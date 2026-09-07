import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pollUntil, retryTransient } from '../src/poll.ts'
import { RelayError } from '../src/providers/relay-http.ts'

interface St {
  state: 'done' | 'failed' | 'running'
  progress: number | null
  error?: string
}

test('pollUntil：终态立即返回；临时错误指数退避重试', async () => {
  let calls = 0
  const r = await pollUntil<St>(
    async () => {
      calls++
      if (calls === 1) throw new RelayError(0, 'network')
      if (calls === 2) throw new RelayError(429, '饱和')
      return { state: 'done', progress: 100 }
    },
    { isFinal: (s) => s.state === 'done' || s.state === 'failed', delayMs: 1, maxPollMs: 5000 },
  )
  assert.equal(r.state, 'done')
  assert.ok(calls >= 3)
})

test('pollUntil：failed 终态不重试直接返回', async () => {
  let calls = 0
  const r = await pollUntil<St>(
    async () => {
      calls++
      return { state: 'failed', progress: null, error: '审核未通过' }
    },
    { isFinal: (s) => s.state === 'done' || s.state === 'failed', delayMs: 1, maxPollMs: 5000 },
  )
  assert.equal(calls, 1)
  assert.equal(r.state, 'failed')
})

test('pollUntil：总超时后抛错（引用最后一次错误）', async () => {
  await assert.rejects(
    pollUntil<St>(
      async () => { throw new RelayError(0, 'network') },
      { isFinal: (s) => s.state === 'done', delayMs: 1, maxPollMs: 50 },
    ),
    /轮询超时/,
  )
})

test('retryTransient：瞬时错误重试后成功；非瞬时立即抛', async () => {
  let calls = 0
  const r = await retryTransient(
    async () => {
      calls++
      if (calls === 1) throw new RelayError(0, 'network')
      return 'ok'
    },
    3, 1,
  )
  assert.equal(r, 'ok')
  assert.equal(calls, 2)
  await assert.rejects(
    retryTransient(async () => { throw new RelayError(400, '参数错') }, 3, 1),
    (e: unknown) => (e as { status?: number }).status === 400,
  )
})
