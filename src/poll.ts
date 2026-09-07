/** 韧性轮询：仅对临时性错误（RelayError status 0/429/>=500）指数退避重试；终态绝不重试；总超时引用最后错误。 */

import { RelayError } from './providers/relay-http.ts'

export interface PollOptions<T> {
  isFinal: (state: T) => boolean
  delayMs?: number
  maxPollMs?: number
  maxDelayMs?: number
}

function isTransient(err: unknown): boolean {
  if (!(err instanceof RelayError)) return false
  const s = err.status
  return s === 0 || s === 429 || s >= 500
}

export async function pollUntil<T>(attempt: () => Promise<T>, opts: PollOptions<T>): Promise<T> {
  const delayMs = opts.delayMs ?? 5000
  const maxDelayMs = opts.maxDelayMs ?? 30000
  const maxPollMs = opts.maxPollMs ?? 600000
  const start = Date.now()
  let delay = delayMs
  let lastErr: unknown = null
  for (;;) {
    try {
      const state = await attempt()
      if (opts.isFinal(state)) return state
      lastErr = null
    } catch (err) {
      if (!isTransient(err)) throw err
      lastErr = err
    }
    if (Date.now() - start > maxPollMs) {
      const detail = lastErr instanceof Error ? lastErr.message : 'unknown'
      throw new Error(`轮询超时（>${Math.round(maxPollMs / 1000)}s）：${detail}`)
    }
    await new Promise((r) => setTimeout(r, delay))
    delay = Math.min(delay * 2, maxDelayMs)
  }
}
