/** 配音：voiceFile 外挂优先（云 TTS/真人录音）；否则 macOS say / Windows SAPI 本地合成。 */
// voiceFile 的存在性由调用方探测；SAPI 脚本必须写临时 .ps1 后用 powershell -File 执行（不得 -Command 内联，防引号剥离重开解析面）；say 的 text 以 - 开头时执行层需自行防护。

import { RelayError } from '../providers/relay-http.ts'

export interface VoiceIntent {
  voiceFile?: string
  voiceHint?: string
}

export type VoiceResolution =
  | { kind: 'file'; src: string }
  | { kind: 'say'; text: string }
  | { kind: 'sapi'; text: string }
  | null

export function resolveVoice(intent: VoiceIntent, platform: NodeJS.Platform): VoiceResolution {
  if (intent.voiceFile) return { kind: 'file', src: intent.voiceFile }
  const text = (intent.voiceHint ?? '').trim()
  if (!text) return null
  if (platform === 'darwin') return { kind: 'say', text }
  if (platform === 'win32') return { kind: 'sapi', text }
  return null
}

export function buildMacSayCommand(text: string, outAiff: string, voice = 'Tingting'): { cmd: string; args: string[]; file: string } {
  return { cmd: 'say', args: ['-v', voice, '-o', outAiff, text], file: outAiff }
}

export function buildSapiScript(text: string, outWav: string): string {
  const escaped = text.replace(/'/g, "''")
  return [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    `$s.SetOutputToWaveFile('${outWav.replace(/'/g, "''")}')`,
    `$s.Speak('${escaped}')`,
    '$s.Dispose()',
  ].join('\n')
}

/* ── 云端 TTS（OpenAI 兼容 /v1/audio/speech；自然度远超本地 say/SAPI，规格 §5 配音） ── */

export interface CloudTtsConfig {
  /** 站点根或 /v1 根均可（内部归一）。 */
  baseUrl: string
  apiKey: string
  /** 如 gpt-4o-mini-tts / qwen-tts 等（以站点 /v1/models 实测为准）。 */
  model: string
  /** 如 alloy / shimmer；中文旁白任意音色均可，配合 instructions 定语气。 */
  voice?: string
  /** 语气指令（gpt-4o-mini-tts 支持），如 "温柔的中文女声旁白，语速平缓"。 */
  instructions?: string
  /** mp3 之外的格式（缺省 mp3）。 */
  responseFormat?: string
}

export function buildCloudSpeechRequest(cfg: CloudTtsConfig, text: string): { url: string; init: RequestInit } {
  const base = cfg.baseUrl.trim().replace(/\/+$/, '')
  const body: Record<string, unknown> = { model: cfg.model, voice: cfg.voice ?? 'alloy', input: text, response_format: cfg.responseFormat ?? 'mp3' }
  if (cfg.instructions) body['instructions'] = cfg.instructions
  return {
    url: `${base}/v1/audio/speech`,
    init: {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  }
}

/** 云端合成：返回 mp3 字节（调用方落盘）。非 200 抛 RelayError（复用 relay-http 的错误归一）。 */
export async function synthesizeCloudSpeech(cfg: CloudTtsConfig, text: string, fetchImpl: typeof fetch = fetch, timeoutMs = 120000): Promise<Buffer> {
  const { url, init } = buildCloudSpeechRequest(cfg, text)
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { ...init, signal: ac.signal })
    if (!res.ok) {
      let msg = `http-${res.status}`
      try {
        const j = (await res.json()) as { error?: { message?: string }; message?: string }
        msg = j?.error?.message ?? (typeof j?.message === 'string' ? j.message : msg)
      } catch { /* 非 JSON 错误体 */ }
      throw new RelayError(res.status, `云端 TTS 失败: ${msg}`)
    }
    return Buffer.from(await res.arrayBuffer())
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw new Error('云端 TTS 超时')
    throw err
  } finally {
    clearTimeout(timer)
  }
}
