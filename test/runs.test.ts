import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
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
