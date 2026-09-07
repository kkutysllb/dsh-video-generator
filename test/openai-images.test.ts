import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOpenaiImagesProvider } from '../src/providers/openai-images.ts'
import { assertProvider } from '../src/provider.ts'

function imageOk(): typeof fetch {
  return (async (_u: unknown, init?: RequestInit) => {
    const body = String(init?.body ?? '')
    if (!body.includes('"prompt"')) return new Response(JSON.stringify({ error: { message: 'missing prompt' } }), { status: 400 })
    return new Response(JSON.stringify({
      created: 1788742283,
      model: 'doubao-seedream-4-0-250828',
      data: [{ url: 'https://cdn.example/img.jpeg?sig=1', size: '2k' }],
      usage: { generated_images: 1, output_tokens: 17800, total_tokens: 17800 },
    }), { status: 200 })
  }) as unknown as typeof fetch
}

test('图像适配器：同步 API 用 URL 短路模式（submit 即得 jobId，status 恒 done）', async () => {
  const p = assertProvider(createOpenaiImagesProvider({ baseUrl: 'https://x.example/v1', apiKey: 'sk-test-123456', model: 'doubao-seedream-4-0-250828' }, imageOk()))
  assert.equal(p.id, 'openai-images:doubao-seedream-4-0-250828')
  assert.equal(p.capabilities.image, true)
  const { jobId } = await p.submit('shot-assets', { prompt: 'whale', size: '1024x1024' })
  assert.ok(jobId.startsWith('https://cdn.example/'))
  const st = await p.status(jobId)
  assert.equal(st.state, 'done')
  const f = await p.fetch(jobId)
  assert.deepEqual(f.outputs, [jobId])
})

test('图像适配器：400 -> RelayError 透传消息；quote 走注入估价', async () => {
  const p = createOpenaiImagesProvider({ baseUrl: 'https://x.example/v1', apiKey: 'sk-test-123456', model: 'm1' }, imageOk())
  await assert.rejects(p.submit('image', {}), /missing prompt/)
  const q = await p.quote('image', {})
  assert.equal(q.currency, 'CNY')
})
