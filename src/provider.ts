/** 六方法 Provider 薄抽象（继承鲸影验证过的接口形态）。 */

export interface ProviderCapabilities {
  textToVideo?: boolean
  imageToVideo?: boolean
  image?: boolean
  tts?: boolean
  maxDurationSec?: number
  resolutions?: string[]
  qualityTier?: number
}

export interface ProviderQuote {
  qualityTier: number
  costEstimate: number
  currency: string
}

export interface ProviderStatus {
  state: 'running' | 'done' | 'failed' | 'unknown'
  progress: number | null
  error?: string
}

export interface ProviderSubmitResult {
  jobId: string
}

export interface ProviderFetchResult {
  outputs: string[]
  meta?: Record<string, unknown>
}

export interface ProviderHealth {
  ok: boolean
  quotaRemaining?: number | null
}

export interface Provider {
  id: string
  capabilities: ProviderCapabilities
  quote(stage: string, spec: Record<string, unknown>): Promise<ProviderQuote>
  submit(stage: string, spec: Record<string, unknown>): Promise<ProviderSubmitResult>
  status(jobId: string): Promise<ProviderStatus>
  fetch(jobId: string): Promise<ProviderFetchResult>
  health(): Promise<ProviderHealth>
}

const REQUIRED: Array<keyof Provider> = ['id', 'capabilities', 'quote', 'submit', 'status', 'fetch', 'health']

export function assertProvider<T extends Provider>(p: T): T {
  if (p == null) throw new Error('provider 缺少方法/字段: <null>')
  for (const m of REQUIRED) {
    if (p[m] == null) {
      throw new Error(`provider ${p.id} 缺少方法/字段: ${String(m)}`)
    }
  }
  return p
}

/** route() 的需求描述只接受布尔能力位；数值能力（时长/分辨率/tier）是排序与报价的输入，不是硬过滤条件。 */
export type ProviderNeed = Pick<ProviderCapabilities, 'textToVideo' | 'imageToVideo' | 'image' | 'tts'>

/**
 * 按布尔能力位过滤并按 qualityTier 高->低（preferCost 时低->高）挑出 provider。
 * @param preferCost true 时按 qualityTier 升序（tier 低 ≈ 成本低）；真实报价见 quote().costEstimate，route 为同步函数不做报价排序
 */
export function route(providers: Provider[], need: ProviderNeed, preferCost = false): Provider | null {
  const ok = providers.filter((p) =>
    Object.entries(need).every(([k, v]) => !v || Boolean(p.capabilities[k as keyof ProviderCapabilities])),
  )
  if (!ok.length) return null
  ok.sort((a, b) => {
    const ta = a.capabilities.qualityTier ?? 5
    const tb = b.capabilities.qualityTier ?? 5
    return preferCost ? ta - tb : tb - ta
  })
  return ok[0] ?? null
}
