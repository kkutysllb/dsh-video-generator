import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
