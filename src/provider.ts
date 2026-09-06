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
  for (const m of REQUIRED) {
    if (typeof p[m] === 'undefined') {
      throw new Error(`provider ${p?.id ?? '?'} 缺少方法/字段: ${String(m)}`)
    }
  }
  return p
}

export function route(providers: Provider[], need: ProviderCapabilities, preferCost = false): Provider | null {
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
