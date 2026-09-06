/** DSH 插件入口：cordis 风格注册 webServer 路由（effect 生命周期管理）。 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { VaultStore } from '../store/vault.ts'
import { RunStore } from '../store/runs.ts'
import { probeChannel } from '../probe.ts'
import { PLUGIN_ID, handleApi, healthPayload, isLoopbackRequest } from './routes.ts'

export const name = PLUGIN_ID

/** cordis 依赖声明：webServer 服务就绪后才 apply（对齐 dsh-super-ppts 的模块级 inject 约定）。 */
export const inject = ['webServer']

/** 请求体超限：显式字段形式（erasableSyntaxOnly 禁参数属性），接线 catch 借此区分 413/400。 */
class BodyTooLargeError extends Error {}

interface WebServerFace {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** wire 层收到的 ctx 面：webServer 经模块级 inject 就绪后挂到 ctx（effect 为 cordis ctx 自带）。 */
interface HostContext {
  webServer: WebServerFace
  effect(fn: () => () => void, name?: string): () => void
}

export function apply(ctx: HostContext): () => void {
  const vault = VaultStore.open({ env: process.env })
  const runs = RunStore.open({ env: process.env })
  const web = ctx.webServer

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

  return () => {}
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
