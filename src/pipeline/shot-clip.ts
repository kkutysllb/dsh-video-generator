// src/pipeline/shot-clip.ts
/** 单镜视频片段生成序列（machine video 段与 vgen_review 重拍共用，DRY）。
 *  职责边界：只做 submit→poll→fetch→save；成本确认/记账/事件由调用方负责。 */

import { writeFileSync } from 'node:fs'
import type { Provider } from '../provider.ts'
import { pollUntil, retryTransient } from '../poll.ts'

/** i2v 通用运动提示词（重拍时在其后追加负面要求）。 */
export const SHOT_MOTION_PROMPT = '镜头缓慢推进，主体自然运动，电影感光影'

/** 下载 URL 到本地（0600）；120s 超时（对偶发慢 CDN 的实测收紧值）。 */
export async function saveUrl(fetchImpl: typeof fetch, url: string, file: string): Promise<void> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(120000) })
  if (!res.ok) throw new Error(`下载失败 http-${res.status}`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()), { mode: 0o600 })
}

export interface ShotClipOptions {
  provider: Provider
  fetchImpl: typeof fetch
  imageUrl: string
  prompt: string
  durationSec: number
  outFile: string
  pollDelayMs?: number
  maxPollMs?: number
  /** submit 成功即回调（调用方在此落 spend 事件，保持与原 machine 相同的事件顺序）。 */
  onSubmit?: (jobId: string) => void
}

export async function generateShotClip(o: ShotClipOptions): Promise<string> {
  const { jobId } = await retryTransient(() => o.provider.submit('video', {
    prompt: o.prompt,
    imageUrl: o.imageUrl,
    durationSec: o.durationSec,
  }))
  o.onSubmit?.(String(jobId))
  const finalState = await pollUntil(
    () => o.provider.status(String(jobId)),
    { isFinal: (s) => s.state === 'done' || s.state === 'failed', delayMs: o.pollDelayMs ?? 1000, maxPollMs: o.maxPollMs ?? 600000 },
  )
  if (finalState.state === 'failed') throw new Error(`视频生成失败: ${finalState.error ?? '?'}`)
  const f = await o.provider.fetch(String(jobId))
  const url = f.outputs[0]
  if (!url) throw new Error('任务完成但无输出')
  await saveUrl(o.fetchImpl, url, o.outFile)
  return o.outFile
}
