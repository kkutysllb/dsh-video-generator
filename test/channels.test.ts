/** vgen_channels 工具单测（规格 §7.1）：新 list 形状（channels+slots+slotMeta+budget+gateDefaults）、
 *  health 按绑定槽估价（probe/pricing 注入）、markChannelVerified、spend 聚合。 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SLOT_META, type SlotBinding } from '../src/store/slots.ts'
import { VaultError, VaultStore } from '../src/store/vault.ts'
import { RunStore } from '../src/store/runs.ts'
import { buildChannelsTools } from '../src/tools/channels.ts'

function setup(): { vault: VaultStore; runs: RunStore; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'vgen-ch-v-'))
  const runsDir = mkdtempSync(join(tmpdir(), 'vgen-ch-r-'))
  const vault = VaultStore.open({ file: join(home, 'vault.json') })
  const runs = RunStore.open({ rootDir: runsDir })
  const cleanup = (): void => {
    rmSync(home, { recursive: true, force: true })
    rmSync(runsDir, { recursive: true, force: true })
  }
  return { vault, runs, cleanup }
}

/** 主通道 + video 槽绑定（每个用途槽各自绑定通道：已无默认通道概念）。 */
function seed(vault: VaultStore): void {
  vault.createChannel({ id: 'relay-a', baseUrl: 'https://api.example.com', apiKey: 'sk-abcdefgh12345678', label: 'A 站' })
  vault.setSlotBinding({
    slot: 'video', channelId: 'relay-a', model: 'happyhorse-1.1-i2v',
    protocol: 'dashscope-video', capabilities: { textToVideo: true },
  })
}

test('list：新形状 {channels, slots, slotMeta, budget, gateDefaults} 且全出口脱敏', async () => {
  const { vault, runs, cleanup } = setup()
  try {
    seed(vault)
    const tools = buildChannelsTools({ vault, runs })
    const r = await tools.channels.execute({ action: 'list' })
    assert.equal(r.ok, true)
    const s = JSON.stringify(r)
    assert.ok(!s.includes('sk-abcdefgh12345678'))
    assert.ok(s.includes('••••'))
    const v = (r as { value: {
      channels: Array<{ id: string; apiKeyMasked: string; models?: unknown }>
      slots: SlotBinding[]
      slotMeta: typeof SLOT_META
      budget: { confirmThresholdCny: number }
      gateDefaults: Record<string, string>
    } }).value
    // 通道脱敏、无 models 字段
    assert.equal(v.channels.length, 1)
    assert.equal(v.channels[0]!.id, 'relay-a')
    assert.equal(v.channels[0]!.apiKeyMasked, 'sk-••••678')
    assert.ok(!('apiKey' in v.channels[0]!))
    assert.ok(!('models' in v.channels[0]!))
    // 用途槽绑定 + 槽位元数据（Host/客户端同源）
    assert.equal(v.slots.length, 1)
    assert.equal(v.slots[0]!.slot, 'video')
    assert.equal(v.slots[0]!.model, 'happyhorse-1.1-i2v')
    assert.equal(v.slotMeta['video'].label, '视频')
    assert.deepEqual(Object.keys(v.slotMeta), Object.keys(SLOT_META))
    // 预算与 gate 缺省
    assert.equal(v.budget.confirmThresholdCny, 1)
    assert.deepEqual(v.gateDefaults, {})
  } finally {
    cleanup()
  }
})

test('createChannel 不再收 models；updateChannel 可写 protocols（非法 → bad-request）', () => {
  const { vault, cleanup } = setup()
  try {
    const masked = vault.createChannel({ id: 'relay-b', baseUrl: 'https://b.example.com', apiKey: 'sk-vgen-bbbbbbbb' })
    assert.ok(!('models' in masked))
    assert.deepEqual(vault.getChannel('relay-b')?.protocols, [])
    const updated = vault.updateChannel('relay-b', { protocols: ['openai-images', 'generic-music'] })
    assert.deepEqual(updated.protocols, ['openai-images', 'generic-music'])
    assert.deepEqual(vault.getChannel('relay-b')?.protocols, ['openai-images', 'generic-music'])
    assert.throws(
      () => vault.updateChannel('relay-b', { protocols: ['minimax-music'] as never }),
      (err: unknown) => err instanceof VaultError && err.code === 'bad-request',
    )
  } finally {
    cleanup()
  }
})

test('health：绑定槽估价（probe + pricing 注入，estimates=[{slot,model,estCny}]）', async () => {
  const { vault, runs, cleanup } = setup()
  try {
    seed(vault)
    const tools = buildChannelsTools({
      vault, runs,
      probe: async () => ({ ok: true, baseUrl: 'https://api.example.com', models: ['m1', 'm2', 'm3'], status: 200 }),
      // PricingTable = Map<string, PricingRow>（src/pricing.ts），quota_type=1 才可按次估价
      fetchPricingImpl: async () => new Map([['happyhorse-1.1-i2v', { model_name: 'happyhorse-1.1-i2v', quota_type: 1, model_ratio: 1, model_price: 0.35 }]]),
    })
    const r = await tools.channels.execute({ action: 'health', channelId: 'relay-a' })
    assert.equal(r.ok, true)
    const v = (r as { value: {
      channelId: string
      probe: { ok: boolean; models: number }
      pricingAvailable: boolean
      estimates: Array<{ slot: string; model: string; estCny: number | null }>
    } }).value
    assert.equal(v.channelId, 'relay-a')
    assert.equal(v.probe.ok, true)
    assert.equal(v.probe.models, 3)
    assert.equal(v.pricingAvailable, true)
    // 估价对象 = 绑定到该通道的槽位模型
    assert.deepEqual(v.estimates, [{ slot: 'video', model: 'happyhorse-1.1-i2v', estCny: 0.35 }])
    assert.ok(!JSON.stringify(r).includes('sk-abcdefgh'))
  } finally {
    cleanup()
  }
})

test('health：未绑定槽的通道 → estimates 为空数组', async () => {
  const { vault, runs, cleanup } = setup()
  try {
    vault.createChannel({ id: 'bare', baseUrl: 'https://bare.example.com', apiKey: 'sk-vgen-bare12345' })
    const tools = buildChannelsTools({ vault, runs, probe: async () => ({ ok: true, baseUrl: '', models: [], status: 200 }) })
    const r = await tools.channels.execute({ action: 'health', channelId: 'bare' })
    assert.equal(r.ok, true)
    assert.deepEqual((r as { value: { estimates: unknown[] } }).value.estimates, [])
  } finally {
    cleanup()
  }
})

test('health：不指定 channelId → not-found（已无默认通道概念，提示 channelId）', async () => {
  const { vault, runs, cleanup } = setup()
  try {
    seed(vault)
    const tools = buildChannelsTools({ vault, runs, probe: async () => ({ ok: true, baseUrl: '', models: [], status: 200 }) })
    const r = await tools.channels.execute({ action: 'health' })
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.error.code, 'not-found')
      assert.ok(r.error.message.includes('channelId'))
    }
  } finally {
    cleanup()
  }
})

test('health：未知 channelId → not-found', async () => {
  const { vault, runs, cleanup } = setup()
  try {
    seed(vault)
    const tools = buildChannelsTools({ vault, runs, probe: async () => ({ ok: true, baseUrl: '', models: [], status: 200 }) })
    const r = await tools.channels.execute({ action: 'health', channelId: 'ghost' })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.error.code, 'not-found')
  } finally {
    cleanup()
  }
})

test('markChannelVerified：写 verifiedAt/verifyNote，出口脱敏', () => {
  const { vault, cleanup } = setup()
  try {
    vault.createChannel({ id: 'relay-c', baseUrl: 'https://c.example.com', apiKey: 'sk-vgen-cccccccc' })
    const masked = vault.markChannelVerified('relay-c', '实测 200 OK')
    assert.ok(masked.verifiedAt)
    assert.ok(!Number.isNaN(Date.parse(masked.verifiedAt)))
    assert.equal(masked.verifyNote, '实测 200 OK')
    assert.ok(!('apiKey' in masked))
    assert.equal(vault.getChannel('relay-c')?.verifiedAt, masked.verifiedAt)
  } finally {
    cleanup()
  }
})

test('spend：run 事件聚合（非数字 estCny 忽略）', async () => {
  const { vault, runs, cleanup } = setup()
  const ledgerHome = mkdtempSync(join(tmpdir(), 'vgen-ch-h-'))
  try {
    seed(vault)
    const run = runs.create('花费 run')
    runs.appendEvent(run.id, 'spend', { stage: 'video', estCny: 0.35 })
    runs.appendEvent(run.id, 'spend', { stage: 'video', estCny: 'bad' })
    runs.appendEvent(run.id, 'spend', { stage: 'image' })
    const tools = buildChannelsTools({ vault, runs, env: { DSH_HOME: ledgerHome } as NodeJS.ProcessEnv })
    const r = await tools.channels.execute({ action: 'spend' })
    assert.equal(r.ok, true)
    const v = (r as { value: { runs: Array<{ entries: number; estCny: number }> } }).value
    assert.equal(v.runs[0]?.entries, 3)
    assert.equal(v.runs[0]?.estCny, 0.35)
  } finally {
    rmSync(ledgerHome, { recursive: true, force: true })
    cleanup()
  }
})

test('非法 action → bad-request', async () => {
  const { vault, runs, cleanup } = setup()
  try {
    seed(vault)
    const tools = buildChannelsTools({ vault, runs })
    const r = await tools.channels.execute({ action: 'nuke' as 'list' })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.error.code, 'bad-request')
  } finally {
    cleanup()
  }
})
