/** 仓库/bundle 卫生哨兵（通道槽重构规格 §8 删除清单 + §10 验收 4/11/13 的防回流断言）。
 *  这些断言钉的是「清理过的东西不许回来」：route() 死代码、picker 旧符号、
 *  lib/ 孤儿构建残留、provider 名称条件分支、运行时依赖表非空。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 剥掉注释与字符串/模板字面量——品牌名只允许出现在注释、路径与协议族字面量里，
 *  出现在可执行代码（条件分支/标识符）即违规（规格 §3「零 provider 分支」）。 */
function stripCommentsAndStrings(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, " '' ")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, ' "" ')
    .replace(/`(?:[^`\\]|\\.)*`/g, ' `` ')
}

test('lib/ 无孤儿构建残留（删除清单防回流：picker/model-catalog/registry）', () => {
  assert.ok(!existsSync(join(ROOT, 'lib', 'picker')), 'lib/picker/ 应已删除')
  assert.ok(!existsSync(join(ROOT, 'lib', 'model-catalog.js')), 'lib/model-catalog.js 应已删除')
  assert.ok(!existsSync(join(ROOT, 'lib', 'registry.js')), 'lib/registry.js 应已删除')
  // 通用形态：lib 顶层每个 .js 都必须能对应到 src 下的同名 .ts（client.js 例外：手写 bundle）
  for (const name of readdirSync(join(ROOT, 'lib'))) {
    if (name === 'client.js') continue
    const full = join(ROOT, 'lib', name)
    if (!statSync(full).isFile() || !name.endsWith('.js')) continue
    const tsCounterpart = join(ROOT, 'src', name.replace(/\.js$/, '.ts'))
    assert.ok(existsSync(tsCounterpart), `lib/${name} 是孤儿构建残留（无 src 对应源文件）——请删除后重新 build`)
  }
})

test('验收 13：lib/client.js 不含 picker 旧符号（assemblePickerRowsPublic/inferKindByName）', () => {
  const client = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  assert.ok(!client.includes('assemblePickerRowsPublic'), 'bundle 不应含 assemblePickerRowsPublic')
  assert.ok(!client.includes('inferKindByName'), 'bundle 不应含 inferKindByName')
})

test('route() 能力路由死代码不回流（规格 §8 删除清单）', () => {
  const provider = readFileSync(join(ROOT, 'src', 'provider.ts'), 'utf8')
  assert.ok(!/export\s+function\s+route\s*\(/.test(provider), 'provider.ts 不应再有 route()')
  assert.ok(!provider.includes('ProviderNeed'), 'provider.ts 不应再有 ProviderNeed')
})

test('验收 11：package.json 无运行时 dependencies（本地音频分析零新依赖）', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, unknown>
  assert.ok(!('dependencies' in pkg), 'package.json 不应声明 dependencies')
})

test('验收 4（扩面）：providers/pipeline/选型/槽位测试源码剥注释字符串后零 provider 名', () => {
  // 只命中「独立词」形态：适配器自身标识符（DashscopeChannel / createDashscopeRelayProvider）
  // 与协议族字面量（'dashscope-video'）是合法的；独立出现的品牌名（如条件分支里的裸标识符）
  // 才是「以 provider 名称为条件」的违规。基于字符串条件的模型名猜测（.includes('…')）
  // 在字符串剥离后自然消失，由 code review 与 dashscope-relay 专项测试共同盯防。
  const BRANDS = /(?<![\w$])(minimax|suno|so-vits|ace-step|happyhorse|seedream|vidu|pixverse|qwen|kling|dashscope|sora)(?![\w$])/i
  const dirs = ['src/providers', 'src/pipeline']
  const files: string[] = ['src/model-selection.ts', 'src/slot-probe.ts']
  for (const dir of dirs) {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (name.endsWith('.ts')) files.push(join(dir, name))
    }
  }
  assert.ok(files.length >= 10, `扫描面过小: ${files.length}`)
  for (const rel of files) {
    const stripped = stripCommentsAndStrings(readFileSync(join(ROOT, rel), 'utf8'))
    const hit = BRANDS.exec(stripped)
    assert.ok(!hit, `${rel} 可执行代码中出现独立 provider 名「${hit?.[0]}」——协议判定不得依赖厂商名（规格 §3）`)
  }
})

test('能力通告与工具枚举与 music 段同步（target/rerunStage 含 music）', async () => {
  const guidance = readFileSync(join(ROOT, 'src', 'host', 'index.ts'), 'utf8')
  assert.ok(guidance.includes("'assets'|'video'|'music'|'final'"), 'vgenGuidance 的 target 枚举须含 music')
  const { generateToolDefs } = await import('../src/tools/generate.ts')
  const dummy = {
    generate: { execute: async () => ({ ok: true as const, value: {} }) },
    status: { execute: async () => ({ ok: true as const, value: {} }) },
  }
  const defs = generateToolDefs(dummy)
  const gen = defs.find((d) => d.name === 'vgen_generate')
  assert.ok(gen, 'vgen_generate 定义存在')
  const rerunEnum = (gen.parameters as { properties: { rerunStage: { enum: string[] } } }).properties.rerunStage.enum
  assert.ok(rerunEnum.includes('music'), 'rerunStage 枚举须含 music')
})
