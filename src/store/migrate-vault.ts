/** vault v1 → v2 一次性迁移（规格 2026-09-28 §7）。
 *
 *  v1 的有效选型只来自 defaultChannelId 通道的 models[]（其余通道的模型在 v1 运行时
 *  根本不会被选中），因此迁移规则：取 defaultChannelId ?? 首个 enabled ?? 首个通道
 *  的 models[]，按 kind 各取第一项填入对应槽位；image.master 与 image.shot 同源；
 *  music.* 留空（新增能力，不猜）。models[]/defaultChannelId 本身不迁移（备份保留）。
 *
 *  幂等：仅当 parsed.version === 1 时被调用（vault.load() 把关）；备份写失败不阻塞
 *  迁移（channels/baseUrl/apiKey 全量保留，仅 models 清单可能丢失，日志明示）。
 */

import { writeFileSync } from 'node:fs'
import type { ChannelConfig, VaultData } from './vault.ts'
import { defaultVaultData } from './vault.ts'
import { parseSlotBinding, type SlotBinding, type SlotId } from './slots.ts'

interface V1Model {
  model: string
  kind: 'image' | 'video' | 'tts'
}

interface V1Channel {
  id: string
  label: string
  baseUrl: string
  apiKey: string
  enabled: boolean
  createdAt: string
  models: V1Model[]
}

/** v1 形状轻守卫：只提取迁移需要的字段（models 逐条校验 kind 白名单）。 */
function extractV1Channels(parsedV1: unknown): V1Channel[] {
  const v1 = (typeof parsedV1 === 'object' && parsedV1 !== null ? parsedV1 : {}) as Record<string, unknown>
  if (!Array.isArray(v1.channels)) return []
  const out: V1Channel[] = []
  for (const item of v1.channels) {
    if (typeof item !== 'object' || item === null) continue
    const c = item as Record<string, unknown>
    const id = typeof c.id === 'string' ? c.id : ''
    const baseUrl = typeof c.baseUrl === 'string' ? c.baseUrl : ''
    const apiKey = typeof c.apiKey === 'string' ? c.apiKey : ''
    if (!id || !baseUrl || !apiKey) continue
    const models: V1Model[] = []
    if (Array.isArray(c.models)) {
      for (const m of c.models) {
        if (typeof m !== 'object' || m === null) continue
        const model = (m as Record<string, unknown>).model
        const kind = (m as Record<string, unknown>).kind
        if (typeof model === 'string' && model && (kind === 'image' || kind === 'video' || kind === 'tts')) {
          models.push({ model, kind })
        }
      }
    }
    out.push({
      id,
      label: typeof c.label === 'string' && c.label.trim() ? c.label.slice(0, 80) : id,
      baseUrl,
      apiKey,
      enabled: c.enabled !== false,
      createdAt: typeof c.createdAt === 'string' ? c.createdAt : '',
      models,
    })
  }
  return out
}

export function migrateV1ToV2(
  file: string,
  rawV1: string,
  parsedV1: unknown,
  save: (d: VaultData) => void,
): VaultData {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupFile = `${file}.v1.bak-${stamp}`
  try {
    writeFileSync(backupFile, rawV1, { mode: 0o600 })
  } catch (err) {
    console.error(
      '[dsh-video-generator] vault v1→v2 迁移：备份写入失败（继续迁移，models 清单可能无法从备份恢复）:',
      err instanceof Error ? err.message : err,
    )
  }

  const v1Channels = extractV1Channels(parsedV1)
  const d: VaultData = { ...defaultVaultData() }

  // ── 通道（凭证层；v1 的 models/endpointProfile 丢弃）──
  d.channels = v1Channels.map((c) => {
    const ch: ChannelConfig = {
      id: c.id,
      label: c.label,
      kind: 'openai-compat',
      baseUrl: c.baseUrl,
      apiKey: c.apiKey,
      protocols: [],
      enabled: c.enabled,
      createdAt: c.createdAt,
    }
    return ch
  })

  // ── 槽位：从默认（或首个可用/首个）通道的 models[] 迁移 ──
  const defaultId = (() => {
    const v1 = (typeof parsedV1 === 'object' && parsedV1 !== null ? parsedV1 : {}) as Record<string, unknown>
    return typeof v1.defaultChannelId === 'string' ? v1.defaultChannelId : null
  })()
  const source =
    v1Channels.find((c) => c.id === defaultId) ?? v1Channels.find((c) => c.enabled) ?? v1Channels[0]
  const firstOfKind = (kind: V1Model['kind']): V1Model | null =>
    source?.models.find((m) => m.kind === kind) ?? null

  const putSlot = (input: Omit<SlotBinding, 'capabilities'> & { capabilities?: Record<string, boolean> }): void => {
    const binding = parseSlotBinding(input.slot, input)
    if (binding) d.slots[input.slot] = binding
  }

  const image = firstOfKind('image')
  if (image && source) {
    for (const slot of ['image.master', 'image.shot'] as const) {
      putSlot({ slot, channelId: source.id, model: image.model, protocol: 'openai-images' })
    }
  }
  const video = firstOfKind('video')
  if (video && source) {
    putSlot({
      slot: 'video',
      channelId: source.id,
      model: video.model,
      // v1 协议启发式：kling 名走 kling 原生，其余（含 wan/happyhorse 与未知）走 DashScope 透传
      protocol: /kling/i.test(video.model) ? 'kling-video' : 'dashscope-video',
      capabilities: { textToVideo: /(?:t2v|text2video)/i.test(video.model) },
    })
  }
  const tts = firstOfKind('tts')
  if (tts && source) {
    putSlot({ slot: 'tts', channelId: source.id, model: tts.model, protocol: 'openai-tts' })
  }

  // ── 预算与 gate 原样保留 ──
  const v1 = (typeof parsedV1 === 'object' && parsedV1 !== null ? parsedV1 : {}) as Record<string, unknown>
  const threshold = (v1.budget as { confirmThresholdCny?: unknown } | undefined)?.confirmThresholdCny
  if (typeof threshold === 'number' && Number.isFinite(threshold)) d.budget = { confirmThresholdCny: threshold }
  if (typeof v1.gateDefaults === 'object' && v1.gateDefaults !== null && !Array.isArray(v1.gateDefaults)) {
    d.gateDefaults = v1.gateDefaults as VaultData['gateDefaults']
  }

  save(d)
  console.log(
    `[dsh-video-generator] vault v1→v2 迁移完成：备份 ${backupFile}；` +
      `迁移槽位 ${(Object.keys(d.slots) as SlotId[]).join(', ') || '（无）'}；music.* 留空待配置`,
  )
  return d
}
