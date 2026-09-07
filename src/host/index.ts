/** DSH 插件入口：cordis 风格注册 webServer 路由（effect 生命周期管理）。 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { copyFileSync, createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VaultStore } from '../store/vault.ts'
import { RunStore } from '../store/runs.ts'
import { probeChannel } from '../probe.ts'
import { buildHandoffTools, handoffToolDefs, type HandoffTools, type DshToolDefinition } from '../tools/handoff.ts'
import { buildGenerateTools, generateToolDefs } from '../tools/generate.ts'
import { buildProvideTools, provideToolDefs } from '../tools/provide.ts'
import { buildReviewTools, reviewToolDefs } from '../tools/review.ts'
import { buildChannelsTools, channelsToolDefs } from '../tools/channels.ts'
import type { ChannelRef } from '../registry.ts'
import { PLUGIN_ID, handleApi, healthPayload, isLoopbackRequest, resolveMediaPath, mediaContentType } from './routes.ts'

export const name = PLUGIN_ID

/** cordis 依赖声明：这些服务就绪后才 apply（对齐 super-ppts 的模块级 inject 约定）。 */
export const inject = ['webServer', 'tools', 'systemPrompt']

/** Agent 能力通告：能力 + 三段交接工作流 + JSON 形状简例 + M4 工具面（不重复技能正文，避免上下文膨胀）。 */
export const vgenGuidance = `本机已安装 dsh-video-generator 插件（短视频/短剧/漫剧生成管线，竖屏 9:16 成片 mp4+SRT）。三段交接工作流：会话模型自己产出结构化 JSON 并依次调用 vgen_story → vgen_script → vgen_storyboard，之后接 vgen_generate 推进非 LLM 段。
1) vgen_story 提交故事 JSON 开新 run：{ title, logline, style, characters: [{ id（^[a-z0-9_-]+$，≤48）, name, appearance }], chapters: [...] }；
2) vgen_script 提交剧本 JSON：scenes: [{ id, name, description, characters: [id] }]、dialog: [{ sceneId, characterId, line }]，引用必须存在；
3) vgen_storyboard 提交分镜数组：每镜 { index（从 1 连续）, line, prompt, characterIds, sceneId?, camera?, durationSec 2..10, voiceHint? }，工具自动注入四层提示词；
4) vgen_generate { runId, target: 'assets'|'video'|'final', confirm?, concurrency?, gates?, gateApprovals?, rerunStage? }：assets 出角色三视图/场景主图/逐镜参考图，video 逐镜图生视频，final 配音并渲染成片。首次不带 confirm；返回 confirm-required（error.code）→ 向用户转述成本后 confirm:true 重调；gate-approval → 用户批准后 gateApprovals:["段名"] 重调；manual-gate → 收用户文件走 vgen_provide；重做某段 → rerunStage（媒体段重置 pending）；
5) vgen_status { runId }：进度 + gates + reviews + 最近事件；
6) vgen_review { runId, shot, score?, negativeHint?, confirm? } 质量闭环：不带 score → 返回成片 25/50/75% 三帧路径（用读图工具逐帧查看后评分）；带 score 1-5 → ≥3 记通过；≤2 自动追加负面词重拍（每镜 ≤2 次，重拍花费同 confirm 语义），重拍后返回新帧继续评；
7) vgen_provide { runId, stage, files: [{ path, shot?, name? }] }：manual gate 产物注入（master-asset 文件名 char-*/scene-*；shot-assets/video 逐镜 shot 号，video 须全镜覆盖且时长≥0.5s；final-cut 首文件 .mp4 注入后 run 直接 done）；
8) vgen_channels { action: 'list'|'health'|'spend' }：通道面板（脱敏列表/探测健康+估价/累计消耗）。
用户通道在 Web 设置页「视频工坊」管理（三要素自配，官方/中转皆可）。注意：happyhorse 等免费档视频模型可能带平台水印，介意请提醒用户换付费模型。错误信封 { ok: false, error: { code, message } }；未知 runId = not-found。`


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

/** 包根：lib/host/index.js（构建产物）与 src/host/index.ts（测试直跑）上溯两级均为包根。 */
function packageRoot(): string {
  return fileURLToPath(new URL('../../', import.meta.url))
}

/** 预设安装（super-ppts 模式，幂等）：写 ~/.dsh 与 ~/.kcoder 双候选目录
 *  （宿主品牌 home 分叉期的双保险），任一失败静默——预设缺失不阻断插件加载。 */
function ensurePresetInstalled(): void {
  try {
    const src = resolve(packageRoot(), 'presets')
    if (!existsSync(src)) return
    for (const base of ['.dsh', '.kcoder']) {
      try {
        const dest = join(homedir(), base, '.agent-presets', 'dsh-video-generator')
        mkdirSync(dest, { recursive: true })
        for (const f of ['preset.yml', 'agent.cordis.yml']) {
          const p = join(src, f)
          if (existsSync(p)) copyFileSync(p, join(dest, f))
        }
      } catch {
        // 单目录失败不影响另一目录
      }
    }
  } catch {
    // 预设安装失败不阻断插件加载
  }
}

export function apply(ctx: HostContext): () => void {
  ensurePresetInstalled()
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
        kind: 'prefix',
        path: `/${PLUGIN_ID}/runs`,
        handler: async (req, res) => {
          const pathname = (req.url ?? '').split('?')[0] ?? ''
          if (pathname === `/${PLUGIN_ID}/runs` || pathname === `/${PLUGIN_ID}/runs/`) {
            json(res, 200, { ok: true, value: { runs: runs.list() } })
            return
          }
          const m = new RegExp(`^/${PLUGIN_ID}/runs/([^/?#]+)$`).exec(pathname)
          if (!m) {
            json(res, 404, { ok: false, error: { code: 'not-found', message: '未知路径' } } as const)
            return
          }
          if (!isLoopbackRequest(req.headers.host, req.socket.remoteAddress)) {
            json(res, 403, { ok: false, error: { code: 'forbidden', message: '仅限本机回环访问' } } as const)
            return
          }
          const envelope = await handleApi({ vault, runs, probe: probeChannel }, 'runs.get', { id: decodeURIComponent(m[1]!) })
          json(res, envelope.ok ? 200 : errorStatus(envelope), envelope)
        },
      }),
    `${PLUGIN_ID}: runs routes`,
  )

  ctx.effect(
    () =>
      web.register({
        kind: 'prefix',
        path: `/${PLUGIN_ID}/media`,
        handler: (req, res) => {
          if (!isLoopbackRequest(req.headers.host, req.socket.remoteAddress)) {
            json(res, 403, { ok: false, error: { code: 'forbidden', message: '仅限本机回环访问' } })
            return
          }
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            json(res, 405, { ok: false, error: { code: 'method-not-allowed', message: '仅 GET/HEAD' } })
            return
          }
          let pathname: string
          try {
            // urlPath 按契约须已 decode：这里集中 decode 一次，失败 400；再剥 '/dsh-video-generator' 前缀得 '/media/...'
            pathname = decodeURIComponent((req.url ?? '').split('?')[0] ?? '').slice(PLUGIN_ID.length + 1)
          } catch {
            json(res, 400, { ok: false, error: { code: 'bad-url', message: 'URL 解码失败' } })
            return
          }
          const file = resolveMediaPath(runs.rootDir, pathname)
          if (!file || !existsSync(file) || !statSync(file).isFile()) {
            json(res, 404, { ok: false, error: { code: 'not-found', message: '产物不存在' } })
            return
          }
          const stat = statSync(file)
          res.statusCode = 200
          res.setHeader('content-type', mediaContentType(basename(file)))
          res.setHeader('content-length', String(stat.size))
          res.setHeader('cache-control', 'no-store')
          if (req.method === 'HEAD') {
            res.end()
            return
          }
          const stream = createReadStream(file)
          stream.on('error', () => {
            res.destroy()
          })
          stream.pipe(res)
        },
      }),
    `${PLUGIN_ID}: media route`,
  )

  ctx.effect(
    () =>
      web.register({
        kind: 'exact',
        path: `/${PLUGIN_ID}/channels`,
        handler: async (req, res) => {
          if (!isLoopbackRequest(req.headers.host, req.socket.remoteAddress)) {
            json(res, 403, { ok: false, error: { code: 'forbidden', message: '仅限本机回环访问' } })
            return
          }
          const envelope = await handleApi({ vault, runs, probe: probeChannel }, 'channels.list', {})
          json(res, envelope.ok ? 200 : errorStatus(envelope), envelope)
        },
      }),
    `${PLUGIN_ID}: channels route`,
  )

  ctx.effect(
    () =>
      web.register({
        kind: 'exact',
        path: `/${PLUGIN_ID}/settings`,
        handler: async (req, res) => {
          if (!isLoopbackRequest(req.headers.host, req.socket.remoteAddress)) {
            json(res, 403, { ok: false, error: { code: 'forbidden', message: '仅限本机回环访问' } })
            return
          }
          if (req.method !== 'POST') {
            json(res, 405, { ok: false, error: { code: 'method-not-allowed', message: '仅 POST' } })
            return
          }
          let body: Record<string, unknown> = {}
          try {
            body = await readJsonBody(req)
          } catch (err) {
            if (err instanceof BodyTooLargeError) json(res, 413, { ok: false, error: { code: 'too-large', message: '请求体超过 1MB' } })
            else json(res, 400, { ok: false, error: { code: 'bad-json', message: '请求体非法 JSON' } })
            return
          }
          const envelope = await handleApi({ vault, runs, probe: probeChannel }, 'settings.update', body)
          json(res, envelope.ok ? 200 : errorStatus(envelope), envelope)
        },
      }),
    `${PLUGIN_ID}: settings route`,
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
