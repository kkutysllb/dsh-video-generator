import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDashscopeRelayProvider } from '../src/providers/dashscope-relay.ts'
import { assertProvider } from '../src/provider.ts'

function seqFetch(responses: Array<{ status: number; body: unknown }>): typeof fetch {
  let i = 0
  return (async () => {
    const r = responses[Math.min(i, responses.length - 1)]!
    i++
    return new Response(JSON.stringify(r.body), { status: r.status })
  }) as unknown as typeof fetch
}

test('视频适配器：提交 -> PENDING/RUNNING -> SUCCEEDED -> video_url', async () => {
  const fetchImpl = seqFetch([
    { status: 200, body: { output: { task_id: 'task_abc', task_status: 'PENDING' }, request_id: 'r1' } },
    { status: 200, body: { output: { task_id: 'task_abc', task_status: 'RUNNING' } } },
    { status: 200, body: { output: { task_id: 'task_abc', task_status: 'SUCCEEDED', video_url: 'https://oss.example/v.mp4?Expires=1' }, usage: { duration: 5 } } },
  ])
  const p = assertProvider(createDashscopeRelayProvider({ baseUrl: 'https://x.example/v1', apiKey: 'sk-test-123456', model: 'happyhorse-1.1-t2v' }, fetchImpl))
  assert.equal(p.capabilities.textToVideo, true)
  assert.equal(p.capabilities.imageToVideo, true)
  const { jobId } = await p.submit('video', { prompt: 'whale', durationSec: 5 })
  assert.equal(jobId, 'task_abc')
  assert.equal((await p.status(jobId)).state, 'running')
  const done = await p.status(jobId)
  assert.equal(done.state, 'done')
  const f = await p.fetch(jobId)
  assert.deepEqual(f.outputs, ['https://oss.example/v.mp4?Expires=1'])
})

test('视频适配器：i2v 时 img_url 进 input；FAILED 带错误消息；429 RelayError 透传', async () => {
  const fetchImpl = seqFetch([
    { status: 200, body: { output: { task_id: 't2', task_status: 'PENDING' } } },
    { status: 200, body: { output: { task_id: 't2', task_status: 'FAILED', message: '内容审核未通过' } } },
  ])
  const p = createDashscopeRelayProvider({ baseUrl: 'https://x.example/v1', apiKey: 'sk-test-123456', model: 'happyhorse-1.1-i2v' }, fetchImpl)
  await p.submit('video', { prompt: '动起来', imageUrl: 'https://img.example/a.png' })
  const failed = await p.status('t2')
  assert.equal(failed.state, 'failed')
  assert.ok(failed.error?.includes('内容审核未通过'))
  const busy = createDashscopeRelayProvider({ baseUrl: 'https://x.example/v1', apiKey: 'sk-test-123456', model: 'happyhorse-1.1-t2v' }, (async () => new Response(JSON.stringify({ code: 'do_response_failed', message: '上游负载已饱和' }), { status: 429 })) as unknown as typeof fetch)
  await assert.rejects(busy.submit('video', { prompt: 'x' }), (e: unknown) => (e as { status?: number }).status === 429)
})
