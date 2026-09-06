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

test('route 需求为布尔能力位；数值能力不参与过滤', () => {
  const anyTier = fakeProvider('any', { image: true }) // 未声明 qualityTier，缺省档 5
  const got = route([anyTier], { image: true })
  assert.equal(got?.id, 'any')
  assert.equal(route([], { image: true }), null)
})

test('route 不改变入参数组顺序', () => {
  const a = fakeProvider('a', { image: true, qualityTier: 3 })
  const b = fakeProvider('b', { image: true, qualityTier: 8 })
  const arr = [a, b]
  route(arr, { image: true })
  assert.deepEqual(arr.map((p) => p.id), ['a', 'b'])
})

test('assertProvider 对 null 成员与 null 入参抛错', () => {
  const withNull = fakeProvider('nullish', {})
  ;(withNull as unknown as Record<string, unknown>)['fetch'] = null
  assert.throws(() => assertProvider(withNull), /缺少方法/)
  assert.throws(() => assertProvider(null as unknown as Provider), /缺少方法/)
})
