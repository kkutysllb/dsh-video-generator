import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/host/index.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'

interface RegisteredRoute {
  kind: string
  path: string
  handler: (req: Partial<IncomingMessage>, res: FakeRes) => void | Promise<void>
}

interface FakeRes {
  statusCode: number
  headers: Record<string, string>
  body: string
  setHeader(k: string, v: string): void
  end(b: string): void
}

function fakeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(k, v) {
      res.headers[k] = v
    },
    end(b) {
      res.body = b
    },
  }
  return res
}

function wire(env: NodeJS.ProcessEnv) {
  // apply 现实现直接读 process.env（VaultStore/RunStore open({env: process.env})），
  // 故 wire 期间临时注入 DSH_HOME，结束即还原，避免测试污染真实 HOME。
  const prevHome = process.env['DSH_HOME']
  if (env['DSH_HOME'] !== undefined) process.env['DSH_HOME'] = env['DSH_HOME']

  const routes = new Map<string, RegisteredRoute>()
  const effects: string[] = []
  const ctx = {
    inject: undefined,
    webServer: {
      register(route: RegisteredRoute) {
        routes.set(route.path, route)
        return () => {}
      },
    },
    effect(fn: () => () => void, name?: string) {
      fn()
      effects.push(name ?? '')
      return () => {}
    },
  } as unknown as Parameters<typeof apply>[0]
  apply(ctx)

  if (prevHome === undefined) delete process.env['DSH_HOME']
  else process.env['DSH_HOME'] = prevHome
  return { routes, effects }
}

function findApi(routes: Map<string, RegisteredRoute>): RegisteredRoute {
  const r = routes.get('/dsh-video-generator/api')
  if (!r) throw new Error('api route 未注册')
  return r
}

test('apply 注册三条路由并经 effect 管理', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-wire-'))
  try {
    const { routes, effects } = wire({ DSH_HOME: dir })
    assert.deepEqual([...routes.keys()].sort(), [
      '/dsh-video-generator/api',
      '/dsh-video-generator/health',
      '/dsh-video-generator/runs',
    ])
    assert.equal(effects.length, 3)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('health 路由返回 200 与计数', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-wire-'))
  try {
    const { routes } = wire({ DSH_HOME: dir })
    const res = fakeRes()
    await routes.get('/dsh-video-generator/health')!.handler({}, res)
    assert.equal(res.statusCode, 200)
    assert.ok(res.body.includes('"plugin":"dsh-video-generator"'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('api 面：伪造 Host 403 / GET 405 / 非法 JSON 400 / null body 400', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-wire-'))
  try {
    const { routes } = wire({ DSH_HOME: dir })
    const api = findApi(routes)

    const forbidden = fakeRes()
    await api.handler(
      { headers: { host: 'evil.com' }, socket: { remoteAddress: '127.0.0.1' }, method: 'POST', url: '/api/channels.list' } as unknown as Partial<IncomingMessage>,
      forbidden as unknown as ServerResponse,
    )
    assert.equal(forbidden.statusCode, 403)

    const notAllowed = fakeRes()
    await api.handler(
      { headers: { host: '127.0.0.1:1' }, socket: { remoteAddress: '127.0.0.1' }, method: 'GET', url: '/api/channels.list' } as unknown as Partial<IncomingMessage>,
      notAllowed as unknown as ServerResponse,
    )
    assert.equal(notAllowed.statusCode, 405)

    const reqWith = (body: string) =>
      ({
        headers: { host: '127.0.0.1:1' },
        socket: { remoteAddress: '127.0.0.1' },
        method: 'POST',
        url: '/api/channels.list',
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(body)
        },
      }) as unknown as Partial<IncomingMessage>

    const badJson = fakeRes()
    await api.handler(reqWith('{broken'), badJson as unknown as ServerResponse)
    assert.equal(badJson.statusCode, 400)

    const nullBody = fakeRes()
    await api.handler(reqWith('null'), nullBody as unknown as ServerResponse)
    assert.equal(nullBody.statusCode, 400)

    const okBody = fakeRes()
    await api.handler(reqWith('{}'), okBody as unknown as ServerResponse)
    assert.equal(okBody.statusCode, 200)
    assert.ok(okBody.body.includes('channels'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('api 面：超限请求体 413', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-wire-'))
  try {
    const { routes } = wire({ DSH_HOME: dir })
    const api = findApi(routes)
    const req = {
      headers: { host: '127.0.0.1:1' },
      socket: { remoteAddress: '127.0.0.1' },
      method: 'POST',
      url: '/api/channels.list',
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.alloc((1 << 20) + 1, 0x61)
      },
    } as unknown as Partial<IncomingMessage>
    const res = fakeRes()
    await api.handler(req, res as unknown as ServerResponse)
    assert.equal(res.statusCode, 413)
    assert.ok(res.body.includes('too-large'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
