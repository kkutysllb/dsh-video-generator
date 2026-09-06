import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probeChannel } from '../src/probe.ts'

function fetchOk(body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch
}

test('探测成功：枚举 data[].id 并排序', async () => {
  const r = await probeChannel(
    { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-12345678' },
    fetchOk({ data: [{ id: 'wan2.2-t2v-plus' }, { id: 'seedream-4.0' }, { id: 'abc-model' }] }),
  )
  assert.equal(r.ok, true)
  assert.deepEqual(r.models, ['abc-model', 'seedream-4.0', 'wan2.2-t2v-plus'])
})

test('探测兼容裸字符串数组与 models 字段', async () => {
  const r = await probeChannel(
    { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-12345678' },
    fetchOk({ models: ['b', 'a'] }),
  )
  assert.deepEqual(r.models, ['a', 'b'])
})

test('401 -> auth-failed；404 -> http-404；空列表 -> no-models', async () => {
  const r401 = await probeChannel(
    { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-12345678' },
    (async () => new Response('denied', { status: 401 })) as unknown as typeof fetch,
  )
  assert.equal(r401.error, 'auth-failed')
  const r404 = await probeChannel(
    { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-12345678' },
    (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch,
  )
  assert.equal(r404.error, 'http-404')
  const empty = await probeChannel(
    { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-12345678' },
    fetchOk({ data: [] }),
  )
  assert.equal(empty.error, 'no-models')
})
