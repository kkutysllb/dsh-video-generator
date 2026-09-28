/**
 * DSH Web GUI Client Extension for dsh-video-generator（类型参考，非构建产物）。
 *
 * BUILD NOTE（重要）：`lib/client.js` 是手写的自注册产物，不由 tsc 生成。
 * dsh 的 client 模块加载器要求特定 bundle 形态——编译物必须经
 * `window.__ModuleLoader__.load({ id, factory })` 自注册、经 `exports.apply`
 * 暴露扩展并 `return module.exports`；裸 ESM `export` 不会注册，触发：
 *   "bundle .../client.js loaded without registering \"dsh-video-generator\" via __ModuleLoader__.load"
 * 因此任何 client 侧改动请直接编辑 `lib/client.js`，并保持本文件与它的
 * 结构同构（服务声明、注册调用、行为约定）。
 *
 * 功能面（与 lib/client.js 对应）：
 * 1. 注册 `settings.section` 导航项（id: video-generator，名称「视频工坊」，
 *    order 21，排在演示文稿之后）；
 * 2. 设置页菜单式版式（对齐 dsh-coding-sidebar SideCardSection 配方）：
 *    - 头部：插件名 + 版本徽标 + 刷新按钮；
 *    - 分组卡片（DSH 原生 group recipe：l2 细线边框、16px 圆角、layer-3 填充）：
 *      环境与诊断（菜单行：键在左、值在右）/ 模型通道（通道 CRUD + 开关）/
 *      添加通道（表单菜单行：字段名在左、输入框在右）/ 预算与 gate（阈值/gate 菜单行）；
 *    - 菜单式设置行（标题/描述在左、控件在右、细分隔线）+ DSH 原生开关/按钮/输入框；
 *    - 配色走 --dsw-alias-* 令牌，跟随明暗主题；
 * 3. 数据面 = /dsh-video-generator/api/<method>（POST JSON，
 *    {ok,value}/{ok,error} 信封），与 host 侧 routes.ts 一一对应；
 * 4. 设置页导航图标：宿主 0.1.x 的 settings.section 契约只投影 id/order/label，
 *    壳层对外部分区一律渲染通用齿轮。挂载后按本地化文案标记本插件导航行
 *    （NAV_MARKER），由注入 CSS 用 Lucide clapperboard（场记板）字形替换齿轮；
 *    disposer 清标记，HMR/停用无残留。
 *
 * 会话桥 v4（DSH 0.1.7-rc.2 契约对齐，与 lib/client.js 的模块级函数同构）：
 * - SessionListState 删 `current` 字段：当前会话 = `byId[id].retainedBy.mainView>0`
 *   （uiWorkspace navigation 以 `retain(target, {source:'mainView'})` 持有选择态，
 *   ui-session / ui-workspace 内部同口径判定）；
 * - `ISessions.open()` 已删：选中并展示会话走 `uiWorkspace.openSession(target)`；
 * - `ISessions.binding / scope(id)` 只认**已 retain** 的 generation：
 *   递送期用 `sessions.using(id, {source}, op)` 持引用（回调结算后自动 release）；
 * - 壳解析沿 `conversation.input.for(actx)`（uiConversation.fillDraft 同口径）。
 * 旧宿主（≤0.1.6）面（`list.current` / `sessions.open` / 无 `using`）保留软降级。
 *
 * APPLY NOTE：访问 ctx.slots / ctx.locale / ctx.sessions / ctx.uiConversation /
 * ctx.layout 需要两处同时声明——
 * - exports.inject = ['slots', 'locale', 'sessions', 'uiConversation', 'layout']
 *   （cordis 服务名；inject 是 all-required，可选面只能走 ctx.get 软探测）；
 * - package.json → dsh.client.inject 列出对应引擎包（@deepseek-ai/dsh-api-session-controller、
 *   @deepseek-ai/dsh-client-locale、@deepseek-ai/dsh-client-ui-conversation、
 *   @deepseek-ai/dsh-client-ui-layout、@deepseek-ai/dsh-client-ui-slots、
 *   @deepseek-ai/dsh-client-ui-workspace）。uiWorkspace 为可选面（0.1.7 才有
 *   openSession），一律经 ctx.get('uiWorkspace') 探测，缺席回退 sessions.open。
 */

/** 0.1.7 SessionListState 形状（current 字段已删；旧宿主保留该字段）。 */
export interface VgenSessionListState {
  byId?: Record<string, { retainedBy?: Record<string, number | undefined> }>
  current?: string
}

/** 0.1.7 ISessions 消费面（open() 已删；using/binding 为 0.1.7 新增）。 */
export interface VgenSessionsFace {
  list: { getSnapshot(): VgenSessionListState }
  create(opts?: { workspaceId?: string; cwd?: string; sessionId?: string }): Promise<string>
  refresh(): Promise<void>
  using?<T>(target: string, options: { source: string }, operation: () => T | Promise<T>): Promise<T>
  scope?(id: string): VgenAgentContext | undefined
  binding?(id: string): { ctx: VgenAgentContext } | undefined
  /** 旧宿主（≤0.1.6）面：0.1.7 已删。 */
  open?(id: string): void
}

/** Agent 作用域（scope/binding 借代的最小面）。 */
export interface VgenAgentContext {
  conversation?: VgenConversationFace
}

/** conversation.input.for(actx) → SessionInput（setDraft 在场即视为输入壳）。 */
export interface VgenConversationFace {
  input?: { for(actx: VgenAgentContext): VgenInputShell | null }
}

/** 会话输入壳最小面（0.1.7 SessionInput 保留 setDraft/submit）。 */
export interface VgenInputShell {
  setDraft(text: string): void
  submit?(): void
}

/** uiWorkspace 消费面（可选：0.1.7 起 openSession 选中并展示会话）。 */
export interface VgenUiWorkspaceFace {
  openSession?(target: string): void
}

/** 客户端入口收到的 ctx 服务面（声明的服务 + cordis 自带 effect/get）。 */
export interface VgenClientContext {
  slots: {
    inject(slotType: string, loader: () => unknown): unknown
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  locale: {
    register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void
    bind(ns: string): (key: string, params?: Record<string, unknown>) => string
  }
  sessions: VgenSessionsFace
  uiConversation: { fillDraft(sessionId: string, text: string): void }
  layout: { selectPanel(panelId: string | null): void }
  get(name: string): unknown
  effect(fn: () => () => void, name?: string): () => void
}

/** 必需服务（cordis fiber inject；uiWorkspace 为可选面，走 ctx.get）。 */
export const inject = ['slots', 'locale', 'sessions', 'uiConversation', 'layout']

/** 挂载重试参数（与 lib/client.js 同构）：0.1.7 conversation 挂载异步。 */
export const VG_BRIDGE_RETRIES = 8
export const VG_BRIDGE_RETRY_MS = 250

/** 可选面（inject 是 all-required）只能走 ctx.get 软探测：缺席返回 null。 */
export function uiWorkspaceFace(ctx: VgenClientContext): VgenUiWorkspaceFace | null {
  try {
    const face = ctx.get('uiWorkspace') as VgenUiWorkspaceFace | undefined
    return face ?? null
  } catch {
    return null
  }
}

/** 当前会话 id：mainView 持有者优先；旧宿主回退 list.current。找不到返回 null。 */
export function currentSessionId(sessions: VgenSessionsFace): string | null {
  try {
    const list = sessions.list.getSnapshot()
    const byId = list?.byId
    if (byId) {
      for (const id of Object.keys(byId)) {
        const row = byId[id]
        if (row?.retainedBy && (row.retainedBy['mainView'] ?? 0) > 0) return id
      }
    }
    return typeof list?.current === 'string' && list.current ? list.current : null
  } catch {
    return null
  }
}

/** 输入壳解析（uiConversation.fillDraft 同口径）：conversation.input.for(actx)。 */
export function inputShellFor(
  ctx: VgenClientContext,
  sessions: VgenSessionsFace,
  sessionId: string,
): VgenInputShell | null {
  try {
    let actx = sessions.scope?.(sessionId)
    if (!actx) actx = sessions.binding?.(sessionId)?.ctx
    if (!actx) return null
    const conversation = (ctx.get('conversation') as VgenConversationFace | undefined) ?? actx.conversation
    const shell = conversation?.input?.for(actx) ?? null
    return shell && typeof shell.setDraft === 'function' ? shell : null
  } catch {
    return null
  }
}

/** 写草稿（不自动提交——用户回车即发）：'prefilled' | 'failed'。 */
export function prefillToSession(
  ctx: VgenClientContext,
  sessions: VgenSessionsFace,
  sessionId: string,
  text: string,
  attempt = 0,
): Promise<'prefilled' | 'failed'> {
  const shell = inputShellFor(ctx, sessions, sessionId)
  if (shell) {
    try {
      if (typeof ctx.uiConversation?.fillDraft === 'function') ctx.uiConversation.fillDraft(sessionId, text)
      else shell.setDraft(text)
      return Promise.resolve('prefilled')
    } catch {
      /* 写入失败：按未挂载重试 */
    }
  }
  if (attempt + 1 < VG_BRIDGE_RETRIES) {
    return new Promise((resolve) => setTimeout(resolve, VG_BRIDGE_RETRY_MS)).then(() =>
      prefillToSession(ctx, sessions, sessionId, text, attempt + 1),
    )
  }
  return Promise.resolve('failed')
}

/** 剪贴板写入：'copied' | 'none'（绝不假装成功）。 */
export function clipboardCopy(text: string): Promise<'copied' | 'none'> {
  try {
    const clipboard = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard
    if (clipboard?.writeText) {
      return clipboard.writeText(text).then(() => 'copied', () => 'none')
    }
  } catch {
    /* 剪贴板不可用 */
  }
  return Promise.resolve('none')
}

/** 切回会话视图：面板激活时输入框在对话页，先离开面板再写草稿。 */
export function backToChat(ctx: VgenClientContext): void {
  try {
    ctx.layout.selectPanel(null)
  } catch {
    /* 服务不可达：留在当前面板 */
  }
}

/** 选中并展示会话：0.1.7 uiWorkspace.openSession → 旧宿主 sessions.open。 */
export function openSessionView(ctx: VgenClientContext, sessions: VgenSessionsFace, sessionId: string): boolean {
  try {
    const uiws = uiWorkspaceFace(ctx)
    if (typeof uiws?.openSession === 'function') {
      uiws.openSession(sessionId)
      return true
    }
    if (typeof sessions.open === 'function') {
      sessions.open(sessionId)
      return true
    }
  } catch {
    /* 已选中 */
  }
  return false
}

/** 任务指令发送桥 v4 的结果信封（与 lib/client.js 同构）。 */
export interface VgenSendOutcome {
  result: 'prefilled' | 'copied' | 'none'
  sessionId?: string
}

/** 任务指令发送桥 v4：定位会话 → 持引用预填草稿 → 切回会话视图。 */
export function sendInstructionFor(ctx: VgenClientContext, text: string): Promise<VgenSendOutcome> {
  const sessions = ctx.sessions
  const write = clipboardCopy(text)
  const current = currentSessionId(sessions)
  let plan: Promise<string | null>
  try {
    if (current) plan = Promise.resolve(current)
    else if (typeof sessions.create === 'function') {
      plan = sessions
        .create()
        .then((id) => {
          openSessionView(ctx, sessions, id)
          return id
        })
        .catch(() => null)
    } else plan = Promise.resolve(null)
  } catch (error) {
    console.warn('[dsh-video-generator] 会话桥定位异常:', (error as Error).message)
    plan = Promise.resolve(null)
  }
  return plan.then((sessionId) =>
    write.then((copied) => {
      if (!sessionId) return { result: copied === 'copied' ? 'copied' : 'none' }
      backToChat(ctx)
      const deliver = (): Promise<'prefilled' | 'failed'> => prefillToSession(ctx, sessions, sessionId, text, 0)
      const delivered =
        typeof sessions.using === 'function'
          ? sessions.using(sessionId, { source: 'dsh-video-generator' }, deliver).catch(() => 'failed' as const)
          : deliver()
      return Promise.resolve(delivered).then((outcome): VgenSendOutcome => {
        if (outcome === 'prefilled') return { result: 'prefilled', sessionId }
        return { result: copied === 'copied' ? 'copied' : 'none', sessionId }
      })
    }),
  )
}

/**
 * 设置页导航图标标记（与 lib/client.js 的 registerSettingsNavIcon 同构）：
 * 按本地化文案找到 [role="dialog"] nav button 中本插件的行并打标记，
 * MutationObserver 跟随语言切换与弹窗重开；返回的 disposer 清除全部标记。
 * 缺 DOM/Observer 时为空操作。
 */
export const NAV_MARKER = 'data-dsh-video-generator-settings-nav'

export function registerSettingsNavIcon(label: () => string): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
  let disposed = false
  const sync = (): void => {
    if (disposed) return
    let current = ''
    try { current = String(label() || '').trim() } catch (e) { current = '' }
    const buttons = document.querySelectorAll('[role="dialog"] nav button')
    for (const button of buttons) {
      const matches = current.length > 0 && (button.textContent || '').trim() === current
      if (matches) button.setAttribute(NAV_MARKER, '')
      else button.removeAttribute(NAV_MARKER)
    }
  }
  sync()
  const observer = new MutationObserver(sync)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  return () => {
    disposed = true
    observer.disconnect()
    const marked = document.querySelectorAll('[' + NAV_MARKER + ']')
    for (const element of marked) element.removeAttribute(NAV_MARKER)
  }
}

/** 挂载设置页「视频工坊」区块。 */
export function apply(ctx: VgenClientContext): void {
  ctx.effect(() => ctx.locale.register('videoGen', { zh: {}, en: {} }), 'dsh-video-generator: section dictionaries')
  const t = ctx.locale.bind('videoGen')
  // 设置页导航图标：标记本插件行后由 CSS 把齿轮换成场记板字形（见功能面 4）。
  ctx.effect(() => registerSettingsNavIcon(() => t('nav')), 'dsh-video-generator: settings navigation icon')
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      { name: 'settings.section', id: 'video-generator', order: 21, label: () => t('nav'), locale: 'videoGen' },
      // 真实组件形态（双 tab 状态容器/视图树）见 lib/client.js 的 makeStatefulComponent()
      function Stateful() { return null },
    ),
  )
}
