/** DashScope 原生透传视频适配器（wan/happyhorse 家族；契约：规格附录 B.4，实测端到端）。 */

import { postJson, getJson, RelayError } from './relay-http.ts'
import { assertProvider, type Provider } from '../provider.ts'

export interface DashscopeChannel {
  baseUrl: string
  apiKey: string
  model: string
  estimate?: (model: string) => number | null
}

interface TaskSubmitResponse {
  output?: { task_id?: string; task_status?: string }
  request_id?: string
}

interface TaskPollResponse {
  output?: {
    task_id?: string
    task_status?: string
    video_url?: string
    message?: string
    code?: string
  }
  usage?: Record<string, unknown>
}

const SYNTH_PATH = '/alibailian/api/v1/services/aigc/video-generation/video-synthesis'
const TASK_PATH = '/alibailian/api/v1/tasks'

/** DashScope task_status -> ProviderStatus.state。 */
function mapState(s: string | undefined): 'running' | 'done' | 'failed' | 'unknown' {
  if (s === 'SUCCEEDED') return 'done'
  if (s === 'FAILED' || s === 'CANCELED' || s === 'UNKNOWN') return 'failed'
  if (s === 'PENDING' || s === 'RUNNING') return 'running'
  return 'unknown'
}

export function createDashscopeRelayProvider(ch: DashscopeChannel, fetchImpl: typeof fetch = fetch): Provider {
  const base = ch.baseUrl.trim().replace(/\/+$/, '')
  const isI2v = ch.model.toLowerCase().includes('i2v')
  const provider: Provider = {
    id: `dashscope-relay:${ch.model}`,
    capabilities: { textToVideo: !isI2v, imageToVideo: true, maxDurationSec: 10, qualityTier: 5 },
    async quote(_stage) {
      const est = ch.estimate?.(ch.model) ?? null
      return { qualityTier: 5, costEstimate: est ?? 0, currency: 'CNY' }
    },
    async submit(_stage, spec) {
      const prompt = String(spec['prompt'] ?? '')
      if (!prompt) throw new RelayError(400, 'prompt 必填')
      const input: Record<string, unknown> = { prompt }
      if (typeof spec['imageUrl'] === 'string') input['img_url'] = spec['imageUrl']
      const parameters: Record<string, unknown> = {}
      if (typeof spec['durationSec'] === 'number') parameters['duration'] = spec['durationSec']
      const json = await postJson<TaskSubmitResponse>(`${base}${SYNTH_PATH}`, ch.apiKey, { model: ch.model, input, parameters }, fetchImpl, 60000)
      const taskId = json.output?.task_id
      if (!taskId) throw new RelayError(500, `提交响应缺少 task_id: ${JSON.stringify(json).slice(0, 200)}`)
      return { jobId: taskId }
    },
    async status(jobId) {
      const json = await getJson<TaskPollResponse>(`${base}${TASK_PATH}/${encodeURIComponent(jobId)}`, ch.apiKey, fetchImpl)
      const state = mapState(json.output?.task_status)
      const err = json.output?.message ?? json.output?.code
      return { state, progress: state === 'done' ? 100 : null, error: state === 'failed' ? (err ?? 'task failed') : undefined }
    },
    async fetch(jobId) {
      const json = await getJson<TaskPollResponse>(`${base}${TASK_PATH}/${encodeURIComponent(jobId)}`, ch.apiKey, fetchImpl)
      const url = json.output?.video_url
      return { outputs: url ? [url] : [], meta: { usage: json.usage } }
    },
    async health() {
      return { ok: true, quotaRemaining: null }
    },
  }
  return assertProvider(provider)
}
