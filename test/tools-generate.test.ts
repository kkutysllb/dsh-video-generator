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

test('M4: gates 参数校验非法模式 → bad-request，合法 → 持久化进 run.json', async () => {
  const s = setup({ confirmer: async () => true })
  try {
    const r = await s.tools.generate.execute({ runId: s.run.id, target: 'assets', gates: { video: 'teleport' } as unknown as Record<string, 'auto' | 'ask' | 'manual'> }) as { ok: boolean; error?: { code: string } }
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.error!.code, 'bad-request')
    const r2 = await s.tools.generate.execute({ runId: s.run.id, target: 'assets', gates: { video: 'manual' } }) as { ok: boolean }
    // video 段在 assets 目标下不执行，gates 仅持久化
    assert.equal(r2.ok, true)
    assert.deepEqual(s.runs.get(s.run.id)!.gates, { video: 'manual' })
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('M4: manual gate → manual-gate 信封（指引 vgen_provide）', async () => {
  const s = setup({ confirmer: async () => true })
  try {
    s.runs.setGates(s.run.id, { 'master-asset': 'manual' })
    const r = await s.tools.generate.execute({ runId: s.run.id, target: 'assets' }) as { ok: boolean; error: { code: string; message: string } }
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'manual-gate')
    assert.match(r.error.message, /vgen_provide/)
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('M4: ask gate 未批 → gate-approval 信封；gateApprovals 放行后通过', async () => {
  const s = setup({ confirmer: async () => true })
  try {
    s.runs.setGates(s.run.id, { 'master-asset': 'ask' })
    const r = await s.tools.generate.execute({ runId: s.run.id, target: 'assets' }) as { ok: boolean; error?: { code: string } }
    assert.equal(r.ok, false)
    assert.equal(r.error!.code, 'gate-approval')
    const r2 = await s.tools.generate.execute({ runId: s.run.id, target: 'assets', gateApprovals: ['master-asset'] }) as { ok: boolean; error?: { code: string } }
    assert.notEqual(r2.ok ? '' : r2.error!.code, 'gate-approval')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('M4: rerunStage 把已 done 段重置 pending 后重跑', async () => {
  const s = setup({ confirmer: async () => true })
  try {
    s.runs.setStage(s.run.id, 'master-asset', 'done')
    await s.tools.generate.execute({ runId: s.run.id, target: 'assets', rerunStage: 'master-asset' })
    // mock provider 全链路会重新生成 → 段回到 done 且出现第二次 stage-start 事件
    const starts = s.runs.get(s.run.id)!.events.filter((e) => e.type === 'stage-start' && (e.detail as { stage?: string } | undefined)?.['stage'] === 'master-asset')
    assert.ok(starts.length >= 1)
    assert.equal(s.runs.get(s.run.id)!.stages['master-asset'], 'done')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('M4: rerunStage 非媒体段 → bad-request', async () => {
  const s = setup({ confirmer: async () => true })
  try {
    const r = await s.tools.generate.execute({ runId: s.run.id, target: 'assets', rerunStage: 'story' }) as { ok: boolean; error: { code: string; message: string } }
    assert.equal(r.ok, false)
    assert.match(r.error.message, /媒体段/)
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

test('M4: VGEN_VIDEO_MODEL 覆盖传导到 provider 选择（上游分组饱和换档）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-gen-vm-'))
  try {
    const vault = VaultStore.open({ file: join(dir, 'vault.json') })
    vault.createChannel({ id: 've', baseUrl: 'https://x.example', apiKey: 'sk-vgen-12345678' })
    vault.setDefaultChannel('ve')
    const runs = RunStore.open({ rootDir: join(dir, 'runs') })
    const run = runs.create('换档')
    runs.setStage(run.id, 'story', 'done')
    runs.setStage(run.id, 'script', 'done')
    runs.setStage(run.id, 'storyboard', 'done')
    const rd = join(dir, 'runs', run.id)
    writeFileSync(join(rd, 'story.json'), JSON.stringify(STORY))
    writeFileSync(join(rd, 'script.json'), JSON.stringify(SCRIPT))
    writeFileSync(join(rd, 'storyboard.json'), JSON.stringify({ ...SHOTS, characters: SCRIPT.characters, scenes: SCRIPT.scenes }))
    const requested: string[] = []
    const env = { DSH_HOME: dir, VGEN_FFMPEG: '', VGEN_VIDEO_MODEL: 'wan2.6-i2v' } as unknown as NodeJS.ProcessEnv
    const tools = buildGenerateTools({
      vault, runs,
      channel: () => ({ id: 've', baseUrl: 'https://x.example', apiKey: 'sk-vgen-12345678' }),
      env,
      pricing: FAKE_PRICING,
      providersOverride: {
        forModel: (model: string) => {
          requested.push(model)
          return model.includes('i2v') ? fakeVideoProvider() : fakeImageProvider(`https://img.example/${model.replace(/\W/g, '-')}.png`)
        },
      },
      fetchImpl: fetchFake,
    })
    const r = await tools.generate.execute({ runId: run.id, target: 'video', confirm: true }) as { ok: boolean }
    assert.equal(r.ok, true)
    assert.ok(requested.includes('wan2.6-i2v'), 'video 段应使用 VGEN_VIDEO_MODEL 指定的模型')
    assert.ok(!requested.includes('happyhorse-1.1-i2v'), '不应回退缺省模型')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
