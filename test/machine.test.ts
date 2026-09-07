import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { advanceRun } from '../src/pipeline/machine.ts'
import { RelayError } from '../src/providers/relay-http.ts'
import { RunStore } from '../src/store/runs.ts'
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
    submit: async (_s: string, spec: Record<string, unknown>) => ({ jobId: `task-${String(spec['imageUrl']).slice(-6)}` }),
    status: async () => { polls++; return polls >= 2 ? { state: 'done' as const, progress: 100 } : { state: 'running' as const, progress: 50 } },
    fetch: async (jobId: string) => ({ outputs: [`https://oss.example/${jobId}.mp4`] }),
    health: async () => ({ ok: true }),
  }
}

const fetchFake = (async (url: unknown) => new Response(Buffer.from(`bytes-of-${String(url).slice(-8)}`), { status: 200 })) as unknown as typeof fetch

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

const BASE = {
  channel: { id: 've', baseUrl: 'https://x.example', apiKey: 'k' },
  pricing: null,
  concurrency: 2,
  fetchImpl: fetchFake,
}

test('advanceRun assets+video：三视图/场景/参考图/克隆下载落盘，断点续跑跳过已完成段', async () => {
  const s = setup()
  try {
    const providers = { forModel: (model: string) => model.includes('i2v') ? fakeVideoProvider() : fakeImageProvider(`https://img.example/${model.replace(/\W/g, '-')}.png`) }
    const common = { ...BASE, runs: s.runs, runId: s.run.id, providers, confirmer: async () => true, ffmpeg: null }
    const r1 = await advanceRun({ ...common, target: 'shot-assets' })
    assert.equal(r1.stages['master-asset'], 'done')
    assert.equal(r1.stages['shot-assets'], 'done')
    assert.ok(existsSync(join(s.rd, 'assets', 'char-linjing.png')))
    assert.ok(existsSync(join(s.rd, 'assets', 'scene-s1.png')))
    assert.equal(r1.shotImages?.length, 3)
    assert.ok(existsSync(join(s.rd, 'shots', 'shot-001.png')))
    const r2 = await advanceRun({ ...common, target: 'video', videoModel: 'happyhorse-1.1-i2v' })
    assert.equal(r2.stages['video'], 'done')
    assert.equal(r2.clipFiles?.length, 3)
    assert.ok(existsSync(join(s.rd, 'clips', 'shot-001.mp4')))
    // 断点续跑：重推 video 不新增 clips 事件
    const evBefore = s.runs.get(s.run.id)!.events.filter((e) => e.type === 'clips').length
    await advanceRun({ ...common, target: 'video', videoModel: 'happyhorse-1.1-i2v' })
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
    const providers = { forModel: (m: string) => m.includes('i2v') ? failingVideo : fakeImageProvider('https://img.example/x.png') }
    await assert.rejects(
      advanceRun({ ...BASE, runs: s.runs, runId: s.run.id, target: 'video', videoModel: 'happyhorse-1.1-i2v', providers, confirmer: async () => true, ffmpeg: null, pollDelayMs: 1 }),
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
    const providers = { forModel: () => fakeImageProvider('https://img.example/x.png') }
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
    await advanceRun({ ...common, target: 'shot-assets', providers: { forModel: () => fakeImageProvider('https://img.example/x.png') } })
    await assert.rejects(
      advanceRun({ ...common, target: 'video', videoModel: 'happyhorse-1.1-i2v', providers: { forModel: (m: string) => m.includes('i2v') ? failing : fakeImageProvider('https://img.example/x.png') } }),
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
    const providers = { forModel: () => fakeImageProvider('https://img.example/x.png') }
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

test('M4: shot-assets 提交带竖版 size（1024x1536）', async () => {
  const s = setup()
  try {
    const submitSpecs: Array<Record<string, unknown>> = []
    const providers = { forModel: () => fakeImageProvider('https://img.example/shot.png', submitSpecs) }
    s.runs.setStage(s.run.id, 'master-asset', 'done')
    const r = await advanceRun({ ...BASE, runs: s.runs, runId: s.run.id, target: 'shot-assets', providers, confirmer: async () => true, ffmpeg: null })
    assert.equal(r.stages['shot-assets'], 'done')
    assert.equal(submitSpecs.length, 3) // 3 镜各一次
    for (const spec of submitSpecs) assert.equal(spec['size'], '1024x1536')
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
    const providers = { forModel: () => fallbackImage }
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
    const providers = { forModel: () => fakeImageProvider('https://img.example/x.png', submitSpecs) }
    const r = await advanceRun({ ...BASE, runs: s.runs, runId: s.run.id, target: 'master-asset', providers, confirmer: async () => true, ffmpeg: null })
    assert.equal(r.stages['master-asset'], 'done')
    assert.ok(submitSpecs.length >= 2)
    assert.ok(submitSpecs.some((x) => x['size'] === '1536x1024'), 'char 任务应横版 1536x1024')
    assert.ok(submitSpecs.some((x) => x['size'] === '1024x1536'), 'scene 任务应竖版 1024x1536')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})
