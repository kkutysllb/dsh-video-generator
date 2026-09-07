import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunStore } from '../src/store/runs.ts'

function tmpRuns(): string {
  return mkdtempSync(join(tmpdir(), 'vgen-runs-'))
}

test('run 生命周期：create -> setStage -> appendEvent -> 落盘可回读', () => {
  const dir = tmpRuns()
  try {
    const store = RunStore.open({ rootDir: dir })
    const run = store.create('鲸鱼漫剧第一集')
    assert.ok(run.id.startsWith('run-'))
    store.setStage(run.id, 'story', 'done')
    store.appendEvent(run.id, 'stage-done', { stage: 'story' })
    const got = store.get(run.id)
    assert.equal(got?.stages['story'], 'done')
    assert.equal(got?.events.length, 1)
    assert.equal(got?.title, '鲸鱼漫剧第一集')
    const again = RunStore.open({ rootDir: dir })
    assert.equal(again.get(run.id)?.stages['story'], 'done')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('list 按 updatedAt 倒序；prune 保留最近 N 个', () => {
  const dir = tmpRuns()
  try {
    const store = RunStore.open({ rootDir: dir })
    const a = store.create('a')
    const b = store.create('b')
    const c = store.create('c')
    store.appendEvent(a.id, 'touch', {})
    const ids = store.list().map((r) => r.id)
    assert.deepEqual(ids, [a.id, c.id, b.id])
    assert.equal(store.prune(2), 1)
    assert.equal(store.get(b.id), null)
    assert.ok(store.get(c.id))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('损坏 run.json：get 返回 null 且备份 .broken-*；list 跳过', () => {
  const dir = tmpRuns()
  try {
    const store = RunStore.open({ rootDir: dir })
    const run = store.create('x')
    writeFileSync(join(dir, run.id, 'run.json'), '{broken', 'utf8')
    assert.equal(store.get(run.id), null)
    assert.equal(store.list().length, 0)
    const leftovers = readdirSync(join(dir, run.id)).filter((f) => f.startsWith('run.json.broken-'))
    assert.equal(leftovers.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('run.json 权限 0600（POSIX）', { skip: process.platform === 'win32' }, () => {
  const dir = tmpRuns()
  try {
    const store = RunStore.open({ rootDir: dir })
    const run = store.create('perm')
    assert.equal(statSync(join(dir, run.id, 'run.json')).mode & 0o777, 0o600)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('mutate 未知 id 返回 null；setStatus 落盘；prune(keep 超总数) 返回 0', () => {
  const dir = tmpRuns()
  try {
    const store = RunStore.open({ rootDir: dir })
    assert.equal(store.mutate('run-nope', () => {}), null)
    const run = store.create('s')
    store.setStatus(run.id, 'done')
    assert.equal(store.get(run.id)?.status, 'done')
    assert.equal(store.prune(100), 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('title 空串兜底 untitled；超长截 120', () => {
  const dir = tmpRuns()
  try {
    const store = RunStore.open({ rootDir: dir })
    const e = store.create('')
    assert.equal(e.title, 'untitled')
    const long = store.create('标'.repeat(200))
    assert.equal(long.title.length, 120)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('list/prune 对根目录下杂散文件健壮（跳过非目录条目）', () => {
  const dir = tmpRuns()
  try {
    const store = RunStore.open({ rootDir: dir })
    const run = store.create('keep')
    writeFileSync(join(dir, '.DS_Store'), 'junk', 'utf8')
    assert.equal(store.list().length, 1)
    assert.equal(store.list()[0]!.id, run.id)
    assert.equal(store.prune(50), 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stages 值非法视为损坏（.broken 备份路径）', () => {
  const dir = tmpRuns()
  try {
    const store = RunStore.open({ rootDir: dir })
    const run = store.create('bad-stages')
    writeFileSync(join(dir, run.id, 'run.json'), JSON.stringify({ id: run.id, status: 'running', stages: { video: 'oops' }, events: [] }), 'utf8')
    assert.equal(store.get(run.id), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('M4: reviews/gates 合法形状往返持久化', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-runs-m4-'))
  try {
    const store = RunStore.open({ rootDir: dir })
    const run = store.create('评审往返')
    store.setReview(run.id, 'shot-1', { scores: [2, 4], retries: 1, passed: true })
    store.setGates(run.id, { video: 'ask', 'final-cut': 'manual' })
    const got = store.get(run.id)!
    assert.deepEqual(got.reviews?.['shot-1'], { scores: [2, 4], retries: 1, passed: true })
    assert.deepEqual(got.gates, { video: 'ask', 'final-cut': 'manual' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('M4: setGates 增量合并不清空既有键', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-runs-m4b-'))
  try {
    const store = RunStore.open({ rootDir: dir })
    const run = store.create('gates 合并')
    store.setGates(run.id, { video: 'ask' })
    store.setGates(run.id, { 'final-cut': 'manual' })
    assert.deepEqual(store.get(run.id)!.gates, { video: 'ask', 'final-cut': 'manual' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('M4: 非法 reviews/gates 形状整体丢弃（记录仍有效）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-runs-m4c-'))
  try {
    const store = RunStore.open({ rootDir: dir })
    const run = store.create('形状守卫')
    const file = join(dir, run.id, 'run.json')
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    raw.reviews = { 'shot-1': { scores: 'bad', retries: 0, passed: true } }
    raw.gates = { video: 'teleport' }
    writeFileSync(file, JSON.stringify(raw))
    const got = store.get(run.id)!
    assert.equal(got.reviews, undefined)
    assert.equal(got.gates, undefined)
    assert.equal(got.id, run.id)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
