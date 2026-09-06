/** 多通道三要素保险库：0700/0600 + tmp+rename 原子写 + 损坏备份/形状守卫 + 全出口脱敏。 */

import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type ModelKind = 'image' | 'video' | 'tts'

export interface ChannelModel {
  model: string
  kind: ModelKind
  endpointProfile?: string
  pricingCny?: number
  qualityTier?: number
}

export interface ChannelConfig {
  id: string
  label: string
  kind: 'openai-compat'
  baseUrl: string
  apiKey: string
  models: ChannelModel[]
  enabled: boolean
  createdAt: string
}

export type GateMode = 'auto' | 'ask' | 'manual'

export interface VaultData {
  version: 1
  channels: ChannelConfig[]
  defaultChannelId: string | null
  budget: { confirmThresholdCny: number }
  gateDefaults: Record<string, GateMode>
}

export function defaultVaultData(): VaultData {
  return {
    version: 1,
    channels: [],
    defaultChannelId: null,
    budget: { confirmThresholdCny: 1 },
    gateDefaults: {},
  }
}

export function resolveVaultPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env['DSH_HOME'] ? join(env['DSH_HOME']!, '.dsh-video-generator') : join(homedir(), '.dsh-video-generator')
  return join(base, 'vault.json')
}

export function maskCredential(s: string): string {
  if (s.length <= 8) return '••••'
  return `${s.slice(0, 3)}••••${s.slice(-3)}`
}

/** 显式声明字段 + 构造器体内赋值（Node strip-only 禁参数属性）。 */
export class VaultError extends Error {
  readonly code: 'bad-request' | 'not-found' | 'conflict'

  constructor(code: 'bad-request' | 'not-found' | 'conflict', message: string) {
    super(message)
    this.code = code
  }
}

export type MaskedChannel = Omit<ChannelConfig, 'apiKey'> & { apiKeyMasked: string }

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/
const MAX_CHANNELS = 20

export interface ChannelInput {
  id: string
  baseUrl: string
  apiKey: string
  label?: string
  models?: ChannelModel[]
  enabled?: boolean
}

/** 解析成功后的逐字段形状守卫：损坏但合法的 JSON 不带类型谎言入库。 */
function sanitize(parsed: unknown): VaultData {
  const d = defaultVaultData()
  if (typeof parsed !== 'object' || parsed === null) return d
  const p = parsed as Partial<VaultData>
  if (Array.isArray(p.channels)) d.channels = p.channels
  if (typeof p.defaultChannelId === 'string' || p.defaultChannelId === null) d.defaultChannelId = p.defaultChannelId ?? null
  const threshold = p.budget?.confirmThresholdCny
  if (typeof threshold === 'number' && Number.isFinite(threshold)) {
    d.budget = { confirmThresholdCny: threshold }
  }
  if (typeof p.gateDefaults === 'object' && p.gateDefaults !== null && !Array.isArray(p.gateDefaults)) d.gateDefaults = p.gateDefaults
  return d
}

/** 显式声明字段 + 构造器体内赋值（Node strip-only 禁参数属性）。 */
export class VaultStore {
  readonly file: string

  constructor(file: string) {
    this.file = file
  }

  static open(opts: { file?: string; env?: NodeJS.ProcessEnv } = {}): VaultStore {
    return new VaultStore(opts.file ?? resolveVaultPath(opts.env))
  }

  load(): VaultData {
    let raw: string
    try {
      raw = readFileSync(this.file, 'utf8')
    } catch (err) {
      // 仅 ENOENT 视为首次使用回退默认；EACCES 等权限/IO 故障原样抛出，明确失败好过静默空库。
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return defaultVaultData()
      throw err
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // 损坏现场先备份原字节（复用已读入的 raw，避免重复读盘；含明文 key 必须 0600 落盘），
      // 备份失败不阻塞回退，再从默认空库开始。
      try {
        writeFileSync(`${this.file}.broken-${Date.now()}`, raw, { mode: 0o600 })
      } catch {
        // 备份失败不阻塞回退
      }
      return defaultVaultData()
    }
    return sanitize(parsed)
  }

  save(data: VaultData): void {
    const dir = dirname(this.file)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    chmodSync(dir, 0o700)
    const tmp = `${this.file}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
    renameSync(tmp, this.file)
    chmodSync(this.file, 0o600)
  }

  private mutate<T>(fn: (d: VaultData) => T): T {
    const d = this.load()
    const out = fn(d)
    this.save(d)
    return out
  }

  listChannels(): MaskedChannel[] {
    return this.load().channels.map((c) => masked(c))
  }

  getChannel(id: string): ChannelConfig | null {
    return this.load().channels.find((c) => c.id === id) ?? null
  }

  createChannel(input: ChannelInput): MaskedChannel {
    const id = String(input.id ?? '')
    if (!ID_RE.test(id)) throw new VaultError('bad-request', `非法通道 id: ${id}`)
    const baseUrl = validateBaseUrl(input.baseUrl)
    const apiKey = String(input.apiKey ?? '').trim()
    if (apiKey.length < 8 || apiKey.length > 4096) throw new VaultError('bad-request', 'apiKey 长度须在 8..4096')
    const label = String(input.label ?? id).slice(0, 80)
    const models = validateModels(input.models ?? [])
    return this.mutate((d) => {
      if (d.channels.some((c) => c.id === id)) throw new VaultError('conflict', `通道已存在: ${id}`)
      if (d.channels.length >= MAX_CHANNELS) throw new VaultError('bad-request', `通道数超过上限 ${MAX_CHANNELS}`)
      const ch: ChannelConfig = {
        id,
        label,
        kind: 'openai-compat',
        baseUrl,
        apiKey,
        models,
        enabled: input.enabled ?? true,
        createdAt: new Date().toISOString(),
      }
      d.channels.push(ch)
      if (!d.defaultChannelId) d.defaultChannelId = id
      return masked(ch)
    })
  }

  updateChannel(id: string, patch: Partial<Pick<ChannelConfig, 'label' | 'baseUrl' | 'enabled' | 'models'>> & { apiKey?: string }): MaskedChannel {
    const label = patch.label !== undefined ? String(patch.label).slice(0, 80) : undefined
    const baseUrl = patch.baseUrl !== undefined ? validateBaseUrl(patch.baseUrl) : undefined
    const models = patch.models !== undefined ? validateModels(patch.models) : undefined
    let apiKey: string | undefined
    if (patch.apiKey !== undefined) {
      apiKey = String(patch.apiKey).trim()
      if (apiKey.length < 8 || apiKey.length > 4096) throw new VaultError('bad-request', 'apiKey 长度须在 8..4096')
    }
    return this.mutate((d) => {
      const ch = d.channels.find((c) => c.id === id)
      if (!ch) throw new VaultError('not-found', `通道不存在: ${id}`)
      if (label !== undefined) ch.label = label
      if (baseUrl !== undefined) ch.baseUrl = baseUrl
      if (patch.enabled !== undefined) ch.enabled = Boolean(patch.enabled)
      if (models !== undefined) ch.models = models
      if (apiKey !== undefined) ch.apiKey = apiKey
      return masked(ch)
    })
  }

  deleteChannel(id: string): void {
    this.mutate((d) => {
      const before = d.channels.length
      d.channels = d.channels.filter((c) => c.id !== id)
      if (d.channels.length === before) throw new VaultError('not-found', `通道不存在: ${id}`)
      if (d.defaultChannelId === id) d.defaultChannelId = d.channels[0]?.id ?? null
    })
  }

  setDefaultChannel(id: string | null): void {
    this.mutate((d) => {
      if (id !== null && !d.channels.some((c) => c.id === id)) throw new VaultError('not-found', `通道不存在: ${id}`)
      d.defaultChannelId = id
    })
  }

  getBudget(): VaultData['budget'] {
    return this.load().budget
  }

  setBudget(confirmThresholdCny: number): void {
    const v = Number(confirmThresholdCny)
    if (!Number.isFinite(v) || v < 0 || v > 10000) throw new VaultError('bad-request', '阈值须在 0..10000')
    this.mutate((d) => {
      d.budget = { confirmThresholdCny: v }
    })
  }

  getGateDefaults(): Record<string, GateMode> {
    return this.load().gateDefaults
  }

  setGateDefault(stage: string, mode: GateMode): void {
    if (!['auto', 'ask', 'manual'].includes(mode)) throw new VaultError('bad-request', `非法 gate 模式: ${mode}`)
    this.mutate((d) => {
      d.gateDefaults[stage] = mode
    })
  }
}

function masked(c: ChannelConfig): MaskedChannel {
  const { apiKey, ...rest } = c
  return { ...rest, apiKeyMasked: maskCredential(apiKey) }
}

function validateBaseUrl(u: string): string {
  const s = String(u ?? '').trim().replace(/\/+$/, '')
  let parsed: URL
  try {
    parsed = new URL(s)
  } catch {
    throw new VaultError('bad-request', `非法 baseUrl: ${u}`)
  }
  if (parsed.protocol === 'https:') return s
  if (parsed.protocol === 'http:' && process.env['VGEN_ALLOW_INSECURE'] === '1') return s
  throw new VaultError('bad-request', 'baseUrl 必须为 https（本地调试可设 VGEN_ALLOW_INSECURE=1）')
}

function validateModels(models: ChannelModel[]): ChannelModel[] {
  if (!Array.isArray(models) || models.length > 100) throw new VaultError('bad-request', 'models 须为数组且 ≤100')
  const seen = new Set<string>()
  return models.map((m) => {
    const model = String(m?.model ?? '')
    if (model.length < 1 || model.length > 200) throw new VaultError('bad-request', `非法模型名: ${m?.model}`)
    if (seen.has(model)) throw new VaultError('bad-request', `重复模型名: ${model}`)
    seen.add(model)
    if (!['image', 'video', 'tts'].includes(m?.kind)) throw new VaultError('bad-request', `非法模型 kind: ${m?.kind}`)
    const out: ChannelModel = { model, kind: m.kind }
    if (m.endpointProfile !== undefined) out.endpointProfile = String(m.endpointProfile).slice(0, 120)
    if (m.pricingCny !== undefined) {
      const p = Number(m.pricingCny)
      if (!Number.isFinite(p) || p < 0) throw new VaultError('bad-request', `非法 pricingCny: ${m.pricingCny}`)
      out.pricingCny = p
    }
    if (m.qualityTier !== undefined) {
      const q = Number(m.qualityTier)
      if (!Number.isInteger(q) || q < 0 || q > 10) throw new VaultError('bad-request', `非法 qualityTier: ${m.qualityTier}`)
      out.qualityTier = q
    }
    return out
  })
}
