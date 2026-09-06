import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertProvider, route, type Provider } from '../src/provider.ts'

function fakeProvider(id: string, caps: Provider['capabilities']): Provider {
  return {
    id,
    capabilities: caps,
    quote: async () => ({ qualityTier: 5, costEstimate: 0, currency: 'CNY' }),
    submit: async () => ({ jobId: `${id}-job` }),
    status: async () => ({ state: 'done', progress: 100 }),
    fetch: async () => ({ outputs: [] }),
    health: async () => ({ ok: true }),
  }
}

test('assertProvider 对完整 provider 原样返回', () => {
  const p = fakeProvider('a', {})
  assert.equal(assertProvider(p), p)
})

test('assertProvider 缺方法即抛错', () => {
  const broken = fakeProvider('bad', {})
  delete (broken as Partial<Provider>).fetch
  assert.throws(() => assertProvider(broken as Provider), /缺少方法/)
})

test('route 按能力过滤并按 qualityTier 高->低排序', () => {
  const low = fakeProvider('low', { image: true, qualityTier: 1 })
  const high = fakeProvider('high', { image: true, qualityTier: 9 })
  const noImage = fakeProvider('nope', { qualityTier: 10 })
  const got = route([low, high, noImage], { image: true })
  assert.equal(got?.id, 'high')
})

test('route preferCost 时低价档优先；无匹配返回 null', () => {
  const low = fakeProvider('low', { image: true, qualityTier: 1 })
  const high = fakeProvider('high', { image: true, qualityTier: 9 })
  assert.equal(route([high, low], { image: true }, true)?.id, 'low')
  assert.equal(route([low], { imageToVideo: true }), null)
})
