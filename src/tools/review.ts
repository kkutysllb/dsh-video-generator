/** vgen_review：两阶段质量评审闭环（规格 §5.3）。
 *  阶段A（无 score）：抽该镜成片 25/50/75% 三帧，返回路径 + 评分指引（会话模型用读图工具查看）。
 *  阶段B（带 score）：1-5 clamp 记录进 run.json；≤2 自动追加负面词重拍（每镜 ≤2 次，花费走 confirm 语义）；
 *  非法 score 兜底不重拍（review-invalid 事件留痕）。重拍后自动重新抽帧，闭环回阶段B。 */

import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join, basename } from 'node:path'
import type { VaultStore } from '../store/vault.ts'
import type { RunStore, RunEvent } from '../store/runs.ts'
import type { ChannelRef } from '../registry.ts'
import type { Provider } from '../provider.ts'
import { providerForModel } from '../registry.ts'
import { fetchPricing, estimateCny, type PricingTable } from '../pricing.ts'
import { locateFfmpeg } from '../finalcut/render-ffmpeg.ts'
import { extractReviewFrames } from '../review/frames.ts'
import { generateShotClip, SHOT_MOTION_PROMPT } from '../pipeline/shot-clip.ts'
import { GENERIC_NEGATIVE } from '../prompts.ts'
import { isExplicitModelUnavailable, ModelUnavailableError, modelUnavailableFrom, selectConfiguredModel } from '../model-selection.ts'
import { HandoffError } from '../schema/handoff.ts'
import type { ToolResult, DshToolDefinition } from './handoff.ts'

export interface ReviewContext {
  vault: VaultStore
  runs: RunStore
  /** 默认通道解析（与 vgen_generate 同一注入形态）。 */
  channel: () => ChannelRef
  env?: NodeJS.ProcessEnv
  /** undefined → 按需 fetchPricing（失败容错 null）；测试传 null 跳过。 */
  pricing?: PricingTable | null
  /** 测试注入：重拍花费确认。生产 = args.confirm 语义。 */
  confirmer?: (est: number | null) => Promise<boolean>
  providersOverride?: { forModel: (model: string, opts?: { fetchImpl?: typeof fetch }) => Provider }
  fetchImpl?: typeof fetch
  /** 测试注入：抽帧实现。 */
  extract?: typeof extractReviewFrames
  /** undefined → locateFfmpeg(env)。 */
  ffmpeg?: string | null
  videoModel?: string
}

export interface ReviewArgs {
  runId: string
  shot: number
  score?: number
  negativeHint?: string
  confirm?: boolean
}

const MAX_RETRIES = 2

function shotFileBase(shot: number): string {
  return `shot-${String(shot).padStart(3, '0')}`
}

function lastEventOf(events: RunEvent[], type: string): RunEvent | undefined {
  const hits = events.filter((e) => e.type === type)
  return hits.length ? hits[hits.length - 1] : undefined
}

export function buildReviewTools(ctx: ReviewContext): {
  review: { execute: (args: ReviewArgs) => Promise<ToolResult> }
} {
  const env = ctx.env ?? process.env
  return {
    review: {
      execute: async (args): Promise<ToolResult> => {
        try {
          const runId = typeof args?.runId === 'string' ? args.runId : ''
          const record = ctx.runs.get(runId)
          if (!record) throw new HandoffError('not-found', `run 不存在: ${runId}`)
          const shot = Number(args?.shot)
          if (!Number.isInteger(shot) || shot < 1 || shot > 200) throw new HandoffError('bad-request', `shot 须为 1..200 整数: ${args?.shot}`)
          const runDir = join(ctx.runs.rootDir, runId)
          const clip = join(runDir, 'clips', `${shotFileBase(shot)}.mp4`)
          const reviewDir = join(runDir, 'review', shotFileBase(shot))
          const key = `shot-${shot}`
          // 浅拷贝档案 + push + setReview 全量写回：依赖 run.json 单调用方串行读写（RunStore 同款约束）
          const entry = { ...(record.reviews?.[key] ?? { scores: [], retries: 0, passed: false }) }
          const ffmpeg = ctx.ffmpeg !== undefined ? ctx.ffmpeg : locateFfmpeg(env)
          const extract = ctx.extract ?? extractReviewFrames
          const fetchImpl = ctx.fetchImpl ?? fetch

          // ---- 阶段A：抽帧 ----
          if (args?.score === undefined) {
            if (!existsSync(clip)) throw new HandoffError('bad-request', `shot ${shot} 尚无成片片段：先完成 video 段（vgen_generate target=video）`)
            if (!ffmpeg) throw new Error('未找到 ffmpeg，无法抽帧（可设 VGEN_FFMPEG）')
            const frames = await extract(clip, reviewDir, ffmpeg)
            ctx.runs.appendEvent(runId, 'review-frames', { shot, frames })
            return {
              ok: true,
              value: {
                runId, shot, frames, retriesUsed: entry.retries,
                next: '用读图工具逐帧查看（构图/角色一致性/画面畸变），再携带 score（1-5 整数）重调 vgen_review：≥3 记通过；≤2 自动追加负面词重拍（每镜至多 2 次）',
              },
            }
          }

          // ---- 阶段B：评分 ----
          const raw: unknown = args.score
          if (typeof raw !== 'number' || !Number.isFinite(raw)) {
            ctx.runs.appendEvent(runId, 'review-invalid', { shot, raw: String(raw).slice(0, 80) })
            return { ok: true, value: { runId, shot, action: 'ignored', reason: 'score 须为 1-5 有限数字；本次不重拍' } }
          }
          const score = Math.min(5, Math.max(1, Math.round(raw)))
          entry.scores.push(score)

          if (score >= 3) {
            entry.passed = true
            ctx.runs.setReview(runId, key, entry)
            ctx.runs.appendEvent(runId, 'review', { shot, score, action: 'passed' })
            return { ok: true, value: { runId, shot, action: 'passed', score, scores: entry.scores, retriesUsed: entry.retries } }
          }

          if (entry.retries >= MAX_RETRIES) {
            ctx.runs.setReview(runId, key, entry)
            ctx.runs.appendEvent(runId, 'review', { shot, score, action: 'retry-exhausted' })
            return {
              ok: true,
              value: {
                runId, shot, action: 'retry-exhausted', score, scores: entry.scores, retriesUsed: entry.retries,
                next: `重拍已达上限 ${MAX_RETRIES} 次：建议人工处理（vgen_provide 注入替换片段）或调整分镜后 vgen_generate rerunStage=video 重跑`,
              },
            }
          }

          // ---- 重拍 ----
          if (!existsSync(clip)) throw new HandoffError('bad-request', `shot ${shot} 尚无成片片段，无可重拍`)
          const urlsEv = lastEventOf(record.events, 'shot-urls')
          const urls = (urlsEv?.detail as { urls?: Array<{ index: number; url: string; file: string }> } | undefined)?.urls ?? []
          const shotUrl = urls.find((u) => u.index === shot)?.url ?? ''
          if (!shotUrl) {
            throw new HandoffError('bad-request', `shot ${shot} 参考图无公网 URL（可能为手动提供）：无法自动重拍，先 vgen_generate rerunStage=shot-assets 重新生成参考图后再评审`)
          }
          const sbFile = join(runDir, 'storyboard.json')
          if (!existsSync(sbFile)) throw new Error(`run ${runId} 缺少 storyboard.json，无法重拍`)
          const sb = JSON.parse(readFileSync(sbFile, 'utf8')) as { shots: Array<{ index: number; durationSec?: number }> }
          const durationSec = sb.shots.find((s) => s.index === shot)?.durationSec ?? 5

          const hint = typeof args.negativeHint === 'string' ? args.negativeHint.trim() : ''
          const negatives = [...GENERIC_NEGATIVE, ...(hint ? [hint] : [])]
          const prompt = `${SHOT_MOTION_PROMPT}。负面要求：${negatives.join('、')}`

          // 花费确认（与 vgen_generate 同语义）
          const channel = ctx.channel()
          let pricingMaybe = ctx.pricing
          if (pricingMaybe === undefined) pricingMaybe = await fetchPricing(channel, undefined, 15000).catch(() => null)
          const pricing = pricingMaybe
          const videoModel = ctx.videoModel ?? selectConfiguredModel(channel, 'video')
          const provider = ctx.providersOverride
            ? ctx.providersOverride.forModel(videoModel, { fetchImpl })
            : providerForModel(channel, videoModel, { fetchImpl, estimate: pricing ? (m: string) => estimateCny(m, pricing) : undefined })
          if (!provider.capabilities.imageToVideo) {
            throw modelUnavailableFrom(channel, 'video', videoModel, `Provider ${provider.id} 不支持 image-to-video`)
          }
          const est = pricing ? estimateCny(videoModel, pricing) : null
          let approved = false
          if (ctx.confirmer) approved = await ctx.confirmer(est)
          else if (args.confirm === true) approved = true
          if (!approved) {
            return {
              ok: false,
              error: { code: 'confirm-required', message: `重拍 shot ${shot} 需 1 次视频生成（估价 ${est ?? 'unknown'} CNY）：向用户转述成本后携带 confirm:true 重调` },
            }
          }

          const backup = join(runDir, 'clips', `${shotFileBase(shot)}.rejected-${entry.retries + 1}.mp4`)
          renameSync(clip, backup)
          try {
            await generateShotClip({
              provider, fetchImpl, imageUrl: shotUrl, prompt, durationSec, outFile: clip,
              pollDelayMs: pollDelayFromEnv(env),
              // spend 事件在 submit 成功即落（与 machine video 段同序）：重拍中途失败花费也有账
              onSubmit: (jobId) => {
                ctx.runs.appendEvent(runId, 'spend', { stage: 'video', model: videoModel, estCny: est, shot, jobId: jobId.slice(0, 80) })
              },
            })
          } catch (err) {
            if (err instanceof ModelUnavailableError || isExplicitModelUnavailable(err)) {
              if (existsSync(clip)) rmSync(clip)
              renameSync(backup, clip)
              throw err instanceof ModelUnavailableError
                ? err
                : modelUnavailableFrom(channel, 'video', videoModel, err instanceof Error ? err.message : String(err))
            }
            // 无条件回滚：saveUrl 中途失败可能留下半截新片，先删再复位旧片（备份恒存在——刚 rename 过来的）
            if (existsSync(clip)) rmSync(clip)
            renameSync(backup, clip)
            ctx.runs.appendEvent(runId, 'reshoot-failed', { shot, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) })
            throw err
          }
          entry.retries += 1
          ctx.runs.setReview(runId, key, entry)
          ctx.runs.appendEvent(runId, 'reshoot', { shot, score, retry: entry.retries, prompt: prompt.slice(0, 200), backup: basename(backup) })

          let frames: string[] = []
          if (ffmpeg) {
            try { frames = await extract(clip, reviewDir, ffmpeg) } catch { frames = [] }
          }
          return {
            ok: true,
            value: {
              runId, shot, action: 'reshoot', score, retriesUsed: entry.retries, clip, frames,
              next: frames.length
                ? '重新查看新帧后再次携带 score 调用 vgen_review（剩余重拍次数 ' + (MAX_RETRIES - entry.retries) + '）'
                : '重拍完成但抽帧失败（可手动查看新片段后再次评分）',
            },
          }
        } catch (err) {
          if (err instanceof ModelUnavailableError) return { ok: false, error: { code: err.code, message: err.message } }
          if (err instanceof HandoffError) return { ok: false, error: { code: err.code, message: err.message } }
          return { ok: false, error: { code: 'internal', message: err instanceof Error ? err.message : String(err) } }
        }
      },
    },
  }
}

/** VGEN_POLL_DELAY_MS 环境覆盖（demo 提速用），未设/非法 → undefined（走缺省 1000）。 */
function pollDelayFromEnv(env: NodeJS.ProcessEnv): number | undefined {
  const v = Number(env['VGEN_POLL_DELAY_MS'])
  return Number.isFinite(v) && v > 0 ? v : undefined
}

export function reviewToolDefs(tools: ReturnType<typeof buildReviewTools>): DshToolDefinition[] {
  const jsonRender = (_args: unknown, value: unknown): Array<{ type: string; text: string }> => [
    { type: 'text', text: JSON.stringify(value) },
  ]
  return [
    {
      name: 'vgen_review',
      description:
        '单镜质量评审闭环：不带 score 调用 → 返回成片 25/50/75% 三帧路径（用读图工具查看后评分）；带 score（1-5 整数）重调 → ≥3 记通过，≤2 自动追加负面词重拍（每镜至多 2 次；重拍花费走 confirm-required 语义）。评分与重拍次数记录进 run.json。',
      parameters: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'run id' },
          shot: { type: 'number', description: '镜头 index（1 起）' },
          score: { type: 'number', description: '评分 1-5（整数，越界 clamp）；缺省 = 抽帧阶段' },
          negativeHint: { type: 'string', description: '可选：重拍追加负面词（如"肢体扭曲"）' },
          confirm: { type: 'boolean', description: '重拍成本确认；收到 confirm-required 后向用户转述成本再置 true' },
        },
        required: ['runId', 'shot'],
      },
      output: { schema: { type: 'object' }, render: jsonRender },
      timeoutMs: 600000,
      execute: (args: unknown) => tools.review.execute(args as ReviewArgs),
    },
  ]
}
