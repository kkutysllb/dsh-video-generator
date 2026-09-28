/** 通用音乐适配器：声明式端点映射，零 provider 绑定（规格 2026-09-28 §4）。
 *
 *  请求体 = { model, [promptField]: prompt, ...用户映射的歌词/器乐/时长/参考音频字段 }
 *  响应   = sync：直接读 audioPath（URL 或 base64）；async：jobIdPath 取任务 id →
 *           GET endpoint.statusPath（{id} 占位）→ statusValuePath 判态 → audioPath 取音频。
 *  路径求值只认 点号 + [n] 下标（与 slots.ts 的守卫一致）。
 */

import { getJson, postJson, RelayError } from './relay-http.ts'
import { assertProvider, type Provider } from '../provider.ts'
import type { GenericMusicMapping, SlotBinding } from '../store/slots.ts'

export interface GenericMusicChannel {
  baseUrl: string
  apiKey: string
}

export interface MusicSubmitSpec {
  prompt: string
  lyrics?: string
  instrumental?: boolean
  durationSec?: number
  referenceAudioUrl?: string
}

/** sync 模式的音频暂存（进程内；机器层在同一次推进内 submit→fetch，无跨进程需求）。 */
const syncAudio = new Map<string, { url?: string; base64?: string }>()

/** 点号 + [n] 下标的最小路径求值；任何一步缺失返回 undefined（不计正则/通配）。 */
export function readPath(value: unknown, path: string): unknown {
  let cur: unknown = value
  for (const seg of path.split('.')) {
    const m = /^([^\[\]]*)((?:\[\d+\])*)$/.exec(seg.trim())
    if (!m) return undefined
    const key = m[1] ?? ''
    if (key) {
      if (typeof cur !== 'object' || cur === null) return undefined
      cur = (cur as Record<string, unknown>)[key]
    }
    const idx = m[2] ?? ''
    for (const bracket of idx.matchAll(/\[(\d+)\]/g)) {
      const i = Number(bracket[1])
      if (!Array.isArray(cur)) return undefined
      cur = cur[i]
    }
  }
  return cur
}

function buildBody(binding: SlotBinding, spec: MusicSubmitSpec): Record<string, unknown> {
  const m = binding.music as GenericMusicMapping
  const body: Record<string, unknown> = { model: binding.model }
  body[m.request.promptField] = spec.prompt
  if (m.request.lyricsField && typeof spec.lyrics === 'string' && spec.lyrics) body[m.request.lyricsField] = spec.lyrics
  if (m.request.instrumentalField && typeof spec.instrumental === 'boolean') body[m.request.instrumentalField] = spec.instrumental
  if (m.request.durationField && typeof spec.durationSec === 'number') body[m.request.durationField] = spec.durationSec
  if (m.request.referenceAudioField && typeof spec.referenceAudioUrl === 'string' && spec.referenceAudioUrl) {
    body[m.request.referenceAudioField] = spec.referenceAudioUrl
  }
  if (m.request.extra) Object.assign(body, m.request.extra)
  return body
}

function extractAudio(raw: unknown, mapping: GenericMusicMapping): { url?: string; base64?: string } {
  const value = readPath(raw, mapping.response.audioPath)
  if (typeof value === 'string' && value.length > 0) {
    return mapping.response.audioIsBase64 ? { base64: value } : { url: value }
  }
  throw new RelayError(500, `音乐响应缺少音频字段 ${mapping.response.audioPath}: ${JSON.stringify(raw).slice(0, 200)}`)
}

export function createGenericMusicProvider(channel: GenericMusicChannel, binding: SlotBinding, fetchImpl: typeof fetch = fetch): Provider {
  const m = binding.music as GenericMusicMapping
  const base = channel.baseUrl.trim().replace(/\/+$/, '')
  const provider: Provider = {
    id: `generic-music:${binding.model}`,
    capabilities: { tts: true, qualityTier: 5 },
    async quote(_stage) {
      // 通用映射无价目来源：est 交调用方 pricing 层（未知 → 走确认）
      return { qualityTier: 5, costEstimate: 0, currency: 'CNY' }
    },
    async submit(_stage, spec) {
      const prompt = String(spec['prompt'] ?? '')
      if (!prompt) throw new RelayError(400, 'prompt 必填')
      const body = buildBody(binding, {
        prompt,
        lyrics: typeof spec['lyrics'] === 'string' ? spec['lyrics'] : undefined,
        instrumental: typeof spec['instrumental'] === 'boolean' ? spec['instrumental'] : undefined,
        durationSec: typeof spec['durationSec'] === 'number' ? spec['durationSec'] : undefined,
        referenceAudioUrl: typeof spec['referenceAudioUrl'] === 'string' ? spec['referenceAudioUrl'] : undefined,
      })
      const json = await postJson<unknown>(`${base}${m.endpoint.path}`, channel.apiKey, body, fetchImpl, 120000)
      if (m.mode === 'sync') {
        const audio = extractAudio(json, m)
        const jobId = `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        syncAudio.set(jobId, audio)
        if (syncAudio.size > 32) {
          const oldest = syncAudio.keys().next().value
          if (oldest !== undefined) syncAudio.delete(oldest)
        }
        return { jobId }
      }
      const jobId = readPath(json, m.response.jobIdPath ?? '')
      if (typeof jobId !== 'string' || !jobId) {
        throw new RelayError(500, `音乐提交响应缺少任务 id（${m.response.jobIdPath ?? '?'}）: ${JSON.stringify(json).slice(0, 200)}`)
      }
      return { jobId }
    },
    async status(jobId) {
      if (m.mode === 'sync') return { state: 'done', progress: 100 }
      const statusPath = (m.endpoint.statusPath ?? '').replace('{id}', encodeURIComponent(jobId))
      const json = await getJson<unknown>(`${base}${statusPath}`, channel.apiKey, fetchImpl, 15000)
      const state = String(readPath(json, m.response.statusValuePath ?? 'status') ?? '').toLowerCase()
      const doneValues = m.response.doneValues ?? ['completed', 'succeeded', 'done', 'success']
      if (doneValues.includes(state)) return { state: 'done', progress: 100 }
      if (m.response.failedValues?.includes(state)) {
        return { state: 'failed', progress: null, error: `music task ${state}` }
      }
      return { state: 'running', progress: null }
    },
    async fetch(jobId) {
      if (m.mode === 'sync') {
        const audio = syncAudio.get(jobId)
        if (!audio) throw new RelayError(404, `音乐任务不存在或已过期: ${jobId}`)
        syncAudio.delete(jobId)
        if (audio.base64 !== undefined) return { outputs: [''], meta: { audioBase64: audio.base64 } }
        return { outputs: [audio.url ?? ''], meta: { urlIsSigned: m.response.urlIsSigned === true } }
      }
      const statusPath = (m.endpoint.statusPath ?? '').replace('{id}', encodeURIComponent(jobId))
      const json = await getJson<unknown>(`${base}${statusPath}`, channel.apiKey, fetchImpl, 15000)
      const audio = extractAudio(json, m)
      if (audio.base64 !== undefined) return { outputs: [''], meta: { audioBase64: audio.base64 } }
      return { outputs: [audio.url ?? ''], meta: { urlIsSigned: m.response.urlIsSigned === true } }
    },
    async health() {
      return { ok: true, quotaRemaining: null }
    },
  }
  return assertProvider(provider)
}
