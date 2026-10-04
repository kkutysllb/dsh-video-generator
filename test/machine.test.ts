import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { advanceRun, RunInterruptedError } from '../src/pipeline/machine.ts'
import { ModelUnavailableError } from '../src/model-selection.ts'
import { HandoffError } from '../src/schema/handoff.ts'
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
    // 全量重做意图（size 能力位翻转后所有镜都要按新 size 重提）：显式落 stage-redo 使旧条目作废
    s.runs.appendEvent(s.run.id, 'stage-redo', { stage: 'shot-assets' })
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

/* ── P2：mode=mv（先曲后镜 + 网格/score）────────────── */

test('P2 mode=mv：music 段走 music.song 槽 + 注入歌词 + score.json（grid 溯源）', async () => {
  const s = setup()
  try {
    s.runs.setMode(s.run.id, 'mv')
    writeFileSync(join(s.rd, 'lyrics.json'), JSON.stringify({ lyrics: '[Verse]\n第一句\n第二句\n[Chorus]\n副歌\n桥段\n尾声' }))
    const musicSpecs: Array<Record<string, unknown>> = []
    const providers = {
      forSlot: (b: SlotBinding) => {
        if (b.slot === 'music.song') {
          return {
            id: 'fake-song', capabilities: { tts: true, qualityTier: 5 },
            quote: async () => ({ qualityTier: 5, costEstimate: 0.9, currency: 'CNY' }),
            submit: async (_s: string, spec: Record<string, unknown>) => { musicSpecs.push({ ...spec }); return { jobId: 'song-1' } },
            status: async () => ({ state: 'done' as const, progress: 100 }),
            fetch: async () => ({ outputs: ['https://oss.example/song.mp3'], meta: { sections: [{ label: 'Intro', startSec: 0, endSec: 8 }, { label: 'Chorus', startSec: 8, endSec: 15 }] } }),
            health: async () => ({ ok: true }),
          }
        }
        return fakeImageProvider(`https://img.example/${b.slot}.png`)
      },
    }
    const r = await advanceRun({
      ...BASE, slots: slots({ 'music.song': slot('music.song', 'song-model') }),
      runs: s.runs, runId: s.run.id, target: 'music', providers,
      confirmer: async () => true, ffmpeg: null, pollDelayMs: 1,
    })
    assert.equal(r.stages['music'], 'done')
    assert.ok(existsSync(join(s.rd, 'music', 'song.mp3')))
    // 提交契约：instrumental=false + 歌词注入
    assert.equal(musicSpecs[0]!['instrumental'], false)
    assert.ok(String(musicSpecs[0]!['lyrics']).includes('[Chorus]'))
    // score.json：grid.source=api（适配器 sections 命中）+ 歌词行时间轴
    const score = JSON.parse(readFileSync(join(s.rd, 'music', 'score.json'), 'utf8')) as { kind: string; grid: { source: string; sections: unknown[] }; lyrics: unknown[] }
    assert.equal(score.kind, 'song')
    assert.equal(score.grid.source, 'api')
    assert.equal(score.grid.sections.length, 2)
    assert.ok(score.lyrics.length >= 2, '歌词行时间轴已生成')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('P2 mode=mv：music.song 未绑定 → music-skip（原因指明 MV 主曲）', async () => {
  const s = setup()
  try {
    // setup 不支持 mode——直接 setMode
    s.runs.setMode(s.run.id, 'mv')
    const r = await advanceRun({
      ...BASE, runs: s.runs, runId: s.run.id, target: 'music',
      providers: { forSlot: () => fakeImageProvider('https://img.example/x.png') },
      confirmer: async () => true, ffmpeg: null,
    })
    assert.notEqual(r.stages['music'], 'done')
    const ev = s.runs.get(s.run.id)!.events.find((e) => e.type === 'music-skip')
    assert.match(String((ev?.detail as { reason?: string }).reason), /music\.song/)
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('P2 mode=mv：song 槽推进但无歌词 → bad-request（确认之前抛出、零花费，规格 §6.2）', async () => {
  const s = setup()
  try {
    s.runs.setMode(s.run.id, 'mv')
    const confirmKinds: string[] = []
    let threw: unknown = null
    try {
      await advanceRun({
        ...BASE, slots: slots({ 'music.song': slot('music.song', 'song-model') }),
        runs: s.runs, runId: s.run.id, target: 'music',
        providers: { forSlot: () => fakeImageProvider('https://img.example/x.png') },
        confirmer: async (_est, kind) => { confirmKinds.push(kind); return true },
        ffmpeg: null, pollDelayMs: 1,
      })
    } catch (err) { threw = err }
    assert.ok(threw instanceof HandoffError, `抛 HandoffError，实际: ${String(threw)}`)
    assert.equal((threw as HandoffError).code, 'bad-request')
    assert.ok(/歌词/.test((threw as Error).message), '消息指引先补歌词')
    assert.ok(!confirmKinds.includes('music'), 'music 段确认之前抛出（不触发确认交互）')
    assert.equal(s.runs.get(s.run.id)!.stages['music'], 'failed')
    assert.equal(
      s.runs.get(s.run.id)!.events.filter((e) => e.type === 'spend' && e.detail?.['stage'] === 'music').length, 0,
      'music 段零 spend 事件',
    )
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('spend 事件含 channel 字段（规格 §4.4 记账四元组）', async () => {
  const s = setup()
  try {
    await advanceRun({
      ...BASE, runs: s.runs, runId: s.run.id, target: 'shot-assets',
      providers: { forSlot: () => fakeImageProvider('https://img.example/a.png') },
      confirmer: async () => true, ffmpeg: null, pollDelayMs: 1,
    })
    const spend = s.runs.get(s.run.id)!.events.find((e) => e.type === 'spend')
    assert.ok(spend, 'spend 事件存在')
    assert.equal(spend!.detail?.['channel'], 've', 'run 内 spend 事件带通道 id')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

/* ── 取消感知与 music 断点续跑（规格 §5.1 / §13）────────── */

test('abort 感知：宿主停用立即中断在飞轮询（RunInterruptedError + run-interrupted 事件）', async () => {
  const s = setup()
  try {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 120)
    const neverDone = {
      id: 'fake-never', capabilities: { imageToVideo: true, qualityTier: 5 },
      quote: async () => ({ qualityTier: 5, costEstimate: 0.013, currency: 'CNY' }),
      submit: async () => ({ jobId: 'task-x' }),
      status: async () => ({ state: 'running' as const, progress: 10 }),
      fetch: async () => ({ outputs: [] }),
      health: async () => ({ ok: true }),
    }
    await assert.rejects(
      advanceRun({
        ...BASE, runs: s.runs, runId: s.run.id, target: 'video',
        providers: { forSlot: (b: SlotBinding) => (b.slot === 'video' ? neverDone : fakeImageProvider(`https://img.example/${b.slot}.png`)) },
        confirmer: async () => true, ffmpeg: null, pollDelayMs: 5000, signal: controller.signal,
      }),
      RunInterruptedError,
    )
    const rec = s.runs.get(s.run.id)!
    assert.equal(rec.status, 'failed')
    assert.ok(rec.events.some((e) => e.type === 'run-interrupted'), 'run-interrupted 事件留痕')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('music 断点续跑：中止后重推续查同一 jobId，不重复提交计费（规格 §5.1）', async () => {
  const s = setup()
  try {
    s.runs.setMode(s.run.id, 'mv')
    writeFileSync(join(s.rd, 'lyrics.json'), JSON.stringify({ lyrics: '[Verse]\n第一句\n[Chorus]\n副歌' }))
    let submits = 0
    let done = false
    const musicProvider = {
      id: 'fake-song', capabilities: { tts: true, qualityTier: 5 },
      quote: async () => ({ qualityTier: 5, costEstimate: 0.9, currency: 'CNY' }),
      submit: async () => { submits++; return { jobId: `song-${submits}` } },
      status: async () => (done ? { state: 'done' as const, progress: 100 } : { state: 'running' as const, progress: 10 }),
      fetch: async () => ({ outputs: ['https://oss.example/song.mp3'] }),
      health: async () => ({ ok: true }),
    }
    const forSlot = (b: SlotBinding) => (b.slot === 'music.song' ? musicProvider : fakeImageProvider(`https://img.example/${b.slot}.png`))
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 120)
    await assert.rejects(
      advanceRun({
        ...BASE, slots: slots({ 'music.song': slot('music.song', 'song-model') }),
        runs: s.runs, runId: s.run.id, target: 'music', providers: { forSlot },
        confirmer: async () => true, ffmpeg: null, pollDelayMs: 5000, signal: controller.signal,
      }),
      RunInterruptedError,
    )
    assert.equal(submits, 1)
    assert.ok(s.runs.get(s.run.id)!.events.some((e) => e.type === 'music-job'), 'music-job 事件留痕')
    // 重推：上游任务已完成 → 续查同一 jobId，不再提交
    done = true
    const r = await advanceRun({
      ...BASE, slots: slots({ 'music.song': slot('music.song', 'song-model') }),
      runs: s.runs, runId: s.run.id, target: 'music', providers: { forSlot },
      confirmer: async () => true, ffmpeg: null, pollDelayMs: 1,
    })
    assert.equal(submits, 1, '续跑不重复提交（不重复计费）')
    assert.equal(r.stages['music'], 'done')
    assert.ok(s.runs.get(s.run.id)!.events.some((e) => e.type === 'music-resume'), 'music-resume 事件留痕')
    assert.ok(existsSync(join(s.rd, 'music', 'song.mp3')))
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('music 上游判死（failed 终态）后重推重新提交，不续查死任务', async () => {
  const s = setup()
  try {
    s.runs.setMode(s.run.id, 'mv')
    writeFileSync(join(s.rd, 'lyrics.json'), JSON.stringify({ lyrics: '[Verse]\n第一句\n[Chorus]\n副歌' }))
    let submits = 0
    let fail = true
    const musicProvider = {
      id: 'fake-song', capabilities: { tts: true, qualityTier: 5 },
      quote: async () => ({ qualityTier: 5, costEstimate: 0.9, currency: 'CNY' }),
      submit: async () => { submits++; return { jobId: `song-${submits}` } },
      status: async () => (fail ? { state: 'failed' as const, progress: 0, error: '内容审核未通过' } : { state: 'done' as const, progress: 100 }),
      fetch: async () => ({ outputs: ['https://oss.example/song.mp3'] }),
      health: async () => ({ ok: true }),
    }
    const forSlot = (b: SlotBinding) => (b.slot === 'music.song' ? musicProvider : fakeImageProvider(`https://img.example/${b.slot}.png`))
    await assert.rejects(
      advanceRun({
        ...BASE, slots: slots({ 'music.song': slot('music.song', 'song-model') }),
        runs: s.runs, runId: s.run.id, target: 'music', providers: { forSlot },
        confirmer: async () => true, ffmpeg: null, pollDelayMs: 1,
      }),
      /音乐生成失败/,
    )
    assert.equal(submits, 1)
    assert.ok(s.runs.get(s.run.id)!.events.some((e) => e.type === 'music-job-dead'), 'music-job-dead 事件留痕')
    fail = false
    const r = await advanceRun({
      ...BASE, slots: slots({ 'music.song': slot('music.song', 'song-model') }),
      runs: s.runs, runId: s.run.id, target: 'music', providers: { forSlot },
      confirmer: async () => true, ffmpeg: null, pollDelayMs: 1,
    })
    assert.equal(submits, 2, '死任务不续查，重新提交新任务')
    assert.equal(r.stages['music'], 'done')
    assert.ok(!s.runs.get(s.run.id)!.events.some((e) => e.type === 'music-resume'), '无 music-resume')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

/* ── master-asset/shot-assets 条目级断点续跑（规格 §5.1「已完成段不重花钱」；600s 工具窗口掐断可续） ── */

test('master-asset 条目级续跑：段中途失败重推，已付费条目跳过不重复提交；stage-redo 使条目作废', async () => {
  const s = setup()
  try {
    // 首推：第 1 个条目（char:linjing）完成后第 2 次确认处掐断（模拟 600s 工具窗口上限）
    let confirms = 0
    const specs1: Array<Record<string, unknown>> = []
    await assert.rejects(
      advanceRun({
        ...BASE, runs: s.runs, runId: s.run.id, target: 'master-asset', concurrency: 1,
        providers: { forSlot: () => fakeImageProvider('https://img.example/m1.png', specs1) },
        confirmer: async () => { confirms++; if (confirms >= 2) throw new Error('模拟工具窗口掐断'); return true },
        ffmpeg: null,
      }),
      /模拟工具窗口掐断/,
    )
    const run1 = s.runs.get(s.run.id)!
    assert.equal(run1.stages['master-asset'], 'failed')
    assert.equal(specs1.length, 1, '掐断前只提交了 1 个条目')
    assert.equal(run1.events.filter((e) => e.type === 'asset-item').length, 1, '完成条目留痕 asset-item')
    const charFile = join(s.rd, 'assets', 'char-linjing.png')
    assert.ok(existsSync(charFile), '已完成条目产物在盘')

    // 重推（无 rerunStage）：已付费条目跳过（不重复提交/计费），只补漏的 scene 条目
    const specs2: Array<Record<string, unknown>> = []
    const r2 = await advanceRun({
      ...BASE, runs: s.runs, runId: s.run.id, target: 'master-asset', concurrency: 1,
      providers: { forSlot: () => fakeImageProvider('https://img.example/m2.png', specs2) },
      confirmer: async () => true, ffmpeg: null,
    })
    assert.equal(r2.stages['master-asset'], 'done')
    assert.equal(specs2.length, 1, '重推只补提交未完成的 scene 条目')
    assert.equal(s.runs.get(s.run.id)!.events.filter((e) => e.type === 'asset-item').length, 2)
    assert.ok(existsSync(join(s.rd, 'assets', 'scene-s1.png')))

    // 显式重做（rerunStage 落 stage-redo）：旧条目全部作废，重新提交全部条目
    s.runs.setStage(s.run.id, 'master-asset', 'pending')
    s.runs.appendEvent(s.run.id, 'stage-redo', { stage: 'master-asset' })
    const specs3: Array<Record<string, unknown>> = []
    const r3 = await advanceRun({
      ...BASE, runs: s.runs, runId: s.run.id, target: 'master-asset', concurrency: 1,
      providers: { forSlot: () => fakeImageProvider('https://img.example/m3.png', specs3) },
      confirmer: async () => true, ffmpeg: null,
    })
    assert.equal(r3.stages['master-asset'], 'done')
    assert.equal(specs3.length, 2, 'stage-redo 后全量重做（char + scene）')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('shot-assets 条目级续跑：重推补漏后 shot-urls 事件保持全量（video 段 i2v 输入不缺镜）', async () => {
  const s = setup()
  try {
    s.runs.setStage(s.run.id, 'master-asset', 'done') // 聚焦 shot-assets：master-asset 不消耗确认次数
    // 首推：shot 1、2 完成后在第 3 次确认处掐断
    let confirms = 0
    await assert.rejects(
      advanceRun({
        ...BASE, runs: s.runs, runId: s.run.id, target: 'shot-assets', concurrency: 1,
        providers: { forSlot: () => fakeImageProvider('https://img.example/shot.png') },
        confirmer: async () => { confirms++; if (confirms >= 3) throw new Error('模拟工具窗口掐断'); return true },
        ffmpeg: null,
      }),
      /模拟工具窗口掐断/,
    )
    assert.equal(s.runs.get(s.run.id)!.stages['shot-assets'], 'failed')

    // 重推：shot 1/2 跳过，只补 shot 3；最终 shot-urls 事件含全部 3 镜
    const specs: Array<Record<string, unknown>> = []
    const r = await advanceRun({
      ...BASE, runs: s.runs, runId: s.run.id, target: 'shot-assets', concurrency: 1,
      providers: { forSlot: () => fakeImageProvider('https://img.example/shot2.png', specs) },
      confirmer: async () => true, ffmpeg: null,
    })
    assert.equal(r.stages['shot-assets'], 'done')
    assert.equal(specs.length, 1, '重推只补提交 shot 3')
    const ev = [...s.runs.get(s.run.id)!.events].reverse().find((e) => e.type === 'shot-urls')
    const urls = (ev!.detail as { urls: Array<{ index: number }> }).urls
    assert.deepEqual(urls.map((u) => u.index), [1, 2, 3], 'shot-urls 全量（含续跑种子）')
    assert.equal(r.shotImages?.length, 3)
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})
