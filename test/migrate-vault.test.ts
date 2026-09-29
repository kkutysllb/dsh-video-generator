/** vault v1 → v2 迁移单测（规格 2026-09-28 §7）：直调 migrateV1ToV2 + VaultStore.load 集成幂等。 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateV1ToV2 } from '../src/store/migrate-vault.ts'
import { VaultStore, type VaultData } from '../src/store/vault.ts'

function tmpCase(): { home: string; file: string } {
  const home = mkdtempSync(join(tmpdir(), 'vgen-mig-'))
  return { home, file: join(home, 'vault.json') }
}

/** 迁移会 console.log 一行；静音并回收，避免污染 TAP 输出。 */
function silence<T>(fn: () => T): { out: T; logs: string[] } {
  const logs: string[] = []
  const origLog = console.log
  const origErr = console.error
  console.log = (...args: unknown[]) => { logs.push(args.map((a) => String(a)).join(' ')) }
  console.error = (...args: unknown[]) => { logs.push(args.map((a) => String(a)).join(' ')) }
  try {
    return { out: fn(), logs }
  } finally {
    console.log = origLog
    console.error = origErr
  }
}

/** 典型 v1 文档：主通道带 image/video/tts 各两个模型 + 预算 + gate。 */
function v1Doc(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    defaultChannelId: 'ch-main',
    channels: [{
      id: 'ch-main',
      label: '主站',
      baseUrl: 'https://api.main.example',
      apiKey: 'sk-vgen-main123456',
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      models: [
        { model: 'img-a', kind: 'image' }, { model: 'img-b', kind: 'image' },
        { model: 'vid-a', kind: 'video' }, { model: 'vid-b', kind: 'video' },
        { model: 'tts-a', kind: 'tts' }, { model: 'tts-b', kind: 'tts' },
      ],
    }],
    budget: { confirmThresholdCny: 7 },
    gateDefaults: { video: 'ask' },
    ...overrides,
  })
}

function migrateRaw(file: string, raw: string): { d: VaultData; logs: string[] } {
  const parsed = JSON.parse(raw) as unknown
  const { out, logs } = silence(() => migrateV1ToV2(file, raw, parsed, (d) => new VaultStore(file).save(d)))
  return { d: out, logs }
}

function v1Backups(home: string): string[] {
  return readdirSync(home).filter((f) => f.startsWith('vault.json.v1.bak-'))
}

test('v1 典型迁移：image 双槽同源、video 走 dashscope、tts 走 openai-tts，music 留空，预算/gate 保留', () => {
  const { home, file } = tmpCase()
  try {
    const raw = v1Doc()
    writeFileSync(file, raw, 'utf8')
    const { d, logs } = migrateRaw(file, raw)

    // 6 槽词汇表中恰好绑定 4 个：image.master/image.shot/video/tts；music.* 留空
    assert.deepEqual(Object.keys(d.slots).sort(), ['image.master', 'image.shot', 'tts', 'video'])

    const master = d.slots['image.master']!
    assert.equal(master.channelId, 'ch-main')
    assert.equal(master.model, 'img-a') // 每个 kind 只取第一项
    assert.equal(master.protocol, 'openai-images')
    assert.deepEqual(master.capabilities, { sizeParam: true })

    const shot = d.slots['image.shot']!
    assert.equal(shot.model, 'img-a') // 与主图同源
    assert.equal(shot.protocol, 'openai-images')
    assert.deepEqual(shot.capabilities, { referenceImage: true })

    const video = d.slots['video']!
    assert.equal(video.model, 'vid-a')
    assert.equal(video.protocol, 'dashscope-video') // 非 kling 名 → dashscope 透传
    assert.deepEqual(video.capabilities, { imageToVideo: true, textToVideo: false, maxDurationSec: 10 })

    const tts = d.slots['tts']!
    assert.equal(tts.model, 'tts-a')
    assert.equal(tts.protocol, 'openai-tts')
    assert.deepEqual(tts.capabilities, {})

    assert.equal(d.slots['music.bgm'], undefined)
    assert.equal(d.slots['music.song'], undefined)

    // 预算与 gate 原样保留
    assert.deepEqual(d.budget, { confirmThresholdCny: 7 })
    assert.deepEqual(d.gateDefaults, { video: 'ask' })

    // 备份恰一份 + 日志一行
    assert.equal(v1Backups(home).length, 1)
    assert.equal(logs.length, 1)
    assert.ok(logs[0]!.includes('v1→v2'))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('v1 迁移来源：defaultChannelId 指向缺失 id → 回落首个 enabled 通道', () => {
  const { file } = tmpCase()
  const raw = JSON.stringify({
    version: 1,
    defaultChannelId: 'ghost',
    channels: [
      { id: 'ch-off', label: '停用', baseUrl: 'https://off.example', apiKey: 'sk-vgen-off123456', enabled: false, createdAt: '', models: [{ model: 'off-img', kind: 'image' }] },
      { id: 'ch-on', label: '在用', baseUrl: 'https://on.example', apiKey: 'sk-vgen-on1234567', enabled: true, createdAt: '', models: [{ model: 'on-img', kind: 'image' }, { model: 'on-vid', kind: 'video' }] },
    ],
  })
  const { d } = migrateRaw(file, raw)
  assert.equal(d.slots['image.master']!.channelId, 'ch-on')
  assert.equal(d.slots['image.master']!.model, 'on-img')
  assert.equal(d.slots['video']!.model, 'on-vid')
  // 两个通道都保留（凭证层全量迁入）
  assert.deepEqual(d.channels.map((c) => c.id), ['ch-off', 'ch-on'])
})

test('v1 video 协议启发式：kling 名 → kling-video；wan 系 → dashscope-video；t2v 名 → textToVideo=true', () => {
  const cases: Array<{ model: string; protocol: string; textToVideo: boolean }> = [
    { model: 'kling-2', protocol: 'kling-video', textToVideo: false },
    { model: 'wan2.6-i2v', protocol: 'dashscope-video', textToVideo: false },
    { model: 'happyhorse-1.1-t2v', protocol: 'dashscope-video', textToVideo: true },
  ]
  for (const c of cases) {
    const { file } = tmpCase()
    try {
      const raw = JSON.stringify({
        version: 1,
        channels: [{ id: 'c1', label: 'c', baseUrl: 'https://x.example', apiKey: 'sk-vgen-11111111', enabled: true, createdAt: '', models: [{ model: c.model, kind: 'video' }] }],
      })
      const { d } = migrateRaw(file, raw)
      const video = d.slots['video']!
      assert.equal(video.protocol, c.protocol, c.model)
      assert.equal(video.capabilities['textToVideo'], c.textToVideo, c.model)
      assert.equal(video.capabilities['imageToVideo'], true)
      assert.equal(video.capabilities['maxDurationSec'], 10)
    } finally {
      rmSync(join(file, '..'), { recursive: true, force: true })
    }
  }
})

test('v1 迁移备份：字节级一致、权限 0600', { skip: process.platform === 'win32' && 'POSIX 权限位在 Windows 无意义' }, () => {
  const { home, file } = tmpCase()
  try {
    const raw = v1Doc()
    writeFileSync(file, raw, 'utf8')
    migrateRaw(file, raw)
    const backups = v1Backups(home)
    assert.equal(backups.length, 1)
    const backup = join(home, backups[0]!)
    assert.equal(readFileSync(backup, 'utf8'), raw)
    assert.equal(statSync(backup).mode & 0o777, 0o600)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('v1 通道迁入：只保留凭证字段（无 models），label/baseUrl/apiKey/enabled/createdAt 原样', () => {
  const { file } = tmpCase()
  const { d } = migrateRaw(file, v1Doc())
  assert.equal(d.channels.length, 1)
  const ch = d.channels[0]!
  assert.ok(!('models' in ch))
  assert.ok(!JSON.stringify(d.channels).includes('"models"'))
  assert.equal(ch.id, 'ch-main')
  assert.equal(ch.label, '主站')
  assert.equal(ch.baseUrl, 'https://api.main.example')
  assert.equal(ch.apiKey, 'sk-vgen-main123456')
  assert.equal(ch.enabled, true)
  assert.equal(ch.createdAt, '2026-01-01T00:00:00.000Z')
  assert.deepEqual(ch.protocols, [])
})

test('空 v1（无通道）：不崩溃、无槽位、预算回默认', () => {
  const { file } = tmpCase()
  const { d, logs } = migrateRaw(file, JSON.stringify({ version: 1, channels: [] }))
  assert.deepEqual(d.slots, {})
  assert.deepEqual(d.channels, [])
  assert.deepEqual(d.budget, { confirmThresholdCny: 1 })
  assert.deepEqual(d.gateDefaults, {})
  assert.equal(logs.length, 1)
  assert.ok(logs[0]!.includes('（无）'))
})

test('VaultStore.load 集成：v1 文件就地迁移为 v2，二次 load 幂等（不再产生备份）', () => {
  const { home, file } = tmpCase()
  try {
    writeFileSync(file, v1Doc(), 'utf8')
    const store = VaultStore.open({ file })
    const d = silence(() => store.load()).out
    assert.equal(d.version, 2)
    assert.equal(Object.keys(d.slots).length, 4)
    assert.equal(v1Backups(home).length, 1)
    // 迁移即落盘：磁盘文件已是 v2
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as { version: number }
    assert.equal(onDisk.version, 2)

    const d2 = silence(() => store.load()).out
    assert.equal(v1Backups(home).length, 1) // 幂等：没有第二个备份
    assert.equal(d2.version, 2)
    assert.deepEqual(d2.slots, d.slots)
    assert.deepEqual(d2.channels.map((c) => c.id), d.channels.map((c) => c.id))
    assert.deepEqual(d2.budget, d.budget)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
