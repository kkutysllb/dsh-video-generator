/** 协议族 → 适配器工厂单测（规格 §3）：零模型名猜测，按绑定声明构造；TTS 不经 Provider 抽象。 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { providerForSlot, type ChannelRef } from '../src/providers/protocols.ts'
import { ModelUnavailableError } from '../src/model-selection.ts'
import { parseSlotBinding, type ProtocolFamily, type SlotBinding, type SlotId } from '../src/store/slots.ts'

const CHANNEL: ChannelRef = { id: 'ch-1', label: '中转站', baseUrl: 'https://relay.example', apiKey: 'sk-vgen-12345678' }

const SYNC_MUSIC = {
  endpoint: { path: '/v1/audio/music', method: 'POST' },
  mode: 'sync',
  request: { promptField: 'prompt' },
  response: { audioPath: 'data.audio_url' },
}

function binding(slot: SlotId, raw: Record<string, unknown>): SlotBinding {
  const b = parseSlotBinding(slot, raw)
  assert.ok(b, `fixture binding for ${slot} 应可解析`)
  return b
}

test('五个可构造协议族：按绑定 protocol 构造适配器，id = <适配器>:<model>', () => {
  const cases: Array<{ slot: SlotId; protocol: ProtocolFamily; model: string; idPrefix: string; extra?: Record<string, unknown> }> = [
    { slot: 'image.master', protocol: 'openai-images', model: 'img-1', idPrefix: 'openai-images' },
    { slot: 'video', protocol: 'dashscope-video', model: 'wan2.6-i2v', idPrefix: 'dashscope-relay' },
    { slot: 'video', protocol: 'kling-video', model: 'kling-2', idPrefix: 'kling-compat' },
    { slot: 'video', protocol: 'openai-video', model: 'vid-async-1', idPrefix: 'openai-video' },
    { slot: 'music.bgm', protocol: 'generic-music', model: 'music-1', idPrefix: 'generic-music', extra: { music: SYNC_MUSIC } },
  ]
  for (const c of cases) {
    const b = binding(c.slot, { channelId: 'ch-1', model: c.model, protocol: c.protocol, ...c.extra })
    const p = providerForSlot(CHANNEL, b)
    assert.equal(p.id, `${c.idPrefix}:${c.model}`, c.protocol)
    assert.equal(typeof p.submit, 'function', c.protocol)
    assert.equal(typeof p.status, 'function', c.protocol)
    assert.equal(typeof p.fetch, 'function', c.protocol)
    assert.equal(typeof p.health, 'function', c.protocol)
  }
})

test('openai-tts 不经 Provider 抽象：providerForSlot 抛 ModelUnavailableError（model-unavailable）', () => {
  const b = binding('tts', { channelId: 'ch-1', model: 'tts-1', protocol: 'openai-tts' })
  assert.throws(
    () => providerForSlot(CHANNEL, b),
    (err: unknown) => err instanceof ModelUnavailableError
      && err.code === 'model-unavailable'
      && err.message.includes('openai-tts'),
  )
})

test('绑定协议族非法（绕过类型注入）→ default 分支抛 ModelUnavailableError', () => {
  const b = { ...binding('video', { channelId: 'ch-1', model: 'v-1', protocol: 'kling-video' }), protocol: 'minimax-video' as ProtocolFamily }
  assert.throws(
    () => providerForSlot(CHANNEL, b),
    (err: unknown) => err instanceof ModelUnavailableError && err.message.includes('未知协议族'),
  )
})

test('源码静态检查：protocols.ts / music-templates.ts 不含 provider 名（minimax|suno|so-vits|ace-step）', () => {
  const protocolsSrc = readFileSync(new URL('../src/providers/protocols.ts', import.meta.url), 'utf8')
  const templatesSrc = readFileSync(new URL('../src/providers/music-templates.ts', import.meta.url), 'utf8')
  // 零模型名/厂商名分支：适配器只认协议族
  assert.ok(!/minimax|suno|so-vits|ace-step/i.test(protocolsSrc), 'protocols.ts 不应出现 provider 名')
  assert.ok(!/minimax|suno|so-vits|ace-step/i.test(templatesSrc), 'music-templates.ts 不应出现 provider 名')
  // 正向锚点：kling/dashscope 只作为协议族字面量出现（文件非空且词汇表在位）
  assert.ok(protocolsSrc.includes("'kling-video'"))
  assert.ok(protocolsSrc.includes("'dashscope-video'"))
  assert.ok(protocolsSrc.includes("'generic-music'"))
  // 模板纯数据：不引用任何适配器实现
  assert.ok(!/kling-compat|dashscope-relay|createOpenaiImagesProvider|createKlingCompatProvider/.test(templatesSrc))
})
