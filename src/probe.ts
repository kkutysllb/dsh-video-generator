/** 通道探测：/models 枚举 + 鉴权校验。开发前置（M0 实测）与产品"测试通道"共用。 */
// 注意：probe.ok 只代表 /models 可达且返回了模型清单；部分中转不校验 /models 的 token，不能等同生成端点的鉴权/可用性证明。

export interface ProbeTarget {
  baseUrl: string
  apiKey: string
}

export interface ProbeResult {
  ok: boolean
  baseUrl: string
  models: string[]
  status: number | null
  error?: 'auth-failed' | 'no-models' | 'bad-json' | 'network' | 'timeout' | `http-${number}`
}

const isAbortError = (err: unknown): boolean => err instanceof Error && err.name === 'AbortError'

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
    } catch (err) {
      if (isAbortError(err)) {
        return { ok: false, baseUrl: base, models: [], status: res.status, error: 'timeout' }
      }
      return { ok: false, baseUrl: base, models: [], status: res.status, error: 'bad-json' }
    }
    const obj = json as { data?: unknown; models?: unknown }
    const raw = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.models) ? obj.models : []
    const models = Array.from(
      new Set(raw.map((m) => (typeof m === 'string' ? m : (m as { id?: string })?.id ?? ''))),
    )
      .filter((s) => s.length > 0)
      .sort()
    if (!models.length) return { ok: false, baseUrl: base, models: [], status: res.status, error: 'no-models' }
    return { ok: true, baseUrl: base, models, status: res.status }
  } catch (err) {
    return { ok: false, baseUrl: base, models: [], status: null, error: isAbortError(err) ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}
