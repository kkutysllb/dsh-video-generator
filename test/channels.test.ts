import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultStore } from '../src/store/vault.ts'
import { RunStore } from '../src/store/runs.ts'
import { buildChannelsTools } from '../src/tools/channels.ts'

function seedVault(): VaultStore {
  const vault = VaultStore.open({ file: join(mkdtempSync(join(tmpdir(), 'vgen-ch-v-')), 'vault.json') })
  vault.createChannel({ id: 'relay-a', baseUrl: 'https://api.example.com', apiKey: 'sk-abcdefgh12345678', label: 'A 站', models: [{ model: 'happyhorse-1.1-i2v', kind: 'video' }] })
  return vault
}

test('list：脱敏通道 + 默认 + 预算 + gateDefaults', async () => {
  const vault = seedVault()
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-ch-r-')) })
  const tools = buildChannelsTools({ vault, runs })
  const r = await tools.channels.execute({ action: 'list' })
  assert.equal(r.ok, true)
  const s = JSON.stringify(r)
  assert.ok(!s.includes('sk-abcdefgh12345678'))
  assert.ok(s.includes('••••'))
  const v = (r as { value: { defaultChannelId: string } }).value
  assert.equal(v.defaultChannelId, 'relay-a')
})

test('health：probe 注入结果透传 + 估价（pricing 注入）', async () => {
  const vault = seedVault()
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-ch-r2-')) })
  const tools = buildChannelsTools({
    vault, runs,
    probe: async () => ({ ok: true, baseUrl: 'https://api.example.com', models: ['m1', 'm2', 'm3'], status: 200 }),
    // PricingTable = Map<string, PricingRow>（src/pricing.ts），quota_type=1 才可按次估价
    fetchPricingImpl: async () => new Map([['happyhorse-1.1-i2v', { model_name: 'happyhorse-1.1-i2v', quota_type: 1, model_ratio: 1, model_price: 0.35 }]]),
  })
  const r = await tools.channels.execute({ action: 'health' })
  assert.equal(r.ok, true)
  const v = (r as { value: { probe: { ok: boolean; models: number }; estimates: Array<{ estCny: number | null }> } }).value
  assert.equal(v.probe.ok, true)
  assert.equal(v.probe.models, 3)
  assert.equal(v.estimates[0]?.estCny, 0.35)
  assert.ok(!JSON.stringify(r).includes('sk-abcdefgh'))
})

test('health：无通道 → not-found', async () => {
  const vault = VaultStore.open({ file: join(mkdtempSync(join(tmpdir(), 'vgen-ch-v3-')), 'vault.json') })
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-ch-r3-')) })
  const tools = buildChannelsTools({ vault, runs, probe: async () => ({ ok: true, baseUrl: '', models: [], status: 200 }) })
  const r = await tools.channels.execute({ action: 'health' })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error.code, 'not-found')
})

test('spend：run 事件聚合（非数字 estCny 忽略）', async () => {
  const vault = seedVault()
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-ch-r4-')) })
  const run = runs.create('花费 run')
  runs.appendEvent(run.id, 'spend', { stage: 'video', estCny: 0.35 })
  runs.appendEvent(run.id, 'spend', { stage: 'video', estCny: 'bad' })
  runs.appendEvent(run.id, 'spend', { stage: 'image' })
  const tools = buildChannelsTools({ vault, runs, env: { DSH_HOME: mkdtempSync(join(tmpdir(), 'vgen-ch-h-')) } as NodeJS.ProcessEnv })
  const r = await tools.channels.execute({ action: 'spend' })
  assert.equal(r.ok, true)
  const v = (r as { value: { runs: Array<{ entries: number; estCny: number }> } }).value
  assert.equal(v.runs[0]?.entries, 3)
  assert.equal(v.runs[0]?.estCny, 0.35)
})

test('非法 action → bad-request', async () => {
  const vault = seedVault()
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-ch-r5-')) })
  const tools = buildChannelsTools({ vault, runs })
  const r = await tools.channels.execute({ action: 'nuke' as 'list' })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error.code, 'bad-request')
})
