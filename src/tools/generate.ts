/** vgen_generate / vgen_status：推进非 LLM 段 + run 概览。
 *  确认语义（规格 §4.4）：估价未知/超阈值且未带 confirm → confirm-required 信封（会话模型向用户转述成本后带 confirm 重调）。
 */

import type { VaultStore } from '../store/vault.ts'
import type { RunStore } from '../store/runs.ts'
import type { ChannelRef } from '../registry.ts'
import type { MachineDeps } from '../pipeline/machine.ts'
import { fetchPricing, estimateCny, type PricingTable } from '../pricing.ts'
import { SpendLedger } from '../spend.ts'
import { providerForModel } from '../registry.ts'
import { advanceRun, ManualGateError, AskGateRejectedError } from '../pipeline/machine.ts'
import { isStage } from '../stages.ts'
import { locateFfmpeg } from '../finalcut/render-ffmpeg.ts'
import type { CloudTtsConfig } from '../finalcut/voice.ts'
import type { ToolResult } from './handoff.ts'
import { HandoffError } from '../schema/handoff.ts'
import { ModelUnavailableError } from '../model-selection.ts'

export interface GenerateContext {
  vault: VaultStore
  runs: RunStore
  /** 默认通道解析（站点根）。 */
  channel: () => ChannelRef
  env?: NodeJS.ProcessEnv
  /** 生产路径不传：内部 fetchPricing（失败容错 null）；测试可传 null 跳过或传表。 */
  pricing?: PricingTable | null
  /** 测试注入：confirm 判定（注入后 args.confirm 语义失效）。 */
  confirmer?: (est: number | null) => Promise<boolean>
  /** 测试注入：覆盖 provider 工厂。 */
  providersOverride?: { forModel: MachineDeps['providers']['forModel'] }
  /** 测试注入：下载用 fetch。 */
  fetchImpl?: typeof fetch
  /** 测试注入：云端 TTS 配置；生产路径按当前通道 models[] 动态选择。 */
  tts?: CloudTtsConfig
}

export function configuredCloudTts(channel: ChannelRef, env: NodeJS.ProcessEnv = process.env): CloudTtsConfig | undefined {
  const model = channel.models?.find((entry) => entry.kind === 'tts' && entry.model.trim())
  if (!model) return undefined
  return {
    baseUrl: channel.baseUrl,
    apiKey: channel.apiKey,
    model: model.model.trim(),
    voice: env['VGEN_TTS_VOICE'] || undefined,
    instructions: env['VGEN_TTS_INSTRUCTIONS'] || undefined,
  }
}

export interface GenerateArgs {
  runId: string
  target: 'assets' | 'video' | 'final'
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
  return 'final-cut'
}

export function buildGenerateTools(ctx: GenerateContext): {
  generate: { execute: (args: GenerateArgs) => Promise<ToolResult> }
  status: { execute: (args: { runId: string }) => Promise<ToolResult> }
} {
  const env = ctx.env ?? process.env
  const ledger = SpendLedger.open(env)
  return {
    generate: {
      execute: async (args) => {
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
          const MEDIA_STAGES = ['master-asset', 'shot-assets', 'video', 'final-cut']
          if (args['rerunStage'] !== undefined) {
            const rs = String(args['rerunStage'])
            if (!MEDIA_STAGES.includes(rs)) return { ok: false, error: { code: 'bad-request', message: `rerunStage 须为媒体段（${MEDIA_STAGES.join('|')}）: ${rs}` } }
            ctx.runs.setStage(runId, rs, 'pending')
          }
          const recGates = ctx.runs.get(runId)?.gates ?? {}
          const effectiveGates = { ...ctx.vault.getGateDefaults(), ...recGates } as MachineDeps['gates']
          const approvals = Array.isArray(args['gateApprovals']) ? (args['gateApprovals'] as unknown[]).filter((s): s is string => typeof s === 'string') : []
          const channel = ctx.channel()
          let pricingMaybe = ctx.pricing
          if (pricingMaybe === undefined) pricingMaybe = await fetchPricing(channel, undefined, 15000).catch(() => null)
          const pricing = pricingMaybe
          const r = await advanceRun({
            runs: ctx.runs,
            runId,
            target: mapTarget(String(args['target'] ?? 'final')),
            channel,
            gates: effectiveGates,
            ask: async (stage) => approvals.includes(stage),
            providers: {
              forModel: (model, opts) =>
                ctx.providersOverride
                  ? ctx.providersOverride.forModel(model, opts)
                  : providerForModel(channel, model, {
                      fetchImpl: opts?.fetchImpl,
                      estimate: pricing ? (m: string) => estimateCny(m, pricing) : undefined,
                    }),
            },
            pricing: pricing,
            confirmer: async (est) => {
              if (ctx.confirmer) return ctx.confirmer(est)
              if (args['confirm'] === true) return true
              denied++
              return false
            },
            ffmpeg: locateFfmpeg(env),
            // 生产模型只来自当前默认通道 models[]；videoModel 仅保留 MachineDeps 的内部测试注入字段。
            tts: ctx.tts ?? configuredCloudTts(channel, env),
            concurrency: typeof args['concurrency'] === 'number' ? args['concurrency'] : undefined,
            fetchImpl: ctx.fetchImpl,
          })
          ledger.totals() // 触碰记账文件，保证 open 语义生效（空读容错）
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
                message: `有 ${denied} 笔消费需要确认（估价见 run 记账事件）。向用户转述成本后，携带 confirm:true 重新调用 vgen_generate 继续。`,
              },
            }
          }
          if (err instanceof ManualGateError) {
            return { ok: false, error: { code: 'manual-gate', message: `${err.message}。用法：vgen_provide { runId, stage, files: [{ path, shot?, name? }] }` } }
          }
          if (err instanceof AskGateRejectedError) {
            return { ok: false, error: { code: 'gate-approval', message: `${err.message}。请与用户确认该段执行，然后携带 gateApprovals（如 ["master-asset"]）重新调用；或改 gates 为 auto/manual。` } }
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
        '推进 run 的非 LLM 段：target=assets 生成角色三视图/场景主图/逐镜参考图；target=video 逐镜图生视频；target=final 配音并渲染成片 mp4+SRT。' +
        '首次调用不带 confirm；若返回 confirm-required，先向用户转述成本，再携带 confirm:true 重新调用。',
      parameters: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'run id（vgen_story 返回）' },
          target: { type: 'string', enum: ['assets', 'video', 'final'], description: '推进目标段（含其前序段）' },
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
      execute: (args: unknown) => tools.generate.execute(args as GenerateArgs),
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
