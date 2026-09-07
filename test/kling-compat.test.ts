import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createKlingCompatProvider } from '../src/providers/kling-compat.ts'
import { assertProvider } from '../src/provider.ts'

function klingFetch(submitBodies: string[]): typeof fetch {
  let polls = 0
  return (async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    if (u.endsWith('/videos/text2video')) {
      submitBodies.push(String(init?.body ?? ''))
      return new Response(JSON.stringify({ code: 0, data: { task_id: 'kling-task-1', task_status: 'submitted' } }), { status: 200 })
    }
    if (u.includes('/videos/text2video/')) {
      polls++
      const status = polls >= 2 ? 'succeed' : 'processing'
      return new Response(JSON.stringify({
        code: 0,
        data: {
          task_id: 'kling-task-1',
          task_status: status,
          ...(status === 'succeed' ? { task_result: { videos: [{ url: 'https://kling.example/v.mp4' }] } } : {}),
        },
      }), { status: 200 })
    }
    return new Response('not found', { status: 404 })
  }) as unknown as typeof fetch
}

test('kling-compat：text2video 提交/轮询/取片', async () => {
  const submitBodies: string[] = []
  const p = assertProvider(createKlingCompatProvider({ baseUrl: 'https://x.example/v1', apiKey: 'sk-test-123456', model: 'kling-video' }, klingFetch(submitBodies)))
  assert.equal(p.id, 'kling-compat:kling-video')
  assert.equal(p.capabilities.imageToVideo, false)
  assert.equal(p.capabilities.textToVideo, true)
  const { jobId } = await p.submit('video', { prompt: 'whale', durationSec: 5 })
  assert.equal(jobId, 'kling-task-1')
  assert.equal(submitBodies.length, 1)
  assert.ok(submitBodies[0]!.includes('"model_name":"kling-video"'))
  assert.ok(submitBodies[0]!.includes('"duration":"5"'))
  assert.equal((await p.status(jobId)).state, 'running')
  const done = await p.status(jobId)
  assert.equal(done.state, 'done')
  assert.deepEqual((await p.fetch(jobId)).outputs, ['https://kling.example/v.mp4'])
})
