import { test } from 'node:test'
import assert from 'node:assert/strict'
import { postJson, getJson, RelayError } from '../src/providers/relay-http.ts'

test('postJson 发 Bearer 头与 JSON 体，返回解析后的 json', async () => {
  let seen: { url: string; init: RequestInit } | null = null
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    seen = { url: String(url), init: init ?? {} }
    return new Response(JSON.stringify({ ok: 1 }), { status: 200 })
  }) as unknown as typeof fetch
  const r = await postJson('https://x.example/v1/videos', 'sk-key-123456', { model: 'm' }, fetchImpl)
  assert.deepEqual(r, { ok: 1 })
  const headers = seen!.init.headers as Record<string, string>
  assert.equal(headers['Authorization'], 'Bearer sk-key-123456')
  assert.equal(headers['content-type'], 'application/json')
  assert.equal((seen!.init.body as string).includes('"model":"m"'), true)
})

test('new_api_error 形态：{error:{message}} -> RelayError 透传状态码与消息', async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: '模型不属于该接口', type: 'new_api_error' } }), { status: 400 })) as unknown as typeof fetch
  await assert.rejects(
    postJson('https://x.example/v1/videos', 'sk-key-123456', {}, fetchImpl),
    (e: unknown) => e instanceof RelayError && e.status === 400 && e.message.includes('模型不属于该接口'),
  )
})

test('new-api 429 形态：{code,message} -> RelayError', async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ code: 'do_response_failed', message: '上游负载已饱和', data: null }), { status: 429 })) as unknown as typeof fetch
  await assert.rejects(
    postJson('https://x.example/v1/videos', 'sk-key-123456', {}, fetchImpl),
    (e: unknown) => e instanceof RelayError && e.status === 429 && e.message.includes('上游负载已饱和'),
  )
})

test('getJson 401 -> RelayError auth；网络异常 -> RelayError network', async () => {
  const auth = (async () => new Response('denied', { status: 401 })) as unknown as typeof fetch
  await assert.rejects(getJson('https://x.example/a', 'sk-key-123456', auth), (e: unknown) => e instanceof RelayError && e.status === 401)
  const net = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
  await assert.rejects(getJson('https://x.example/a', 'sk-key-123456', net), (e: unknown) => e instanceof RelayError && e.status === 0)
})

test('超时中止 -> RelayError network', async () => {
  const slow = ((_u: unknown, init?: RequestInit) =>
    new Promise<Response>((_res, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })) as unknown as typeof fetch
  await assert.rejects(getJson('https://x.example/a', 'sk-key-123456', slow, 30), (e: unknown) => e instanceof RelayError && e.status === 0)
})
