// test/contract-020.test.ts
/** DSH 0.2.1-alpha.2 适配契约哨兵（v2.1.4 起）。
 *
 *  依据：本地 fork deepseek-harness @ 0.2.1-alpha.2（上游 alpha.2 树 + KCoder 偏离面）逐面核对，
 *  并用 fork 内真实的 `ToolRuntime`/`SystemPrompt` 完成「10 工具 + prompt section」挂载实测。
 *  钉死三件在 0.2.x 上**已经踩过坑**的事：
 *
 *  1. peer 兼容门的**数值语义**——0.2.x 必须被左支覆盖（含预发布），否则 app-boot 的
 *     compatibility-preflight 直接 `row.disabled = true` 静默禁用整个 bundle（v2.1.2 的线上故障）；
 *     右侧 QiLin 3.x 支不得收窄。
 *  2. **客户端会话桥 v4 主路径**不得退化回 0.1.6 世代：0.2.x 已删 `SessionListState.current`
 *     与 `ISessions.open()`，旧面只允许作为 `typeof` 守卫的软降级存在。
 *  3. **prompt section 插值安全**：alpha.2 的 `interpolate` 对 malformed 双花括号引用会抛错，
 *     正文里出现双花括号会让整个 prompt 组装失败。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import semver from 'semver'
import { PLUGIN_ID, PLUGIN_VERSION } from '../src/host/routes.ts'
import { inject as hostInject } from '../src/host/index.ts'

const ROOT = join(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  version: string
  dsh?: { client?: { inject?: string[] } }
  peerDependencies?: Record<string, string>
}

/** 本版本实测的宿主运行时（本地 fork 的 app-boot 版本号）。 */
const VERIFIED_RUNTIME = '0.2.1-alpha.2'
/** 兼容门范围：左支覆盖 0.1.0-rc.5 起的全部 0.x（含 0.2.x 预发布），右支为 QiLin 3.x 预留。 */
const PEER_RANGE = '>=0.1.0-rc.5 <1.0.0 || >=3.0.0 <4.0.0'
/** 宿主 evaluator 的口径：预发布参与求值（plugin-compatibility.ts）。 */
const EVAL = { includePrerelease: true } as const

/** 剥掉块注释与行注释，只保留可执行代码（哨兵只认代码里的用法，注释里的说明不算）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

test('兼容门数值语义：0.2.x 左支放行（含预发布）、1.x 拒绝、QiLin 3.x 右支放行', () => {
  const peers = pkg.peerDependencies ?? {}
  assert.ok(Object.keys(peers).length > 0, '必须声明 peerDependencies（兼容门只读该字段）')
  for (const [name, range] of Object.entries(peers)) {
    assert.equal(range, PEER_RANGE, 'peer ' + name + ' 范围应为 ' + PEER_RANGE)
  }

  // 放行（左支）
  for (const v of ['0.1.0-rc.5', '0.1.7-rc.2', '0.2.0-rc.2', '0.2.1-alpha.1', VERIFIED_RUNTIME, '0.2.2', '0.9.9']) {
    assert.equal(semver.satisfies(v, PEER_RANGE, EVAL), true, '左支应放行 ' + v)
  }
  // 拒绝（左支上界之外）
  for (const v of ['1.0.0', '2.0.0']) {
    assert.equal(semver.satisfies(v, PEER_RANGE, EVAL), false, '应拒绝 ' + v)
  }
  // 预发布口径（宿主 includePrerelease: true）：边界版本自身的预发布仍 < 边界，故被放行。
  // 旧上界 <0.2.0 之所以没在 0.2.0-rc.* 上爆雷，靠的就是同一条规则（0.2.0-rc.2 < 0.2.0）；
  // 一旦上游跨到 0.2.1-alpha.* 就失配——这是 v2.1.2 被静默禁用的完整成因，钉在此处。
  assert.equal(semver.satisfies('1.0.0-rc.1', PEER_RANGE, EVAL), true, '边界版本的预发布按 semver 计为小于边界')
  // 放行（QiLin 右支）
  for (const v of ['3.0.0', '3.0.10', '3.9.9']) {
    assert.equal(semver.satisfies(v, PEER_RANGE, EVAL), true, '右支应放行 ' + v)
  }
  assert.equal(semver.satisfies('4.0.0', PEER_RANGE, EVAL), false, '应拒绝 4.x')

  // 回归钉：旧上界 <0.2.0 对 0.2.1-alpha.2 求值为 false —— 这正是 v2.1.2 被静默禁用的根因
  const OLD_RANGE = '>=0.1.0-rc.5 <0.2.0 || >=3.0.0 <4.0.0'
  assert.equal(semver.satisfies(VERIFIED_RUNTIME, OLD_RANGE, EVAL), false, '旧上界的失配事实必须成立（哨兵自证）')
})

test('manifest：0.2.x 会话桥所需的引擎包全部在 inject 清单里', () => {
  const inject = pkg.dsh?.client?.inject ?? []
  for (const name of [
    '@deepseek-ai/dsh-api-session-controller', // ctx.sessions（retain/using/binding/scope）
    '@deepseek-ai/dsh-client-ui-workspace',    // ctx.get('uiWorkspace').openSession
    '@deepseek-ai/dsh-client-ui-layout',       // ctx.layout.selectPanel
    '@deepseek-ai/dsh-client-ui-conversation', // conversation.input / fillDraft
    '@deepseek-ai/dsh-client-ui-slots',        // settings.section / sidebar.panellist / main
    '@deepseek-ai/dsh-client-locale',
  ]) {
    assert.ok(inject.includes(name), 'inject 清单缺 ' + name)
  }
  assert.ok(!JSON.stringify(pkg).includes('dsh-client-runtime'), '0.1.7 已删包不得回流')
})

test('client 会话桥 v4：0.2.x 主路径关键串在场（防退化回 0.1.6 世代）', () => {
  const code = stripComments(readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8'))
  // 当前会话判定：retainedBy.mainView（0.2.x 已无 SessionListState.current）
  assert.match(code, /retainedBy/, '缺 retainedBy（mainView 判定）')
  assert.match(code, /mainView/, '缺 mainView')
  // 选中并展示：uiWorkspace.openSession（可选面 ctx.get 软探测）
  assert.match(code, /"uiWorkspace"/, '缺 uiWorkspace 软探测')
  assert.match(code, /openSession/, '缺 openSession')
  // 递送期持引用 + 壳解析
  assert.match(code, /\.using\(/, '缺 sessions.using 持引用递送')
  assert.match(code, /typeof sessions\.scope === "function"/, '缺 sessions.scope 探测')
  assert.match(code, /typeof sessions\.binding === "function"/, '缺 sessions.binding 探测')
  assert.match(code, /conversation\.input/, '缺 conversation.input')
  assert.match(code, /\.for\(actx\)/, '缺 input.for(actx)')
  assert.match(code, /fillDraft/, '缺 uiConversation.fillDraft')
  assert.match(code, /setDraft/, '缺 shell.setDraft 回退')
})

test('client 会话桥 v4：已删面只允许出现在自带 typeof 守卫的软降级行', () => {
  const code = stripComments(readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8'))
  const dead: Array<[string, RegExp, RegExp]> = [
    // 出现行必须同时含守卫：0.2.x 的 ISessions 没有 open()
    ['sessions.open', /sessions\.open/, /typeof sessions\.open === "function"/],
    // 出现行必须同时含守卫：0.2.x 的 SessionListState 没有 current
    ['list.current', /list\.current/, /typeof list\.current === "string"/],
  ]
  for (const [label, usage, guard] of dead) {
    for (const line of code.split('\n')) {
      if (!usage.test(line)) continue
      assert.match(line, guard, label + ' 出现在无 typeof 守卫的行：' + line.trim().slice(0, 100))
    }
  }
})

test('prompt section 插值安全：正文不得含双花括号引用（alpha.2 会抛错）', () => {
  const src = readFileSync(join(ROOT, 'src', 'host', 'index.ts'), 'utf8')
  assert.ok(!src.includes('{{'), 'vgenGuidance 正文含双花括号，alpha.2 的 interpolate 会抛 malformed prompt variable reference')
  assert.deepEqual(hostInject, ['webServer', 'tools', 'systemPrompt', 'workspaceRegistry'], 'host 四服务面须与 0.2.x 同名')
})

test('版本同源：PLUGIN_VERSION == package.json.version（v2.1.4 起）', () => {
  assert.equal(PLUGIN_VERSION, pkg.version)
  assert.equal(PLUGIN_ID, 'dsh-video-generator')
})
