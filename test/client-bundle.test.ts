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

test('bundle：模型行支持草稿移除、保存空列表，且不保留未勾选旧模型', () => {
  const code = readFileSync(join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8')
  assert.match(code, /pickerRemove/)
  assert.match(code, /aria-label/)
  assert.match(code, /title:/)
  assert.match(code, /props\.onChange\(Object\.assign\(\{\}, picker, \{ rows:/)
  assert.match(code, /patch: \{ models: submitted \}/)
  assert.doesNotMatch(code, /未勾选但已配置/)
  assert.doesNotMatch(code, /checked\.size === 0/)
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
    'wbTitle', 'newProject', 'emptyProjects', 'wizTitle', 'fLogline', 'create',
    'stageOverview', 'stagePremise', 'stageArch', 'stageWorld', 'stageChars', 'stageOutline', 'stageChapter', 'stageAdapt', 'stageRuns',
    'agentPanel', 'pendingProposals', 'statusWriting', 'statusPendingReview', 'statusAdapting', 'statusDone',
    'subBlueprint', 'subDraft', 'subReview', 'subFinal', 'finalize', 'adaptCreate', 'instructCopied', 'registryMissing', 'channelWarn',
  ]) {
    assert.ok(code.includes(`${key}: "`), `缺词典键 ${key}`)
  }
})

test('apply：locale 字典含 picker 全套键（zh/en 同步）', () => {
  const { mod } = loadBundle()
  let dictRef: { current: { zh: Record<string, string>; en: Record<string, string> } | null } = { current: null }
  const ctx = {
    slots: { inject: () => () => {}, register: () => () => {} },
    locale: {
      register: (_n: string, d: { zh: Record<string, string>; en: Record<string, string> }) => { dictRef.current = d; return () => {} },
      bind: () => (k: string) => k,
    },
    effect: (fn: () => () => void) => { fn(); return () => {} },
  }
  ;(mod['apply'] as (c: unknown) => void)(ctx)
  const dict = dictRef.current
  assert.ok(dict, 'locale.register 未被调用')
  const required = [
    'pickerSearch', 'pickerFilterKind', 'pickerFilterAll',
    'pickerSelectAll', 'pickerDeselectAll', 'pickerSave',
    'pickerEmpty', 'pickerLabelConfigured', 'pickerLabelNew',
    'pickerKindImage', 'pickerKindVideo', 'pickerKindTts', 'pickerSaved', 'pickerRemove',
    'pickerTitle', 'pickerCountUnit', 'pickerCheckedHintPrefix',
    'pickerStatCheckedPrefix', 'pickerStatRemovedPrefix',
  ]
  for (const k of required) {
    // 注：允许空字符串（en.pickerCountUnit = '' 是合法设计——英文复数不分单复）
    assert.ok(typeof dict!.zh[k] === 'string', `locale.zh.${k} 缺失`)
    assert.ok(typeof dict!.en[k] === 'string', `locale.en.${k} 缺失`)
  }
})
