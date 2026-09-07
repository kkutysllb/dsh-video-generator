import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { apply } from '../src/host/index.ts'
import type { IncomingMessage } from 'node:http'
import type { DshToolDefinition } from '../src/tools/handoff.ts'
import { VaultStore } from '../src/store/vault.ts'

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
  end(b?: string): void
  destroy?(): void
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
      res.body = b ?? ''
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
  const registeredTools: DshToolDefinition[] = []
  const sections: Array<{ name: string; order: number; text: string }> = []
  const disposers: Array<() => void> = []
  const ctx = {
    inject: undefined,
    webServer: {
      register(route: RegisteredRoute) {
        routes.set(route.path, route)
        return () => {}
      },
    },
    tools: {
      register(def: DshToolDefinition) {
        registeredTools.push(def)
        const d = () => {
          const i = registeredTools.indexOf(def)
          if (i >= 0) registeredTools.splice(i, 1)
        }
        disposers.push(d)
        return d
      },
    },
    systemPrompt: {
      section(spec: { name: string; order: number; text: string }) {
        sections.push(spec)
        return () => {}
      },
    },
    effect(fn: () => () => void, name?: string) {
      fn()
      effects.push(name ?? '')
      return () => {}
    },
  } as unknown as Parameters<typeof apply>[0]
  const dispose = apply(ctx)

  if (prevHome === undefined) delete process.env['DSH_HOME']
  else process.env['DSH_HOME'] = prevHome
  return { routes, effects, registeredTools, sections, dispose, disposers }
}

function findApi(routes: Map<string, RegisteredRoute>): RegisteredRoute {
  const r = routes.get('/dsh-video-generator/api')
  if (!r) throw new Error('api route 未注册')
  return r
}

test('apply 注册六条路由并经 effect 管理', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-wire-'))
  try {
    const { routes, effects } = wire({ DSH_HOME: dir })
    assert.deepEqual([...routes.keys()].sort(), [
      '/dsh-video-generator/api',
      '/dsh-video-generator/channels',
      '/dsh-video-generator/health',
      '/dsh-video-generator/media',
      '/dsh-video-generator/runs',
      '/dsh-video-generator/settings',
    ])
    assert.equal(effects.length, 6)
    assert.equal(routes.get('/dsh-video-generator/runs')!.kind, 'prefix')
    assert.equal(routes.get('/dsh-video-generator/media')!.kind, 'prefix')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('apply 注册三交接工具与 systemPrompt 通告；disposer 回收', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-wire-'))
  try {
    const w = wire({ DSH_HOME: dir })
    assert.deepEqual(
      [...w.registeredTools].map((d) => d.name).sort(),
      ['vgen_channels', 'vgen_generate', 'vgen_provide', 'vgen_review', 'vgen_script', 'vgen_status', 'vgen_story', 'vgen_storyboard'],
    )
    assert.ok(w.registeredTools.every((d) => typeof d.execute === 'function' && d.parameters && d.output?.render))
    assert.deepEqual(
      [...w.sections].map((s) => s.name),
      ['plugin:dsh-video-generator'],
    )
    // 登记 disposer：先逆向回收工具，工具名清空
    for (const d of w.disposers) d()
    assert.equal(w.registeredTools.length, 0)
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
      forbidden,
    )
    assert.equal(forbidden.statusCode, 403)

    const notAllowed = fakeRes()
    await api.handler(
      { headers: { host: '127.0.0.1:1' }, socket: { remoteAddress: '127.0.0.1' }, method: 'GET', url: '/api/channels.list' } as unknown as Partial<IncomingMessage>,
      notAllowed,
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
    await api.handler(reqWith('{broken'), badJson)
    assert.equal(badJson.statusCode, 400)

    const nullBody = fakeRes()
    await api.handler(reqWith('null'), nullBody)
    assert.equal(nullBody.statusCode, 400)

    const okBody = fakeRes()
    await api.handler(reqWith('{}'), okBody)
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
    await api.handler(req, res)
    assert.equal(res.statusCode, 413)
    assert.ok(res.body.includes('too-large'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// media 路由需要真流式响应（createReadStream pipe）：Writable 收集 chunks + 补被调用面
function writableRes(): FakeRes & { bytes(): Buffer; finish(): Promise<void>; on(ev: string, cb: () => void): void } {
  const chunks: Buffer[] = []
  let finishResolve: (() => void) | null = null
  const finishP = new Promise<void>((r) => {
    finishResolve = r
  })
  const res = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk as Buffer)
      cb()
    },
  }) as unknown as FakeRes & { bytes(): Buffer; finish(): Promise<void>; on(ev: string, cb: () => void): void }
  res.statusCode = 0
  res.headers = {}
  res.setHeader = (k, v) => {
    res.headers[k] = v
  }
  res.end = () => {
    finishResolve!()
  }
  res.destroy = () => {}
  res.bytes = () => Buffer.concat(chunks)
  res.body = ''
  res.on('finish', () => finishResolve!())
  res.finish = () => finishP
  return res
}

// media fixture：真 tmp run 目录 + 真 png；call() 走完整 handler 并等流结束
function mediaFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-wire-'))
  const { routes } = wire({ DSH_HOME: dir })
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad, 0xbe, 0xef])
  const runDir = join(dir, '.dsh-video-generator', 'runs', 'run-alpha')
  mkdirSync(join(runDir, 'assets'), { recursive: true })
  writeFileSync(join(runDir, 'assets', 'a.png'), png)
  const media = routes.get('/dsh-video-generator/media')!
  const call = async (url: string, host = '127.0.0.1:1', method = 'GET') => {
    const res = writableRes()
    await media.handler(
      { method, url, headers: { host }, socket: { remoteAddress: '127.0.0.1' } } as unknown as Partial<IncomingMessage>,
      res as unknown as FakeRes,
    )
    await res.finish()
    return res
  }
  return { png, call, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('media：GET run 内真文件 → 200 + content-type image/png + 字节一致 + no-store', async () => {
  const fx = mediaFixture()
  try {
    const res = await fx.call('/dsh-video-generator/media/run-alpha/assets/a.png')
    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['content-type'], 'image/png')
    assert.equal(res.headers['cache-control'], 'no-store')
    assert.equal(res.headers['content-length'], String(fx.png.length))
    assert.ok(res.bytes().equals(fx.png))
  } finally {
    fx.cleanup()
  }
})

test('media：目录穿越 URL → 404', async () => {
  const fx = mediaFixture()
  try {
    const res = await fx.call('/dsh-video-generator/media/run-alpha/../../vault.json')
    assert.equal(res.statusCode, 404)
  } finally {
    fx.cleanup()
  }
})

test('media：编码穿越 URL（%2e%2e%2f）→ 404', async () => {
  const fx = mediaFixture()
  try {
    const res = await fx.call('/dsh-video-generator/media/run-alpha/%2e%2e%2fvault.json')
    assert.equal(res.statusCode, 404)
  } finally {
    fx.cleanup()
  }
})

test('media：伪造 Host（evil.com）→ 403', async () => {
  const fx = mediaFixture()
  try {
    const res = await fx.call('/dsh-video-generator/media/run-alpha/assets/a.png', 'evil.com')
    assert.equal(res.statusCode, 403)
  } finally {
    fx.cleanup()
  }
})

test('media：HEAD → 200 + 头齐全 + 空 body', async () => {
  const fx = mediaFixture()
  try {
    const res = await fx.call('/dsh-video-generator/media/run-alpha/assets/a.png', '127.0.0.1:1', 'HEAD')
    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['content-type'], 'image/png')
    assert.equal(res.headers['content-length'], String(fx.png.length))
    assert.equal(res.bytes().length, 0)
  } finally {
    fx.cleanup()
  }
})

test('便捷路由：GET /channels 返回通道且不含明文 key；伪造 Host 403', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-wire-'))
  try {
    const { routes } = wire({ DSH_HOME: dir })
    VaultStore.open({ env: { DSH_HOME: dir } }).createChannel({
      id: 'ch1',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-secret-12345678',
    })
    const channels = routes.get('/dsh-video-generator/channels')!
    const req = (host: string) =>
      ({ method: 'GET', headers: { host }, socket: { remoteAddress: '127.0.0.1' } }) as unknown as Partial<IncomingMessage>

    const ok = fakeRes()
    await channels.handler(req('127.0.0.1:1'), ok)
    assert.equal(ok.statusCode, 200)
    assert.ok(ok.body.includes('ch1'))
    assert.ok(!ok.body.includes('sk-secret'))

    const forbidden = fakeRes()
    await channels.handler(req('evil.com'), forbidden)
    assert.equal(forbidden.statusCode, 403)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('便捷路由：POST /settings 更新预算；非法 JSON 400；非 POST 405', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-wire-'))
  try {
    const { routes } = wire({ DSH_HOME: dir })
    const settings = routes.get('/dsh-video-generator/settings')!
    const reqWith = (method: string, body?: string) =>
      ({
        method,
        headers: { host: '127.0.0.1:1' },
        socket: { remoteAddress: '127.0.0.1' },
        ...(body === undefined
          ? {}
          : {
              [Symbol.asyncIterator]: async function* () {
                yield Buffer.from(body)
              },
            }),
      }) as unknown as Partial<IncomingMessage>

    const updated = fakeRes()
    await settings.handler(reqWith('POST', '{"confirmThresholdCny": 12.5}'), updated)
    assert.equal(updated.statusCode, 200)
    assert.ok(updated.body.includes('12.5'))

    const badJson = fakeRes()
    await settings.handler(reqWith('POST', '{broken'), badJson)
    assert.equal(badJson.statusCode, 400)

    const notAllowed = fakeRes()
    await settings.handler(reqWith('GET'), notAllowed)
    assert.equal(notAllowed.statusCode, 405)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runs prefix：列表免围栏、未知 run 详情 404、非两段路径 404、伪造 Host 403', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-wire-'))
  try {
    const { routes } = wire({ DSH_HOME: dir })
    const runsRoute = routes.get('/dsh-video-generator/runs')!
    const req = (url: string, host = '127.0.0.1:1') =>
      ({ method: 'GET', url, headers: { host }, socket: { remoteAddress: '127.0.0.1' } }) as unknown as Partial<IncomingMessage>

    const list = fakeRes()
    await runsRoute.handler(req('/dsh-video-generator/runs'), list)
    assert.equal(list.statusCode, 200)
    assert.ok(list.body.includes('"runs"'))

    const detail = fakeRes()
    await runsRoute.handler(req('/dsh-video-generator/runs/no-such-run'), detail)
    assert.equal(detail.statusCode, 404)

    const unknown = fakeRes()
    await runsRoute.handler(req('/dsh-video-generator/runs/a/b'), unknown)
    assert.equal(unknown.statusCode, 404)

    const forbidden = fakeRes()
    await runsRoute.handler(req('/dsh-video-generator/runs/no-such-run', 'evil.com'), forbidden)
    assert.equal(forbidden.statusCode, 403)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
