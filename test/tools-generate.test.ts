import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildGenerateTools } from '../src/tools/generate.ts'
import { VaultStore } from '../src/store/vault.ts'
import { RunStore } from '../src/store/runs.ts'
import { STORY, SCRIPT, SHOTS } from './schema-fixtures.ts'

const FAKE_PRICING = new Map([
  ['doubao-seedream-4-0-250828', { model_name: 'doubao-seedream-4-0-250828', model_type: '图像', quota_type: 1, model_ratio: 0, model_price: 0.2 }],
  ['happyhorse-1.1-i2v', { model_name: 'happyhorse-1.1-i2v', model_type: '音视频', quota_type: 1, model_ratio: 0, model_price: 0.013 }],
])

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
    id: 'fake-video', capabilities: { imageToVideo: true, qualityTier: 5 },
    quote: async () => ({ qualityTier: 5, costEstimate: 0.013, currency: 'CNY' }),
    submit: async (_s: string, spec: Record<string, unknown>) => ({ jobId: `task-${String(spec['imageUrl']).slice(-6)}` }),
    status: async () => ({ state: 'done' as const, progress: 100 }),
    fetch: async (jobId: string) => ({ outputs: [`https://oss.example/${jobId}.mp4`] }),
    health: async () => ({ ok: true }),
  }
}

const fetchFake = (async (url: unknown) => new Response(Buffer.from(`bytes-of-${String(url).slice(-8)}`), { status: 200 })) as unknown as typeof fetch

function setup(opts: { confirmer?: (est: number | null) => Promise<boolean> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-gen-tools-'))
  const vault = VaultStore.open({ file: join(dir, 'vault.json') })
  vault.createChannel({ id: 've', baseUrl: 'https://x.example', apiKey: 'sk-vgen-12345678' })
  vault.setDefaultChannel('ve')
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
  const tools = buildGenerateTools({
    vault, runs,
    channel: () => ({ id: 've', baseUrl: 'https://x.example', apiKey: 'sk-vgen-12345678' }),
    env,
    pricing: FAKE_PRICING,
    ...(opts.confirmer ? { confirmer: opts.confirmer } : {}),
    providersOverride: {
      forModel: (model: string) => model.includes('i2v') ? fakeVideoProvider() : fakeImageProvider(`https://img.example/${model.replace(/\W/g, '-')}.png`),
    },
    fetchImpl: fetchFake,
  })
  return { dir, vault, runs, run, rd, tools }
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

test('vgen_generate：生产确认路径被拒 -> confirm-required 信封，段置 failed', async () => {
  const s = setup() // 不注入 confirmer：走生产确认路径
  try {
    const r = await s.tools.generate.execute({ runId: s.run.id, target: 'assets' }) as { ok: boolean; error: { code: string; message: string } }
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'confirm-required')
    assert.ok(r.error.message.includes('confirm'))
    assert.equal(s.runs.get(s.run.id)!.stages['master-asset'], 'failed')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('vgen_generate：确认通过 -> assets 段完成并返回镜头数（注入确认 + fake providers）', async () => {
  const s = setup({ confirmer: async () => true })
  try {
    const r = await s.tools.generate.execute({ runId: s.run.id, target: 'assets' }) as { ok: boolean; value: { stages: Record<string, string>; shots: number } }
    assert.equal(r.ok, true)
    assert.equal(r.value.stages['shot-assets'], 'done')
    assert.ok(r.value.shots >= 1)
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})
