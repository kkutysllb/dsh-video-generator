/**
 * /dsh-video-generator API 面：纯函数 handler + {ok,value}/{ok,error} 信封 + loopback 信任围栏。
 * 对齐 dsh-super-ppts 路由模式；handler 不碰 node:http，便于无宿主测试。
 */

import { resolve, sep } from 'node:path'
import type { VaultStore } from '../store/vault.ts'
import { VaultError } from '../store/vault.ts'
import type { RunStore } from '../store/runs.ts'
import type { probeChannel } from '../probe.ts'
import { collectArtifacts } from './artifacts.ts'
import { resolveModel } from '../model-catalog.ts'
import { isStage } from '../stages.ts'

export const PLUGIN_ID = 'dsh-video-generator'
export const PLUGIN_VERSION = '1.0.1'

export interface ApiContext {
  vault: VaultStore
  runs: RunStore
  probe: typeof probeChannel
}

export type Envelope = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }
export type MaybePromise<T> = T | Promise<T>

// 仅精确 loopback 名（'127.0.0.1' 的 URL hostname 形态已剥括号，故 '::1'/'[::1]' 双收录无害）
const TRUSTED_LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

// DNS-rebind / 跨站防御（非认证）：Host 头存在即权威精确匹配；remote 仅在 Host 缺失时兜底——
// 两者绝不互补，防"伪造 host + 回环 remote"组合绕过。
export function isLoopbackRequest(
  host: string | string[] | undefined,
  remote: string | undefined,
  trustedHosts: readonly string[] = [],
): boolean {
  // 重复 Host 头（数组形态）直接拒绝：无法判定意图
  if (Array.isArray(host)) return false
  if (host !== undefined && host !== '') {
    // Host 头存在即权威：必须精确通过；绝不允许 remote 回环补偿伪造 host
    if (isLoopbackHostname(host)) return true
    return trustedHosts.some((t) => t === host || t === safeHostname(host))
  }
  // Host 缺失（HTTP/1.0 代理等）才退回 remote 回环判断
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
}

function isLoopbackHostname(host: string): boolean {
  // 只认精确 loopback 名：经 WHATWG URL 解析规范化（剥端口/括号、小写化）后比对集合。
  // 不做 127/8 段级放行——'127.0.0.10'、'127.0.0.1.evil.com'、sslip.io 等前缀/段级形态一律拒绝（契约测试钉死）。
  try {
    return TRUSTED_LOCAL.has(new URL(`http://${host}`).hostname.toLowerCase())
  } catch {
    return false
  }
}

function safeHostname(host: string): string {
  try {
    return new URL(`http://${host}`).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function healthPayload(ctx: { vault: VaultStore; runs: RunStore }): Record<string, unknown> {
  const data = ctx.vault.load()
  return {
    ok: true,
    plugin: PLUGIN_ID,
    version: PLUGIN_VERSION,
    channels: { total: data.channels.length, enabled: data.channels.filter((c) => c.enabled).length },
    runs: ctx.runs.list().length,
  }
}

export function handleApi(ctx: ApiContext, name: string, args: Record<string, unknown>): MaybePromise<Envelope> {
  try {
    const value = dispatch(ctx, name, args)
    if (value instanceof Promise) {
      return value.then(
        (v) => ({ ok: true, value: v }) as Envelope,
        (err: unknown) => {
          // VaultError 消息按契约安全（校验/状态类用户可读文案），照常透传
          if (err instanceof VaultError) return { ok: false, error: toError(err) } as Envelope
          // 非 VaultError 的异步 reject 可能含内部细节（绝对路径/堆栈）：详情只进 host 日志，对外泛化
          console.error('[dsh-video-generator] api async error:', err)
          return { ok: false, error: { code: 'internal', message: 'internal error' } } as Envelope
        },
      )
    }
    return { ok: true, value }
  } catch (err) {
    // VaultError 消息按契约安全（校验/状态类用户可读文案），照常透传；
    // 非 VaultError 的同步 throw 可能含内部细节（绝对路径/堆栈）：与异步分支一致——详情只进 host 日志，对外泛化
    if (err instanceof VaultError) return { ok: false, error: toError(err) }
    console.error('[dsh-video-generator] api error:', err)
    return { ok: false, error: { code: 'internal', message: 'internal error' } }
  }
}

function toError(err: VaultError): { code: string; message: string } {
  return { code: err.code, message: err.message }
}

// 从 JSON args 取非空 string 字段（缺失/类型不符 → bad-request）。
function requireString(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new VaultError('bad-request', `字段 ${field} 须为非空字符串`)
  return v
}

function optionalString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function dispatch(ctx: ApiContext, name: string, args: Record<string, unknown>): unknown {
  const id = typeof args['id'] === 'string' ? args['id'] : undefined
  switch (name) {
    case 'channels.list':
      return { channels: ctx.vault.listChannels(), defaultChannelId: ctx.vault.load().defaultChannelId }
    case 'channels.create':
      return ctx.vault.createChannel({
        id: requireString(args['id'], 'id'),
        baseUrl: requireString(args['baseUrl'], 'baseUrl'),
        apiKey: requireString(args['apiKey'], 'apiKey'),
        label: optionalString(args['label']),
        models: Array.isArray(args['models']) ? args['models'] : undefined,
      })
    case 'channels.update': {
      const p = (args['patch'] ?? {}) as Record<string, unknown>
      // 严格类型边界：'false' 字符串不再翻转为 true（非布尔=不更新）；models 非数组=不更新
      return ctx.vault.updateChannel(requireString(args['id'], 'id'), {
        label: optionalString(p['label']),
        baseUrl: optionalString(p['baseUrl']),
        enabled: typeof p['enabled'] === 'boolean' ? p['enabled'] : undefined,
        models: Array.isArray(p['models']) ? p['models'] : undefined,
        apiKey: optionalString(p['apiKey']),
      })
    }
    case 'channels.delete':
      ctx.vault.deleteChannel(id ?? '')
      return { deleted: id }
    case 'channels.setDefault':
      ctx.vault.setDefaultChannel(id ?? null)
      return { defaultChannelId: id ?? null }
    case 'channels.test': {
      // 契约：信封 ok:true 表示"探测已执行"；探测成败看 value.probe.ok / value.probe.error（auth-failed/http-*/no-models/timeout/network）
      const ch = id ? ctx.vault.getChannel(id) : null
      if (!ch) throw new VaultError('not-found', `通道不存在: ${id}`)
      return ctx.probe({ baseUrl: ch.baseUrl, apiKey: ch.apiKey }).then((r) => ({ probe: r }))
    }
    case 'runs.list':
      return { runs: ctx.runs.list() }
    case 'runs.get': {
      const rid = requireString(args['id'], 'id')
      const record = ctx.runs.get(rid)
      if (!record) throw new VaultError('not-found', `run 不存在: ${rid}`)
      let entries = 0
      let estCny = 0
      for (const e of record.events) {
        if (e.type !== 'spend') continue
        entries++
        const v = e.detail?.['estCny']
        if (typeof v === 'number' && Number.isFinite(v)) estCny += v
      }
      return { record, artifacts: collectArtifacts(ctx.runs, rid), spend: { entries, estCny: Number(estCny.toFixed(4)) } }
    }
    case 'channels.adoptModels': {
      const cid = requireString(args['id'], 'id')
      const ch = ctx.vault.getChannel(cid)
      if (!ch) throw new VaultError('not-found', `通道不存在: ${cid}`)
      const names = args['models']
      if (!Array.isArray(names) || names.length === 0 || names.length > 100) throw new VaultError('bad-request', 'models 须为 1..100 字符串数组')
      const merged = new Map(ch.models.map((m) => [m.model, m]))
      for (const n of names) {
        if (typeof n !== 'string' || !n) throw new VaultError('bad-request', `非法模型名: ${String(n)}`)
        const { entry, source } = resolveModel(n)
        // 目录不认识的名字（unknown 缺省 kind=video）不得覆盖用户已配置的既有条目：
        // 中转站枚举导入动辄数百模型，盲覆盖会把用户手工设好的 image/tts kind 全刷成 video
        const existing = merged.get(n)
        merged.set(n, source === 'unknown' && existing ? existing : { model: n, kind: entry.kind })
      }
      return ctx.vault.updateChannel(cid, { models: [...merged.values()] })
    }
    case 'settings.get': {
      const d = ctx.vault.load()
      return { defaultChannelId: d.defaultChannelId, budget: d.budget, gateDefaults: d.gateDefaults }
    }
    case 'settings.update': {
      // null 不再静默清零：undefined=不更新；非有限数字拒绝
      const t = args['confirmThresholdCny']
      if (t !== undefined) {
        if (typeof t !== 'number' || !Number.isFinite(t)) throw new VaultError('bad-request', 'confirmThresholdCny 须为数字')
        ctx.vault.setBudget(t)
      }
      const gd = args['gateDefaults']
      if (gd !== undefined) {
        if (typeof gd !== 'object' || gd === null || Array.isArray(gd)) throw new VaultError('bad-request', 'gateDefaults 须为对象 {段名: auto|ask|manual}')
        for (const [k, v] of Object.entries(gd as Record<string, unknown>)) {
          if (!isStage(k)) throw new VaultError('bad-request', `gateDefaults 键须为合法段名: ${k}`)
          if (v !== 'auto' && v !== 'ask' && v !== 'manual') throw new VaultError('bad-request', `gateDefaults[${k}] 须为 auto|ask|manual`)
          ctx.vault.setGateDefault(k, v)
        }
      }
      const d = ctx.vault.load()
      return { budget: d.budget, gateDefaults: d.gateDefaults }
    }
    default:
      throw new VaultError('bad-request', `unknown-method: ${name}`)
  }
}

const MEDIA_RUNID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** '/media/<runId>/<rel...>' → run 目录内绝对路径；任何穿越/畸形 → null（调用方 404）。
 *  入参 urlPath 必须已 decodeURIComponent。防线三层：runId 白名单正则、rel 段级拒绝 '.'/'..'/空段、
 *  resolve 后前缀核验（endsWith 兜底不做——前缀 + sep 即充分）。 */
export function resolveMediaPath(runsRoot: string, urlPath: string): string | null {
  const m = /^\/media\/([^/?#]+)\/(.+)$/.exec(urlPath)
  if (!m) return null
  const runId = m[1]!
  const rel = m[2]!
  if (!MEDIA_RUNID_RE.test(runId)) return null
  const segs = rel.split('/')
  // 段级拒绝：''/'.'/'..' 直接拒；另防御性二次 decode 段值，%2e 等编码形态还原后为 '.'/'..'/空 同样拒
  //（双 decode 不误伤合法文件名——按契约入参应已 decode，残留 % 编码段本就异常）。
  const dangerous = segs.some((s) => {
    if (s === '' || s === '.' || s === '..') return true
    try {
      const d = decodeURIComponent(s)
      return d === '' || d === '.' || d === '..'
    } catch {
      return true
    }
  })
  if (dangerous) return null
  const base = resolve(runsRoot, runId)
  const resolved = resolve(base, segs.join(sep))
  if (!resolved.startsWith(base + sep)) return null
  return resolved
}

const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.aiff': 'audio/aiff', '.wav': 'audio/wav',
  '.srt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8',
}

export function mediaContentType(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return MEDIA_TYPES[ext] ?? 'application/octet-stream'
}
