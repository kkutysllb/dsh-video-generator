/** 路由真机冒烟：极简 http 适配器（exact/prefix 匹配语义与宿主 webServer 一致）
 *  + 插件真实 apply() 注册面 → 真端口 curl 验收 /health /runs /runs/:id /channels
 *  /settings /api/* 与 /media/*（围栏/穿越/流式）。
 *  用法: node scripts/live-routes.ts [port]（DSH_HOME 可注入隔离）
 *  背景：隔离 profile boot 被宿主 fs-ext ABI 不匹配阻断（与本插件无关），此脚本补足路由层真机验证。
 *  路由注册 path 已含插件前缀（/dsh-video-generator/...），按注册 path 全路径匹配即可。 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { apply } from '../src/host/index.ts'

interface Route {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

const routes = new Map<string, Route>()
const ctx = {
  webServer: {
    register(route: Route) {
      routes.set(route.path, route)
      return () => {}
    },
  },
  tools: { register: () => () => {} },
  systemPrompt: { section: () => () => {} },
  effect(fn: () => () => void) {
    fn()
    return () => {}
  },
} as unknown as Parameters<typeof apply>[0]

apply(ctx)

function pick(pathname: string): Route | null {
  for (const r of routes.values()) {
    if (r.kind === 'exact' && r.path === pathname) return r
    if (r.kind === 'prefix' && pathname.startsWith(`${r.path}/`)) return r
  }
  return null
}

const port = Number(process.argv[2] ?? 65432)
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const pathname = (req.url ?? '/').split('?')[0]!
  const route = pick(pathname)
  if (!route) {
    res.statusCode = 404
    res.end(JSON.stringify({ ok: false, error: { code: 'not-found', message: '未知路径' } }))
    return
  }
  void route.handler(req, res)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[live-routes] listening http://127.0.0.1:${port}`)
  console.log(`[live-routes] routes: ${[...routes.keys()].join(', ')}`)
})
