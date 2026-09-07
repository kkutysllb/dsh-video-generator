import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveModel } from '../src/model-catalog.ts'

test('内置目录按模型名子串匹配', () => {
  assert.equal(resolveModel('wan2.2-t2v-plus').entry.kind, 'video')
  assert.equal(resolveModel('Kling-v3').entry.kind, 'video')
  assert.equal(resolveModel('seedream-4.0').entry.kind, 'image')
  assert.equal(resolveModel('mj_imagine-6').entry.kind, 'image')
})

test('用户覆盖 > 内置 > unknown 三层查表', () => {
  const override = { pricingCny: 0.5 }
  const r1 = resolveModel('wan2.2-t2v-plus', override)
  assert.equal(r1.source, 'user')
  assert.equal(r1.entry.pricingCny, 0.5)
  const r2 = resolveModel('wan2.2-t2v-plus')
  assert.equal(r2.source, 'builtin')
  const r3 = resolveModel('totally-unknown-model')
  assert.equal(r3.source, 'unknown')
  assert.equal(r3.entry.kind, 'video') // unknown 一律按最贵形态 video 处理 -> 走成本确认
})

test('覆盖可只改部分字段且不污染内置表', () => {
  const before = resolveModel('seedream-4.0').entry.qualityTier
  const r = resolveModel('seedream-4.0', { qualityTier: 9 })
  assert.equal(r.entry.qualityTier, 9)
  assert.equal(resolveModel('seedream-4.0').entry.qualityTier, before)
  assert.equal(before, 5)
})

test('mutate 解析结果的 capabilities 不回写内置表', () => {
  const r = resolveModel('kling-v3')
  const caps = r.entry.capabilities as { qualityTier?: number }
  caps.qualityTier = 99
  assert.equal(resolveModel('kling-v3').entry.capabilities.qualityTier, 5)
})

test('tts 组与空覆盖语义', () => {
  assert.equal(resolveModel('gpt-4o-mini-tts').entry.kind, 'tts')
  assert.equal(resolveModel('wan2.2-t2v-plus', {}).source, 'builtin')
})

test('builtin 注入：顺序决定混合命名归档（video 组须最前）', () => {
  const rules = [
    { patterns: ['video'], kind: 'video' as const, capabilities: {}, qualityTier: 5 },
    { patterns: ['image'], kind: 'image' as const, capabilities: {}, qualityTier: 5 },
  ]
  assert.equal(resolveModel('image-to-video-model', undefined, rules).entry.kind, 'video')
})

test('M0 实测家族归档（向量引擎 536 模型清单，见规格附录 B）', () => {
  // 万相系：i2v/t2v 是视频，image/t2i 是图像——'wan2' 宽前缀不得进 video 组
  assert.equal(resolveModel('wan2.6-i2v').entry.kind, 'video')
  assert.equal(resolveModel('wan2.5-i2v-preview').entry.kind, 'video')
  assert.equal(resolveModel('wan2.7-image').entry.kind, 'image')
  assert.equal(resolveModel('wanx2.1-t2i-turbo').entry.kind, 'image')
  // 名字带 tts 的必是语音，不被 vidu 等家族词抢走
  assert.equal(resolveModel('vidu-tts').entry.kind, 'tts')
  assert.equal(resolveModel('MiniMax-Voice-Clone').entry.kind, 'tts')
  // 实测在列的视频/图像家族
  assert.equal(resolveModel('kling-3.0-turbo').entry.kind, 'video')
  assert.equal(resolveModel('MiniMax-Hailuo-2.3').entry.kind, 'video')
  assert.equal(resolveModel('viduq2-pro').entry.kind, 'video')
  assert.equal(resolveModel('pixverse-video').entry.kind, 'video')
  assert.equal(resolveModel('happyhorse-1.1-t2v').entry.kind, 'video')
  assert.equal(resolveModel('doubao-seedream-4-0-250828').entry.kind, 'image')
  assert.equal(resolveModel('qwen-image-edit-max').entry.kind, 'image')
  assert.equal(resolveModel('z-image-turbo').entry.kind, 'image')
})
