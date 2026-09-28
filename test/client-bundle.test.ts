// test/client-bundle.test.ts
/** lib/client.js 是手写 bundle（不经 tsc）：本测试守住加载契约——
 *  __ModuleLoader__ 自注册、exports.apply/inject 形态、settings.section 注册参数、locale 字典。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface CapturedSpec { id: string; factory: (require: (m: string) => unknown) => Record<string, unknown> }

function loadBundle(): { mod: Record<string, unknown>; captured: CapturedSpec } {
  const code = readFileSync(join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8')
  const specRef: { current: CapturedSpec | null } = { current: null }
  const stubWindow = { __ModuleLoader__: { load(spec: CapturedSpec) { specRef.current = spec } } }
  Reflect.set(globalThis, 'window', stubWindow)
  try {
    new Function(code)()
  } finally {
    Reflect.deleteProperty(globalThis, 'window')
  }
  assert.ok(specRef.current, 'bundle 未经 __ModuleLoader__.load 自注册')
  const captured = specRef.current as CapturedSpec
  const reactStub = {
    createElement: () => ({}),
    useState: (v: unknown) => [v, () => {}],
    useEffect: () => {},
    useCallback: (f: unknown) => f,
    useRef: () => ({ current: null }),
  }
  const mod = captured!.factory((m: string) => {
    if (m === 'react') return reactStub
    throw new Error(`unexpected require: ${m}`)
  })
  return { mod, captured: captured! }
}

test('bundle 自注册 id = dsh-video-generator，exports.apply/inject 契约', () => {
  const { mod, captured } = loadBundle()
  assert.equal(captured.id, 'dsh-video-generator')
  assert.equal(typeof mod['apply'], 'function')
  assert.deepEqual(mod['inject'], ['slots', 'locale', 'sessions', 'uiConversation', 'layout'])
})

test('apply：注册 locale 字典（videoGen zh/en 均含 nav）+ settings.section（id/order）', () => {
  const { mod } = loadBundle()
  let ns = ''
  const dictRef: { current: { zh: Record<string, string>; en: Record<string, string> } | null } = { current: null }
  const registered: Array<Record<string, unknown>> = []
  const ctx = {
    slots: {
      inject: (_type: string, loader: () => unknown) => { loader(); return () => {} },
      register: (opts: Record<string, unknown>) => { registered.push(opts); return () => {} },
    },
    locale: {
      register: (n: string, d: { zh: Record<string, string>; en: Record<string, string> }) => { ns = n; dictRef.current = d; return () => {} },
      bind: () => (key: string) => key,
    },
    effect: (fn: () => () => void) => { fn(); return () => {} },
  }
  ;(mod['apply'] as (c: unknown) => void)(ctx)
  assert.equal(ns, 'videoGen')
  const dicts = dictRef.current
  assert.ok(dicts && dicts.zh['nav'] && dicts.en['nav'])
  // 0.1.5 左侧栏接入：settings.section 之外追加 sidebar.panellist（图标）
  // 与 main（主面板）两段注册，settings 断言按注册顺序定位。
  assert.ok(registered.length >= 3, `至少 3 段注册（settings/panellist/main），实际 ${registered.length}`)
  assert.equal(registered[0]!['name'], 'settings.section')
  assert.equal(registered[0]!['id'], 'video-generator')
  assert.equal(typeof registered[0]!['label'], 'function')
  const names = registered.map((r) => r['name'])
  assert.ok(names.includes('sidebar.panellist'), '缺 sidebar.panellist 注册')
  assert.ok(names.includes('main'), '缺 main 注册')
  const panellist = registered.find((r) => r['name'] === 'sidebar.panellist')
  const main = registered.find((r) => r['name'] === 'main')
  assert.equal(panellist!['id'], 'drama-workbench')
  assert.equal(main!['key'], 'drama-workbench', 'main 与 panellist 必须同 id')
})

test('apply：无 document 环境（node）不炸——样式/导航图标注入全部守卫', () => {
  const { mod } = loadBundle()
  const ctx = {
    slots: { inject: () => () => {}, register: () => () => {} },
    locale: { register: () => () => {}, bind: () => (k: string) => k },
    effect: (fn: () => () => void) => { fn(); return () => {} },
  }
  assert.doesNotThrow(() => (mod['apply'] as (c: unknown) => void)(ctx))
})

test('bundle 渲染冒烟：settings 与漫剧工坊主面板首帧渲染不抛错', () => {
  const { mod } = loadBundle()
  const components: Array<unknown> = []
  const ctx = {
    slots: {
      inject: (_type: string, loader: () => unknown) => { loader(); return () => {} },
      register: (_opts: unknown, comp: unknown) => { components.push(comp); return () => {} },
    },
    locale: { register: () => () => {}, bind: () => (k: string, params?: Record<string, unknown>) => (params ? k : k) },
    effect: (fn: () => () => void) => { fn(); return () => {} },
    sessions: {},
    layout: {},
  }
  ;(mod['apply'] as (c: unknown) => void)(ctx)
  assert.ok(components.length >= 2, '应注册 settings 与 main 两个面板组件')
  // 极简 React stub：createElement 造元素树、hooks 返回惰性初值。
  // 首帧渲染只走 loading/空态分支，可捕获引用错误/hooks 顺序错误等低级缺陷。
  const reactStub = {
    createElement: function (type: unknown, props: unknown) {
      const kids = Array.prototype.slice.call(arguments, 2) as unknown[]
      return { type, props, kids: kids.flat() }
    },
    useState: (v: unknown) => [v, () => {}],
    useEffect: () => {},
    useCallback: (f: unknown) => f,
    useRef: () => ({ current: null }),
  }
  for (const comp of components) {
    assert.doesNotThrow(() => {
      ;(comp as () => unknown)()
    }, '面板组件首帧渲染抛错')
  }
  void reactStub
})

test('bundle：用途槽设置面——六槽、每槽单绑定保存与真实测试按钮', () => {
  const code = readFileSync(join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8')
  // 六槽顺序表与固定协议映射（image/tts/music 固定协议；video 三族可选）
  assert.match(code, /SLOT_ORDER = \["image\.master", "image\.shot", "video", "tts", "music\.bgm", "music\.song"\]/)
  assert.match(code, /"music\.bgm": "generic-music"/)
  assert.match(code, /generic-music/)
  // 保存走 slots.set（含 capabilities / music 映射），测试走 slots.test（真实小额调用）
  assert.match(code, /api\("slots\.set"/)
  assert.match(code, /api\("slots\.test", \{ slot: slot \}/)
  assert.match(code, /capabilities: capsPayload\(slot, draft\)/)
  // 音乐槽：模板套用 + JSON 映射编辑
  assert.match(code, /musicTemplates\.save/)
  assert.match(code, /musicTemplates\.list/)
  assert.match(code, /slotInvalidJson/)
  // 默认通道交互已退役
  assert.doesNotMatch(code, /channels\.setDefault/)
  assert.doesNotMatch(code, /onSetDefault/)
})

test('bundle：漫剧工坊契约——PANEL_ID、drama RPC 面、提案闭环与轮询门控关键串', () => {
  const code = readFileSync(join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8')
  // 面板 id 与侧边栏 order（§2.1）
  assert.match(code, /PANEL_ID = "drama-workbench"/)
  assert.match(code, /order: 110/)
  // drama RPC 面（§5）
  for (const method of [
    'drama.workspace.resolve', 'drama.project.list', 'drama.project.create', 'drama.project.get',
    'drama.asset.get', 'drama.asset.update', 'drama.proposal.apply', 'drama.proposal.reject',
    'drama.task.create', 'drama.task.update', 'drama.adaptation.create',
    'drama.candidate.save',
  ]) {
    assert.ok(code.includes(`"${method}"`), `缺 RPC 方法 ${method}`)
  }
  // 提案闭环交互（diff/编辑/应用/拒绝）与指令发送桥
  for (const key of ['viewDiff', 'editSuggestion', 'doApply', 'doReject', 'instructCopied', 'sendInstruction']) {
    assert.ok(code.includes(key), `缺提案/会话桥关键串 ${key}`)
  }
  // 可见性门控轮询（验收 15）
  assert.match(code, /visibilityState === "visible"/)
  // 旧工作台已退役
  assert.ok(!code.includes('makeWorkbenchComponent'), '旧工作台组件应已移除')
})

test('bundle：漫剧工坊双语词典键齐备（zh/en 同步）', () => {
  const code = readFileSync(join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8')
  for (const key of [
    'wbTitle', 'newProject', 'emptyProjects', 'wizTitle', 'fLogline', 'create', 'wizConfirmHint',
    'instructCopied', 'instructPrefilled', 'wsAll', 'adaptNoChapters', 'adaptNoChaptersHint',
    'stageOverview', 'stagePremise', 'stageArch', 'stageWorld', 'stageChars', 'stageOutline', 'stageChapter', 'stageAdapt', 'stageRuns',
    'agentPanel', 'pendingProposals', 'statusWriting', 'statusPendingReview', 'statusAdapting', 'statusDone',
    'subBlueprint', 'subDraft', 'subReview', 'subFinal', 'finalize', 'adaptCreate', 'instructCopied', 'registryMissing', 'channelWarn',
  ]) {
    assert.ok(code.includes(`${key}: "`), `缺词典键 ${key}`)
  }
  // 指令预填走宿主 uiConversation.fillDraft（SessionId 显式寻址的官方 API），
  // 且必须保留剪贴板兜底路径（fillDraft 对未挂载输入壳的会话是 no-op）
  assert.ok(code.includes('.fillDraft(sessionId, text)'), 'sendInstruction 未使用 uiConversation.fillDraft')
  assert.ok(code.includes('navigator.clipboard.writeText'), '剪贴板兜底路径丢失')
})

test('apply：locale 字典含用途槽全套键（zh/en 同步，picker 键已退役）', () => {
  const code = readFileSync(join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8')
  for (const key of [
    'slotsTitle', 'slotsIntro', 'slotChannel', 'slotModel', 'slotCaps', 'slotProtocol',
    'slotTest', 'slotTesting', 'slotSave', 'slotUnbound', 'slotVoice', 'slotInstructions',
    'slotMaxDur', 'slotMapping', 'slotTpl', 'slotTplSaveAs', 'slotTplSavePrompt',
    'slotInvalidJson', 'slotTestOk', 'slotTestFail', 'slotSavedOk', 'slotNeedChannel',
  ]) {
    const hits = code.split(`${key}: "`).length - 1
    assert.ok(hits >= 2, `词典键 ${key} 须 zh/en 双语齐备（现 ${hits} 处）`)
  }
  // picker 时代词典键不复存在
  for (const dead of ['pickerSearch', 'pickerSave:', 'pickerSaved', 'adopt:']) {
    assert.ok(!code.includes(dead), `退役词典键 ${dead} 不应存在`)
  }
})

// ── DSH 0.1.7-rc.2 会话桥 v4（lib/client.js 模块级 __testHooks）────────

interface VgenShell { setDraft(text: string): void }

interface BridgeHooks {
  currentSessionId(sessions: any): string | null
  inputShellFor(ctx: any, sessions: any, sessionId: string): VgenShell | null
  prefillToSession(ctx: any, sessions: any, sessionId: string, text: string, attempt?: number): Promise<string>
  openSessionView(ctx: any, sessions: any, sessionId: string): boolean
  sendInstructionFor(ctx: any, text: string): Promise<{ result: string; sessionId?: string }>
}

function hooks(): BridgeHooks {
  const { mod } = loadBundle()
  return mod['__testHooks'] as BridgeHooks
}

interface FakeShell extends VgenShell { drafts: string[] }
function fakeShell(): FakeShell {
  const drafts: string[] = []
  return { drafts, setDraft(text: string) { drafts.push(text) } }
}

interface FakeSessionListState {
  byId?: Record<string, { retainedBy?: Record<string, number> }>
  current?: string
  phase?: string
}

interface FakeSessions {
  list: { getSnapshot: () => FakeSessionListState }
  create: () => Promise<string>
  refresh: () => Promise<void>
  using: (id: string, options: { source: string }, op: () => unknown) => Promise<unknown>
  scope: (id: string) => unknown
  binding: (id: string) => { ctx: unknown } | undefined
  calls: Record<string, unknown[]>
}

/** 0.1.7 面：无 list.current、无 sessions.open；using/scope/binding 在场。
 *  mountAfter 控制输入壳迟到位（第 N 次解析后才挂载）。 */
function sessions017(opts: { shell?: FakeShell | null; mountAfter?: number } = {}): FakeSessions {
  const calls: Record<string, unknown[]> = { using: [], create: [] }
  const shell = opts.shell === undefined ? fakeShell() : opts.shell
  const mountAfter = opts.mountAfter ?? 0
  let attempts = 0
  const actx = { conversation: { input: { for: () => (attempts++ >= mountAfter && shell ? shell : null) } } }
  return {
    calls,
    list: {
      getSnapshot: () => ({
        byId: {
          's-1': { retainedBy: { mainView: 1 } },
          's-2': { retainedBy: { mainView: 0, other: 1 } },
        },
        phase: 'ready',
      }),
    },
    create: () => { calls['create']!.push(true); return Promise.resolve('s-new') },
    refresh: () => Promise.resolve(),
    using: (id: string, options: { source: string }, op: () => unknown) => {
      calls['using']!.push({ id, source: options.source })
      return Promise.resolve(op())
    },
    scope: () => actx,
    binding: () => ({ ctx: actx }),
  }
}

interface FakeCtx {
  sessions: any
  uiConversation: { fillDraft?: (id: string, text: string) => void }
  layout: { selectPanel: (panel: string | null) => void }
  get: (name: string) => unknown
  opened: string[]
  panels: Array<string | null>
  filled: Array<[string, string]>
}

function ctx017(sessions: any, opts: { fillDraft?: boolean; workspace?: unknown } = {}): FakeCtx {
  const opened: string[] = []
  const panels: Array<string | null> = []
  const filled: Array<[string, string]> = []
  const workspace = 'workspace' in opts
    ? opts.workspace
    : { openSession: (id: string) => { opened.push(id) } }
  return {
    sessions,
    uiConversation: opts.fillDraft === false ? {} : { fillDraft: (id: string, text: string) => { filled.push([id, text]) } },
    layout: { selectPanel: (panel: string | null) => { panels.push(panel) } },
    get: (name: string) => (name === 'uiWorkspace' ? workspace : null),
    opened,
    panels,
    filled,
  }
}

test('v4：currentSessionId 按 retainedBy.mainView 判定，旧宿主回退 list.current', () => {
  const h = hooks()
  assert.equal(h.currentSessionId(sessions017()), 's-1', 'mainView 持有者即当前会话')
  const legacy = { list: { getSnapshot: () => ({ current: 's-legacy' }) } }
  assert.equal(h.currentSessionId(legacy), 's-legacy', '旧宿主 list.current 兜底')
  const mixed = { list: { getSnapshot: () => ({ current: 's-old', byId: { 's-1': { retainedBy: { mainView: 1 } } } }) } }
  assert.equal(h.currentSessionId(mixed), 's-1', 'mainView 判定优先于旧 current 字段')
  assert.equal(h.currentSessionId({}), null, '无会话面返回 null')
  assert.equal(h.currentSessionId({ list: { getSnapshot: () => ({ byId: { 's-2': { retainedBy: { mainView: 0 } } } }) } }), null)
})

test('v4：openSessionView 走 uiWorkspace.openSession（ctx.get 软探测），缺席回退 sessions.open', () => {
  const h = hooks()
  const s017 = sessions017()
  const ctx = ctx017(s017)
  assert.equal(h.openSessionView(ctx, s017, 's-9'), true)
  assert.deepEqual(ctx.opened, ['s-9'], '0.1.7 应经 uiWorkspace.openSession 选中并展示')

  const legacyOpened: string[] = []
  const legacySessions = { open: (id: string) => { legacyOpened.push(id) } }
  const legacyCtx = { get: () => null }
  assert.equal(h.openSessionView(legacyCtx, legacySessions, 's-8'), true)
  assert.deepEqual(legacyOpened, ['s-8'], '旧宿主回退 sessions.open')

  assert.equal(h.openSessionView({ get: () => null }, {}, 's-7'), false, '两代面皆无返回 false')
})

test('v4：sendInstructionFor 持引用递送（sessions.using）+ fillDraft 落地 → prefilled', async () => {
  const h = hooks()
  const shell = fakeShell()
  const s017 = sessions017({ shell })
  const ctx = ctx017(s017)
  const out = await h.sendInstructionFor(ctx, '指令文本')
  assert.equal(out.result, 'prefilled')
  assert.equal(out.sessionId, 's-1')
  assert.deepEqual(ctx.filled, [['s-1', '指令文本']], '经 uiConversation.fillDraft 写草稿')
  assert.deepEqual(shell.drafts, [], 'fillDraft 在场时不应重复 setDraft')
  const using = s017.calls['using'] as Array<{ id: string; source: string }>
  assert.equal(using.length, 1, '递送期必须经 sessions.using 持引用')
  assert.deepEqual(using[0], { id: 's-1', source: 'dsh-video-generator' })
  assert.deepEqual(ctx.panels, [null], '预填前切回会话视图（selectPanel(null)）')
})

test('v4：无当前会话 → sessions.create() + openSession 落点后递送', async () => {
  const h = hooks()
  const shell = fakeShell()
  const s017 = sessions017({ shell })
  s017.list.getSnapshot = () => ({ byId: {}, phase: 'ready' })
  const ctx = ctx017(s017)
  const out = await h.sendInstructionFor(ctx, '开工')
  assert.equal(out.result, 'prefilled')
  assert.equal(out.sessionId, 's-new')
  assert.equal(s017.calls['create']!.length, 1)
  assert.deepEqual(ctx.opened, ['s-new'], '新会话经 openSessionView 展示')
  assert.deepEqual(ctx.filled, [['s-new', '开工']])
})

test('v4：输入壳迟到位按重试参数等待（挂载后落地）', async () => {
  const h = hooks()
  const shell = fakeShell()
  const s017 = sessions017({ shell, mountAfter: 3 })
  const ctx = ctx017(s017, { fillDraft: false })
  const out = await h.sendInstructionFor(ctx, '迟到')
  assert.equal(out.result, 'prefilled')
  assert.deepEqual(shell.drafts, ['迟到'], '挂载后经 shell.setDraft 落地')
})

test('v4：输入壳永不挂载 → 不假装成功，降级剪贴板/none', async () => {
  const h = hooks()
  const s017 = sessions017({ shell: null, mountAfter: 999 })
  const ctx = ctx017(s017, { fillDraft: false })
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let clipboardForced = false
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText: () => Promise.resolve() } },
      configurable: true,
    })
    clipboardForced = true
  } catch {
    clipboardForced = false
  }
  try {
    const out = await h.sendInstructionFor(ctx, '落不了地')
    assert.notEqual(out.result, 'prefilled', '绝不假装预填成功')
    assert.equal(out.sessionId, 's-1')
    assert.equal(out.result, clipboardForced ? 'copied' : 'none')
  } finally {
    if (clipboardForced) {
      if (previous) Object.defineProperty(globalThis, 'navigator', previous)
      else delete (globalThis as Record<string, unknown>)['navigator']
    }
  }
})

test('v4：旧宿主（≤0.1.6）软降级——list.current / sessions.open / 无 using 照常递送', async () => {
  const h = hooks()
  const shell = fakeShell()
  const actx = { conversation: { input: { for: () => shell } } }
  const legacyOpened: string[] = []
  const legacySessions = {
    list: { getSnapshot: () => ({ current: 's-legacy' }) },
    open: (id: string) => { legacyOpened.push(id) },
    scope: () => actx,
    binding: () => ({ ctx: actx }),
  }
  const ctx = ctx017(legacySessions, { workspace: null })
  const out = await h.sendInstructionFor(ctx, '旧宿主指令')
  assert.equal(out.result, 'prefilled')
  assert.equal(out.sessionId, 's-legacy')
  assert.deepEqual(ctx.filled, [['s-legacy', '旧宿主指令']])
  assert.deepEqual(legacyOpened, [], '已有当前会话不再 open')
})

test('bundle：0.1.7 会话桥 v4 契约哨兵——关键串齐备、旧面只作软降级', () => {
  const code = readFileSync(join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8')
  for (const marker of [
    'retainedBy', 'mainView', 'using(sessionId', 'uiWorkspace', 'openSession',
    'inputShellFor', 'currentSessionId', 'sendInstructionFor', 'VG_BRIDGE_RETRIES',
  ]) {
    assert.ok(code.includes(marker), '缺 0.1.7 契约关键串 ' + marker)
  }
  assert.ok(code.includes('{ source: "dsh-video-generator" }'), '递送缺 sessions.using 持引用 source')
  assert.ok(code.includes('typeof sessions.open === "function"'), '旧宿主 sessions.open 回退分支丢失')
  assert.ok(code.includes('list.current'), '旧宿主 list.current 兜底丢失')
  assert.ok(code.includes('ctx.get("uiWorkspace")'), 'uiWorkspace 必须走 ctx.get 软探测（可选面不得直读）')
  // 0.1.7 已删字段：不再把 getSnapshot().current 当唯一判据
  assert.doesNotMatch(code, /getSnapshot\(\)\.current/)
})
