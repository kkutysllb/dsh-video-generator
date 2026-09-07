import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockProvider } from '../src/providers/mock.ts'
import { assertProvider } from '../src/provider.ts'

test('mock 全生命周期：submit -> 两次 poll 后 done -> fetch 出占位产物', async () => {
  const p = assertProvider(createMockProvider())
  assert.equal(p.id, 'mock')
  const { jobId } = await p.submit('video', { prompt: '鲸鱼跃出海面' })
  assert.ok(jobId.startsWith('mock-'))
  const s1 = await p.status(jobId)
  assert.equal(s1.state, 'running')
  const s2 = await p.status(jobId)
  assert.equal(s2.state, 'done')
  const f = await p.fetch(jobId)
  assert.equal(f.outputs.length, 1)
  assert.ok(f.outputs[0]!.startsWith('mock://'))
})

test('mock quote 零成本、health 恒 ok、failFirst 可造失败', async () => {
  const p = createMockProvider({ failFirst: 1 })
  await assert.rejects(p.submit('video', {}), /mock-注入失败/)
  const { jobId } = await p.submit('video', {})
  assert.ok(jobId)
  const q = await p.quote('video', {})
  assert.equal(q.costEstimate, 0)
  assert.equal((await p.health()).ok, true)
})

test('mock 未知 jobId：status unknown / fetch 空产物', async () => {
  const p = createMockProvider()
  assert.deepEqual(await p.status('mock-nope'), { state: 'unknown', progress: null, error: 'no-such-job' })
  assert.deepEqual(await p.fetch('mock-nope'), { outputs: [] })
})
