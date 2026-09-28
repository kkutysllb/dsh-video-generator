/** VaultStore v2 单测：凭证层（Channel）+ 用途槽层（每槽一条绑定）+ 模板/预算/gate。 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { maskCredential, resolveVaultPath, VaultError, VaultStore } from '../src/store/vault.ts'

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), 'vgen-vault-'))
}

function tmpVault(): { home: string; store: VaultStore; file: string } {
  const home = tmpHome()
  const file = join(home, 'vault.json')
  return { home, store: VaultStore.open({ file }), file }
}

const GOOD = { id: 'vectorengine', baseUrl: 'https://api.vectorengine.ai/v1', apiKey: 'sk-vgen-1234567890' }

const SYNC_FIELDS = {
  endpoint: { path: '/v1/audio/music', method: 'POST' },
  mode: 'sync',
  request: { promptField: 'prompt' },
  response: { audioPath: 'data.audio_url' },
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

test('save 落盘为 0600、目录 0700、内容为 v2 形状', { skip: process.platform === 'win32' && 'POSIX 权限位在 Windows 无意义' }, () => {
  const { home, store, file } = tmpVault()
  try {
    const data = store.load()
    assert.equal(data.version, 2)
    store.save(data)
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.equal(statSync(home).mode & 0o777, 0o700)
    const round = JSON.parse(readFileSync(file, 'utf8')) as { version: number; channels: unknown[]; slots: Record<string, unknown>; musicTemplates: unknown[] }
    assert.equal(round.version, 2)
    assert.deepEqual(round.channels, [])
    assert.deepEqual(round.slots, {})
    assert.deepEqual(round.musicTemplates, [])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('损坏文件先备份 .broken-* 再回退默认，保存后可恢复读写', () => {
  const { home, store, file } = tmpVault()
  try {
    writeFileSync(file, '{broken', 'utf8')
    assert.deepEqual(store.load().channels, [])
    const leftovers = readdirSync(home).filter((f) => f.startsWith('vault.json.broken-'))
    assert.equal(leftovers.length, 1)
    store.save(store.load())
    assert.deepEqual(store.load().channels, [])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('load 对合法但形状错误的 JSON 逐字段守卫，回退默认', () => {
  const { store, file } = tmpVault()
  try {
    writeFileSync(file, JSON.stringify({
      version: 99, channels: 'oops', slots: 'no', musicTemplates: 5,
      budget: { confirmThresholdCny: 'x' }, gateDefaults: 'no',
    }), 'utf8')
    const d = store.load()
    assert.equal(d.version, 2)
    assert.deepEqual(d.channels, [])
    assert.deepEqual(d.slots, {})
    assert.deepEqual(d.musicTemplates, [])
    assert.equal(d.budget.confirmThresholdCny, 1)
    assert.deepEqual(d.gateDefaults, {})
    // 形状合法的 gateDefaults 原样保留
    writeFileSync(file, JSON.stringify({ version: 99, gateDefaults: { video: 'manual' } }), 'utf8')
    assert.deepEqual(store.load().gateDefaults, { video: 'manual' })
  } finally {
    rmSync(join(file, '..'), { recursive: true, force: true })
  }
})

test('读失败仅 ENOENT 回退，EACCES 原样抛出', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const { home, file } = tmpVault()
  try {
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

test('createChannel 正常路径：落库、返回脱敏、明文不泄露、无 models 字段', () => {
  const { store } = tmpVault()
  try {
    const masked = store.createChannel({ ...GOOD, label: '向量引擎' })
    assert.equal(masked.id, 'vectorengine')
    assert.equal(masked.apiKeyMasked, 'sk-••••890')
    assert.ok(!('apiKey' in masked))
    assert.ok(!('models' in masked))
    assert.ok(!JSON.stringify(masked).includes('sk-vgen-1234567890'))
    const full = store.getChannel('vectorengine')
    assert.equal(full?.apiKey, GOOD.apiKey)
    assert.equal(full?.enabled, true)
    assert.equal(full?.kind, 'openai-compat')
    assert.deepEqual(full?.protocols, [])
  } finally {
    rmSync(join(store.file, '..'), { recursive: true, force: true })
  }
})

test('createChannel 校验：非法 id/http baseUrl/短 key/重复 id conflict', () => {
  const { store } = tmpVault()
  try {
    store.createChannel({ ...GOOD })
    assert.throws(() => store.createChannel({ ...GOOD, id: 'Bad Id' }), VaultError)
    assert.throws(() => store.createChannel({ ...GOOD, id: 'insecure', baseUrl: 'http://x.example' }), VaultError)
    assert.throws(() => store.createChannel({ ...GOOD, id: 'short', apiKey: 'sk-1' }), VaultError)
    assert.throws(
      () => store.createChannel({ ...GOOD }),
      (err: unknown) => err instanceof VaultError && err.code === 'conflict',
    )
  } finally {
    rmSync(join(store.file, '..'), { recursive: true, force: true })
  }
})

test('updateChannel 只改提供的字段（含 protocols）、永不明文回显；delete not-found', () => {
  const { store } = tmpVault()
  try {
    store.createChannel({ ...GOOD })
    const updated = store.updateChannel('vectorengine', {
      label: 'VE', enabled: false, baseUrl: 'https://api.vectorengine.cn/v1',
      protocols: ['openai-images', 'generic-music'],
    })
    assert.equal(updated.label, 'VE')
    assert.equal(updated.enabled, false)
    assert.equal(updated.baseUrl, 'https://api.vectorengine.cn/v1')
    assert.deepEqual(updated.protocols, ['openai-images', 'generic-music'])
    assert.ok(!JSON.stringify(updated).includes('sk-vgen-1234567890'))
    // 非法协议族 → bad-request；未知通道 → not-found
    assert.throws(
      () => store.updateChannel('vectorengine', { protocols: ['minimax-music'] as never }),
      (err: unknown) => err instanceof VaultError && err.code === 'bad-request',
    )
    assert.throws(
      () => store.updateChannel('nope', { label: 'x' }),
      (err: unknown) => err instanceof VaultError && err.code === 'not-found',
    )
    store.deleteChannel('vectorengine')
    assert.equal(store.getChannel('vectorengine'), null)
  } finally {
    rmSync(join(store.file, '..'), { recursive: true, force: true })
  }
})

test('预算阈值边界 0..10000 + 跨实例持久化（已无 defaultChannel 概念）', () => {
  const { store, file } = tmpVault()
  try {
    store.createChannel({ ...GOOD })
    store.setBudget(5)
    assert.throws(() => store.setBudget(-0.01), VaultError)
    assert.throws(() => store.setBudget(10000.01), VaultError)
    assert.throws(() => store.setBudget(Number.NaN), VaultError)
    store.setBudget(0)
    store.setBudget(10000)
    const again = VaultStore.open({ file })
    assert.equal(again.getBudget().confirmThresholdCny, 10000)
    assert.ok(!('defaultChannelId' in again.load()))
  } finally {
    rmSync(join(file, '..'), { recursive: true, force: true })
  }
})

test('两实例交错写：后写者不抹掉外部写入', () => {
  const { home, file } = tmpVault()
  try {
    const a = VaultStore.open({ file })
    const b = VaultStore.open({ file })
    a.createChannel({ id: 'ch-a', baseUrl: 'https://a.example.com/v1', apiKey: 'sk-vgen-aaaaaaaa' })
    b.createChannel({ id: 'ch-b', baseUrl: 'https://b.example.com/v1', apiKey: 'sk-vgen-bbbbbbbb' })
    a.setBudget(3)
    const ids = VaultStore.open({ file }).load().channels.map((c) => c.id).sort()
    assert.deepEqual(ids, ['ch-a', 'ch-b'])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('setSlotBinding 单槽单绑定：同槽两次 set → 后者覆盖，仅一条绑定', () => {
  const { store } = tmpVault()
  try {
    store.createChannel({ ...GOOD })
    store.setSlotBinding({ slot: 'video', channelId: 'vectorengine', model: 'vid-1', protocol: 'dashscope-video', capabilities: { textToVideo: true } })
    store.setSlotBinding({ slot: 'video', channelId: 'vectorengine', model: 'vid-2', protocol: 'kling-video' })
    const bindings = store.listSlotBindings()
    assert.equal(bindings.length, 1)
    assert.equal(bindings[0]!.slot, 'video')
    assert.equal(bindings[0]!.model, 'vid-2')
    assert.equal(bindings[0]!.protocol, 'kling-video')
    assert.equal(store.getSlotBinding('video')?.model, 'vid-2')
  } finally {
    rmSync(join(store.file, '..'), { recursive: true, force: true })
  }
})

test('setSlotBinding 校验：未知通道 not-found；music 缺映射 / 非 music 槽 generic-music → bad-request 带提示', () => {
  const { store } = tmpVault()
  try {
    store.createChannel({ ...GOOD })
    assert.throws(
      () => store.setSlotBinding({ slot: 'video', channelId: 'ghost', model: 'v', protocol: 'kling-video' }),
      (err: unknown) => err instanceof VaultError && err.code === 'not-found',
    )
    assert.throws(
      () => store.setSlotBinding({ slot: 'music.bgm', channelId: 'vectorengine', model: 'm', protocol: 'generic-music' }),
      (err: unknown) => err instanceof VaultError && err.code === 'bad-request' && err.message.includes('music 槽'),
    )
    assert.throws(
      () => store.setSlotBinding({ slot: 'video', channelId: 'vectorengine', model: 'v', protocol: 'generic-music', music: SYNC_FIELDS }),
      VaultError,
    )
    assert.equal(store.listSlotBindings().length, 0)
  } finally {
    rmSync(join(store.file, '..'), { recursive: true, force: true })
  }
})

test('getSlotBinding/clearSlotBinding：非法槽位 bad-request；cleared 语义；music 绑定含映射', () => {
  const { store } = tmpVault()
  try {
    store.createChannel({ ...GOOD })
    assert.throws(
      () => store.getSlotBinding('image.hero' as never),
      (err: unknown) => err instanceof VaultError && err.code === 'bad-request',
    )
    assert.equal(store.getSlotBinding('tts'), null)
    store.setSlotBinding({ slot: 'music.bgm', channelId: 'vectorengine', model: 'm', protocol: 'generic-music', music: SYNC_FIELDS })
    const bgm = store.getSlotBinding('music.bgm')
    assert.ok(bgm?.music)
    assert.equal(bgm.music.endpoint.path, '/v1/audio/music')
    assert.deepEqual(store.clearSlotBinding('music.bgm'), { cleared: true })
    assert.deepEqual(store.clearSlotBinding('music.bgm'), { cleared: false })
    assert.equal(store.getSlotBinding('music.bgm'), null)
  } finally {
    rmSync(join(store.file, '..'), { recursive: true, force: true })
  }
})

test('deleteChannel 清除引用该通道的槽位绑定（返回 clearedSlots）；重复删 not-found', () => {
  const { store } = tmpVault()
  try {
    store.createChannel({ ...GOOD, id: 'ch-a', apiKey: 'sk-vgen-aaaaaaaa' })
    store.createChannel({ ...GOOD, id: 'ch-b', apiKey: 'sk-vgen-bbbbbbbb' })
    store.setSlotBinding({ slot: 'video', channelId: 'ch-a', model: 'v', protocol: 'kling-video' })
    store.setSlotBinding({ slot: 'tts', channelId: 'ch-a', model: 't', protocol: 'openai-tts' })
    store.setSlotBinding({ slot: 'image.master', channelId: 'ch-b', model: 'i', protocol: 'openai-images' })
    const res = store.deleteChannel('ch-a')
    assert.deepEqual([...res.clearedSlots].sort(), ['tts', 'video'])
    assert.equal(store.getSlotBinding('video'), null)
    assert.equal(store.getSlotBinding('tts'), null)
    assert.equal(store.getSlotBinding('image.master')?.channelId, 'ch-b')
    assert.throws(
      () => store.deleteChannel('ch-a'),
      (err: unknown) => err instanceof VaultError && err.code === 'not-found',
    )
  } finally {
    rmSync(join(store.file, '..'), { recursive: true, force: true })
  }
})

test('markChannelVerified 写 verifiedAt/verifyNote，出口脱敏，跨实例可见', () => {
  const { store, file } = tmpVault()
  try {
    store.createChannel({ ...GOOD })
    const masked = store.markChannelVerified('vectorengine', '实测 200 OK')
    assert.ok(masked.verifiedAt)
    assert.ok(!Number.isNaN(Date.parse(masked.verifiedAt)))
    assert.equal(masked.verifyNote, '实测 200 OK')
    assert.ok(!('apiKey' in masked))
    const full = VaultStore.open({ file }).getChannel('vectorengine')
    assert.equal(full?.verifiedAt, masked.verifiedAt)
    assert.equal(full?.verifyNote, '实测 200 OK')
  } finally {
    rmSync(join(file, '..'), { recursive: true, force: true })
  }
})

test('用户音乐模板 CRUD：save/list/delete 落库持久，缺失删除 not-found', () => {
  const { store, file } = tmpVault()
  try {
    const saved = store.saveMusicTemplate({ label: '我的站', fields: SYNC_FIELDS, note: '备注' })
    assert.equal(saved.source, 'user')
    assert.equal(store.listUserMusicTemplates().length, 1)
    assert.deepEqual(VaultStore.open({ file }).listUserMusicTemplates(), store.listUserMusicTemplates())
    store.deleteMusicTemplate(saved.id)
    assert.equal(store.listUserMusicTemplates().length, 0)
    assert.throws(
      () => store.deleteMusicTemplate(saved.id),
      (err: unknown) => err instanceof VaultError && err.code === 'not-found',
    )
  } finally {
    rmSync(join(file, '..'), { recursive: true, force: true })
  }
})

test('通道数上限 20', () => {
  const { store } = tmpVault()
  try {
    for (let i = 0; i < 20; i++) {
      store.createChannel({ id: `ch${String(i).padStart(2, '0')}`, baseUrl: 'https://x.example.com/v1', apiKey: 'sk-vgen-99999999' })
    }
    assert.throws(() => store.createChannel({ id: 'ch21', baseUrl: 'https://x.example.com/v1', apiKey: 'sk-vgen-99999999' }), VaultError)
  } finally {
    rmSync(join(store.file, '..'), { recursive: true, force: true })
  }
})

test('setGateDefault：非法 mode 抛错、合法写入、跨实例回读', () => {
  const { store, file } = tmpVault()
  try {
    assert.throws(() => store.setGateDefault('story', 'maybe' as never), VaultError)
    store.setGateDefault('story', 'manual')
    assert.equal(VaultStore.open({ file }).getGateDefaults()['story'], 'manual')
  } finally {
    rmSync(join(file, '..'), { recursive: true, force: true })
  }
})

test('baseUrl 尾斜杠归一存储', () => {
  const { store } = tmpVault()
  try {
    store.createChannel({ id: 'slash', baseUrl: 'https://x.example.com/v1///', apiKey: 'sk-vgen-33333333' })
    assert.equal(store.getChannel('slash')?.baseUrl, 'https://x.example.com/v1')
  } finally {
    rmSync(join(store.file, '..'), { recursive: true, force: true })
  }
})
