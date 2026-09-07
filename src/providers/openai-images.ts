/** OpenAI 兼容图像适配器（契约：规格附录 B.3）。同步 API → jobId = 图片 URL 短路。 */

import { postJson, RelayError } from './relay-http.ts'
import { assertProvider, type Provider, type ProviderSubmitResult } from '../provider.ts'

export interface ImageChannel {
  baseUrl: string
  apiKey: string
  model: string
  /** 可选：注入按次估价（来自 pricing 层）；缺省 0（走调用方确认逻辑）。 */
  estimate?: (model: string) => number | null
}

interface ImagesResponse {
  created?: number
  data?: Array<{ url?: string; b64_json?: string; size?: string }>
}

export function createOpenaiImagesProvider(ch: ImageChannel, fetchImpl: typeof fetch = fetch): Provider {
  const base = ch.baseUrl.trim().replace(/\/+$/, '')
  const provider: Provider = {
    id: `openai-images:${ch.model}`,
    capabilities: { image: true, qualityTier: 5 },
    async quote(_stage) {
      const est = ch.estimate?.(ch.model) ?? null
      return { qualityTier: 5, costEstimate: est ?? 0, currency: 'CNY' }
    },
    async submit(_stage, spec): Promise<ProviderSubmitResult> {
      // prompt 缺省时不本地预校验：交给服务端 400 校验，错误消息按 RelayError 透传。
      const prompt = String(spec['prompt'] ?? '')
      const body: Record<string, unknown> = { model: ch.model, n: 1 }
      if (prompt) body['prompt'] = prompt
      if (typeof spec['size'] === 'string') body['size'] = spec['size']
      const json = await postJson<ImagesResponse>(`${base}/images/generations`, ch.apiKey, body, fetchImpl)
      const url = json.data?.[0]?.url
      if (!url) throw new RelayError(500, '图像响应缺少 data[0].url')
      return { jobId: url }
    },
    async status(jobId) {
      // 同步 API：jobId 即成品 URL，无异步态。
      return /^https?:\/\//.test(jobId) ? { state: 'done', progress: 100 } : { state: 'unknown', progress: null, error: 'not-a-url' }
    },
    async fetch(jobId) {
      return { outputs: [jobId] }
    },
    async health() {
      return { ok: true, quotaRemaining: null }
    },
  }
  return assertProvider(provider)
}
