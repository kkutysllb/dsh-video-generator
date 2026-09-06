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
