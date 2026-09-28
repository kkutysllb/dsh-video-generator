/** 内置音乐映射模板 + vault 用户模板 CRUD（规格 §4.2）：模板纯数据、零 provider 绑定。 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sanitizeMusicMapping } from '../src/store/slots.ts'
import { BUILTIN_MUSIC_TEMPLATES } from '../src/providers/music-templates.ts'
import { VaultError, VaultStore } from '../src/store/vault.ts'

const USER_ASYNC_FIELDS = {
  endpoint: { path: '/v1/music/tasks', method: 'POST', statusPath: '/v1/music/tasks/{id}' },
  mode: 'async',
  request: { promptField: 'prompt', lyricsField: 'lyrics' },
  response: {
    audioPath: 'data.audio_url',
    jobIdPath: 'data.id',
    statusValuePath: 'data.status',
    doneValues: ['completed'],
    failedValues: ['failed'],
    pollIntervalMs: 2000,
  },
}

test('内置模板恰好 4 个：builtin/ 前缀、source=builtin、逐条通过映射守卫且守卫后零漂移', () => {
  assert.equal(BUILTIN_MUSIC_TEMPLATES.length, 4)
  for (const t of BUILTIN_MUSIC_TEMPLATES) {
    assert.ok(t.id.startsWith('builtin/'), t.id)
    assert.equal(t.source, 'builtin', t.id)
    const clean = sanitizeMusicMapping(t.fields)
    assert.ok(clean, `${t.id} 应通过 sanitizeMusicMapping`)
    // 模板即"已归一形态"：守卫幂等，套用前后零漂移
    assert.deepEqual(clean, t.fields, t.id)
  }
  const modes = new Set(BUILTIN_MUSIC_TEMPLATES.map((t) => t.fields.mode))
  assert.deepEqual([...modes].sort(), ['async', 'sync'])
})

test('内置模板纯数据：不含 baseUrl/apiKey/sk-/任何模型名形字符串', () => {
  const s = JSON.stringify(BUILTIN_MUSIC_TEMPLATES)
  assert.ok(!s.includes('baseUrl'))
  assert.ok(!s.includes('apiKey'))
  // 以引号定位 JSON 字符串值，避免 "async-ta(sk-p)oll" 这类子串误报
  assert.ok(!s.includes('"sk-'))
  // 常见模型/厂商名一律不出现：模板按协议形态命名，不是 provider 预设（\b 防止 "audio" 撞上 udio 之类）
  assert.ok(!/\b(gpt-|claude|gemini|kling|sora|seedream|doubao|qwen|minimax|suno|ace-step|so-vits|happyhorse|veo|lyria|udio)\b/i.test(s))
  assert.ok(!/wan[\d.]/i.test(s))
})

test('saveMusicTemplate 往返：user 模板落库、跨实例可读，库中只存 user 模板', () => {
  const home = mkdtempSync(join(tmpdir(), 'vgen-mtpl-'))
  const file = join(home, 'vault.json')
  try {
    const store = VaultStore.open({ file })
    const saved = store.saveMusicTemplate({ label: '我的异步站', fields: USER_ASYNC_FIELDS, note: '备注' })
    assert.equal(saved.label, '我的异步站')
    assert.equal(saved.source, 'user')
    assert.ok(saved.id.length > 0)
    assert.deepEqual(saved.fields, USER_ASYNC_FIELDS)

    const list = store.listUserMusicTemplates()
    assert.equal(list.length, 1)
    assert.deepEqual(list[0], saved)
    // vault 只存 user 模板（builtin 合并发生在 routes 层，不落库）
    assert.ok(list.every((t) => t.source === 'user'))

    // 持久化：新实例可读同一份
    const again = VaultStore.open({ file }).listUserMusicTemplates()
    assert.equal(again.length, 1)
    assert.deepEqual(again[0], saved)

    // 同 id 再存 → 覆盖；不同 id → 追加
    store.saveMusicTemplate({ id: saved.id, label: '改名', fields: USER_ASYNC_FIELDS })
    const after = store.listUserMusicTemplates()
    assert.equal(after.length, 1)
    assert.equal(after[0]!.label, '改名')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('deleteMusicTemplate 缺失 → not-found；空 label / 非法 fields → bad-request', () => {
  const home = mkdtempSync(join(tmpdir(), 'vgen-mtpl2-'))
  try {
    const store = VaultStore.open({ file: join(home, 'vault.json') })
    assert.throws(
      () => store.deleteMusicTemplate('tpl-nope'),
      (err: unknown) => err instanceof VaultError && err.code === 'not-found',
    )
    const saved = store.saveMusicTemplate({ label: '待删', fields: USER_ASYNC_FIELDS })
    store.deleteMusicTemplate(saved.id)
    assert.equal(store.listUserMusicTemplates().length, 0)
    assert.throws(() => store.deleteMusicTemplate(saved.id), VaultError)

    assert.throws(
      () => store.saveMusicTemplate({ label: '   ', fields: USER_ASYNC_FIELDS }),
      (err: unknown) => err instanceof VaultError && err.code === 'bad-request',
    )
    assert.throws(
      () => store.saveMusicTemplate({ label: '坏字段', fields: { mode: 'sync' } }),
      (err: unknown) => err instanceof VaultError && err.code === 'bad-request',
    )
    assert.throws(
      () => store.saveMusicTemplate({ label: '坏字段', fields: { ...USER_ASYNC_FIELDS, response: { audioPath: 'data.url' } } }),
      VaultError, // async 缺 statusPath/jobIdPath
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
