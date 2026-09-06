import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { maskCredential, resolveVaultPath, VaultError, VaultStore } from '../src/store/vault.ts'

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), 'vgen-vault-'))
}

test('maskCredential 短串全遮、长串前3后3', () => {
  assert.equal(maskCredential('abc'), '••••')
  assert.equal(maskCredential('sk-1234567890xyz'), 'sk-••••xyz')
  assert.equal(maskCredential('12345678'), '••••')
  assert.equal(maskCredential('123456789'), '123••••789')
})

test('resolveVaultPath 跟随 DSH_HOME，无则回退 home', () => {
  assert.equal(resolveVaultPath({ DSH_HOME: '/lab' } as NodeJS.ProcessEnv), join('/lab', '.dsh-video-generator', 'vault.json'))
  const p = resolveVaultPath({} as NodeJS.ProcessEnv)
  assert.ok(p.includes(join('.dsh-video-generator', 'vault.json')))
})

test('save 落盘为 0600、目录 0700、内容可回读', { skip: process.platform === 'win32' && 'POSIX 权限位在 Windows 无意义' }, () => {
  const home = tmpHome()
  try {
    const store = VaultStore.open({ file: join(home, '.dsh-video-generator', 'vault.json') })
    const data = store.load()
    store.save(data)
    const st = statSync(join(home, '.dsh-video-generator', 'vault.json'))
    assert.equal(st.mode & 0o777, 0o600)
    assert.equal(statSync(join(home, '.dsh-video-generator')).mode & 0o777, 0o700)
    const round = JSON.parse(readFileSync(join(home, '.dsh-video-generator', 'vault.json'), 'utf8')) as { version: number }
    assert.equal(round.version, 1)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('损坏文件从默认空库开始，不抛错', () => {
  const home = tmpHome()
  try {
    const file = join(home, 'vault.json')
    writeFileSync(file, '{broken', 'utf8')
    const store = VaultStore.open({ file })
    assert.deepEqual(store.load().channels, [])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('load 对合法但形状错误的 JSON 逐字段守卫，回退默认', () => {
  const home = tmpHome()
  try {
    const file = join(home, 'vault.json')
    writeFileSync(file, JSON.stringify({ channels: 'oops', defaultChannelId: 42, budget: { confirmThresholdCny: 'x' }, gateDefaults: 'no', version: 99 }), 'utf8')
    const d = VaultStore.open({ file }).load()
    assert.deepEqual(d.channels, [])
    assert.equal(d.defaultChannelId, null)
    assert.equal(d.budget.confirmThresholdCny, 1)
    assert.deepEqual(d.gateDefaults, {})
    assert.equal(d.version, 1)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('读失败仅 ENOENT 回退，EACCES 原样抛出', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const home = tmpHome()
  try {
    const file = join(home, 'vault.json')
    writeFileSync(file, 'ok', 'utf8')
    chmodSync(file, 0o000)
    try {
      assert.throws(() => VaultStore.open({ file }).load())
    } finally {
      chmodSync(file, 0o600)
    }
    assert.equal(VaultStore.open({ file: join(home, 'nope.json') }).load().channels.length, 0)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('parse 失败先备份 .broken-* 再回退，且保存后可恢复读写', () => {
  const home = tmpHome()
  try {
    const file = join(home, 'vault.json')
    writeFileSync(file, '{broken', 'utf8')
    const store = VaultStore.open({ file })
    assert.deepEqual(store.load().channels, [])
    const leftovers = readdirSync(home).filter((f) => f.startsWith('vault.json.broken-'))
    assert.equal(leftovers.length, 1)
    store.save(store.load())
    assert.deepEqual(store.load().channels, [])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

const GOOD = { id: 'vectorengine', baseUrl: 'https://api.vectorengine.ai/v1', apiKey: 'sk-vgen-1234567890' }

test('createChannel 正常路径：落库、返回脱敏、明文不泄露', () => {
  const home = tmpHome()
  try {
    const store = VaultStore.open({ file: join(home, 'vault.json') })
    const masked = store.createChannel({ ...GOOD, label: '向量引擎' })
    assert.equal(masked.id, 'vectorengine')
    assert.equal(masked.apiKeyMasked, 'sk-••••890')
    assert.ok(!('apiKey' in masked))
    assert.ok(!JSON.stringify(masked).includes('sk-vgen-1234567890'))
    const full = store.getChannel('vectorengine')
    assert.equal(full?.apiKey, GOOD.apiKey)
    assert.equal(full?.enabled, true)
    assert.equal(full?.kind, 'openai-compat')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('createChannel 校验：非法 id/http baseUrl/短 key/重复 id', () => {
  const home = tmpHome()
  try {
    const store = VaultStore.open({ file: join(home, 'vault.json') })
    store.createChannel({ ...GOOD })
    assert.throws(() => store.createChannel({ ...GOOD, id: 'Bad Id' }), VaultError)
    assert.throws(() => store.createChannel({ ...GOOD, id: 'insecure', baseUrl: 'http://x.example' }), VaultError)
    assert.throws(() => store.createChannel({ ...GOOD, id: 'short', apiKey: 'sk-1' }), VaultError)
    // 重复 id 须为 conflict 类错误（断言 code 而非 message 文案）
    assert.throws(
      () => store.createChannel({ ...GOOD }),
      (err: unknown) => err instanceof VaultError && err.code === 'conflict',
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('updateChannel 只改提供的字段且永不明文回显；delete 生效', () => {
  const home = tmpHome()
  try {
    const store = VaultStore.open({ file: join(home, 'vault.json') })
    store.createChannel({ ...GOOD })
    const updated = store.updateChannel('vectorengine', { label: 'VE', enabled: false, baseUrl: 'https://api.vectorengine.cn/v1' })
    assert.equal(updated.label, 'VE')
    assert.equal(updated.enabled, false)
    assert.equal(updated.baseUrl, 'https://api.vectorengine.cn/v1')
    assert.ok(!JSON.stringify(updated).includes('sk-vgen-1234567890'))
    store.deleteChannel('vectorengine')
    assert.equal(store.getChannel('vectorengine'), null)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('setDefaultChannel + 预算阈值读写 + 跨实例持久化', () => {
  const home = tmpHome()
  const file = join(home, 'vault.json')
  try {
    const store = VaultStore.open({ file })
    store.createChannel({ ...GOOD })
    store.setDefaultChannel('vectorengine')
    store.setBudget(5)
    const again = VaultStore.open({ file })
    assert.equal(again.load().defaultChannelId, 'vectorengine')
    assert.equal(again.getBudget().confirmThresholdCny, 5)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
