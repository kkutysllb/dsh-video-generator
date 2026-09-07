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
  assert.deepEqual(mod['inject'], ['slots', 'locale'])
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
  assert.equal(registered.length, 1)
  assert.equal(registered[0]!['name'], 'settings.section')
  assert.equal(registered[0]!['id'], 'video-generator')
  assert.equal(typeof registered[0]!['label'], 'function')
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
