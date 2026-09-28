/** 通道保险库 v2：凭证层（Channel）+ 用途槽层（每槽恰好一条 SlotBinding）。
 *  0700/0600 + tmp+rename 原子写 + 损坏备份/形状守卫 + 全出口脱敏。
 *  v1（models[] 模型池 + defaultChannelId）在 load() 时经 migrate-vault 一次性迁移。
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { harnessHome } from './home.ts'
import { migrateV1ToV2 } from './migrate-vault.ts'
import {
  isProtocolFamily, isSlotId, parseMusicTemplate, parseSlotBinding,
  type MusicTemplate, type ProtocolFamily, type SlotBinding, type SlotId,
} from './slots.ts'

export {
  capabilityFlag, capabilityOf, isProtocolFamily, isSlotId, parseMusicTemplate, parseSlotBinding,
  sanitizeCapabilities, sanitizeMusicMapping, slotUnavailableMessage, PROTOCOL_FAMILIES, SLOT_IDS, SLOT_META,
  type CapabilityValue, type GenericMusicMapping, type MusicTemplate, type ProtocolFamily,
  type SlotBinding, type SlotId, type SlotKind, type SlotMeta,
} from './slots.ts'

export interface ChannelConfig {
  id: string
  label: string
  kind: 'openai-compat'
  baseUrl: string
  apiKey: string
  /** 实测/用户声明的协议族集合（信息性：供槽位绑定时的下拉提示；真实验证在槽位「测试」）。 */
  protocols: ProtocolFamily[]
  enabled: boolean
  createdAt: string
  verifiedAt?: string
  verifyNote?: string
}

export type GateMode = 'auto' | 'ask' | 'manual'

export interface VaultData {
  version: 2
  channels: ChannelConfig[]
  /** 每槽恰好一条绑定；结构性排除多候选（规格 §2.1）。 */
  slots: Partial<Record<SlotId, SlotBinding>>
  /** 用户另存的音乐映射模板（内置模板随插件数据提供，不落库，随版本刷新）。 */
  musicTemplates: MusicTemplate[]
  budget: { confirmThresholdCny: number }
  gateDefaults: Record<string, GateMode>
}

export function defaultVaultData(): VaultData {
  return {
    version: 2,
    channels: [],
    slots: {},
    musicTemplates: [],
    budget: { confirmThresholdCny: 1 },
    gateDefaults: {},
  }
}

export function resolveVaultPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = harnessHome(env)
  const base = home !== null ? join(home, '.dsh-video-generator') : join(homedir(), '.dsh-video-generator')
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
const MAX_USER_TEMPLATES = 20

export interface ChannelInput {
  id: string
  baseUrl: string
  apiKey: string
  label?: string
  enabled?: boolean
  protocols?: ProtocolFamily[]
}

function sanitizeChannels(raw: unknown): ChannelConfig[] {
  if (!Array.isArray(raw)) return []
  const out: ChannelConfig[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const c = item as Record<string, unknown>
    const id = typeof c.id === 'string' ? c.id : ''
    const baseUrl = typeof c.baseUrl === 'string' ? c.baseUrl : ''
    const apiKey = typeof c.apiKey === 'string' ? c.apiKey : ''
    if (!ID_RE.test(id) || !baseUrl || !apiKey) continue
    const protocols = Array.isArray(c.protocols)
      ? [...new Set(c.protocols.filter((p): p is ProtocolFamily => isProtocolFamily(p)))]
      : []
    const ch: ChannelConfig = {
      id,
      label: typeof c.label === 'string' && c.label.trim() ? c.label.slice(0, 80) : id,
      kind: 'openai-compat',
      baseUrl,
      apiKey,
      protocols,
      enabled: c.enabled !== false,
      createdAt: typeof c.createdAt === 'string' ? c.createdAt : '',
    }
    if (typeof c.verifiedAt === 'string' && c.verifiedAt) ch.verifiedAt = c.verifiedAt.slice(0, 40)
    if (typeof c.verifyNote === 'string' && c.verifyNote) ch.verifyNote = c.verifyNote.slice(0, 500)
    out.push(ch)
  }
  return out
}

function sanitizeSlots(raw: unknown): VaultData['slots'] {
  const out: VaultData['slots'] = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  for (const [slot, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSlotId(slot)) continue
    const binding = parseSlotBinding(slot, value)
    if (binding) out[slot] = binding
  }
  return out
}

function sanitizeMusicTemplates(raw: unknown): MusicTemplate[] {
  if (!Array.isArray(raw)) return []
  const out: MusicTemplate[] = []
  for (const item of raw) {
    const t = parseMusicTemplate(item)
    // 库里只存 user 模板（builtin 随插件数据提供）；历史误存者按 user 收编
    if (t && t.source === 'user') out.push({ ...t, source: 'user' })
  }
  return out.slice(0, MAX_USER_TEMPLATES)
}

/** 解析成功后的逐字段形状守卫：损坏但合法的 JSON 不带类型谎言入库。 */
export function sanitize(parsed: unknown): VaultData {
  const d = defaultVaultData()
  if (typeof parsed !== 'object' || parsed === null) return d
  const p = parsed as Partial<VaultData>
  d.channels = sanitizeChannels(p.channels)
  d.slots = sanitizeSlots(p.slots)
  d.musicTemplates = sanitizeMusicTemplates(p.musicTemplates)
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
    // v1（模型池 + defaultChannelId）→ 一次性迁移到 v2：备份原文件后原子替换（规格 §7）。
    if (typeof parsed === 'object' && parsed !== null && (parsed as { version?: unknown }).version === 1) {
      return migrateV1ToV2(this.file, raw, parsed, (d) => this.save(d))
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

  /* ── 通道（凭证层）── */

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
    const protocols = sanitizeProtocols(input.protocols)
    return this.mutate((d) => {
      if (d.channels.some((c) => c.id === id)) throw new VaultError('conflict', `通道已存在: ${id}`)
      if (d.channels.length >= MAX_CHANNELS) throw new VaultError('bad-request', `通道数超过上限 ${MAX_CHANNELS}`)
      const ch: ChannelConfig = {
        id,
        label,
        kind: 'openai-compat',
        baseUrl,
        apiKey,
        protocols,
        enabled: input.enabled ?? true,
        createdAt: new Date().toISOString(),
      }
      d.channels.push(ch)
      return masked(ch)
    })
  }

  updateChannel(
    id: string,
    patch: Partial<Pick<ChannelConfig, 'label' | 'baseUrl' | 'enabled' | 'protocols'>> & { apiKey?: string },
  ): MaskedChannel {
    const label = patch.label !== undefined ? String(patch.label).slice(0, 80) : undefined
    const baseUrl = patch.baseUrl !== undefined ? validateBaseUrl(patch.baseUrl) : undefined
    const protocols = patch.protocols !== undefined ? sanitizeProtocols(patch.protocols) : undefined
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
      if (protocols !== undefined) ch.protocols = protocols
      if (apiKey !== undefined) ch.apiKey = apiKey
      return masked(ch)
    })
  }

  /** 删除通道：引用它的槽位绑定一并清除（避免悬挂绑定），返回清除的槽位数。 */
  deleteChannel(id: string): { clearedSlots: SlotId[] } {
    return this.mutate((d) => {
      const before = d.channels.length
      d.channels = d.channels.filter((c) => c.id !== id)
      if (d.channels.length === before) throw new VaultError('not-found', `通道不存在: ${id}`)
      const clearedSlots: SlotId[] = []
      for (const [slot, binding] of Object.entries(d.slots) as Array<[SlotId, SlotBinding]>) {
        if (binding.channelId === id) {
          delete d.slots[slot]
          clearedSlots.push(slot)
        }
      }
      return { clearedSlots }
    })
  }

  markChannelVerified(id: string, note: string): MaskedChannel {
    return this.mutate((d) => {
      const ch = d.channels.find((c) => c.id === id)
      if (!ch) throw new VaultError('not-found', `通道不存在: ${id}`)
      ch.verifiedAt = new Date().toISOString()
      ch.verifyNote = note.slice(0, 500)
      return masked(ch)
    })
  }

  /* ── 用途槽（用途层，每槽一条绑定）── */

  listSlotBindings(): SlotBinding[] {
    const d = this.load()
    return (Object.keys(d.slots) as SlotId[]).map((s) => d.slots[s]!)
  }

  getSlotBinding(slot: SlotId): SlotBinding | null {
    if (!isSlotId(slot)) throw new VaultError('bad-request', `非法槽位: ${String(slot)}`)
    return this.load().slots[slot] ?? null
  }

  setSlotBinding(input: { slot: SlotId } & Record<string, unknown>): SlotBinding {
    if (!isSlotId(input.slot)) throw new VaultError('bad-request', `非法槽位: ${String(input.slot)}`)
    return this.mutate((d) => {
      const channelId = typeof input.channelId === 'string' ? input.channelId.trim() : ''
      if (!channelId) throw new VaultError('bad-request', `槽位 ${input.slot} 缺少 channelId`)
      if (!d.channels.some((c) => c.id === channelId)) throw new VaultError('not-found', `通道不存在: ${channelId}`)
      const binding = parseSlotBinding(input.slot, input)
      if (!binding) {
        const musicHint = input.slot === 'music.bgm' || input.slot === 'music.song'
          ? '（music 槽须提供完整的通用映射：endpoint.path / request.promptField / response.audioPath / mode）'
          : ''
        throw new VaultError('bad-request', `槽位 ${input.slot} 绑定字段非法：须含 channelId/model/protocol${musicHint}`)
      }
      d.slots[input.slot] = binding
      return binding
    })
  }

  clearSlotBinding(slot: SlotId): { cleared: boolean } {
    if (!isSlotId(slot)) throw new VaultError('bad-request', `非法槽位: ${String(slot)}`)
    return this.mutate((d) => {
      const cleared = slot in d.slots
      delete d.slots[slot]
      return { cleared }
    })
  }

  /* ── 音乐映射模板（仅 user 模板落库；builtin 随插件数据提供）── */

  listUserMusicTemplates(): MusicTemplate[] {
    return this.load().musicTemplates
  }

  saveMusicTemplate(input: { id?: unknown; label: unknown; fields: unknown; note?: unknown }): MusicTemplate {
    const label = typeof input.label === 'string' ? input.label.trim() : ''
    if (!label) throw new VaultError('bad-request', '模板 label 不能为空')
    return this.mutate((d) => {
      const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim().slice(0, 64) : `tpl-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
      const parsed = parseMusicTemplate({ id, label: label.slice(0, 80), source: 'user', fields: input.fields, note: input.note })
      if (!parsed) throw new VaultError('bad-request', '模板字段非法：须为完整通用映射（endpoint.path / request.promptField / response.audioPath / mode）')
      d.musicTemplates = [...d.musicTemplates.filter((t) => t.id !== parsed.id), parsed].slice(-MAX_USER_TEMPLATES)
      return parsed
    })
  }

  deleteMusicTemplate(id: string): void {
    this.mutate((d) => {
      const before = d.musicTemplates.length
      d.musicTemplates = d.musicTemplates.filter((t) => t.id !== id)
      if (d.musicTemplates.length === before) throw new VaultError('not-found', `模板不存在: ${id}`)
    })
  }

  /* ── 预算与 gate ── */

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

function sanitizeProtocols(raw: ProtocolFamily[] | undefined): ProtocolFamily[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new VaultError('bad-request', 'protocols 须为数组')
  const out: ProtocolFamily[] = []
  for (const p of raw) {
    if (!isProtocolFamily(p)) throw new VaultError('bad-request', `非法协议族: ${String(p)}`)
    if (!out.includes(p)) out.push(p)
  }
  return out
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
