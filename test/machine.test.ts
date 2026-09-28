import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { advanceRun } from '../src/pipeline/machine.ts'
import { ModelUnavailableError } from '../src/model-selection.ts'
import { RelayError } from '../src/providers/relay-http.ts'
import { RunStore } from '../src/store/runs.ts'
import type { ChannelRef } from '../src/providers/protocols.ts'
import type { SlotBinding, SlotId } from '../src/store/slots.ts'
import { STORY, SCRIPT, SHOTS } from './schema-fixtures.ts'

function fakeImageProvider(url: string, submitSpecs?: Array<Record<string, unknown>>) {
  return {
    id: 'fake-image', capabilities: { image: true, qualityTier: 5 },
    quote: async () => ({ qualityTier: 5, costEstimate: 0.2, currency: 'CNY' }),
    submit: async (_s: string, spec: Record<string, unknown>) => {
      submitSpecs?.push({ ...spec })
      return { jobId: url }
    },
    status: async () => ({ state: 'done' as const, progress: 100 }),
    fetch: async (jobId: string) => ({ outputs: [jobId] }),
    health: async () => ({ ok: true }),
  }
}

function fakeVideoProvider() {
  let polls = 0
  return {
    id: 'fake-video', capabilities: { imageToVideo: true, qualityTier: 5 },
    quote: async () => ({ qualityTier: 5, costEstimate: 0.013, currency: 'CNY' }),
    submit: async (_s: string, spec: Record<string, unknown>) => ({ jobId: `task-${String(spec['imageUrl'] ?? 't2v').slice(-6)}` }),
    status: async () => { polls++; return polls >= 2 ? { state: 'done' as const, progress: 100 } : { state: 'running' as const, progress: 50 } },
    fetch: async (jobId: string) => ({ outputs: [`https://oss.example/${jobId}.mp4`] }),
    health: async () => ({ ok: true }),
  }
}

const fetchFake = (async (url: unknown) => new Response(Buffer.from(`bytes-of-${String(url).slice(-8)}`), { status: 200 })) as unknown as typeof fetch

function slot(slot: SlotId, model: string, capabilities: Record<string, boolean | number> = {}): SlotBinding {
  const protocol = slot === 'video' ? 'dashscope-video' : 'openai-images'
  return { slot, channelId: 've', model, protocol, capabilities } as SlotBinding
}

function slots(overrides: Partial<Record<SlotId, Partial<SlotBinding>>> = {}): Partial<Record<SlotId, SlotBinding>> {
  const base: Partial<Record<SlotId, SlotBinding>> = {
    'image.master': slot('image.master', 'img-model', { sizeParam: true }),
    'image.shot': slot('image.shot', 'img-model', { sizeParam: true }),
    video: slot('video', 'vid-model', { imageToVideo: true, textToVideo: true, maxDurationSec: 10 }),
  }
  for (const [k, v] of Object.entries(overrides)) {
    const cur = base[k as SlotId]
    if (cur && v) base[k as SlotId] = { ...cur, ...v } as SlotBinding
    else if (v) base[k as SlotId] = v as SlotBinding
    else delete base[k as SlotId]
  }
  return base
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-machine-'))
  const runs = RunStore.open({ rootDir: join(dir, 'runs') })
  const run = runs.create('三镜漫剧')
  runs.setStage(run.id, 'story', 'done')
  runs.setStage(run.id, 'script', 'done')
  runs.setStage(run.id, 'storyboard', 'done')
  const rd = join(dir, 'runs', run.id)
  writeFileSync(join(rd, 'story.json'), JSON.stringify(STORY))
  writeFileSync(join(rd, 'script.json'), JSON.stringify(SCRIPT))
  writeFileSync(join(rd, 'storyboard.json'), JSON.stringify({ ...SHOTS, characters: SCRIPT.characters, scenes: SCRIPT.scenes }))
  return { dir, runs, run, rd }
}

const CHANNEL: ChannelRef = { id: 've', baseUrl: 'https://x.example', apiKey: 'k' }

const BASE = {
  slots: slots(),
  channelFor: (binding: SlotBinding): ChannelRef => {
    if (!CHANNEL) throw new Error('no channel')
    void binding
    return CHANNEL
  },
  estimate: () => null,
  concurrency: 2,
  fetchImpl: fetchFake,
}

test('advanceRun 使用槽位绑定模型，不使用任何内置 image/video 默认值', async () => {
  const s = setup()
  try {
    const requested: string[] = []
    const providers = {
      forSlot: (binding: SlotBinding) => {
        requested.push(binding.model)
        return binding.slot === 'video'
          ? fakeVideoProvider()
          : fakeImageProvider(`https://img.example/${binding.model}.png`)
      },
    }
    await advanceRun({ ...BASE, runs: s.runs, runId: s.run.id, target: 'video', providers, confirmer: async () => true, ffmpeg: null, pollDelayMs: 1 })
    assert.ok(requested.includes('img-model'))
    assert.ok(requested.includes('vid-model'))
    assert.ok(!requested.some((model) => /happyhorse|doubao-seedream/.test(model)))
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('video 槽能力位 imageToVideo/textToVideo 均未启用 → confirmer 前 model-unavailable', async () => {
  const s = setup()
  try {
    s.runs.setStage(s.run.id, 'master-asset', 'done')
    s.runs.setStage(s.run.id, 'shot-assets', 'done')
    s.runs.appendEvent(s.run.id, 'shot-urls', { urls: [{ index: 1, url: 'https://oss.example/ref-1.png', file: join(s.rd, 'shots', 'shot-001.png') }] })
    let confirmCalls = 0
    await assert.rejects(
      advanceRun({
        ...BASE,
        slots: slots({ video: { capabilities: { imageToVideo: false, textToVideo: false } } }),
        runs: s.runs,
        runId: s.run.id,
        target: 'video',
        providers: { forSlot: () => fakeVideoProvider() },
        confirmer: async () => { confirmCalls++; return true },
        ffmpeg: null,
        pollDelayMs: 1,
      }),
      (err: unknown) => err instanceof ModelUnavailableError
        && err.code === 'model-unavailable'
        && err.message.includes('视频')
        && err.message.includes('能力位'),
    )
    assert.equal(confirmCalls, 0)
    assert.equal(s.runs.get(s.run.id)!.events.filter((e) => e.type === 'spend' && e.detail?.['stage'] === 'video').length, 0)
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('未绑定槽消费 → model-unavailable 且零确认零花费；image.shot 未绑定回落 image.master', async () => {
  const s = setup()
  try {
    // video 槽未绑定
    await assert.rejects(
      advanceRun({ ...BASE, slots: { 'image.master': slot('image.master', 'img-model') }, runs: s.runs, runId: s.run.id, target: 'video', providers: { forSlot: () => fakeVideoProvider() }, confirmer: async () => true, ffmpeg: null }),
      (err: unknown) => err instanceof ModelUnavailableError && err.message.includes('用途槽'),
    )
    // image.shot 未绑定 → 回落 image.master（同模型同通道）
    const used: SlotBinding[] = []
    const r = await advanceRun({
      ...BASE,
      slots: { 'image.master': slot('image.master', 'master-only') },
      runs: s.runs, runId: s.run.id, target: 'shot-assets',
      providers: { forSlot: (b) => { used.push(b); return fakeImageProvider(`https://img.example/${b.slot}.png`) } },
      confirmer: async () => true, ffmpeg: null,
    })
    assert.equal(r.stages['shot-assets'], 'done')
    assert.ok(used.every((b) => b.model === 'master-only'), '回落到主图槽模型')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('t2v 降级：无参考图且 textToVideo 启用 → 无 imageUrl 提交并落 mode=t2v 事件', async () => {
  const s = setup()
  try {
    s.runs.setStage(s.run.id, 'master-asset', 'done')
    s.runs.setStage(s.run.id, 'shot-assets', 'done')
    const specs: Array<Record<string, unknown>> = []
    const t2vProvider = {
      id: 'fake-t2v', capabilities: { textToVideo: true, qualityTier: 5 },
      quote: async () => ({ qualityTier: 5, costEstimate: 0.013, currency: 'CNY' }),
      submit: async (_s: string, spec: Record<string, unknown>) => { specs.push({ ...spec }); return { jobId: 'task-t2v' } },
      status: async () => ({ state: 'done' as const, progress: 100 }),
      fetch: async (jobId: string) => ({ outputs: [`https://oss.example/${jobId}.mp4`] }),
      health: async () => ({ ok: true }),
    }
    const r = await advanceRun({
      ...BASE,
      slots: slots({ video: { capabilities: { imageToVideo: false, textToVideo: true } } }),
      runs: s.runs, runId: s.run.id, target: 'video',
      providers: { forSlot: (b: SlotBinding) => b.slot === 'video' ? t2vProvider : fakeImageProvider('https://img.example/x.png') },
      confirmer: async () => true, ffmpeg: null, pollDelayMs: 1,
    })
    assert.equal(r.stages['video'], 'done')
    assert.equal(r.clipFiles?.length, 3)
    assert.ok(specs.length > 0 && specs.every((x) => x['imageUrl'] === undefined), 't2v 提交不带参考图')
    const ev = s.runs.get(s.run.id)!.events.find((e) => e.type === 'clips')
    assert.equal((ev?.detail as { mode?: string } | undefined)?.mode, 't2v')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('advanceRun assets+video：三视图/场景/参考图/克隆下载落盘，断点续跑跳过已完成段', async () => {
  const s = setup()
  try {
    const providers = { forSlot: (binding: SlotBinding) => binding.slot === 'video' ? fakeVideoProvider() : fakeImageProvider(`https://img.example/${binding.model}.png`) }
    const common = { ...BASE, runs: s.runs, runId: s.run.id, providers, confirmer: async () => true, ffmpeg: null }
    const r1 = await advanceRun({ ...common, target: 'shot-assets' })
    assert.equal(r1.stages['master-asset'], 'done')
    assert.equal(r1.stages['shot-assets'], 'done')
    assert.ok(existsSync(join(s.rd, 'assets', 'char-linjing.png')))
    assert.ok(existsSync(join(s.rd, 'assets', 'scene-s1.png')))
    assert.equal(r1.shotImages?.length, 3)
    assert.ok(existsSync(join(s.rd, 'shots', 'shot-001.png')))
    const r2 = await advanceRun({ ...common, target: 'video' })
    assert.equal(r2.stages['video'], 'done')
    assert.equal(r2.clipFiles?.length, 3)
    assert.ok(existsSync(join(s.rd, 'clips', 'shot-001.mp4')))
    // 断点续跑：重推 video 不新增 clips 事件
    const evBefore = s.runs.get(s.run.id)!.events.filter((e) => e.type === 'clips').length
    await advanceRun({ ...common, target: 'video' })
    assert.equal(s.runs.get(s.run.id)!.events.filter((e) => e.type === 'clips').length, evBefore)
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('pump 失败熔断：首镜失败后不再 submit 后续镜头（旧实现会打满 5 次）', async () => {
  const s = setup()
  try {
    const fiveShots = {
      characters: SCRIPT.characters,
      scenes: SCRIPT.scenes,
      shots: Array.from({ length: 5 }, (_, i) => ({
        index: i + 1, line: `镜头${i + 1}`, prompt: `画面${i + 1}`, characterIds: ['linjing'], sceneId: 's1', camera: '中景', durationSec: 3,
      })),
    }
    writeFileSync(join(s.rd, 'storyboard.json'), JSON.stringify({ ...fiveShots, characters: SCRIPT.characters, scenes: SCRIPT.scenes }))
    s.runs.setStage(s.run.id, 'master-asset', 'done')
    s.runs.setStage(s.run.id, 'shot-assets', 'done')
    s.runs.appendEvent(s.run.id, 'shot-urls', { urls: Array.from({ length: 5 }, (_, i) => ({ index: i + 1, url: `https://oss.example/ref-${i + 1}.png`, file: join(s.rd, 'shots', `shot-00${i + 1}.png`) })) })
    let submitCalls = 0
    const failingVideo = {
      id: 'fake-video-fuse', capabilities: { imageToVideo: true, qualityTier: 5 },
      quote: async () => ({ qualityTier: 5, costEstimate: 0.013, currency: 'CNY' }),
      submit: async (_s: string, spec: Record<string, unknown>) => {
        submitCalls++
        const n = Number(String(spec['imageUrl']).match(/ref-(\d)/)?.[1])
        if (n >= 2) throw new Error(`shot ${n} 提交被拒`)
        return { jobId: 'task-1' }
      },
      status: async () => ({ state: 'done' as const, progress: 100 }),
      fetch: async (jobId: string) => ({ outputs: [`https://oss.example/${jobId}.mp4`] }),
      health: async () => ({ ok: true }),
    }
    const providers = { forSlot: (b: SlotBinding) => b.slot === 'video' ? failingVideo : fakeImageProvider('https://img.example/x.png') }
    await assert.rejects(
      advanceRun({ ...BASE, runs: s.runs, runId: s.run.id, target: 'video', providers, confirmer: async () => true, ffmpeg: null, pollDelayMs: 1 }),
      /提交被拒/,
    )
    await new Promise((r) => setTimeout(r, 120)) // 给旧实现的"继续烧"窗口
    assert.ok(submitCalls <= 2, `首镜失败后仍提交了后续镜头：submit 共 ${submitCalls} 次`)
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('gate ask：ask 返回 false -> 报审批拒绝；未提供 ask 通道 -> 明确报错', async () => {
  const s = setup()
  try {
    const providers = { forSlot: () => fakeImageProvider('https://img.example/x.png') }
    await assert.rejects(
      advanceRun({ ...BASE, runs: s.runs, runId: s.run.id, target: 'master-asset', providers, confirmer: async () => true, ffmpeg: null, gates: { 'master-asset': 'ask' }, ask: async () => false }),
      /ask 审批中被拒绝/,
    )
    await assert.rejects(
      advanceRun({ ...BASE, runs: s.runs, runId: s.run.id, target: 'master-asset', providers, confirmer: async () => true, ffmpeg: null, gates: { 'master-asset': 'ask' } }),
      /未提供 ask 通道/,
    )
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('video 段 provider failed：段置 failed 并 rethrow', async () => {
  const s = setup()
  try {
    const failing = {
      id: 'fake-video-fail', capabilities: { imageToVideo: true, qualityTier: 5 },
      quote: async () => ({ qualityTier: 5, costEstimate: 0.013, currency: 'CNY' }),
      submit: async () => ({ jobId: 'task-f' }),
      status: async () => ({ state: 'failed' as const, progress: null, error: '内容审核未通过' }),
      fetch: async () => ({ outputs: [] }),
      health: async () => ({ ok: true }),
    }
    const common = { ...BASE, runs: s.runs, runId: s.run.id, confirmer: async () => true, ffmpeg: null }
    await advanceRun({ ...common, target: 'shot-assets', providers: { forSlot: () => fakeImageProvider('https://img.example/x.png') } })
    await assert.rejects(
      advanceRun({ ...common, target: 'video', providers: { forSlot: (b: SlotBinding) => b.slot === 'video' ? failing : fakeImageProvider('https://img.example/x.png') } }),
      /内容审核/,
    )
    assert.equal(s.runs.get(s.run.id)!.stages['video'], 'failed')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('advanceRun：确认被拒 -> 报用户取消；gate manual 未提供产物 -> 明确报错', async () => {
  const s = setup()
  try {
    const providers = { forSlot: () => fakeImageProvider('https://img.example/x.png') }
    await assert.rejects(
      advanceRun({ ...BASE, runs: s.runs, runId: s.run.id, target: 'master-asset', providers, confirmer: async () => false, ffmpeg: null }),
      /取消/,
    )
    await assert.rejects(
      advanceRun({ ...BASE, runs: s.runs, runId: s.run.id, target: 'master-asset', providers, confirmer: async () => true, ffmpeg: null, gates: { 'master-asset': 'manual' } }),
      /manual/,
    )
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('M4: shot-assets 提交带竖版 size（1024x1536）；sizeParam=false 时不带 size', async () => {
  const s = setup()
  try {
    const submitSpecs: Array<Record<string, unknown>> = []
    const providers = { forSlot: () => fakeImageProvider('https://img.example/shot.png', submitSpecs) }
    s.runs.setStage(s.run.id, 'master-asset', 'done')
    const r = await advanceRun({ ...BASE, runs: s.runs, runId: s.run.id, target: 'shot-assets', providers, confirmer: async () => true, ffmpeg: null })
    assert.equal(r.stages['shot-assets'], 'done')
    assert.equal(submitSpecs.length, 3) // 3 镜各一次
    for (const spec of submitSpecs) assert.equal(spec['size'], '1024x1536')

    const specs2: Array<Record<string, unknown>> = []
    s.runs.setStage(s.run.id, 'shot-assets', 'pending')
    await advanceRun({
      ...BASE,
      slots: slots({ 'image.shot': { capabilities: { sizeParam: false } } }),
      runs: s.runs, runId: s.run.id, target: 'shot-assets',
      providers: { forSlot: () => fakeImageProvider('https://img.example/shot.png', specs2) },
      confirmer: async () => true, ffmpeg: null,
    })
    assert.equal(specs2.length, 3)
    for (const spec of specs2) assert.equal(spec['size'], undefined)
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('M4: 服务端 400 时单次降级重提（无 size），size-fallback 事件入流', async () => {
  const s = setup()
  try {
    const submitSpecs: Array<Record<string, unknown>> = []
    const fallbackImage = {
      id: 'fake-image-400', capabilities: { image: true, qualityTier: 5 },
      quote: async () => ({ qualityTier: 5, costEstimate: 0.2, currency: 'CNY' }),
      submit: async (_s: string, spec: Record<string, unknown>) => {
        submitSpecs.push({ ...spec })
        if (spec['size'] !== undefined) throw new RelayError(400, 'size 参数不支持')
        return { jobId: 'https://img.example/fallback.png' }
      },
      status: async () => ({ state: 'done' as const, progress: 100 }),
      fetch: async (jobId: string) => ({ outputs: [jobId] }),
      health: async () => ({ ok: true }),
    }
    const providers = { forSlot: () => fallbackImage }
    s.runs.setStage(s.run.id, 'master-asset', 'done')
    const r = await advanceRun({ ...BASE, runs: s.runs, runId: s.run.id, target: 'shot-assets', providers, confirmer: async () => true, ffmpeg: null })
    assert.equal(r.stages['shot-assets'], 'done')
    assert.equal(submitSpecs.length, 6) // 3 镜 ×（带 size 400 + 无 size 重提），降级只发生一次
    assert.equal(submitSpecs.filter((x) => x['size'] !== undefined).length, 3)
    assert.equal(submitSpecs.filter((x) => x['size'] === undefined).length, 3)
    const shotSpec = submitSpecs.find((x) => x['size'] !== undefined)
    assert.equal(shotSpec?.['size'], '1024x1536')
    const fb = s.runs.get(s.run.id)!.events.filter((e) => e.type === 'size-fallback')
    assert.equal(fb.length, 3, '每镜各落一笔 size-fallback')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('M4: master-asset 角色卡横版 size / 场景图竖版 size', async () => {
  const s = setup()
  try {
    const submitSpecs: Array<Record<string, unknown>> = []
    const providers = { forSlot: () => fakeImageProvider('https://img.example/x.png', submitSpecs) }
    const r = await advanceRun({ ...BASE, runs: s.runs, runId: s.run.id, target: 'master-asset', providers, confirmer: async () => true, ffmpeg: null })
    assert.equal(r.stages['master-asset'], 'done')
    assert.ok(submitSpecs.length >= 2)
    assert.ok(submitSpecs.some((x) => x['size'] === '1536x1024'), 'char 任务应横版 1536x1024')
    assert.ok(submitSpecs.some((x) => x['size'] === '1024x1536'), 'scene 任务应竖版 1024x1536')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('recordSpend 回调：每次 submit 成功落一条（image/video 均含）', async () => {
  const s = setup()
  try {
    const recorded: Array<{ kind: string; model: string }> = []
    const providers = {
      forSlot: (b: SlotBinding) => b.slot === 'video' ? fakeVideoProvider() : fakeImageProvider(`https://img.example/${b.model}.png`),
    }
    await advanceRun({
      ...BASE, runs: s.runs, runId: s.run.id, target: 'video', providers,
      confirmer: async () => true, ffmpeg: null, pollDelayMs: 1,
      recordSpend: (e) => recorded.push({ kind: e.kind, model: e.model }),
    })
    assert.ok(recorded.filter((e) => e.kind === 'image').length >= 4, 'master(2+1) + shot(3)')
    assert.equal(recorded.filter((e) => e.kind === 'video').length, 3)
    assert.ok(recorded.every((e) => e.model === 'img-model' || e.model === 'vid-model'))
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

/* ── P1：music 段（BGM）────────────────────────────── */

function fakeMusicProvider(opts: { fail?: boolean } = {}, specs: Array<Record<string, unknown>> = []) {
  return {
    id: 'fake-music', capabilities: { tts: true, qualityTier: 5 },
    quote: async () => ({ qualityTier: 5, costEstimate: 0.3, currency: 'CNY' }),
    submit: async (_s: string, spec: Record<string, unknown>) => {
      specs.push({ ...spec })
      if (opts.fail) throw new Error('music upstream error')
      return { jobId: 'mus-1' }
    },
    status: async () => ({ state: 'done' as const, progress: 100 }),
    fetch: async () => ({ outputs: ['https://oss.example/bgm.mp3'] }),
    health: async () => ({ ok: true }),
  }
}

test('P1 music 段：绑定 bgm 槽 → music/bgm.mp3 落盘 + music-done + spend(kind=music)', async () => {
  const s = setup()
  try {
    const musicSpecs: Array<Record<string, unknown>> = []
    const spend: Array<{ kind: string; model: string }> = []
    const providers = {
      forSlot: (b: SlotBinding) => b.slot === 'music.bgm' ? fakeMusicProvider({}, musicSpecs) : fakeImageProvider(`https://img.example/${b.slot}.png`),
    }
    const r = await advanceRun({
      ...BASE, slots: slots({ 'music.bgm': slot('music.bgm', 'bgm-model') }),
      runs: s.runs, runId: s.run.id, target: 'music', providers,
      confirmer: async () => true, ffmpeg: null, pollDelayMs: 1,
      recordSpend: (e: { kind: string; model: string }) => spend.push({ kind: e.kind, model: e.model }),
    })
    assert.equal(r.stages['music'], 'done')
    assert.ok(existsSync(join(s.rd, 'music', 'bgm.mp3')))
    assert.ok(String(musicSpecs[0]!['prompt']).includes('Instrumental background music'))
    assert.equal(musicSpecs[0]!['instrumental'], true)
    assert.ok(Number(musicSpecs[0]!['durationSec']) >= 15, '时长请求 = 分镜合计（下限 15s）')
    const ev = s.runs.get(s.run.id)!.events.find((e) => e.type === 'music-done')
    assert.equal((ev?.detail as { file?: string } | undefined)?.file, 'music/bgm.mp3')
    assert.ok(s.runs.get(s.run.id)!.events.some((e) => e.type === 'spend' && e.detail?.['stage'] === 'music'))
    assert.ok(spend.some((e) => e.kind === 'music' && e.model === 'bgm-model'), 'music 提交落账（target=music 含前序 image 段，不精确全等）')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('P1 music 段：bgm 未绑定 → music-skip 留痕不阻断（D6）', async () => {
  const s = setup()
  try {
    const r = await advanceRun({
      ...BASE, runs: s.runs, runId: s.run.id, target: 'music',
      providers: { forSlot: () => fakeImageProvider('https://img.example/x.png') },
      confirmer: async () => true, ffmpeg: null,
    })
    assert.notEqual(r.stages['music'], 'done')
    assert.ok(s.runs.get(s.run.id)!.events.some((e) => e.type === 'music-skip'))
    assert.ok(!s.runs.get(s.run.id)!.events.some((e) => e.type === 'spend' && e.detail?.['stage'] === 'music'), '跳过路径零花费')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('P1 music 段：显式 target=music 失败 → rethrow + 段 failed', async () => {
  const s = setup()
  try {
    const providers = {
      forSlot: (b: SlotBinding) => b.slot === 'music.bgm' ? fakeMusicProvider({ fail: true }) : fakeImageProvider('https://img.example/x.png'),
    }
    await assert.rejects(
      advanceRun({
        ...BASE, slots: slots({ 'music.bgm': slot('music.bgm', 'bgm-model') }),
        runs: s.runs, runId: s.run.id, target: 'music', providers,
        confirmer: async () => true, ffmpeg: null,
      }),
      /music upstream error/,
    )
    assert.equal(s.runs.get(s.run.id)!.stages['music'], 'failed')
    assert.ok(s.runs.get(s.run.id)!.events.some((e) => e.type === 'music-failed'))
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('P1 music 段：过段失败不阻断 final-cut（D6——错误被吞，成片链继续走到自己的报错）', async () => {
  const s = setup()
  try {
    s.runs.setStage(s.run.id, 'master-asset', 'done')
    s.runs.setStage(s.run.id, 'shot-assets', 'done')
    s.runs.setStage(s.run.id, 'video', 'done')
    const providers = {
      forSlot: (b: SlotBinding) => b.slot === 'music.bgm' ? fakeMusicProvider({ fail: true }) : fakeImageProvider('https://img.example/x.png'),
    }
    await assert.rejects(
      advanceRun({
        ...BASE, slots: slots({ 'music.bgm': slot('music.bgm', 'bgm-model') }),
        runs: s.runs, runId: s.run.id, target: 'final-cut', providers,
        confirmer: async () => true, ffmpeg: null,
      }),
      /未找到 ffmpeg/, 'final-cut 自己的报错（而非 music 错误）——音乐失败已被吞',
    )
    assert.equal(s.runs.get(s.run.id)!.stages['music'], 'failed')
    assert.ok(s.runs.get(s.run.id)!.events.some((e) => e.type === 'music-failed'))
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})
