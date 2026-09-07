/** vgen_provide：manual gate 产物注入（规格 §5.2）。用户在会话中给出本地文件路径，
 *  插件按段校验（存在/非空/命名/全镜覆盖/时长）后拷贝进 run 目录并置段 done，管线接管。
 *  约束：注入 shot-assets 后 video 段自动 i2v 不可用（无公网 URL），响应内显式警示。 */

import { copyFileSync, existsSync, statSync, mkdirSync, readFileSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import type { RunStore } from '../store/runs.ts'
import { locateFfmpeg, probeDurationSec } from '../finalcut/render-ffmpeg.ts'
import { HandoffError } from '../schema/handoff.ts'
import type { ToolResult, DshToolDefinition } from './handoff.ts'

export type ProvideStage = 'master-asset' | 'shot-assets' | 'video' | 'final-cut'
const PROVIDE_STAGES: readonly ProvideStage[] = ['master-asset', 'shot-assets', 'video', 'final-cut']

export interface ProvideFile {
  path: string
  shot?: number
  name?: string
}

export interface ProvideArgs {
  runId: string
  stage: ProvideStage
  files: ProvideFile[]
}

export interface ProvideContext {
  runs: RunStore
  env?: NodeJS.ProcessEnv
  /** undefined → locateFfmpeg(env)；null = 无 ffmpeg（video 段时长校验拒绝）。测试注入。 */
  ffmpeg?: string | null
  /** 测试注入：时长探测。 */
  probe?: (file: string, ffmpeg: string) => Promise<number | null>
}

const ASSET_NAME_RE = /^(char|scene)-[a-z0-9_-]+\.(png|jpe?g|webp)$/i
const MIN_CLIP_SEC = 0.5

function isProvideStage(s: unknown): s is ProvideStage {
  return typeof s === 'string' && (PROVIDE_STAGES as readonly string[]).includes(s)
}

function shotName(shot: number, ext: string): string {
  return `shot-${String(shot).padStart(3, '0')}${ext}`
}

export function buildProvideTools(ctx: ProvideContext): {
  provide: { execute: (args: ProvideArgs) => Promise<ToolResult> }
} {
  const env = ctx.env ?? process.env
  const probe = ctx.probe ?? probeDurationSec
  return {
    provide: {
      execute: async (args): Promise<ToolResult> => {
        try {
          const runId = typeof args?.runId === 'string' ? args.runId : ''
          if (!ctx.runs.get(runId)) throw new HandoffError('not-found', `run 不存在: ${runId}`)
          const stage = args?.stage
          if (!isProvideStage(stage)) throw new HandoffError('bad-request', `stage 须为 ${PROVIDE_STAGES.join('|')}: ${String(args?.stage)}`)
          const files = args?.files
          if (!Array.isArray(files) || files.length === 0 || files.length > 200) throw new HandoffError('bad-request', 'files 须为 1..200 项数组')
          // 通用存在性校验（先全验后拷贝，不半注入）
          for (const f of files) {
            if (typeof f?.path !== 'string' || !f.path) throw new HandoffError('bad-request', 'files[].path 须为非空字符串')
            if (!existsSync(f.path) || !statSync(f.path).isFile() || statSync(f.path).size === 0) {
              throw new HandoffError('bad-request', `文件不存在或为空: ${f.path}`)
            }
          }
          const runDir = join(ctx.runs.rootDir, runId)
          const warnings: string[] = []
          let ingested = 0

          if (stage === 'master-asset') {
            const dest = join(runDir, 'assets')
            const planned = files.map((f) => {
              const name = String(f.name ?? '').trim().toLowerCase()
              if (!ASSET_NAME_RE.test(name)) throw new HandoffError('bad-request', `master-asset 文件名须为 char-<id>.png / scene-<id>.png 形态: ${f.name ?? '(缺)'}`)
              return { src: f.path!, dest: join(dest, name) }
            })
            mkdirSync(dest, { recursive: true, mode: 0o700 })
            for (const p of planned) { copyFileSync(p.src, p.dest); ingested++ }
          } else if (stage === 'shot-assets') {
            const dest = join(runDir, 'shots')
            mkdirSync(dest, { recursive: true, mode: 0o700 })
            const urls: Array<{ index: number; url: string; file: string }> = []
            for (const f of files) {
              const shot = Number(f.shot)
              if (!Number.isInteger(shot) || shot < 1) throw new HandoffError('bad-request', `shot-assets 每项须带 shot（≥1 整数）: ${JSON.stringify(f)}`)
              const ext = extname(f.path!).toLowerCase() || '.png'
              const out = join(dest, shotName(shot, ext))
              copyFileSync(f.path!, out)
              urls.push({ index: shot, url: '', file: out })
              ingested++
            }
            urls.sort((a, b) => a.index - b.index)
            ctx.runs.appendEvent(runId, 'shot-urls', { urls })
            warnings.push('手动参考图无公网 URL：video 段自动 i2v 需要 URL。若需继续自动生成视频，请将 shot-assets gate 切回 auto 并 vgen_generate rerunStage=shot-assets 重新生成；或后续 video 段也用 vgen_provide 手动注入。')
          } else if (stage === 'video') {
            const sbFile = join(runDir, 'storyboard.json')
            if (!existsSync(sbFile)) throw new HandoffError('bad-request', `run ${runId} 缺少 storyboard.json：请先完成分镜段`)
            const sb = JSON.parse(readFileSync(sbFile, 'utf8')) as { shots: Array<{ index: number }> }
            const dest = join(runDir, 'clips')
            // 先全验后拷（真不半注入）：shot 号 → 全镜覆盖 → ffmpeg → 时长，全过才落盘；
            // 旧序（拷后验）失败会把残留 clip 留在 clips/ 被下次覆盖校验误计入。
            const planned = files.map((f) => {
              const shot = Number(f.shot)
              if (!Number.isInteger(shot) || shot < 1) throw new HandoffError('bad-request', `video 每项须带 shot（≥1 整数）: ${JSON.stringify(f)}`)
              return { shot, src: f.path!, dest: join(dest, shotName(shot, '.mp4')) }
            })
            // 全镜覆盖校验：storyboard 每一镜的 clip 都必须在位（本次注入或此前已存在）
            const providedIdx = new Set(planned.map((p) => p.shot))
            const missing: number[] = []
            const clipFiles: string[] = []
            for (const s of sb.shots) {
              const p = join(dest, shotName(s.index, '.mp4'))
              if (providedIdx.has(s.index) || existsSync(p)) clipFiles.push(p)
              else missing.push(s.index)
            }
            if (missing.length) throw new HandoffError('bad-request', `video 段缺少镜头: ${missing.join(', ')}（须覆盖 storyboard 全部 ${sb.shots.length} 镜）`)
            // 时长校验（鲸影规则层继承：≥0.5s）；ffmpeg 缺失是环境问题非请求错误 → 普通 Error 走 internal 信封（对齐 review.ts）
            const ffmpeg = ctx.ffmpeg !== undefined ? ctx.ffmpeg : locateFfmpeg(env)
            if (!ffmpeg) throw new Error('未找到 ffmpeg，无法校验片段时长（可设 VGEN_FFMPEG）')
            const checkDuration = async (file: string): Promise<void> => {
              const dur = await probe(file, ffmpeg)
              if (dur === null) throw new HandoffError('bad-request', `无法读取片段时长: ${basename(file)}`)
              if (dur < MIN_CLIP_SEC) throw new HandoffError('bad-request', `片段 ${basename(file)} 时长 ${dur}s < ${MIN_CLIP_SEC}s`)
            }
            for (const p of planned) await checkDuration(p.src)
            // 此前已在位的 clip（非本次注入）同样过时长关，保持旧校验强度
            for (const p of clipFiles) {
              if (!planned.some((q) => q.dest === p)) await checkDuration(p)
            }
            mkdirSync(dest, { recursive: true, mode: 0o700 })
            for (const p of planned) { copyFileSync(p.src, p.dest); ingested++ }
            clipFiles.sort()
            ctx.runs.appendEvent(runId, 'clips', { files: clipFiles })
          } else {
            // final-cut：files[0] = mp4（必须 .mp4），files[1] 可选 = srt
            const mp4 = files[0]!
            if (extname(mp4.path!).toLowerCase() !== '.mp4') throw new HandoffError('bad-request', `final-cut 首文件须为 .mp4: ${basename(mp4.path!)}`)
            copyFileSync(mp4.path!, join(runDir, 'final.mp4'))
            ingested++
            const srt = files[1]
            if (srt) {
              if (extname(srt.path!).toLowerCase() !== '.srt') throw new HandoffError('bad-request', `final-cut 第二文件须为 .srt: ${basename(srt.path!)}`)
              copyFileSync(srt.path!, join(runDir, 'final.srt'))
              ingested++
            } else {
              warnings.push('未提供 final.srt：成片无字幕文件（不影响 final.mp4）')
            }
            ctx.runs.appendEvent(runId, 'final', { output: join(runDir, 'final.mp4'), srt: srt ? join(runDir, 'final.srt') : null, manual: true })
          }

          ctx.runs.setStage(runId, stage, 'done')
          if (stage === 'final-cut') ctx.runs.setStatus(runId, 'done')
          ctx.runs.appendEvent(runId, 'manual-provided', { stage, count: ingested })
          return { ok: true, value: { runId, stage, ingested, stageState: 'done', warnings } }
        } catch (err) {
          if (err instanceof HandoffError) return { ok: false, error: { code: err.code, message: err.message } }
          return { ok: false, error: { code: 'internal', message: err instanceof Error ? err.message : String(err) } }
        }
      },
    },
  }
}

export function provideToolDefs(tools: ReturnType<typeof buildProvideTools>): DshToolDefinition[] {
  const jsonRender = (_args: unknown, value: unknown): Array<{ type: string; text: string }> => [
    { type: 'text', text: JSON.stringify(value) },
  ]
  return [
    {
      name: 'vgen_provide',
      description:
        'manual gate 产物注入：把用户提供的本地文件校验后接管进管线。stage=master-asset（files[].name 须为 char-<id>.png/scene-<id>.png）；shot-assets/video（files[].shot 必填；video 须覆盖全部镜头且时长≥0.5s，需 ffmpeg）；final-cut（首文件 .mp4，可选第二文件 .srt，注入后 run 直接 done）。',
      parameters: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'run id' },
          stage: { type: 'string', enum: ['master-asset', 'shot-assets', 'video', 'final-cut'], description: '注入目标段' },
          files: {
            type: 'array',
            description: '文件清单：[{ path: 本地绝对路径, shot?: 镜头号(shot-assets/video 必填), name?: 目标文件名(master-asset 必填) }]',
          },
        },
        required: ['runId', 'stage', 'files'],
      },
      output: { schema: { type: 'object' }, render: jsonRender },
      timeoutMs: 60000,
      execute: (args: unknown) => tools.provide.execute(args as ProvideArgs),
    },
  ]
}
