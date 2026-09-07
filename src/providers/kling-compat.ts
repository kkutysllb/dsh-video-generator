/** kling-compat 适配器（Kling 原生协议经中转 /kling-compat 前缀；路径已实钉，成功信封按 Kling 原生文档，实钉任务核对字段映射）。 */

import { postJson, getJson, RelayError } from './relay-http.ts'
import { assertProvider, type Provider } from '../provider.ts'

export interface KlingCompatChannel {
  baseUrl: string
  apiKey: string
  model: string
  estimate?: (model: string) => number | null
}

interface KlingTaskResponse {
  code?: number
  message?: string
  data?: {
    task_id?: string
    task_status?: string
    status_msg?: string
    task_result?: { videos?: Array<{ url?: string }> }
  }
}

const SUBMIT_PATH = '/kling-compat/v1/videos/text2video'
const POLL_PREFIX = '/kling-compat/v1/videos/text2video'

function mapState(s: string | undefined): 'running' | 'done' | 'failed' | 'unknown' {
  if (s === 'succeed') return 'done'
  if (s === 'failed') return 'failed'
  if (s === 'submitted' || s === 'processing') return 'running'
  return 'unknown'
}

export function createKlingCompatProvider(ch: KlingCompatChannel, fetchImpl: typeof fetch = fetch): Provider {
  const base = ch.baseUrl.trim().replace(/\/+$/, '')
  const provider: Provider = {
    id: `kling-compat:${ch.model}`,
    capabilities: { textToVideo: true, imageToVideo: true, maxDurationSec: 10, qualityTier: 6 },
    async quote(_stage) {
      const est = ch.estimate?.(ch.model) ?? null
      return { qualityTier: 6, costEstimate: est ?? 0, currency: 'CNY' }
    },
    async submit(_stage, spec) {
      const prompt = String(spec['prompt'] ?? '')
      if (!prompt) throw new RelayError(400, 'prompt 必填')
      const body: Record<string, unknown> = { model_name: ch.model, prompt }
      if (typeof spec['durationSec'] === 'number') body['duration'] = String(spec['durationSec'])
      const json = await postJson<KlingTaskResponse>(`${base}${SUBMIT_PATH}`, ch.apiKey, body, fetchImpl, 60000)
      const taskId = json.data?.task_id
      if (!taskId) throw new RelayError(500, `提交响应缺少 data.task_id: ${JSON.stringify(json).slice(0, 200)}`)
      return { jobId: taskId }
    },
    async status(jobId) {
      const json = await getJson<KlingTaskResponse>(`${base}${POLL_PREFIX}/${encodeURIComponent(jobId)}`, ch.apiKey, fetchImpl)
      const state = mapState(json.data?.task_status)
      return { state, progress: state === 'done' ? 100 : null, error: state === 'failed' ? (json.data?.status_msg ?? 'task failed') : undefined }
    },
    async fetch(jobId) {
      const json = await getJson<KlingTaskResponse>(`${base}${POLL_PREFIX}/${encodeURIComponent(jobId)}`, ch.apiKey, fetchImpl)
      const url = json.data?.task_result?.videos?.[0]?.url
      return { outputs: url ? [url] : [] }
    },
    async health() {
      return { ok: true, quotaRemaining: null }
    },
  }
  return assertProvider(provider)
}
