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

// 顺序敏感（M0 实测定稿，见规格附录 B）：tts 组最先——名字带 tts/voice/speech 的必是语音模型（如 vidu-tts 不能被 vidu 抢走）；
// video 组第二——通用词 'video'/'i2v'/'t2v' 消解 'image-to-video-*' 类混合命名；image 组最后。
// 注意：不要把 'wan2' 这类宽前缀放进 video 组——'wan2.7-image' 是图像模型，万相系靠 'i2v'/'t2v' 与 'image'/'t2i' 区分。
export const BUILTIN_CATALOG: BuiltinRule[] = [
  { patterns: ['tts', 'speech', 'voice'], kind: 'tts', capabilities: { tts: true }, qualityTier: 5 },
  { patterns: ['seedance', 'kling', 'wan-x', 'hailuo', 'sora', 'vidu', 'pixverse', 'happyhorse', 'video', 'i2v', 't2v'], kind: 'video', capabilities: VIDEO, qualityTier: 5 },
  { patterns: ['seedream', 'flux', 'mj', 'midjourney', 'dall', 'sd3', 'image', 'banana', 't2i', 'wanx'], kind: 'image', capabilities: IMAGE, qualityTier: 5 },
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
