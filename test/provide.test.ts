import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunStore } from '../src/store/runs.ts'
import { buildProvideTools, provideToolDefs } from '../src/tools/provide.ts'

function seed(runs: RunStore, withStoryboard = true): string {
  const run = runs.create('provide run')
  const dir = join(runs.rootDir, run.id)
  mkdirSync(dir, { recursive: true })
  if (withStoryboard) {
    writeFileSync(join(dir, 'storyboard.json'), JSON.stringify({ shots: [{ index: 1 }, { index: 2 }] }))
  }
  return run.id
}

function srcFile(dir: string, name: string, content = 'x'): string {
  const p = join(dir, name)
  writeFileSync(p, content)
  return p
}

test('master-asset：合法命名注入 → 拷贝进 assets/ + 段 done + 事件', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vgen-prov-'))
  const src = mkdtempSync(join(tmpdir(), 'vgen-src-'))
  try {
    const runs = RunStore.open({ rootDir: root })
    const runId = seed(runs)
    const tools = buildProvideTools({ runs, ffmpeg: null })
    const r = await tools.provide.execute({
      runId, stage: 'master-asset',
      files: [{ path: srcFile(src, 'a.png'), name: 'char-linjing.png' }, { path: srcFile(src, 'b.png'), name: 'scene-s1.png' }],
    })
    assert.equal(r.ok, true)
    assert.ok(existsSync(join(root, runId, 'assets', 'char-linjing.png')))
    assert.equal(runs.get(runId)!.stages['master-asset'], 'done')
    assert.ok(runs.get(runId)!.events.some((e) => e.type === 'manual-provided'))
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(src, { recursive: true, force: true })
  }
})

test('master-asset：非法命名拒绝（不半注入）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vgen-prov2-'))
  const src = mkdtempSync(join(tmpdir(), 'vgen-src2-'))
  try {
    const runs = RunStore.open({ rootDir: root })
    const runId = seed(runs)
    const tools = buildProvideTools({ runs, ffmpeg: null })
    const r = await tools.provide.execute({ runId, stage: 'master-asset', files: [{ path: srcFile(src, 'a.png'), name: '../evil.png' }] })
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.error.code, 'bad-request')
    assert.equal(runs.get(runId)!.stages['master-asset'], undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(src, { recursive: true, force: true })
  }
})

test('shot-assets：逐镜注入 → shot-urls 事件（url 空串）+ i2v 警示', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vgen-prov3-'))
  const src = mkdtempSync(join(tmpdir(), 'vgen-src3-'))
  try {
    const runs = RunStore.open({ rootDir: root })
    const runId = seed(runs)
    const tools = buildProvideTools({ runs, ffmpeg: null })
    const r = await tools.provide.execute({
      runId, stage: 'shot-assets',
      files: [{ path: srcFile(src, 'a.png'), shot: 1 }, { path: srcFile(src, 'b.png'), shot: 2 }],
    })
    assert.equal(r.ok, true)
    const v = r.value as { warnings: string[] }
    assert.ok(v.warnings.some((w) => w.includes('公网 URL')))
    const ev = runs.get(runId)!.events.find((e) => e.type === 'shot-urls')
    const urls = (ev?.detail as { urls: Array<{ index: number; url: string }> }).urls
    assert.deepEqual(urls.map((u) => u.url), ['', ''])
    assert.ok(existsSync(join(runs.rootDir, runId, 'shots', 'shot-001.png')))
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(src, { recursive: true, force: true })
  }
})

test('video：缺镜拒绝（须覆盖 storyboard 全部镜头）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vgen-prov4-'))
  const src = mkdtempSync(join(tmpdir(), 'vgen-src4-'))
  try {
    const runs = RunStore.open({ rootDir: root })
    const runId = seed(runs)
    const tools = buildProvideTools({ runs, ffmpeg: null, probe: async () => 3 })
    const r = await tools.provide.execute({ runId, stage: 'video', files: [{ path: srcFile(src, 'a.mp4'), shot: 1 }] })
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.match(r.error.message, /缺少镜头/)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(src, { recursive: true, force: true })
  }
})

test('video：全镜 + 时长≥0.5s → clips 事件 + 段 done', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vgen-prov5-'))
  const src = mkdtempSync(join(tmpdir(), 'vgen-src5-'))
  try {
    const runs = RunStore.open({ rootDir: root })
    const runId = seed(runs)
    const tools = buildProvideTools({ runs, ffmpeg: '/bin/true', probe: async () => 3.2 })
    const r = await tools.provide.execute({
      runId, stage: 'video',
      files: [{ path: srcFile(src, 'a.mp4'), shot: 1 }, { path: srcFile(src, 'b.mp4'), shot: 2 }],
    })
    assert.equal(r.ok, true)
    const ev = runs.get(runId)!.events.find((e) => e.type === 'clips')
    assert.equal(((ev?.detail as { files: string[] }).files).length, 2)
    assert.equal(runs.get(runId)!.stages['video'], 'done')
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(src, { recursive: true, force: true })
  }
})

test('video：时长 <0.5s 拒绝（鲸影规则层继承）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vgen-prov6-'))
  const src = mkdtempSync(join(tmpdir(), 'vgen-src6-'))
  try {
    const runs = RunStore.open({ rootDir: root })
    const runId = seed(runs)
    const tools = buildProvideTools({ runs, ffmpeg: '/bin/true', probe: async () => 0.2 })
    const r = await tools.provide.execute({
      runId, stage: 'video',
      files: [{ path: srcFile(src, 'a.mp4'), shot: 1 }, { path: srcFile(src, 'b.mp4'), shot: 2 }],
    })
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.match(r.error.message, /时长/)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(src, { recursive: true, force: true })
  }
})

test('final-cut：mp4+srt 注入 → run 直接 done', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vgen-prov7-'))
  const src = mkdtempSync(join(tmpdir(), 'vgen-src7-'))
  try {
    const runs = RunStore.open({ rootDir: root })
    const runId = seed(runs)
    const tools = buildProvideTools({ runs, ffmpeg: null })
    const r = await tools.provide.execute({
      runId, stage: 'final-cut',
      files: [{ path: srcFile(src, 'movie.mp4', 'final-bytes') }, { path: srcFile(src, 'subs.srt', '1\n00:00:00,000 --> 00:00:01,000\nhi\n') }],
    })
    assert.equal(r.ok, true)
    assert.equal(readFileSync(join(root, runId, 'final.mp4'), 'utf8'), 'final-bytes')
    assert.ok(existsSync(join(root, runId, 'final.srt')))
    assert.equal(runs.get(runId)!.status, 'done')
    assert.equal(runs.get(runId)!.stages['final-cut'], 'done')
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(src, { recursive: true, force: true })
  }
})

test('源文件不存在 → bad-request；stage 非法 → bad-request', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vgen-prov8-'))
  try {
    const runs = RunStore.open({ rootDir: root })
    const runId = seed(runs)
    const tools = buildProvideTools({ runs, ffmpeg: null })
    const r1 = await tools.provide.execute({ runId, stage: 'video', files: [{ path: '/nope/x.mp4', shot: 1 }] })
    assert.equal(r1.ok, false)
    const r2 = await tools.provide.execute({ runId, stage: 'story' as 'video', files: [{ path: 'x' }] })
    assert.equal(r2.ok, false)
    if (!r2.ok) assert.equal(r2.error.code, 'bad-request')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('provideToolDefs 契约', () => {
  const root = mkdtempSync(join(tmpdir(), 'vgen-prov9-'))
  try {
    const runs = RunStore.open({ rootDir: root })
    const defs = provideToolDefs(buildProvideTools({ runs, ffmpeg: null }))
    assert.equal(defs[0]!.name, 'vgen_provide')
    assert.deepEqual((defs[0]!.parameters as { required: string[] }).required, ['runId', 'stage', 'files'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
