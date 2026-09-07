/** DSH 插件入口：cordis 风格注册 webServer 路由（effect 生命周期管理）。 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { VaultStore } from '../store/vault.ts'
import { RunStore } from '../store/runs.ts'
import { probeChannel } from '../probe.ts'
import { buildHandoffTools, handoffToolDefs, type HandoffTools, type DshToolDefinition } from '../tools/handoff.ts'
import { buildGenerateTools, generateToolDefs } from '../tools/generate.ts'
import { buildProvideTools, provideToolDefs } from '../tools/provide.ts'
import { buildReviewTools, reviewToolDefs } from '../tools/review.ts'
import { buildChannelsTools, channelsToolDefs } from '../tools/channels.ts'
import type { ChannelRef } from '../registry.ts'
import { PLUGIN_ID, handleApi, healthPayload, isLoopbackRequest } from './routes.ts'

export const name = PLUGIN_ID

/** cordis 依赖声明：这些服务就绪后才 apply（对齐 super-ppts 的模块级 inject 约定）。 */
export const inject = ['webServer', 'tools', 'systemPrompt']

/** Agent 能力通告：能力 + 三段交接工作流 + JSON 形状简例（不重复技能正文，避免上下文膨胀）。 */
export const vgenGuidance = `本机已安装 dsh-video-generator 插件（短视频/短剧生成管线）。三段交接工作流：会话模型自己产出结构化 JSON 并依次调用 vgen_story → vgen_script → vgen_storyboard，之后接 vgen_generate（素材/成片生成，M3b 提供）。
1) vgen_story 提交故事 JSON 开新 run：{ title, logline, style, characters: [{ id（^[a-z0-9_-]+$，≤48）, name, appearance }], chapters: [...] }，title ≤200、logline/appearance ≤500、characters ≤20、chapters ≤50（每条 ≤200）；
2) vgen_script 提交剧本 JSON 挂到 runId：story 字段 + scenes: [{ id, name, description, characters: [id] }]、dialog: [{ sceneId, characterId, line }]，引用的 characterId/sceneId 必须存在，dialog ≤200 条；
3) vgen_storyboard 提交分镜数组挂到 runId：每镜 { index（从 1 连续）, line（镜头台词）, prompt（手写画面描述）, characterIds: [id], sceneId?, camera?, durationSec 2..10, voiceHint? }，工具自动注入四层提示词（风格、运镜、角色锚、参考图提示）并落盘；
未知 runId 报 not-found，缺字段/超限/引用错误报 bad-request（错误信封 { ok: false, error: { code, message } }）。
4) vgen_generate 推进非 LLM 段：{ runId, target: 'assets'|'video'|'final', confirm? }——assets 出角色三视图/场景主图/逐镜参考图，video 逐镜图生视频，final 配音并渲染成片 mp4+SRT；首次调用不带 confirm，若返回 confirm-required（error.code），先向用户转述成本再携带 confirm:true 重调；
5) vgen_status { runId } 随时查进度（各段状态 + 最近事件）。`


interface WebServerFace {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

interface ToolsFace {
  register(def: DshToolDefinition): () => void
}

interface SystemPromptFace {
  section(spec: { name: string; order: number; text: string }): () => void
}

/** wire 层收到的 ctx 面（effect 为 cordis ctx 自带；systemPrompt 做软探测防宿主版本差异崩载）。 */
interface HostContext {
  webServer: WebServerFace
  tools: ToolsFace
  systemPrompt?: SystemPromptFace
  effect(fn: () => () => void, name?: string): () => void
}

const SECTION_ORDER = 207

/** 请求体超限：显式字段形式（erasableSyntaxOnly 禁参数属性），接线 catch 借此区分 413/400。 */
class BodyTooLargeError extends Error {}

function registerHandoffTools(ctx: HostContext, handoff: HandoffTools): Array<() => void> {
  return handoffToolDefs(handoff).map((def) => ctx.tools.register(def))
}

export function apply(ctx: HostContext): () => void {
  const vault = VaultStore.open({ env: process.env })
  const runs = RunStore.open({ env: process.env })
  const web = ctx.webServer

  const disposers: Array<() => void> = []
  // Agent 能力通告：软探测 section 可用性（漏声明 inject 宿主会抛 without inject，这里 tolerance 防崩载）。
  const sectionAvailable = typeof ctx.systemPrompt?.section === 'function'
  if (sectionAvailable) {
    disposers.push(
      ctx.systemPrompt!.section({ name: `plugin:${PLUGIN_ID}`, order: SECTION_ORDER, text: vgenGuidance }),
    )
  }
  // 原生工具：直接注册（super-ppts 模式，不用回调式 inject）。
  const handoff = buildHandoffTools({ vault, runs })
  // 默认通道解析：generate 与 review 共用（按当前 defaultChannelId 现取，切通道即时生效）。
  const resolveChannel = (): ChannelRef => {
    const d = vault.load().defaultChannelId
    const c = d ? vault.getChannel(d) : null
    if (!c) throw new Error('未配置生成通道：请先在设置页「通道管理」添加通道')
    return { id: c.id, baseUrl: c.baseUrl, apiKey: c.apiKey }
  }
  const generateTools = buildGenerateTools({ vault, runs, channel: resolveChannel })
  const provideTools = buildProvideTools({ runs, env: process.env })
  const reviewTools = buildReviewTools({ vault, runs, channel: resolveChannel })
  const channelsTools = buildChannelsTools({ vault, runs })
  for (const dispose of [
    ...registerHandoffTools(ctx, handoff),
    ...generateToolDefs(generateTools).map((def) => ctx.tools.register(def)),
    ...provideToolDefs(provideTools).map((def) => ctx.tools.register(def)),
    ...reviewToolDefs(reviewTools).map((def) => ctx.tools.register(def)),
    ...channelsToolDefs(channelsTools).map((def) => ctx.tools.register(def)),
  ]) {
    disposers.push(dispose)
  }

  ctx.effect(
    () =>
      web.register({
        kind: 'exact',
        path: `/${PLUGIN_ID}/health`,
        handler: (_req, res) => json(res, 200, healthPayload({ vault, runs })),
      }),
    `${PLUGIN_ID}: health route`,
  )

  ctx.effect(
    () =>
      web.register({
        kind: 'exact',
        path: `/${PLUGIN_ID}/runs`,
        handler: (_req, res) => json(res, 200, { ok: true, value: { runs: runs.list() } }),
      }),
    `${PLUGIN_ID}: runs route`,
  )

  ctx.effect(
    () =>
      web.register({
        kind: 'prefix',
        // webserver.match() 按 `${prefix}/` 前缀匹配子路径，注册路径不能带尾斜杠
        path: `/${PLUGIN_ID}/api`,
        handler: async (req, res) => {
          if (!isLoopbackRequest(req.headers.host, req.socket.remoteAddress)) {
            json(res, 403, { ok: false, error: { code: 'forbidden', message: '仅限本机回环访问' } })
            return
          }
          if (req.method !== 'POST') {
            json(res, 405, { ok: false, error: { code: 'method-not-allowed', message: '仅 POST' } })
            return
          }
          const methodName = (req.url ?? '').split('/api/')[1]?.split('?')[0] ?? ''
          let body: Record<string, unknown> = {}
          try {
            body = await readJsonBody(req)
          } catch (err) {
            if (err instanceof BodyTooLargeError) {
              json(res, 413, { ok: false, error: { code: 'too-large', message: '请求体超过 1MB' } })
            } else {
              json(res, 400, { ok: false, error: { code: 'bad-json', message: '请求体非法 JSON' } })
            }
            return
          }
          const envelope = await handleApi({ vault, runs, probe: probeChannel }, methodName, body)
          json(res, envelope.ok ? 200 : errorStatus(envelope), envelope)
        },
      }),
    `${PLUGIN_ID}: api face`,
  )

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // 回收失败不阻断卸载
      }
    }
  }
}

function errorStatus(envelope: { ok: boolean; error?: { code: string } }): number {
  const code = envelope.error?.code
  if (code === 'not-found') return 404
  if (code === 'conflict') return 409
  if (code === 'forbidden') return 403
  if (code === 'bad-request' || code === 'unknown-method' || code === 'bad-json') return 400
  return 500
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

async function readJsonBody(req: IncomingMessage, limitBytes = 1 << 20): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > limitBytes) throw new BodyTooLargeError()
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  // 形状守卫：JSON.parse 后必须为对象（null/数组/标量一律 400，防 null args 打穿下游 dispatch）。
  const parsed: unknown = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('body must be a json object')
  }
  return parsed as Record<string, unknown>
}
