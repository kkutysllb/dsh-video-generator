// src/tools/channels.ts
/** vgen_channels：通道健康 / 价目估算 / 累计消耗（规格 §7.1）。全出口脱敏（vault.listChannels 已脱敏）。 */

import type { VaultStore } from '../store/vault.ts'
import type { RunStore } from '../store/runs.ts'
import { probeChannel } from '../probe.ts'
import { fetchPricing, estimateCny } from '../pricing.ts'
import { SpendLedger } from '../spend.ts'
import { HandoffError } from '../schema/handoff.ts'
import type { ToolResult, DshToolDefinition } from './handoff.ts'

export interface ChannelsContext {
  vault: VaultStore
  runs: RunStore
  env?: NodeJS.ProcessEnv
  /** 测试注入：探测实现。 */
  probe?: typeof probeChannel
  /** 测试注入：定价表拉取。 */
  fetchPricingImpl?: typeof fetchPricing
}

export interface ChannelsArgs {
  action?: 'list' | 'health' | 'spend'
  channelId?: string
}

function sumRunSpend(events: Array<{ type: string; detail?: Record<string, unknown> }>): { entries: number; estCny: number } {
  let entries = 0
  let estCny = 0
  for (const e of events) {
    if (e.type !== 'spend') continue
    entries++
    const v = e.detail?.['estCny']
    if (typeof v === 'number' && Number.isFinite(v)) estCny += v
  }
  return { entries, estCny: Number(estCny.toFixed(4)) }
}

export function buildChannelsTools(ctx: ChannelsContext): {
  channels: { execute: (args: ChannelsArgs) => Promise<ToolResult> }
} {
  const env = ctx.env ?? process.env
  const probe = ctx.probe ?? probeChannel
  const fetchPricingFn = ctx.fetchPricingImpl ?? fetchPricing
  return {
    channels: {
      execute: async (args): Promise<ToolResult> => {
        try {
          const action = args?.action ?? 'list'
          if (action === 'list') {
            const d = ctx.vault.load()
            return { ok: true, value: { channels: ctx.vault.listChannels(), defaultChannelId: d.defaultChannelId, budget: d.budget, gateDefaults: d.gateDefaults } }
          }
          if (action === 'health') {
            const id = typeof args?.channelId === 'string' && args.channelId ? args.channelId : ctx.vault.load().defaultChannelId
            const ch = id ? ctx.vault.getChannel(id) : null
            if (!ch) throw new HandoffError('not-found', id ? `通道不存在: ${id}` : '尚未配置任何通道（设置页「通道管理」或 channels.create）')
            const probeResult = await probe({ baseUrl: ch.baseUrl, apiKey: ch.apiKey })
            const pricing = await fetchPricingFn({ baseUrl: ch.baseUrl, apiKey: ch.apiKey }, undefined, 15000).catch(() => null)
            const estimates = ch.models.map((m) => ({
              model: m.model, kind: m.kind,
              estCny: pricing ? estimateCny(m.model, pricing) : m.pricingCny ?? null,
            }))
            // 不回显任何 key 形态（含脱敏串）：health 面只出通道元信息 + 探测/估价
            return {
              ok: true,
              value: {
                channelId: ch.id, label: ch.label, baseUrl: ch.baseUrl,
                probe: { ok: probeResult.ok, models: probeResult.models.length, sample: probeResult.models.slice(0, 5), error: probeResult.error ?? null },
                pricingAvailable: pricing !== null,
                estimates,
              },
            }
          }
          if (action === 'spend') {
            const ledger = SpendLedger.open(env)
            const perRun = ctx.runs.list().map((r) => ({ id: r.id, title: r.title, status: r.status, ...sumRunSpend(r.events) }))
            return { ok: true, value: { totals: ledger.totals(), runs: perRun, note: 'estCny 为提交时估价（CNY），非账单实扣' } }
          }
          throw new HandoffError('bad-request', `action 须为 list|health|spend: ${String(action)}`)
        } catch (err) {
          if (err instanceof HandoffError) return { ok: false, error: { code: err.code, message: err.message } }
          return { ok: false, error: { code: 'internal', message: err instanceof Error ? err.message : String(err) } }
        }
      },
    },
  }
}

export function channelsToolDefs(tools: ReturnType<typeof buildChannelsTools>): DshToolDefinition[] {
  const jsonRender = (_args: unknown, value: unknown): Array<{ type: string; text: string }> => [
    { type: 'text', text: JSON.stringify(value) },
  ]
  return [
    {
      name: 'vgen_channels',
      description: '通道面板：action=list 通道列表（脱敏）+默认通道+预算阈值+gate 缺省；action=health 探测通道（模型枚举/鉴权）+按通道模型估价；action=spend 累计消耗（全局 + 按 run）。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'health', 'spend'], description: '缺省 list' },
          channelId: { type: 'string', description: 'health 专用：缺省用默认通道' },
        },
      },
      output: { schema: { type: 'object' }, render: jsonRender },
      timeoutMs: 60000,
      execute: (args: unknown) => tools.channels.execute(args as ChannelsArgs),
    },
  ]
}
