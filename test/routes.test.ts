import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleApi, healthPayload, isLoopbackRequest } from '../src/host/routes.ts'
import { VaultStore } from '../src/store/vault.ts'
import { RunStore } from '../src/store/runs.ts'
import { probeChannel } from '../src/probe.ts'

function ctx() {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-routes-'))
  const vault = VaultStore.open({ file: join(dir, 'vault.json') })
  const runs = RunStore.open({ rootDir: join(dir, 'runs') })
  return {
    dir,
    vault,
    runs,
    api: { vault, runs, probe: probeChannel },
  }
}

test('信任围栏：loopback 精确匹配放行', () => {
  assert.equal(isLoopbackRequest('127.0.0.1:3000', '127.0.0.1'), true)
  assert.equal(isLoopbackRequest('localhost:3000', '::1'), true)
  assert.equal(isLoopbackRequest('[::1]:3000', '127.0.0.1'), true)
})

test('信任围栏：前缀伪造与 rebind 组合全部拒绝', () => {
  assert.equal(isLoopbackRequest('127.0.0.1.evil.com', '10.1.2.3'), false)
  assert.equal(isLoopbackRequest('localhost.attacker.io', '10.1.2.3'), false)
  assert.equal(isLoopbackRequest('127.0.0.10', '10.1.2.3'), false)
  assert.equal(isLoopbackRequest('evil.com', '127.0.0.1'), false) // 真 rebind 形态：remote 回环不补偿伪造 host
  assert.equal(isLoopbackRequest(['127.0.0.1', 'evil.com'], '127.0.0.1'), false) // 重复 Host 头
  assert.equal(isLoopbackRequest(undefined, '127.0.0.1'), true) // Host 缺失退 remote
  assert.equal(isLoopbackRequest(undefined, '10.1.2.3'), false)
})

test('信任围栏：trustedHosts 精确放行', () => {
  assert.equal(isLoopbackRequest('lab.internal:3000', '10.1.2.3', ['lab.internal']), true)
  assert.equal(isLoopbackRequest('lab.internal:3000', '10.1.2.3', ['other.internal']), false)
})

test('healthPayload 汇报版本与通道计数（不含任何明文）', () => {
  const c = ctx()
  try {
    c.vault.createChannel({ id: 'ch1', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-secret-12345678' })
    const payload = healthPayload({ vault: c.vault, runs: c.runs }) as Record<string, unknown>
    assert.equal(payload['ok'], true)
    assert.equal((payload['channels'] as Record<string, unknown>).total, 1)
    assert.ok(!JSON.stringify(payload).includes('sk-secret'))
  } finally {
    rmSync(c.dir, { recursive: true, force: true })
  }
})

test('handleApi：channels.create/list/update/delete/setDefault + settings', () => {
  const c = ctx()
  try {
    const created = handleApi(c.api, 'channels.create', { id: 've', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-vgen-12345678' })
    assert.equal((created as { ok: boolean }).ok, true)
    assert.ok(!JSON.stringify(created).includes('sk-vgen-12345678'))

    const list = handleApi(c.api, 'channels.list', {}) as { ok: boolean; value: { channels: unknown[] } }
    assert.equal(list.ok, true)
    assert.equal(list.value.channels.length, 1)

    const upd = handleApi(c.api, 'channels.update', { id: 've', patch: { label: '向量引擎' } }) as { ok: boolean }
    assert.equal(upd.ok, true)

    const def = handleApi(c.api, 'channels.setDefault', { id: 've' }) as { ok: boolean }
    assert.equal(def.ok, true)

    const settings = handleApi(c.api, 'settings.get', {}) as { value: { defaultChannelId: string; budget: { confirmThresholdCny: number } } }
    assert.equal(settings.value.defaultChannelId, 've')
    assert.equal(settings.value.budget.confirmThresholdCny, 1)

    handleApi(c.api, 'settings.update', { confirmThresholdCny: 3 })
    assert.equal(c.vault.getBudget().confirmThresholdCny, 3)

    handleApi(c.api, 'channels.delete', { id: 've' })
    assert.equal(c.vault.getChannel('ve'), null)
  } finally {
    rmSync(c.dir, { recursive: true, force: true })
  }
})

test('handleApi：VaultError 映射为 ok:false 信封；未知方法报 unknown-method', () => {
  const c = ctx()
  try {
    const bad = handleApi(c.api, 'channels.create', { id: 'Bad!', baseUrl: 'https://x.example', apiKey: 'sk-vgen-12345678' }) as { ok: boolean; error: { code: string } }
    assert.equal(bad.ok, false)
    assert.equal(bad.error.code, 'bad-request')
    const unknown = handleApi(c.api, 'nope', {}) as { ok: boolean; error: { code: string; message: string } }
    assert.equal(unknown.ok, false)
    assert.equal(unknown.error.code, 'bad-request')
    assert.ok(unknown.error.message.includes('unknown-method'))
  } finally {
    rmSync(c.dir, { recursive: true, force: true })
  }
})

test('channels.test 返回探测信封（异步包装）', async () => {
  const c = ctx()
  try {
    c.vault.createChannel({ id: 've', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-vgen-12345678' })
    const fakeProbe = (async () => ({ ok: true, baseUrl: 'https://api.example.com/v1', models: ['m1'], status: 200 })) as unknown as typeof probeChannel
    const res = await handleApi({ vault: c.vault, runs: c.runs, probe: fakeProbe }, 'channels.test', { id: 've' })
    assert.equal((res as { ok: boolean }).ok, true)
    const value = (res as { value: { probe: { models: string[] } } }).value
    assert.deepEqual(value.probe.models, ['m1'])
  } finally {
    rmSync(c.dir, { recursive: true, force: true })
  }
})

test('channels.test 通道不存在 -> not-found 信封', async () => {
  const c = ctx()
  try {
    const res = await handleApi(c.api, 'channels.test', { id: 'nope' })
    assert.equal((res as { ok: boolean }).ok, false)
    assert.equal((res as { error: { code: string } }).error.code, 'not-found')
  } finally {
    rmSync(c.dir, { recursive: true, force: true })
  }
})

test('runs.list 通过 handleApi 可用', () => {
  const c = ctx()
  try {
    c.runs.create('r1')
    const res = handleApi(c.api, 'runs.list', {}) as { ok: boolean; value: { runs: unknown[] } }
    assert.equal(res.ok, true)
    assert.equal(res.value.runs.length, 1)
  } finally {
    rmSync(c.dir, { recursive: true, force: true })
  }
})

test('channels.create 重复 id -> conflict 信封；响应含 apiKeyMasked', async () => {
  const c = ctx()
  try {
    handleApi(c.api, 'channels.create', { id: 've', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-vgen-12345678' })
    const dup = handleApi(c.api, 'channels.create', { id: 've', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-vgen-12345678' }) as { ok: boolean; error: { code: string } }
    assert.equal(dup.ok, false)
    assert.equal(dup.error.code, 'conflict')
    const list = handleApi(c.api, 'channels.list', {}) as { value: { channels: Array<Record<string, unknown>> } }
    assert.ok('apiKeyMasked' in list.value.channels[0]!)
    assert.ok(!('apiKey' in list.value.channels[0]!))
  } finally {
    rmSync(c.dir, { recursive: true, force: true })
  }
})

test('宽进收窄：apiKey 对象/enabled 字符串/threshold null', () => {
  const c = ctx()
  try {
    const bad = handleApi(c.api, 'channels.create', { id: 'x', baseUrl: 'https://x.example.com/v1', apiKey: {} }) as { ok: boolean; error: { code: string } }
    assert.equal(bad.error.code, 'bad-request')
    handleApi(c.api, 'channels.create', { id: 'x', baseUrl: 'https://x.example.com/v1', apiKey: 'sk-vgen-12345678' })
    handleApi(c.api, 'channels.update', { id: 'x', patch: { enabled: 'false' } }) // 字符串被忽略，不翻转
    assert.equal(c.vault.getChannel('x')?.enabled, true)
    const t = handleApi(c.api, 'settings.update', { confirmThresholdCny: null }) as { ok: boolean; error?: { code: string } }
    assert.equal(t.ok, false)
    assert.equal(c.vault.getBudget().confirmThresholdCny, 1) // 未被清零
  } finally {
    rmSync(c.dir, { recursive: true, force: true })
  }
})

test('probe reject -> internal 泛化信封（不泄漏细节）', async () => {
  const c = ctx()
  try {
    c.vault.createChannel({ id: 've', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-vgen-12345678' })
    const boom = (async () => { throw new Error('ECONNREFUSED /Users/libing/secret/path') }) as unknown as typeof probeChannel
    const res = await handleApi({ vault: c.vault, runs: c.runs, probe: boom }, 'channels.test', { id: 've' })
    assert.equal((res as { ok: boolean }).ok, false)
    const msg = JSON.stringify(res)
    assert.ok(!msg.includes('/Users/libing/secret'))
  } finally {
    rmSync(c.dir, { recursive: true, force: true })
  }
})

test('probe ok:false -> 信封 ok:true 但 value.probe.ok false（契约注释钉住）', async () => {
  const c = ctx()
  try {
    c.vault.createChannel({ id: 've', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-vgen-12345678' })
    const failProbe = (async () => ({ ok: false, baseUrl: 'https://api.example.com/v1', models: [], status: 401, error: 'auth-failed' as const })) as unknown as typeof probeChannel
    const res = await handleApi({ vault: c.vault, runs: c.runs, probe: failProbe }, 'channels.test', { id: 've' })
    const value = (res as { ok: boolean; value: { probe: { ok: boolean; error?: string } } }).value
    assert.equal((res as { ok: boolean }).ok, true)
    assert.equal(value.probe.ok, false)
    assert.equal(value.probe.error, 'auth-failed')
  } finally {
    rmSync(c.dir, { recursive: true, force: true })
  }
})

test('同步内部错误不泄漏细节', () => {
  const c = ctx()
  try {
    // 用只读坏的 probe 触发不了同步路径；直接构造：runs 传一个 get 会抛的假实例
    const evilRuns = {
      create: () => { throw new Error('EACCES: permission denied, /Users/libing/secret') },
      list: () => { throw new Error('EACCES: permission denied, /Users/libing/secret') },
    } as unknown as RunStore
    const res = handleApi({ vault: c.vault, runs: evilRuns, probe: probeChannel }, 'runs.list', {}) as { ok: boolean; error: { code: string; message: string } }
    assert.equal(res.ok, false)
    assert.equal(res.error.code, 'internal')
    assert.ok(!res.error.message.includes('/Users/libing/secret'))
  } finally {
    rmSync(c.dir, { recursive: true, force: true })
  }
})
