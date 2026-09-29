/** MV 时长预算（规格 §6.5）：mode=mv 时把分镜 durationSec 等比缩放到歌曲时长，
 *  单镜夹在 [min,max]；两轮再分配误差；输出偏差供 ±2% 验收断言与事件留痕。
 */

export interface MvBudgetResult {
  /** 调整后的每镜时长（与输入等长、同序）。 */
  durations: number[]
  beforeSec: number
  afterSec: number
  deviationSec: number
  /** 是否有镜头触碰上下限（再分配受限）。 */
  clamped: boolean
}

export interface MvBudgetLimits {
  min?: number
  max?: number
}

/** 等比缩放 + 夹取 + 有限轮再分配。songSec 非法（≤0）时原样返回。 */
export function applyMvBudget(durationsSec: number[], songSec: number, limits: MvBudgetLimits = {}): MvBudgetResult {
  const min = limits.min ?? 2
  const max = limits.max ?? 10
  const beforeSec = round2(durationsSec.reduce((a, d) => a + d, 0))
  if (!(songSec > 0) || durationsSec.length === 0) {
    return { durations: [...durationsSec], beforeSec, afterSec: beforeSec, deviationSec: 0, clamped: false }
  }
  // 两轮：等比 → 夹取 → 剩余误差摊到未夹取的镜头；仍不可达则如实输出
  let durations = durationsSec.map((d) => Math.min(max, Math.max(min, d * (songSec / beforeSec))))
  for (let pass = 0; pass < 2; pass++) {
    const sum = durations.reduce((a, d) => a + d, 0)
    const err = songSec - sum
    if (Math.abs(err) < 0.01) break
    const flexible = durations.map((d) => (d > min + 0.01 && d < max - 0.01)).length
    if (flexible === 0) break
    const share = err / flexible
    durations = durations.map((d) => (d > min + 0.01 && d < max - 0.01 ? Math.min(max, Math.max(min, d + share)) : d))
  }
  const afterSec = round2(durations.reduce((a, d) => a + d, 0))
  const clamped = durations.some((d) => d <= min + 0.01 || d >= max - 0.01)
  return { durations: durations.map(round2), beforeSec, afterSec, deviationSec: Math.round((afterSec - songSec) * 100) / 100, clamped }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
