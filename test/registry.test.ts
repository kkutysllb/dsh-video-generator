import { test } from 'node:test'
import assert from 'node:assert/strict'
import { providerForModel } from '../src/registry.ts'

const CHANNEL = { id: 've', baseUrl: 'https://x.example', apiKey: 'sk-test-123456' }

test('registry 按模型名路由到正确适配器', () => {
  const img = providerForModel(CHANNEL, 'doubao-seedream-4-0-250828')
  assert.equal(img.id, 'openai-images:doubao-seedream-4-0-250828')
  const wan = providerForModel(CHANNEL, 'happyhorse-1.1-t2v')
  assert.equal(wan.id, 'dashscope-relay:happyhorse-1.1-t2v')
  const wanI2v = providerForModel(CHANNEL, 'wan2.6-i2v')
  assert.equal(wanI2v.id, 'dashscope-relay:wan2.6-i2v')
  const kling = providerForModel(CHANNEL, 'kling-video')
  assert.equal(kling.id, 'kling-compat:kling-video')
})

test('registry：图像家族路由判定与目录一致', () => {
  const qwen = providerForModel(CHANNEL, 'qwen-image-max')
  assert.equal(qwen.id, 'openai-images:qwen-image-max')
})

test('registry：显式 channel kind 让未知 video 模型走可用的 image-to-video Provider', () => {
  const custom = providerForModel({
    ...CHANNEL,
    models: [{ model: 'relay-custom-video', kind: 'video' }],
  }, 'relay-custom-video')
  assert.equal(custom.id, 'dashscope-relay:relay-custom-video')
  assert.equal(custom.capabilities.imageToVideo, true)
})

test('registry：tts 形态给出清晰错误', () => {
  assert.throws(() => providerForModel(CHANNEL, 'gpt-4o-mini-tts'), /尚未支持/)
})
