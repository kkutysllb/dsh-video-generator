import test from 'node:test'
import assert from 'node:assert/strict'
import { assemblePickerRows } from '../src/picker/assemble.ts'
import type { MaskedChannel } from '../src/store/vault.ts'

function masked(models: Array<{ model: string; kind: 'image' | 'video' | 'tts' }>): MaskedChannel {
  return {
    id: 'relay-a', label: 'A', kind: 'openai-compat',
    baseUrl: 'https://api.example.com', apiKeyMasked: '••••',
    enabled: true,
    models: models.map((m) => ({ model: m.model, kind: m.kind })),
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

test('assemble：已配置项优先 + 新枚举项追加，去重', () => {
  const rows = assemblePickerRows(
    masked([{ model: 'happyhorse-1.1-i2v', kind: 'video' }, { model: 'gpt-x', kind: 'image' }]),
    ['happyhorse-1.1-i2v', 'wan2.6-i2v-flash', 'gpt-4o-mini-tts'],
  )
  // 顺序 = 先 ch.models 后 probe.models；去重 probe 已含的 happyhorse 不重复
  assert.deepEqual(rows.map((r) => r.model), ['happyhorse-1.1-i2v', 'gpt-x', 'wan2.6-i2v-flash', 'gpt-4o-mini-tts'])
  assert.equal(rows[0]!.isConfigured, true)
  assert.equal(rows[0]!.kind, 'video') // 已配置的 kind 原样保留，不被内置目录覆盖
  assert.equal(rows[2]!.isConfigured, false)
  assert.equal(rows[2]!.kind, 'video') // wan2.6-i2v-flash 内置目录 → video
  assert.equal(rows[3]!.kind, 'tts')   // gpt-4o-mini-tts 内置目录 → tts
})

test('assemble：探测清单为空时不报错，返回仅 ch.models', () => {
  const rows = assemblePickerRows(masked([{ model: 'gpt-x', kind: 'image' }]), [])
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.model, 'gpt-x')
  assert.equal(rows[0]!.isConfigured, true)
})

test('assemble：探测清单包含未在 ch.models 的 → isNew=true', () => {
  const rows = assemblePickerRows(masked([]), ['wan2.6-i2v'])
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.isNew, true)
  assert.equal(rows[0]!.isConfigured, false)
  assert.equal(rows[0]!.kind, 'video')
})

test('assemble：内置目录不认识的模型 → kind=video（与 resolveModel 兜底一致）', () => {
  const rows = assemblePickerRows(masked([]), ['completely-unknown-model'])
  assert.equal(rows[0]!.kind, 'video')
})