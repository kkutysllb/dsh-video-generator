// vgen_review 工具测试：两阶段评审闭环（阶段A 抽帧 / 阶段B 评分 clamp + 自动重拍 ≤2）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunStore } from '../src/store/runs.ts'
import { VaultStore } from '../src/store/vault.ts'
import { buildReviewTools, reviewToolDefs } from '../src/tools/review.ts'
import type { Provider } from '../src/provider.ts'

/** 种一个已完成 video 段的 run：storyboard + clip 文件 + shot-urls 事件。 */
function seedRun(runs: RunStore, opts: { url?: string } = {}): string {
  const run = runs.create('评审 run')
  const dir = join(runs.rootDir, run.id)
  mkdirSync(join(dir, 'clips'), { recursive: true })
  writeFileSync(join(dir, 'storyboard.json'), JSON.stringify({ shots: [{ index: 1, durationSec: 5 }, { index: 2, durationSec: 4 }] }))
  writeFileSync(join(dir, 'clips', 'shot-001.mp4'), 'old-clip')
  runs.setStage(run.id, 'video', 'done')
  runs.appendEvent(run.id, 'shot-urls', { urls: [{ index: 1, url: opts.url ?? 'mock://img/1.png', file: join(dir, 'shots', 'shot-001.png') }] })
  return run.id
}

function fakeCtx(runs: RunStore, providerCalls: string[] = []) {
  const vaultDir = mkdtempSync(join(tmpdir(), 'vgen-vault-'))
  const vaultFile = join(vaultDir, 'vault.json')
  const fakeProvider: Provider = {
    id: 'fake', capabilities: {},
    async quote() { return { qualityTier: 5, costEstimate: 0, currency: 'CNY' } },
    async submit(_s, spec) { providerCalls.push(`submit:${String(spec['prompt'])}`); return { jobId: 'job-1' } },
    async status() { return { state: 'done', progress: 100 } },
    async fetch() { return { outputs: ['mock://out/new.mp4'] } },
    async health() { return { ok: true } },
  }
  return {
    vault: VaultStore.open({ file: vaultFile }),
    runs,
    channel: () => ({ id: 'c', baseUrl: 'https://mock.invalid', apiKey: 'k' }),
    providersOverride: { forModel: () => fakeProvider },
    fetchImpl: (async (_u: string) => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })) as unknown as typeof fetch,
    extract: async (_c: string, outDir: string) => {
      mkdirSync(outDir, { recursive: true })
      return [1, 2, 3].map((i) => { const p = join(outDir, `frame-${i}.png`); writeFileSync(p, 'f'); return p })
    },
    ffmpeg: '/bin/true',
    confirmer: async () => true,
    pricing: null,
    providerCalls,
  }
}

/** 仓库惯例：tmp 目录收集 + finally 统一清理。 */
function cleanup(...dirs: string[]): void {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
}

test('阶段A：无 score → 抽 3 帧返回路径 + 评分指引', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'vgen-rev-'))
  const runs = RunStore.open({ rootDir })
  const ctx = fakeCtx(runs)
  try {
    const runId = seedRun(runs)
    const tools = buildReviewTools(ctx)
    const r = await tools.review.execute({ runId, shot: 1 })
    assert.equal(r.ok, true)
    if (!r.ok) return
    const v = r.value as { frames: string[]; next: string }
    assert.equal(v.frames.length, 3)
    assert.ok(v.frames.every((f) => existsSync(f)))
    assert.match(v.next, /score/)
  } finally {
    cleanup(rootDir, join(ctx.vault.file, '..'))
  }
})

test('阶段A：clip 不存在 → bad-request 指引先完成 video 段', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'vgen-rev2-'))
  const runs = RunStore.open({ rootDir })
  const ctx = fakeCtx(runs)
  try {
    const runId = seedRun(runs)
    const tools = buildReviewTools(ctx)
    const r = await tools.review.execute({ runId, shot: 2 })
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.error.code, 'bad-request')
    assert.match(r.error.message, /尚无成片片段/)
  } finally {
    cleanup(rootDir, join(ctx.vault.file, '..'))
  }
})

test('阶段B：score≥3 → passed 记录进 run.json', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'vgen-rev3-'))
  const runs = RunStore.open({ rootDir })
  const ctx = fakeCtx(runs)
  try {
    const runId = seedRun(runs)
    const tools = buildReviewTools(ctx)
    const r = await tools.review.execute({ runId, shot: 1, score: 4 })
    assert.equal(r.ok, true)
    const rec = runs.get(runId)!
    assert.deepEqual(rec.reviews?.['shot-1'], { scores: [4], retries: 0, passed: true })
  } finally {
    cleanup(rootDir, join(ctx.vault.file, '..'))
  }
})

test('阶段B：score 越界 clamp 进 1..5', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'vgen-rev4-'))
  const runs = RunStore.open({ rootDir })
  const ctx = fakeCtx(runs)
  try {
    const runId = seedRun(runs)
    const tools = buildReviewTools(ctx)
    await tools.review.execute({ runId, shot: 1, score: 9 })
    assert.deepEqual(runs.get(runId)!.reviews?.['shot-1']?.scores, [5])
  } finally {
    cleanup(rootDir, join(ctx.vault.file, '..'))
  }
})

test('阶段B：非法 score（字符串）→ review-invalid 事件，不重拍不记录', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'vgen-rev5-'))
  const runs = RunStore.open({ rootDir })
  const calls: string[] = []
  const ctx = fakeCtx(runs, calls)
  try {
    const runId = seedRun(runs)
    const tools = buildReviewTools(ctx)
    const r = await tools.review.execute({ runId, shot: 1, score: '很棒' as unknown as number })
    assert.equal(r.ok, true)
    assert.equal((r.value as { action: string }).action, 'ignored')
    assert.equal(calls.length, 0)
    assert.equal(runs.get(runId)!.reviews, undefined)
    assert.ok(runs.get(runId)!.events.some((e) => e.type === 'review-invalid'))
  } finally {
    cleanup(rootDir, join(ctx.vault.file, '..'))
  }
})

test('阶段B：score≤2 → 自动重拍（备份旧片 + 负面词入 prompt + retries=1 + 新帧返回）', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'vgen-rev6-'))
  const runs = RunStore.open({ rootDir })
  const calls: string[] = []
  const ctx = fakeCtx(runs, calls)
  try {
    const runId = seedRun(runs)
    const tools = buildReviewTools(ctx)
    const r = await tools.review.execute({ runId, shot: 1, score: 2, negativeHint: '肢体扭曲' })
    assert.equal(r.ok, true)
    const v = r.value as { action: string; retriesUsed: number; frames: string[] }
    assert.equal(v.action, 'reshoot')
    assert.equal(v.retriesUsed, 1)
    assert.equal(v.frames.length, 3)
    // 旧片备份、新片落位
    const clips = join(runs.rootDir, runId, 'clips')
    assert.ok(existsSync(join(clips, 'shot-001.rejected-1.mp4')))
    assert.ok(existsSync(join(clips, 'shot-001.mp4')))
    assert.notEqual(readFileSync(join(clips, 'shot-001.mp4'), 'utf8'), 'old-clip')
    // 负面词进了重拍 prompt（运动提示词 + 通用负面 + 自定义 hint 全判别）
    assert.equal(calls.length, 1)
    assert.match(calls[0]!, /镜头缓慢推进/)
    assert.match(calls[0]!, /肢体扭曲/)
    assert.match(calls[0]!, /模糊/)
    const rec = runs.get(runId)!
    assert.deepEqual(rec.reviews?.['shot-1'], { scores: [2], retries: 1, passed: false })
    assert.ok(rec.events.some((e) => e.type === 'reshoot'))
    assert.ok(rec.events.some((e) => e.type === 'spend'))
  } finally {
    cleanup(rootDir, join(ctx.vault.file, '..'))
  }
})

test('阶段B：重拍 2 次耗尽 → retry-exhausted，不再调 provider', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'vgen-rev7-'))
  const runs = RunStore.open({ rootDir })
  const calls: string[] = []
  const ctx = fakeCtx(runs, calls)
  try {
    const runId = seedRun(runs)
    const tools = buildReviewTools(ctx)
    await tools.review.execute({ runId, shot: 1, score: 1 })
    await tools.review.execute({ runId, shot: 1, score: 1 })
    const callsBefore = calls.length
    const r = await tools.review.execute({ runId, shot: 1, score: 1 })
    assert.ok(r.ok)
    if (!r.ok) return
    assert.equal((r.value as { action: string }).action, 'retry-exhausted')
    assert.equal(calls.length, callsBefore)
    assert.equal(runs.get(runId)!.reviews?.['shot-1']?.retries, 2)
  } finally {
    cleanup(rootDir, join(ctx.vault.file, '..'))
  }
})

test('阶段B：重拍花费未确认 → confirm-required 信封', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'vgen-rev8-'))
  const runs = RunStore.open({ rootDir })
  const ctx = fakeCtx(runs)
  delete (ctx as { confirmer?: unknown }).confirmer
  try {
    const runId = seedRun(runs)
    const tools = buildReviewTools(ctx)
    const r = await tools.review.execute({ runId, shot: 1, score: 2 })
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.error.code, 'confirm-required')
  } finally {
    cleanup(rootDir, join(ctx.vault.file, '..'))
  }
})

test('阶段B：参考图无公网 URL（手动提供）→ bad-request 指引 rerunStage', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'vgen-rev9-'))
  const runs = RunStore.open({ rootDir })
  const ctx = fakeCtx(runs)
  try {
    const runId = seedRun(runs, { url: '' })
    const tools = buildReviewTools(ctx)
    const r = await tools.review.execute({ runId, shot: 1, score: 2, confirm: true })
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.error.code, 'bad-request')
    assert.match(r.error.message, /rerunStage=shot-assets/)
  } finally {
    cleanup(rootDir, join(ctx.vault.file, '..'))
  }
})

test('未知 runId → not-found；shot 越界 → bad-request', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'vgen-rev10-'))
  const runs = RunStore.open({ rootDir })
  const ctx = fakeCtx(runs)
  try {
    const tools = buildReviewTools(ctx)
    const r1 = await tools.review.execute({ runId: 'run-nope', shot: 1 })
    assert.equal(r1.ok, false)
    if (!r1.ok) assert.equal(r1.error.code, 'not-found')
    const runId = seedRun(runs)
    const r2 = await tools.review.execute({ runId, shot: 0 })
    assert.equal(r2.ok, false)
    if (!r2.ok) assert.equal(r2.error.code, 'bad-request')
  } finally {
    cleanup(rootDir, join(ctx.vault.file, '..'))
  }
})

test('reviewToolDefs 契约：名称/参数/渲染', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'vgen-rev11-'))
  const runs = RunStore.open({ rootDir })
  const ctx = fakeCtx(runs)
  try {
    const defs = reviewToolDefs(buildReviewTools(ctx))
    assert.equal(defs.length, 1)
    assert.equal(defs[0]!.name, 'vgen_review')
    assert.deepEqual((defs[0]!.parameters as { required: string[] }).required, ['runId', 'shot'])
    const rendered = defs[0]!.output.render({}, { a: 1 })
    assert.deepEqual(rendered, [{ type: 'text', text: '{"a":1}' }])
  } finally {
    cleanup(rootDir, join(ctx.vault.file, '..'))
  }
})
