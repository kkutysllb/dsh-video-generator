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
  if (typeof p.gateDefaults === 'object' && p.gateDefaults !== null) d.gateDefaults = p.gateDefaults
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
      // 损坏现场先备份原字节（复制失败不阻塞回退），再从默认空库开始。
      try {
        writeFileSync(`${this.file}.broken-${Date.now()}`, readFileSync(this.file))
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
}
