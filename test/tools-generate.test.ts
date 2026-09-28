import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildGenerateTools, configuredCloudTts } from '../src/tools/generate.ts'
import type { MachineDeps } from '../src/pipeline/machine.ts'
import { VaultStore } from '../src/store/vault.ts'
import type { SlotBinding, SlotId } from '../src/store/slots.ts'
import { RunStore } from '../src/store/runs.ts'
import { STORY, SCRIPT, SHOTS } from './schema-fixtures.ts'

/** 不可达 host：价目拉取必失败 → est 恒 null（估价未知 → 一律走确认语义，规格 §4.4）。 */
const UNREACHABLE = 'https://mock.invalid'

function fakeImageProvider(url: string) {
  return {
    id: 'fake-image', capabilities: { image: true, qualityTier: 5 },
    quote: async () => ({ qualityTier: 5, costEstimate: 0.2, currency: 'CNY' }),
    submit: async () => ({ jobId: url }),
    status: async () => ({ state: 'done' as const, progress: 100 }),
    fetch: async (jobId: string) => ({ outputs: [jobId] }),
    health: async () => ({ ok: true }),
  }
}

function fakeVideoProvider() {
  return {
    id: 'fake-video', capabilities: { imageToVideo: true, textToVideo: true, qualityTier: 5 },
    quote: async () => ({ qualityTier: 5, costEstimate: 0.013, currency: 'CNY' }),
    submit: async (_stage: string, spec: Record<string, unknown>) => ({ jobId: `task-${String(spec['imageUrl'] ?? 't2v').slice(-6)}` }),
    status: async () => ({ state: 'done' as const, progress: 100 }),
    fetch: async (jobId: string) => ({ outputs: [`https://oss.example/${jobId}.mp4`] }),
    health: async () => ({ ok: true }),
  }
}

const fetchFake = (async (url: unknown) => new Response(Buffer.from(`bytes-of-${String(url).slice(-8)}`), { status: 200 })) as unknown as typeof fetch

/** vault 槽位表 → GenerateContext.slots 的映射形态（与宿主 index.ts 的接线一致）。 */
function slotsRecord(vault: VaultStore): Partial<Record<SlotId, SlotBinding>> {
  const out: Partial<Record<SlotId, SlotBinding>> = {}
  for (const b of vault.listSlotBindings()) out[b.slot] = b
  return out
}

function bindImageSlots(vault: VaultStore): void {
  vault.setSlotBinding({ slot: 'image.master', channelId: 've', model: 'img-model', protocol: 'openai-images' })
  vault.setSlotBinding({ slot: 'image.shot', channelId: 've', model: 'shot-model', protocol: 'openai-images' })
}

function setup(opts: {
  confirmer?: (est: number | null) => Promise<boolean>
  /** 覆盖槽位表（缺省从 vault 现取；传 () => ({}) 模拟全部未绑定）。 */
  slots?: () => Partial<Record<SlotId, SlotBinding>>
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-gen-tools-'))
  const vault = VaultStore.open({ file: join(dir, 'vault.json') })
  vault.createChannel({ id: 've', baseUrl: UNREACHABLE, apiKey: 'sk-vgen-12345678', protocols: ['openai-images', 'openai-video', 'openai-tts'] })
  const runs = RunStore.open({ rootDir: join(dir, 'runs') })
  const run = runs.create('三镜漫剧')
  runs.setStage(run.id, 'story', 'done')
  runs.setStage(run.id, 'script', 'done')
  runs.setStage(run.id, 'storyboard', 'done')
  const rd = join(dir, 'runs', run.id)
  writeFileSync(join(rd, 'story.json'), JSON.stringify(STORY))
  writeFileSync(join(rd, 'script.json'), JSON.stringify(SCRIPT))
  writeFileSync(join(rd, 'storyboard.json'), JSON.stringify({ ...SHOTS, characters: SCRIPT.characters, scenes: SCRIPT.scenes }))
  const env = { DSH_HOME: dir, VGEN_FFMPEG: '' } as unknown as NodeJS.ProcessEnv
  // 记录 forSlot 收到的每次绑定：模型/协议必须来自槽位绑定（单槽单模型，无候选轮询）
  const seen: Array<{ slot: SlotId; model: string; protocol: string }> = []
  const forSlot: MachineDeps['providers']['forSlot'] = (binding, channel, o) => {
    seen.push({ slot: binding.slot, model: binding.model, protocol: binding.protocol })
    void channel
    void o
    return binding.slot === 'video'
      ? fakeVideoProvider()
      : fakeImageProvider(`https://img.example/${binding.model.replace(/\W/g, '-')}.png`)
  }
  const tools = buildGenerateTools({
    vault, runs,
    slots: opts.slots ?? (() => slotsRecord(vault)),
    channelOf: (channelId) => {
      const c = vault.getChannel(channelId)
      if (!c || !c.enabled) return null
      return { id: c.id, label: c.label, baseUrl: c.baseUrl, apiKey: c.apiKey }
    },
    env,
    ...(opts.confirmer ? { confirmer: opts.confirmer } : {}),
    providersOverride: { forSlot },
    fetchImpl: fetchFake,
  })
  return { dir, vault, runs, run, rd, tools, seen }
}

test('vgen_status：返回 run 概要与近期事件；未知 runId 报 not-found', async () => {
  const s = setup()
  try {
    const r = await s.tools.status.execute({ runId: s.run.id }) as { ok: boolean; value: { id: string; stages: Record<string, string> } }
    assert.equal(r.ok, true)
    assert.equal(r.value.id, s.run.id)
    assert.equal(r.value.stages['story'], 'done')
    const miss = await s.tools.status.execute({ runId: 'run-nope' }) as { ok: boolean; error: { code: string } }
    assert.equal(miss.error.code, 'not-found')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('vgen_generate：生产确认路径估价未知被拒 → confirm-required 信封，段置 failed（消息含确认阈值）', async () => {
  const s = setup() // 不注入 confirmer：走生产确认路径；est 恒 null（价目拉取失败容错）
  try {
    bindImageSlots(s.vault)
    s.vault.setBudget(1)
    const r = await s.tools.generate.execute({ runId: s.run.id, target: 'assets' }) as { ok: boolean; error: { code: string; message: string } }
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'confirm-required')
    assert.match(r.error.message, /确认阈值/)
    assert.equal(s.runs.get(s.run.id)!.stages['master-asset'], 'failed')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('vgen_generate：confirm:true 全量放行 → assets 段完成，provider 收到槽位绑定的模型/协议', async () => {
  const s = setup() // 生产确认路径：args.confirm === true 全部放行
  try {
    bindImageSlots(s.vault)
    const r = await s.tools.generate.execute({ runId: s.run.id, target: 'assets', confirm: true }) as { ok: boolean; value?: { stages: Record<string, string>; shots: number } }
    assert.equal(r.ok, true)
    assert.equal(r.value!.stages['master-asset'], 'done')
    assert.equal(r.value!.stages['shot-assets'], 'done')
    assert.equal(r.value!.shots, 3)
    const masterCalls = s.seen.filter((c) => c.slot === 'image.master')
    const shotCalls = s.seen.filter((c) => c.slot === 'image.shot')
    assert.ok(masterCalls.length >= 1 && shotCalls.length >= 1, 'master/shot 两槽都应构造 provider')
    for (const c of [...masterCalls, ...shotCalls]) {
      assert.equal(c.protocol, 'openai-images')
    }
    assert.ok(masterCalls.every((c) => c.model === 'img-model'))
    assert.ok(shotCalls.every((c) => c.model === 'shot-model'))
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('M4: gates 参数校验：非法键/模式 → bad-request，合法 → 持久化进 run.json', async () => {
  const s = setup({ confirmer: async () => true })
  try {
    bindImageSlots(s.vault)
    const badMode = await s.tools.generate.execute({ runId: s.run.id, target: 'assets', gates: { video: 'teleport' } as unknown as Record<string, 'auto' | 'ask' | 'manual'> }) as { ok: boolean; error?: { code: string; message: string } }
    assert.equal(badMode.ok, false)
    assert.equal(badMode.error!.code, 'bad-request')
    assert.match(badMode.error!.message, /auto\|ask\|manual/)
    const badKey = await s.tools.generate.execute({ runId: s.run.id, target: 'assets', gates: { teleport: 'auto' } }) as { ok: boolean; error?: { code: string } }
    assert.equal(badKey.ok, false)
    assert.equal(badKey.error!.code, 'bad-request')
    const r = await s.tools.generate.execute({ runId: s.run.id, target: 'assets', gates: { video: 'manual' } }) as { ok: boolean }
    // video 段在 assets 目标下不执行，gates 仅持久化
    assert.equal(r.ok, true)
    assert.deepEqual(s.runs.get(s.run.id)!.gates, { video: 'manual' })
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('M4: manual gate → manual-gate 信封（指引 vgen_provide），段不执行', async () => {
  const s = setup({ confirmer: async () => true })
  try {
    bindImageSlots(s.vault)
    s.runs.setGates(s.run.id, { 'master-asset': 'manual' })
    const r = await s.tools.generate.execute({ runId: s.run.id, target: 'assets' }) as { ok: boolean; error?: { code: string; message: string } }
    assert.equal(r.ok, false)
    assert.ok(r.error, 'manual gate 必须返回错误信封')
    assert.equal(r.error.code, 'manual-gate')
    assert.match(r.error.message, /vgen_provide/)
    assert.equal(s.runs.get(s.run.id)!.stages['master-asset'] ?? 'pending', 'pending')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('M4: ask gate：未批 → gate-approval 信封；gateApprovals 放行后通过', async () => {
  const s = setup()
  try {
    bindImageSlots(s.vault)
    s.runs.setGates(s.run.id, { 'master-asset': 'ask' })
    const r = await s.tools.generate.execute({ runId: s.run.id, target: 'assets', confirm: true }) as { ok: boolean; error?: { code: string; message: string } }
    assert.equal(r.ok, false)
    assert.ok(r.error, 'ask gate 未批必须返回错误信封')
    assert.equal(r.error.code, 'gate-approval')
    assert.match(r.error.message, /gateApprovals/)
    // 段仍是 pending（未被跳过执行）
    assert.equal(s.runs.get(s.run.id)!.stages['master-asset'] ?? 'pending', 'pending')
    // 用户批准后携带 gateApprovals 重调 → 放行执行
    const r2 = await s.tools.generate.execute({ runId: s.run.id, target: 'assets', confirm: true, gateApprovals: ['master-asset'] }) as { ok: boolean }
    assert.equal(r2.ok, true)
    assert.equal(s.runs.get(s.run.id)!.stages['master-asset'], 'done')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('M4: rerunStage 把已 done 段重置 pending 后重跑；非媒体段 → bad-request', async () => {
  const s = setup({ confirmer: async () => true })
  try {
    bindImageSlots(s.vault)
    const bad = await s.tools.generate.execute({ runId: s.run.id, target: 'assets', rerunStage: 'story' }) as { ok: boolean; error: { code: string; message: string } }
    assert.equal(bad.ok, false)
    assert.match(bad.error.message, /媒体段/)
    s.runs.setStage(s.run.id, 'master-asset', 'done')
    const r = await s.tools.generate.execute({ runId: s.run.id, target: 'assets', rerunStage: 'master-asset' }) as { ok: boolean }
    assert.equal(r.ok, true)
    assert.equal(s.runs.get(s.run.id)!.stages['master-asset'], 'done')
    // 重置后确实重跑了一次（新 run 此前无 stage-start）
    const starts = s.runs.get(s.run.id)!.events.filter((e) => e.type === 'stage-start' && (e.detail as { stage?: string } | undefined)?.['stage'] === 'master-asset')
    assert.equal(starts.length, 1)
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('M4: vgen_status 返回 reviews/gates', async () => {
  const s = setup()
  try {
    s.runs.setGates(s.run.id, { video: 'ask' })
    s.runs.setReview(s.run.id, 'shot-1', { scores: [4], retries: 0, passed: true })
    const r = await s.tools.status.execute({ runId: s.run.id }) as { ok: boolean; value: { gates: Record<string, string>; reviews: Record<string, unknown> } }
    assert.equal(r.ok, true)
    assert.deepEqual(r.value.gates, { video: 'ask' })
    assert.ok(r.value.reviews['shot-1'])
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('vgen_generate：video 段模型一律来自 video 槽绑定（i2v 参考图模式，clips 事件 mode=i2v）', async () => {
  const s = setup() // 替代旧「通道 models 优先于 VGEN_VIDEO_MODEL」：槽位绑定是唯一模型来源
  try {
    bindImageSlots(s.vault)
    s.vault.setSlotBinding({ slot: 'video', channelId: 've', model: 'vid-model', protocol: 'openai-video' })
    // 预置前序段完成 + shot-urls 事件，聚焦 video 段
    s.runs.setStage(s.run.id, 'master-asset', 'done')
    s.runs.setStage(s.run.id, 'shot-assets', 'done')
    s.runs.appendEvent(s.run.id, 'shot-urls', {
      urls: SHOTS.shots.map((x) => ({ index: x.index, url: `https://img.example/shot-${x.index}.png`, file: `shot-${x.index}.png` })),
    })
    const r = await s.tools.generate.execute({ runId: s.run.id, target: 'video', confirm: true }) as { ok: boolean; value?: { clips: number; stages: Record<string, string> } }
    assert.equal(r.ok, true)
    assert.equal(r.value!.stages['video'], 'done')
    assert.equal(r.value!.clips, 3)
    const videoCalls = s.seen.filter((c) => c.slot === 'video')
    assert.ok(videoCalls.length >= 1, 'video 段（含前序校验）应构造 provider')
    for (const c of videoCalls) {
      assert.equal(c.model, 'vid-model')
      assert.equal(c.protocol, 'openai-video')
    }
    const clipsEvent = s.runs.get(s.run.id)!.events.find((e) => e.type === 'clips')
    assert.equal((clipsEvent!.detail as { mode?: string }).mode, 'i2v')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('vgen_generate：video 槽声明 textToVideo 且无参考图 → t2v 降级（clips 事件 mode=t2v）', async () => {
  const s = setup()
  try {
    s.vault.setSlotBinding({
      slot: 'video', channelId: 've', model: 'vid-model', protocol: 'openai-video',
      capabilities: { imageToVideo: false, textToVideo: true },
    })
    s.runs.setStage(s.run.id, 'master-asset', 'done')
    s.runs.setStage(s.run.id, 'shot-assets', 'done') // 无 shot-urls 事件 → 无参考图
    const r = await s.tools.generate.execute({ runId: s.run.id, target: 'video', confirm: true }) as { ok: boolean; value?: { clips: number } }
    assert.equal(r.ok, true)
    assert.equal(r.value!.clips, 3)
    const clipsEvent = s.runs.get(s.run.id)!.events.find((e) => e.type === 'clips')
    assert.equal((clipsEvent!.detail as { mode?: string }).mode, 't2v')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('vgen_generate：有 shot 参考图但 imageToVideo/textToVideo 均未启用 → model-unavailable', async () => {
  const s = setup()
  try {
    s.vault.setSlotBinding({
      slot: 'video', channelId: 've', model: 'vid-model', protocol: 'openai-video',
      capabilities: { imageToVideo: false, textToVideo: false },
    })
    s.runs.setStage(s.run.id, 'master-asset', 'done')
    s.runs.setStage(s.run.id, 'shot-assets', 'done')
    s.runs.appendEvent(s.run.id, 'shot-urls', { urls: [{ index: 1, url: 'https://img.example/shot-1.png', file: 'shot-1.png' }] })
    const r = await s.tools.generate.execute({ runId: s.run.id, target: 'video', confirm: true }) as { ok: boolean; error?: { code: string; message: string } }
    assert.equal(r.ok, false)
    assert.equal(r.error?.code, 'model-unavailable')
    assert.match(r.error?.message ?? '', /imageToVideo\/textToVideo 均未启用/)
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('vgen_generate：slots 为空 → model-unavailable（含用途槽指引），confirmer 零调用、零 spend 事件', async () => {
  let confirmCalls = 0
  const s = setup({
    slots: () => ({}),
    confirmer: async () => { confirmCalls++; return true },
  })
  try {
    const r = await s.tools.generate.execute({ runId: s.run.id, target: 'video', confirm: true }) as { ok: boolean; error?: { code: string; message: string } }
    assert.equal(r.ok, false)
    assert.equal(r.error?.code, 'model-unavailable')
    assert.match(r.error?.message ?? '', /用途槽/)
    assert.match(r.error?.message ?? '', /video/)
    assert.equal(confirmCalls, 0)
    const spends = s.runs.get(s.run.id)!.events.filter((e) => e.type === 'spend')
    assert.equal(spends.length, 0)
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('configuredCloudTts：能力位 voice/instructions 优先于 env（绑定级声明优先）', () => {
  const binding: SlotBinding = { slot: 'tts', channelId: 've', model: 'tts-model', protocol: 'openai-tts', capabilities: { voice: 'Wanwan', instructions: 'calm' } }
  const channel = { id: 've', baseUrl: UNREACHABLE, apiKey: 'sk-vgen-12345678' }
  const cfg = configuredCloudTts(binding, channel, { VGEN_TTS_VOICE: 'env-voice', VGEN_TTS_INSTRUCTIONS: 'env-语气' })
  assert.equal(cfg.baseUrl, UNREACHABLE)
  assert.equal(cfg.model, 'tts-model')
  assert.equal(cfg.voice, 'Wanwan')
  assert.equal(cfg.instructions, 'calm')
})

test('configuredCloudTts：能力位缺省回退 env VGEN_TTS_VOICE/INSTRUCTIONS；再缺省 undefined', () => {
  const binding: SlotBinding = { slot: 'tts', channelId: 've', model: 'tts-model', protocol: 'openai-tts', capabilities: {} }
  const channel = { id: 've', baseUrl: UNREACHABLE, apiKey: 'sk-vgen-12345678' }
  const viaEnv = configuredCloudTts(binding, channel, { VGEN_TTS_VOICE: 'alloy', VGEN_TTS_INSTRUCTIONS: '温柔' })
  assert.equal(viaEnv.voice, 'alloy')
  assert.equal(viaEnv.instructions, '温柔')
  const none = configuredCloudTts(binding, channel, {})
  assert.equal(none.voice, undefined)
  assert.equal(none.instructions, undefined)
})

test('vgen_generate：阈值 0 且估价未知仍 confirm-required（unknown 一律确认）', async () => {
  // 数字阈值的放行分支（est <= threshold → approve）依赖真实网络价目，离线无法构造非 null est，
  // 故此处只覆盖 unknown 恒确认语义：threshold=0 不改变"估价未知必确认"。
  const s = setup()
  try {
    bindImageSlots(s.vault)
    s.vault.setBudget(0)
    const r = await s.tools.generate.execute({ runId: s.run.id, target: 'assets' }) as { ok: boolean; error?: { code: string } }
    assert.equal(r.ok, false)
    assert.equal(r.error?.code, 'confirm-required')
    assert.equal(s.runs.get(s.run.id)!.stages['master-asset'], 'failed')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})
