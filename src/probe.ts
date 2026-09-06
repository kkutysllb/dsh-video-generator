/** 通道探测：/models 枚举 + 鉴权校验。开发前置（M0 实测）与产品"测试通道"共用。 */

export interface ProbeTarget {
  baseUrl: string
  apiKey: string
}

export interface ProbeResult {
  ok: boolean
  baseUrl: string
  models: string[]
  status: number | null
  error?: 'auth-failed' | 'no-models' | 'bad-json' | 'network' | `http-${number}`
}

export async function probeChannel(
  target: ProbeTarget,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 15000,
): Promise<ProbeResult> {
  const base = target.baseUrl.trim().replace(/\/+$/, '')
  const url = `${base}/models`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${target.apiKey}` },
      signal: ac.signal,
    })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, baseUrl: base, models: [], status: res.status, error: 'auth-failed' }
    }
    if (!res.ok) {
      return { ok: false, baseUrl: base, models: [], status: res.status, error: `http-${res.status}` }
    }
    let json: unknown
    try {
      json = await res.json()
    } catch {
      return { ok: false, baseUrl: base, models: [], status: res.status, error: 'bad-json' }
    }
    const obj = json as { data?: unknown; models?: unknown }
    const raw = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.models) ? obj.models : []
    const models = raw
      .map((m) => (typeof m === 'string' ? m : (m as { id?: string })?.id ?? ''))
      .filter((s) => typeof s === 'string' && s.length > 0)
      .sort()
    if (!models.length) return { ok: false, baseUrl: base, models: [], status: res.status, error: 'no-models' }
    return { ok: true, baseUrl: base, models, status: res.status }
  } catch {
    return { ok: false, baseUrl: base, models: [], status: null, error: 'network' }
  } finally {
    clearTimeout(timer)
  }
}
