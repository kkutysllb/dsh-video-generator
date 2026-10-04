/** 韧性轮询：仅对临时性错误（RelayError status 0/429/>=500）指数退避重试；终态绝不重试；总超时引用最后错误。 */

import { RelayError } from './providers/relay-http.ts'

export interface PollOptions<T> {
  isFinal: (state: T) => boolean
  delayMs?: number
  maxPollMs?: number
  maxDelayMs?: number
  /** 取消信号：触发后 sleep/下一轮立即抛 PollAbortedError（调用方在 catch 里转中断语义）。 */
  signal?: AbortSignal
}

/** 轮询被信号中止：不是上游失败，调用方应按取消/中断处置而非任务失败。 */
export class PollAbortedError extends Error {
  constructor() {
    super('轮询已取消（signal aborted）')
  }
}

export function isTransient(err: unknown): boolean {
  if (!(err instanceof RelayError)) return false
  const s = err.status
  return s === 0 || s === 429 || s >= 500
}

/** 可中止的 sleep：abort 触发即 reject，不留到 timeout 自然到期。 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((r) => setTimeout(r, ms))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const onAbort = () => {
      cleanup()
      reject(new PollAbortedError())
    }
    const cleanup = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export async function pollUntil<T>(attempt: () => Promise<T>, opts: PollOptions<T>): Promise<T> {
  const delayMs = opts.delayMs ?? 5000
  const maxDelayMs = opts.maxDelayMs ?? 30000
  const maxPollMs = opts.maxPollMs ?? 600000
  const start = Date.now()
  let delay = delayMs
  let lastErr: unknown = null
  for (;;) {
    if (opts.signal?.aborted) throw new PollAbortedError()
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
    await sleep(delay, opts.signal)
    delay = Math.min(delay * 2, maxDelayMs)
  }
}

/** 瞬时错误（网络/429/5xx）重试包装：非瞬时错误立即抛出。submit 类操作慎用（可能重复计费），轮询/下载类安全。 */
export async function retryTransient<T>(fn: () => Promise<T>, attempts = 3, baseMs = 3000): Promise<T> {
  let lastErr: unknown = null
  for (let n = 1; n <= attempts; n++) {
    try {
      return await fn()
    } catch (err) {
      if (!isTransient(err) || n === attempts) throw err
      lastErr = err
      await new Promise((r) => setTimeout(r, baseMs * 2 ** (n - 1)))
    }
  }
  throw lastErr
}
