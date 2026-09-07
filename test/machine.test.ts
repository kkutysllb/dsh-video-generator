import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { advanceRun } from '../src/pipeline/machine.ts'
import { RunStore } from '../src/store/runs.ts'
import { STORY, SCRIPT, SHOTS } from './schema-fixtures.ts'

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
