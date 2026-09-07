/** 站点价目（规格附录 B.5）：/api/pricing 公开可读；quota_type=1 按次（model_price），0 按量（离线不可估）。 */

import { getJson } from './providers/relay-http.ts'

export interface PricingRow {
  model_name: string
  model_type?: string
  quota_type: number
  model_ratio: number
  model_price: number
}

export type PricingTable = Map<string, PricingRow>

export async function fetchPricing(target: { baseUrl: string; apiKey: string }, fetchImpl: typeof fetch = fetch, timeoutMs = 15000): Promise<PricingTable> {
  const base = target.baseUrl.trim().replace(/\/+$/, '')
  const json = await getJson<{ data?: PricingRow[] }>(`${base}/api/pricing`, target.apiKey, fetchImpl, timeoutMs)
  const table: PricingTable = new Map()
  for (const row of json.data ?? []) {
    if (typeof row?.model_name === 'string') table.set(row.model_name, row)
  }
  return table
}

/** 按次模型返回单次成本原始值（计价单位口径见附录 B.5）；按量/未知返回 null（调用方走确认）。 */
export function estimateCny(model: string, table: PricingTable): number | null {
  const row = table.get(model)
  if (!row || row.quota_type !== 1) return null
  const price = Number(row.model_price)
  return Number.isFinite(price) && price >= 0 ? price : null
}
