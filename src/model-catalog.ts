/** 两层模型目录：内置缺省（按名字模式）+ 用户覆盖。查表：user > builtin > unknown。 */

import type { ModelKind } from './store/vault.ts'
import type { ProviderCapabilities } from './provider.ts'

export interface CatalogEntry {
  kind: ModelKind
  capabilities: ProviderCapabilities
  pricingCny?: number
  qualityTier: number
}

interface BuiltinRule extends CatalogEntry {
  patterns: string[]
}

const VIDEO: ProviderCapabilities = { imageToVideo: true, textToVideo: true, maxDurationSec: 10, qualityTier: 5 }
const IMAGE: ProviderCapabilities = { image: true, qualityTier: 5 }

// 顺序敏感：video 组必须最前——通用词 'video' 优先消解 'image-to-video-*' 类混合命名（ModelKind 表达产出物形态，输入模态由 capabilities 位表达）。新增规则前先想清楚摆放位置。
export const BUILTIN_CATALOG: BuiltinRule[] = [
  { patterns: ['seedance', 'kling', 'wan2', 'wan-x', 'hailuo', 'sora', 'vidu', 'video'], kind: 'video', capabilities: VIDEO, qualityTier: 5 },
  { patterns: ['seedream', 'flux', 'mj', 'midjourney', 'dall', 'sd3', 'image', 'banana'], kind: 'image', capabilities: IMAGE, qualityTier: 5 },
  { patterns: ['tts', 'speech', 'voice'], kind: 'tts', capabilities: { tts: true }, qualityTier: 5 },
]

export interface ResolvedModel {
  model: string
  entry: CatalogEntry
  source: 'user' | 'builtin' | 'unknown'
}

export function resolveModel(
  model: string,
  override?: Partial<CatalogEntry>,
  builtin: BuiltinRule[] = BUILTIN_CATALOG,
): ResolvedModel {
  const id = String(model ?? '').toLowerCase()
  if (override && Object.keys(override).length > 0) {
    const base = matchBuiltin(id, builtin) ?? unknownEntry()
    return { model, entry: { ...base, ...override }, source: 'user' }
  }
  const hit = matchBuiltin(id, builtin)
  if (hit) return { model, entry: hit, source: 'builtin' }
  return { model, entry: unknownEntry(), source: 'unknown' }
}

function matchBuiltin(id: string, rules: BuiltinRule[]): CatalogEntry | null {
  for (const r of rules) {
    if (r.patterns.some((p) => id.includes(p))) {
      const { patterns, ...entry } = r
      return { ...entry, capabilities: { ...entry.capabilities } }
    }
  }
  return null
}

// 确认判据 = source === 'unknown'（规格 §4.4）；pricingCny 缺失只表示"价目未知，走 quote() 估价"，二者不可混用。
function unknownEntry(): CatalogEntry {
  return { kind: 'video', capabilities: { ...VIDEO }, qualityTier: 5, pricingCny: undefined }
}
