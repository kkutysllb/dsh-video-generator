// test/contract-017.test.ts
/** DSH 0.1.7-rc.2 适配契约哨兵：manifest 双通道清单、peer 兼容门声明、版本同源、宿主服务面。
 *  依据：本地 fork deepseek-harness@0.1.7-rc.2（evaluatePluginCompatibility / DshClientManifest）
 *  与 KCoder 上游差异分析「核心契约层变更」口径。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_ID, PLUGIN_VERSION } from '../src/host/routes.ts'
import { inject as hostInject } from '../src/host/index.ts'

const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as {
  version: string
  dsh?: { bundle?: { patch?: string }; client?: { platform?: string; inject?: string[] } }
  qilin?: { bundle?: { patch?: string }; client?: { platform?: string; inject?: string[] } }
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

/** 兼容门范围（与 super-ppts 1.4.3 同口径；右支为 QiLin 3.x 运行时号预留）。 */
const PEER_RANGE = '>=0.1.0-rc.5 <0.2.0 || >=3.0.0 <4.0.0'

test('manifest：死包清零 + 两通道 inject 清单一致（dsh / qilin）', () => {
  const dshInject = pkg.dsh?.client?.inject ?? []
  const qilinInject = pkg.qilin?.client?.inject ?? []
  assert.deepEqual(dshInject, qilinInject, 'dsh/qilin 两通道 inject 清单必须一致')
  // @deepseek-ai/dsh-client-runtime 0.1.7 已删包：任何通道清单/正文都不许再出现
  assert.ok(!JSON.stringify(pkg).includes('dsh-client-runtime'), 'dsh-client-runtime 已删包，清单必须清零')
  assert.ok(dshInject.length > 0, 'inject 清单不应为空')
  for (const name of dshInject) assert.match(name, /^@deepseek-ai\/dsh-/)
  assert.equal(pkg.dsh?.client?.platform, 'web')
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(pkg.qilin?.bundle?.patch, './cordis.patch.yml')
})

test('manifest：peer 兼容门声明——集合 = @deepseek-ai/dsh ∪ client.inject，且全部 optional', () => {
  const peers = pkg.peerDependencies ?? {}
  const expected = ['@deepseek-ai/dsh', ...(pkg.dsh?.client?.inject ?? [])].sort()
  assert.deepEqual(Object.keys(peers).sort(), expected, 'peer 集合 = @deepseek-ai/dsh ∪ client.inject')
  for (const [name, range] of Object.entries(peers)) {
    assert.equal(range, PEER_RANGE, 'peer ' + name + ' 范围应为 ' + PEER_RANGE)
    // optional 是硬要求：非 optional 的宽范围 peer 会让 pnpm 静默把引擎树拉进用户 profile
    assert.equal(pkg.peerDependenciesMeta?.[name]?.optional, true, 'peer ' + name + ' 必须 optional')
  }
})

test('peer 范围语义：0.1.x 预发布走左支、QiLin 3.x 走右支（宿主 includePrerelease 口径）', () => {
  const clauses = PEER_RANGE.split('||').map((c) => c.trim())
  assert.deepEqual(clauses, ['>=0.1.0-rc.5 <0.2.0', '>=3.0.0 <4.0.0'])
  for (const clause of clauses) {
    const parts = clause.split(' ')
    assert.equal(parts.length, 2, '每支须为「下界 + 上界」双比较器')
  }
})

test('版本同源与宿主服务面：PLUGIN_VERSION == package.json；inject 四服务与 0.1.7 宿主同名', () => {
  assert.equal(PLUGIN_VERSION, pkg.version, 'PLUGIN_VERSION 必须与 package.json 同步')
  assert.equal(PLUGIN_ID, 'dsh-video-generator')
  // 0.1.7-rc.2 核实稳定面：webServer/tools/systemPrompt/workspaceRegistry 全部在场
  assert.deepEqual(hostInject, ['webServer', 'tools', 'systemPrompt', 'workspaceRegistry'])
})
