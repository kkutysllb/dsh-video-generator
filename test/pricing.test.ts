import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchPricing, estimateCny } from '../src/pricing.ts'

const SAMPLE = {
  data: [
    { model_name: 'doubao-seedream-4-0-250828', model_type: '图像', quota_type: 1, model_ratio: 0, model_price: 0.2 },
    { model_name: 'kling-video', model_type: '音视频', quota_type: 1, model_ratio: 0, model_price: 0.017 },
    { model_name: 'gpt-4o-mini', model_type: '文本', quota_type: 0, model_ratio: 0.075, model_price: 0 },
  ],
}

function okFetch(): typeof fetch {
  return (async () => new Response(JSON.stringify(SAMPLE), { status: 200 })) as unknown as typeof fetch
}

test('fetchPricing 解析 data 数组', async () => {
  const p = await fetchPricing({ baseUrl: 'https://x.example/v1', apiKey: 'sk-test-123456' }, okFetch())
  assert.equal(p.size, 3)
  assert.equal(p.get('kling-video')?.model_price, 0.017)
})

test('estimateCny：按次模型返回 model_price；按量模型返回 null（走确认）', async () => {
  const p = await fetchPricing({ baseUrl: 'https://x.example/v1', apiKey: 'sk-test-123456' }, okFetch())
  assert.equal(estimateCny('doubao-seedream-4-0-250828', p), 0.2)
  assert.equal(estimateCny('kling-video', p), 0.017)
  assert.equal(estimateCny('gpt-4o-mini', p), null)
  assert.equal(estimateCny('no-such', p), null)
})

test('fetchPricing 归一尾缀 /v1（用户习惯性粘贴 /v1 不静默 404）', async () => {
  let seenUrl = ''
  const spy = (async (url: unknown) => {
    seenUrl = String(url)
    return new Response(JSON.stringify(SAMPLE), { status: 200 })
  }) as unknown as typeof fetch
  await fetchPricing({ baseUrl: 'https://x.example/v1', apiKey: 'sk-test-123456' }, spy)
  assert.equal(seenUrl, 'https://x.example/api/pricing')
})
