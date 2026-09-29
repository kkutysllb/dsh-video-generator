/** MV 时长预算单测（P2）：等比缩放 + 夹取 + 偏差 ≤±2%（规格 §6.5 验收 10）。 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyMvBudget } from '../src/music/budget.ts'

test('等比缩放：30s 素材预算到 24s 歌曲时长（偏差 0）', () => {
  const r = applyMvBudget([10, 10, 10], 24)
  assert.equal(r.beforeSec, 30)
  assert.equal(r.afterSec, 24)
  assert.equal(r.deviationSec, 0)
  for (const d of r.durations) assert.ok(d >= 2 && d <= 10)
})

test('夹取：单镜下限 2s 生效，剩余误差摊给其他镜头', () => {
  // 5 镜 ×6s=30s → 预算 8.5s：等比 1.7s 全 <2 → 夹 2s×5=10s 不可达 → 钳住并如实输出
  const r = applyMvBudget([6, 6, 6, 6, 6], 8.5)
  assert.ok(r.clamped, '触及下限')
  assert.ok(r.afterSec >= 8.5, '下限夹取后只会更长')
  for (const d of r.durations) assert.ok(d >= 2 - 1e-9)
})

test('上限：歌曲很长而镜头极少 → 触顶如实（不虚构时长）', () => {
  const r = applyMvBudget([5, 5], 60)
  assert.ok(r.clamped)
  assert.equal(r.afterSec, 20)
  assert.equal(r.deviationSec, -40)
})

test('非法 songSec（0/负）原样返回', () => {
  const r = applyMvBudget([3, 4], 0)
  assert.deepEqual(r.durations, [3, 4])
  assert.equal(r.deviationSec, 0)
})
