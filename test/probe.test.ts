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

test('超时中止 -> error timeout（外层）', async () => {
  const slow = ((_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })) as unknown as typeof fetch
  const r = await probeChannel({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-12345678' }, slow, 40)
  assert.equal(r.error, 'timeout')
  assert.equal(r.status, null)
})

test('响应体读取中途 abort -> error timeout（非 bad-json）', async () => {
  const midBodyAbort = ((_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })) as unknown as typeof fetch
  const r = await probeChannel({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-12345678' }, midBodyAbort, 40)
  assert.equal(r.error, 'timeout')
})

test('fetch 实参契约：URL 归一、Bearer 头、key 不进 URL、signal 传递', async () => {
  let seen: { url: string; auth: string; hasSignal: boolean } | null = null
  const spy = ((url: unknown, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    seen = {
      url: String(url),
      auth: headers['Authorization'] ?? '',
      hasSignal: init?.signal instanceof AbortSignal,
    }
    return Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200 }))
  }) as unknown as typeof fetch
  await probeChannel({ baseUrl: 'https://api.example.com/v1///', apiKey: 'sk-test-12345678' }, spy)
  // seen 仅在 spy 闭包内赋值，TS 流分析在调用点仍视其为初始 null（断言后窄化为 never），显式还原联合类型
  const s = seen as { url: string; auth: string; hasSignal: boolean } | null
  assert.ok(s, 'fetch 未被调用')
  assert.equal(s.url, 'https://api.example.com/v1/models')
  assert.equal(s.auth, 'Bearer sk-test-12345678')
  assert.ok(!s.url.includes('sk-test-12345678'))
  assert.equal(s.hasSignal, true)
})

test('bad-json 与 network', async () => {
  const badJson = (async () => new Response('<html>not json</html>', { status: 200 })) as unknown as typeof fetch
  assert.equal((await probeChannel({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-12345678' }, badJson)).error, 'bad-json')
  const netFail = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
  assert.equal((await probeChannel({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-12345678' }, netFail)).error, 'network')
})

test('models 去重', async () => {
  const dup = (async () => new Response(JSON.stringify({ data: [{ id: 'm1' }, { id: 'm1' }, { id: 'm2' }] }), { status: 200 })) as unknown as typeof fetch
  const r = await probeChannel({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-12345678' }, dup)
  assert.deepEqual(r.models, ['m1', 'm2'])
})
