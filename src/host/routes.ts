/**
 * /dsh-video-generator API 面：纯函数 handler + {ok,value}/{ok,error} 信封 + loopback 信任围栏。
 * 对齐 dsh-super-ppts 路由模式；handler 不碰 node:http，便于无宿主测试。
 */

import type { VaultStore } from '../store/vault.ts'
import { VaultError } from '../store/vault.ts'
import type { RunStore } from '../store/runs.ts'
import type { probeChannel } from '../probe.ts'

export const PLUGIN_ID = 'dsh-video-generator'
export const PLUGIN_VERSION = '0.1.0'

export interface ApiContext {
  vault: VaultStore
  runs: RunStore
  probe: typeof probeChannel
}

export type Envelope = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }
export type MaybePromise<T> = T | Promise<T>

export function isLoopbackRequest(host: string | undefined, remote: string | undefined): boolean {
  const hostOk = !!host && (host.startsWith('127.0.0.1') || host.startsWith('localhost') || host.startsWith('[::1]'))
  const ipOk = !!remote && (remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1')
  return hostOk || ipOk
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
        (err: unknown) => ({ ok: false, error: toError(err) }),
      )
    }
    return { ok: true, value }
  } catch (err) {
    return { ok: false, error: toError(err) }
  }
}

function toError(err: unknown): { code: string; message: string } {
  if (err instanceof VaultError) return { code: err.code, message: err.message }
  return { code: 'internal', message: err instanceof Error ? err.message : String(err) }
}

function dispatch(ctx: ApiContext, name: string, args: Record<string, unknown>): unknown {
  const id = typeof args['id'] === 'string' ? args['id'] : undefined
  switch (name) {
    case 'channels.list':
      return { channels: ctx.vault.listChannels(), defaultChannelId: ctx.vault.load().defaultChannelId }
    case 'channels.create':
      return ctx.vault.createChannel({
        id: String(args['id'] ?? ''),
        baseUrl: String(args['baseUrl'] ?? ''),
        apiKey: String(args['apiKey'] ?? ''),
        label: args['label'] === undefined ? undefined : String(args['label']),
        models: (args['models'] ?? []) as never,
      })
    case 'channels.update':
      return ctx.vault.updateChannel(id ?? '', (args['patch'] ?? {}) as never)
    case 'channels.delete':
      ctx.vault.deleteChannel(id ?? '')
      return { deleted: id }
    case 'channels.setDefault':
      ctx.vault.setDefaultChannel(id ?? null)
      return { defaultChannelId: id ?? null }
    case 'channels.test': {
      const ch = id ? ctx.vault.getChannel(id) : null
      if (!ch) throw new VaultError('not-found', `通道不存在: ${id}`)
      return ctx.probe({ baseUrl: ch.baseUrl, apiKey: ch.apiKey }).then((r) => ({ probe: r }))
    }
    case 'runs.list':
      return { runs: ctx.runs.list() }
    case 'settings.get': {
      const d = ctx.vault.load()
      return { defaultChannelId: d.defaultChannelId, budget: d.budget, gateDefaults: d.gateDefaults }
    }
    case 'settings.update': {
      if (args['confirmThresholdCny'] !== undefined) ctx.vault.setBudget(Number(args['confirmThresholdCny']))
      return ctx.vault.load().budget
    }
    default:
      throw new VaultError('bad-request', `unknown-method: ${name}`)
  }
}
