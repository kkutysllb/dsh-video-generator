/** 通用 OpenAI 风格异步视频适配器（/v1/videos 系）。
 *
 *  契约取 OpenAI Sora 风格（POST /v1/videos → {id,status}；GET /v1/videos/{id} →
 *  {status}；成片在 GET /v1/videos/{id}/content，需 Bearer 下载）。该家族在中转站
 *  的真实信封差异较大（附录 B.4 当时"成功信封待补"），本适配器按此契约实现，
 *  真机钉契约后如有出入以实测附录为准修正，不做模型名猜测。
 */

import { getJson, postJson, RelayError } from './relay-http.ts'
import { assertProvider, type Provider } from '../provider.ts'

export interface OpenaiVideoChannel {
  baseUrl: string
  apiKey: string
  model: string
  estimate?: (model: string) => number | null
}

interface VideoSubmitResponse {
  id?: string
  task_id?: string
  data?: Array<{ id?: string }>
}

interface VideoPollResponse {
  status?: string
  error?: { message?: string } | string
}

function mapState(s: string | undefined): 'running' | 'done' | 'failed' | 'unknown' {
  if (s === 'completed' || s === 'succeeded' || s === 'success') return 'done'
  if (s === 'failed' || s === 'cancelled' || s === 'canceled') return 'failed'
  if (s === 'queued' || s === 'in_progress' || s === 'running' || s === 'pending') return 'running'
  return 'unknown'
}

export function createOpenaiVideoProvider(ch: OpenaiVideoChannel, fetchImpl: typeof fetch = fetch): Provider {
  const base = ch.baseUrl.trim().replace(/\/+$/, '')
  const provider: Provider = {
    id: `openai-video:${ch.model}`,
    // 家族级能力：两种模态在协议上都可行；实际模态以槽位绑定的能力位声明为准（机器层按绑定校验）。
    capabilities: { textToVideo: true, imageToVideo: true, maxDurationSec: 20, qualityTier: 5 },
    async quote(_stage) {
      const est = ch.estimate?.(ch.model) ?? null
      return { qualityTier: 5, costEstimate: est ?? 0, currency: 'CNY' }
    },
    async submit(_stage, spec) {
      const prompt = String(spec['prompt'] ?? '')
      if (!prompt) throw new RelayError(400, 'prompt 必填')
      const body: Record<string, unknown> = { model: ch.model, prompt }
      if (typeof spec['durationSec'] === 'number') body['seconds'] = spec['durationSec']
      if (typeof spec['imageUrl'] === 'string') body['image_url'] = spec['imageUrl']
      const json = await postJson<VideoSubmitResponse>(`${base}/v1/videos`, ch.apiKey, body, fetchImpl, 60000)
      const id = json.id ?? json.task_id ?? json.data?.[0]?.id
      if (!id) throw new RelayError(500, `提交响应缺少任务 id: ${JSON.stringify(json).slice(0, 200)}`)
      return { jobId: id }
    },
    async status(jobId) {
      const json = await getJson<VideoPollResponse>(`${base}/v1/videos/${encodeURIComponent(jobId)}`, ch.apiKey, fetchImpl)
      const state = mapState(json.status)
      const errText = typeof json.error === 'string' ? json.error : json.error?.message
      return { state, progress: state === 'done' ? 100 : null, error: state === 'failed' ? (errText ?? 'task failed') : undefined }
    },
    async fetch(jobId) {
      // 成片端点需 Bearer：meta.headers 由下载方（saveUrl）透传
      return {
        outputs: [`${base}/v1/videos/${encodeURIComponent(jobId)}/content`],
        meta: { headers: { Authorization: `Bearer ${ch.apiKey}` } },
      }
    },
    async health() {
      return { ok: true, quotaRemaining: null }
    },
  }
  return assertProvider(provider)
}
