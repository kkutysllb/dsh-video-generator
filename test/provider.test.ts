import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertProvider, type Provider } from '../src/provider.ts'

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

test('assertProvider 对 null 成员与 null 入参抛错', () => {
  const withNull = fakeProvider('nullish', {})
  ;(withNull as unknown as Record<string, unknown>)['fetch'] = null
  assert.throws(() => assertProvider(withNull), /缺少方法/)
  assert.throws(() => assertProvider(null as unknown as Provider), /缺少方法/)
})
