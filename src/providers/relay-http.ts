/** 中转站共享 HTTP 层：Bearer 鉴权 + 超时中止 + 双错误形态归一（规格附录 B）。 */

export class RelayError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type FetchImpl = typeof fetch

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` }
}

function signalWithTimeout(timeoutMs: number): { signal: AbortSignal; done: () => void } {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  return { signal: ac.signal, done: () => clearTimeout(timer) }
}

function normalizeErrStatus(status: number, body: unknown): RelayError {
  const b = body as { error?: { message?: string }; message?: string; code?: unknown }
  const msg = b?.error?.message ?? (typeof b?.message === 'string' ? b.message : `http-${status}`)
  return new RelayError(status, msg)
}

async function readError(res: Response): Promise<never> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  throw normalizeErrStatus(res.status, body)
}

async function requestJson<T>(fetchImpl: FetchImpl, url: string, apiKey: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const { signal, done } = signalWithTimeout(timeoutMs)
  try {
    const res = await fetchImpl(url, { ...init, signal })
    if (!res.ok) await readError(res)
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof RelayError) throw err
    throw new RelayError(0, err instanceof Error ? err.message : 'network')
  } finally {
    done()
  }
}

export function postJson<T = Record<string, unknown>>(url: string, apiKey: string, body: unknown, fetchImpl: FetchImpl = fetch, timeoutMs = 120000): Promise<T> {
  return requestJson<T>(fetchImpl, url, apiKey, {
    method: 'POST',
    headers: { ...authHeaders(apiKey), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, timeoutMs)
}

export function getJson<T = Record<string, unknown>>(url: string, apiKey: string, fetchImpl: FetchImpl = fetch, timeoutMs = 15000): Promise<T> {
  return requestJson<T>(fetchImpl, url, apiKey, { method: 'GET', headers: authHeaders(apiKey) }, timeoutMs)
}
