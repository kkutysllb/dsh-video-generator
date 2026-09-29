/** vgen_generate / vgen_status：推进非 LLM 段 + run 概览。
 *  确认语义（规格 §4.4 + 2026-09-28 §9）：估价未知 → 一律确认；估价 ≤ 阈值 → 放行；
 *  超阈值 → confirm-required。模型一律来自用途槽绑定（单槽单模型）。
 */

import type { VaultStore } from '../store/vault.ts'
import type { RunStore } from '../store/runs.ts'
import type { SlotBinding, SlotId } from '../store/slots.ts'
import type { ChannelRef, ProviderSlotOptions } from '../providers/protocols.ts'
import type { MachineDeps } from '../pipeline/machine.ts'
import { fetchPricing, estimateCny, type PricingTable } from '../pricing.ts'
import { SpendLedger, confirmSpend } from '../spend.ts'
import { providerForSlot } from '../providers/protocols.ts'
import { advanceRun, ManualGateError, AskGateRejectedError, RunInterruptedError } from '../pipeline/machine.ts'
import { bindingUnavailable, ModelUnavailableError, requireSlotBinding } from '../model-selection.ts'
import { isStage } from '../stages.ts'
import { locateFfmpeg } from '../finalcut/render-ffmpeg.ts'
import type { CloudTtsConfig } from '../finalcut/voice.ts'
import type { ToolResult } from './handoff.ts'
import { HandoffError } from '../schema/handoff.ts'

export interface GenerateContext {
  vault: VaultStore
  runs: RunStore
  /** 槽位绑定表（每次执行现取，切配置即时生效）。 */
  slots: () => Partial<Record<SlotId, SlotBinding>>
  /** 凭证解析：通道不存在时抛 model-unavailable（含槽位上下文）。 */
  channelOf: (channelId: string) => ChannelRef | null
  env?: NodeJS.ProcessEnv
  /** 测试注入：confirm 判定（注入后 args.confirm 与阈值语义失效）。 */
  confirmer?: (est: number | null) => Promise<boolean>
  /** 测试注入：覆盖 provider 工厂。 */
  providersOverride?: { forSlot: MachineDeps['providers']['forSlot'] }
  /** 测试注入：下载用 fetch。 */
  fetchImpl?: typeof fetch
  /** 测试注入：云端 TTS 配置；生产路径按 tts 槽绑定动态构造。 */
  tts?: CloudTtsConfig
  /** 宿主生命周期信号：插件停用/卸载（HMR）时 abort，在飞生成在检查点停下。 */
  signal?: AbortSignal
}

/** tts 槽绑定 → 云端 TTS 配置（音色/语气：能力位声明优先，env 兜底）。 */
export function configuredCloudTts(binding: SlotBinding, channel: ChannelRef, env: NodeJS.ProcessEnv = process.env): CloudTtsConfig {
  const voiceCap = binding.capabilities['voice']
  const instructionsCap = binding.capabilities['instructions']
  return {
    baseUrl: channel.baseUrl,
    apiKey: channel.apiKey,
    model: binding.model,
    voice: (typeof voiceCap === 'string' && voiceCap) || env['VGEN_TTS_VOICE'] || undefined,
    instructions: (typeof instructionsCap === 'string' && instructionsCap) || env['VGEN_TTS_INSTRUCTIONS'] || undefined,
  }
}

export interface GenerateArgs {
  runId: string
  target: 'assets' | 'video' | 'music' | 'final'
  confirm?: boolean
  concurrency?: number
  /** 每段 gate 模式覆盖（持久化进 run.json；优先级 = vault 缺省 < run.json < 本参数）。 */
  gates?: Record<string, 'auto' | 'ask' | 'manual'>
  /** ask gate 的本次放行清单（用户已在会话中批准后由会话模型带上）。 */
  gateApprovals?: string[]
  /** 把某个媒体段（master-asset/shot-assets/video/final-cut）重置 pending 后重跑。 */
  rerunStage?: string
}

function mapTarget(target: string): MachineDeps['target'] {
  if (target === 'assets') return 'shot-assets'
  if (target === 'video') return 'video'
  if (target === 'music') return 'music'
  return 'final-cut'
}

export function buildGenerateTools(ctx: GenerateContext): {
  generate: { execute: (args: GenerateArgs, callSignal?: AbortSignal) => Promise<ToolResult> }
  status: { execute: (args: { runId: string }) => Promise<ToolResult> }
} {
  const env = ctx.env ?? process.env
  const ledger = SpendLedger.open(env)
  return {
    generate: {
      execute: async (args, callSignal) => {
        let denied = 0
        try {
          const runId = String(args['runId'] ?? '')
          if (!ctx.runs.get(runId)) return { ok: false, error: { code: 'not-found', message: `run 不存在: ${runId}` } }
          let argGates: Record<string, 'auto' | 'ask' | 'manual'> | undefined
          if (args['gates'] !== undefined) {
            const g = args['gates']
            if (typeof g !== 'object' || g === null || Array.isArray(g)) return { ok: false, error: { code: 'bad-request', message: 'gates 须为对象 {段名: auto|ask|manual}' } }
            argGates = {}
            for (const [k, v] of Object.entries(g as Record<string, unknown>)) {
              if (!isStage(k)) return { ok: false, error: { code: 'bad-request', message: `gates 键须为合法段名: ${k}` } }
              if (v !== 'auto' && v !== 'ask' && v !== 'manual') return { ok: false, error: { code: 'bad-request', message: `gates[${k}] 须为 auto|ask|manual: ${String(v)}` } }
              argGates[k] = v
            }
            ctx.runs.setGates(runId, argGates)
          }
          const MEDIA_STAGES = ['master-asset', 'shot-assets', 'video', 'music', 'final-cut']
          if (args['rerunStage'] !== undefined) {
            const rs = String(args['rerunStage'])
            if (!MEDIA_STAGES.includes(rs)) return { ok: false, error: { code: 'bad-request', message: `rerunStage 须为媒体段（${MEDIA_STAGES.join('|')}）: ${rs}` } }
            ctx.runs.setStage(runId, rs, 'pending')
          }
          const recGates = ctx.runs.get(runId)?.gates ?? {}
          const effectiveGates = { ...ctx.vault.getGateDefaults(), ...recGates } as MachineDeps['gates']
          const approvals = Array.isArray(args['gateApprovals']) ? (args['gateApprovals'] as unknown[]).filter((s): s is string => typeof s === 'string') : []
          const slots = ctx.slots()

          const channelOf = (binding: SlotBinding): ChannelRef => {
            const c = ctx.channelOf(binding.channelId)
            if (!c) throw bindingUnavailable(binding, `通道不存在或已删除: ${binding.channelId}`)
            return c
          }

          // 价目按通道拉取（不同槽可绑不同站点）；拉取失败容错为 null → 估价未知走确认
          const pricingByChannel = new Map<string, PricingTable | null>()
          const channelIds = [...new Set(Object.values(slots).map((b) => b.channelId))]
          await Promise.all(channelIds.map(async (cid) => {
            const ch = ctx.channelOf(cid)
            pricingByChannel.set(cid, ch ? await fetchPricing(ch, undefined, 15000).catch(() => null) : null)
          }))
          const estimateFor = (binding: SlotBinding): number | null => {
            const table = pricingByChannel.get(binding.channelId)
            return table ? estimateCny(binding.model, table) : null
          }

          const threshold = ctx.vault.getBudget().confirmThresholdCny
          const r = await advanceRun({
            runs: ctx.runs,
            runId,
            target: mapTarget(String(args['target'] ?? 'final')),
            slots,
            channelFor: channelOf,
            // gate 三态接线（vault 缺省 < run.json < args 已在 effectiveGates 合并）：
            // manual → ManualGateError；ask → approvals 放行清单判定（gateApprovals）
            gates: effectiveGates,
            ask: async (stage) => approvals.includes(stage),
            providers: {
              forSlot: (binding, channel, opts) =>
                ctx.providersOverride
                  ? ctx.providersOverride.forSlot(binding, channel, opts)
                  : providerForSlot(channel, binding, {
                      fetchImpl: opts?.fetchImpl,
                    } satisfies ProviderSlotOptions),
            },
            estimate: estimateFor,
            confirmer: async (est) => {
              if (ctx.confirmer) return ctx.confirmer(est)
              // 用户显式 confirm → 全部放行；否则按阈值判定（unknown 一律确认）
              if (args['confirm'] === true) return true
              return confirmSpend(est, threshold, () => {
                denied++
                return false
              })
            },
            ffmpeg: locateFfmpeg(env),
            tts: resolveCloudTts(ctx, slots, channelOf, env),
            concurrency: typeof args['concurrency'] === 'number' ? args['concurrency'] : undefined,
            fetchImpl: ctx.fetchImpl,
            // 取消信号组合：宿主停用（lifecycle）+ 工具调用截止（exec.signal，B1）——任一触发即停
            signal: ctx.signal && callSignal
              ? AbortSignal.any([ctx.signal, callSignal])
              : (ctx.signal ?? callSignal),
            recordSpend: (entry) => ledger.recordSafe(entry),
          })
          return {
            ok: true,
            value: {
              runId: r.runId,
              stages: r.stages,
              shots: r.shotImages?.length ?? 0,
              clips: r.clipFiles?.length ?? 0,
              finalOutput: r.finalOutput ?? null,
            },
          }
        } catch (err) {
          if (err instanceof ModelUnavailableError) {
            return { ok: false, error: { code: err.code, message: err.message } }
          }
          if (denied > 0) {
            return {
              ok: false,
              error: {
                code: 'confirm-required',
                message: `有 ${denied} 笔消费超过确认阈值（估价见 run 记账事件）。向用户转述成本后，携带 confirm:true 重新调用 vgen_generate 继续。`,
              },
            }
          }
          if (err instanceof ManualGateError) {
            return { ok: false, error: { code: 'manual-gate', message: `${err.message}。用法：vgen_provide { runId, stage, files: [{ path, shot?, name? }] }` } }
          }
          if (err instanceof AskGateRejectedError) {
            return { ok: false, error: { code: 'gate-approval', message: `${err.message}。请与用户确认该段执行，然后携带 gateApprovals（如 ["master-asset"]）重新调用；或改 gates 为 auto/manual。` } }
          }
          if (err instanceof RunInterruptedError) {
            return { ok: false, error: { code: 'interrupted', message: `${err.message}。run 已置 failed(host-interrupted)；插件重新启用后可对未完成段用 rerunStage 续跑。` } }
          }
          if (err instanceof HandoffError) return { ok: false, error: { code: err.code, message: err.message } }
          return { ok: false, error: { code: 'internal', message: err instanceof Error ? err.message : String(err) } }
        }
      },
    },
    status: {
      execute: async (args) => {
        const record = ctx.runs.get(String(args?.['runId'] ?? ''))
        if (!record) return { ok: false, error: { code: 'not-found', message: `run 不存在: ${args?.['runId']}` } }
        return {
          ok: true,
          value: {
            id: record.id, title: record.title, status: record.status, stages: record.stages,
            gates: record.gates ?? {}, reviews: record.reviews ?? {},
            recentEvents: record.events.slice(-5),
          },
        }
      },
    },
  }
}

/** tts 槽绑定 → 云端 TTS；未绑定/通道缺失 → undefined（回退本地 say/SAPI）。 */
function resolveCloudTts(
  ctx: GenerateContext,
  slots: Partial<Record<SlotId, SlotBinding>>,
  channelOf: (binding: SlotBinding) => ChannelRef,
  env: NodeJS.ProcessEnv,
): CloudTtsConfig | undefined {
  if (ctx.tts) return ctx.tts
  try {
    const binding = requireSlotBinding(slots, 'tts')
    if (binding.protocol !== 'openai-tts') return undefined
    const channel = channelOf(binding)
    return configuredCloudTts(binding, channel, env)
  } catch {
    return undefined
  }
}

/** vgen_generate / vgen_status 的 DshToolDefinition（对齐 handoffToolDefs 形态）。 */
export function generateToolDefs(
  tools: ReturnType<typeof buildGenerateTools>,
): Array<import('./handoff.ts').DshToolDefinition> {
  const jsonRender = (_args: unknown, value: unknown): Array<{ type: string; text: string }> => [
    { type: 'text', text: JSON.stringify(value) },
  ]
  return [
    {
      name: 'vgen_generate',
      description:
        '推进 run 的非 LLM 段：target=assets 生成角色三视图/场景主图/逐镜参考图；target=video 逐镜视频；target=music 生成 BGM（用途槽 music.bgm 未绑定时跳过留痕）；target=final 配音+混音渲染成片 mp4+SRT。' +
        '模型来自设置页「用途槽」绑定。首次调用不带 confirm；若返回 confirm-required，先向用户转述成本，再携带 confirm:true 重新调用。',
      parameters: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'run id（vgen_story 返回）' },
          target: { type: 'string', enum: ['assets', 'video', 'music', 'final'], description: '推进目标段（含其前序段）' },
          confirm: { type: 'boolean', description: '成本确认；仅在向用户转述成本后置 true' },
          concurrency: { type: 'number', description: '并发数，默认 2' },
          gates: { type: 'object', description: '可选：每段 gate 模式 {段名: "auto"|"ask"|"manual"}，持久化进 run.json' },
          gateApprovals: { type: 'array', description: '可选：ask 段本次放行清单（用户已批准后携带）' },
          rerunStage: { type: 'string', enum: ['master-asset', 'shot-assets', 'video', 'final-cut'], description: '可选：重置该媒体段为 pending 后重跑' },
        },
        required: ['runId', 'target'],
      },
      output: { schema: { type: 'object' }, render: jsonRender },
      timeoutMs: 600000,
      // exec.signal 透传（0.1.7 契约）：截止触发 → 生成在段边界/并发泵检查点停下
      execute: (args: unknown, exec?: { signal?: AbortSignal }) =>
        tools.generate.execute(args as GenerateArgs, exec?.signal),
    },
    {
      name: 'vgen_status',
      description: '查询 run 进度：各段状态、最近事件。随时可用。',
      parameters: {
        type: 'object',
        properties: { runId: { type: 'string', description: 'run id' } },
        required: ['runId'],
      },
      output: { schema: { type: 'object' }, render: jsonRender },
      timeoutMs: 10000,
      execute: (args: unknown) => tools.status.execute(args as { runId: string }),
    },
  ]
}
