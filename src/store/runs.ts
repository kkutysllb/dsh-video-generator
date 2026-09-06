/** run 持久化：每个 run 一个目录，run.json 即事实源（修鲸影内存 runs 之坑）。 */

import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export type StageState = 'pending' | 'done' | 'failed'
export type RunStatus = 'running' | 'done' | 'failed'

export interface RunEvent {
  at: string
  type: string
  detail?: Record<string, unknown>
}

export interface RunRecord {
  id: string
  title: string
  status: RunStatus
  stages: Record<string, StageState>
  events: RunEvent[]
  createdAt: string
  updatedAt: string
}

export function resolveRunsDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env['DSH_HOME'] ? join(env['DSH_HOME']!, '.dsh-video-generator') : join(homedir(), '.dsh-video-generator')
  return join(base, 'runs')
}

/** 解析成功后的最小形状守卫：id 必须与目录一致，核心字段缺失/类型不符的记录按损坏处理（对齐 vault）。 */
function sanitizeRun(raw: unknown, id: string): RunRecord | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Partial<RunRecord>
  if (typeof r.id !== 'string' || r.id !== id) return null
  if (r.status !== 'running' && r.status !== 'done' && r.status !== 'failed') return null
  if (typeof r.stages !== 'object' || r.stages === null || Array.isArray(r.stages)) return null
  if (!Array.isArray(r.events)) return null
  return {
    id: r.id,
    title: typeof r.title === 'string' ? r.title : 'untitled',
    status: r.status,
    stages: r.stages as Record<string, StageState>,
    events: r.events as RunEvent[],
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
  }
}

/** 约束：单进程使用（同步 API 串行化），跨进程并发写同一 runs 目录不在保障范围。 */
export class RunStore {
  readonly rootDir: string
  private lastStampMs = 0
  private brokenBackedUp = new Set<string>()

  constructor(rootDir: string) {
    this.rootDir = rootDir
  }

  /** 单调逻辑时钟：同实例内每次取号严格递增，毫秒粒度墙钟抖动下排序仍确定。
   * 单调性为实例级；跨实例/墙钟回拨窗口内 updatedAt 排序可能错位（仅影响列表顺序，不损数据）。 */
  private stamp(): string {
    const now = Date.now()
    this.lastStampMs = now > this.lastStampMs ? now : this.lastStampMs + 1
    return new Date(this.lastStampMs).toISOString()
  }

  static open(opts: { rootDir?: string; env?: NodeJS.ProcessEnv } = {}): RunStore {
    return new RunStore(opts.rootDir ?? resolveRunsDir(opts.env))
  }

  private dirOf(id: string): string {
    return join(this.rootDir, id)
  }

  private fileOf(id: string): string {
    return join(this.dirOf(id), 'run.json')
  }

  create(title: string): RunRecord {
    const now = this.stamp()
    const id = `run-${Date.now()}-${randomBytes(3).toString('hex')}`
    const record: RunRecord = {
      id,
      title: String(title ?? '').slice(0, 120) || 'untitled',
      status: 'running',
      stages: {},
      events: [],
      createdAt: now,
      updatedAt: now,
    }
    mkdirSync(this.dirOf(id), { recursive: true, mode: 0o700 })
    this.persist(record)
    return record
  }

  get(id: string): RunRecord | null {
    let raw: string
    try {
      raw = readFileSync(this.fileOf(id), 'utf8')
    } catch (err) {
      // 仅 ENOENT 视为正常不存在；EACCES 等权限/IO 故障原样抛出，明确失败好过静默丢数据（对齐 vault）。
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
    try {
      const record = sanitizeRun(JSON.parse(raw), id)
      if (record) return record
    } catch {
      // JSON.parse 抛错与形状不符同路径处理：备份后按不存在返回。
    }
    this.backupBroken(id, raw)
    return null
  }

  /** 损坏现场备份原字节（复用已读入的 raw 避免重复读盘，0600 落盘）；同实例内同一 id 只备份一次，
   *  避免 get/list 连续读同一损坏文件时 .broken-* 跨毫秒重复堆积；备份失败不阻塞按不存在处理。 */
  private backupBroken(id: string, raw: string): void {
    if (this.brokenBackedUp.has(id)) return
    this.brokenBackedUp.add(id)
    try {
      writeFileSync(`${this.fileOf(id)}.broken-${Date.now()}`, raw, { mode: 0o600 })
    } catch {
      // 备份失败不阻塞
    }
  }

  list(): RunRecord[] {
    let ids: string[] = []
    try {
      // withFileTypes 直接区分目录与杂散文件（.DS_Store 等），非目录条目跳过，避免 get() 触发 ENOTDIR 放大为整体失败。
      ids = readdirSync(this.rootDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    } catch {
      return []
    }
    return ids
      .map((id) => this.get(id))
      .filter((r): r is RunRecord => r !== null)
      .sort((a, b) => (a.updatedAt === b.updatedAt ? (a.id < b.id ? 1 : -1) : a.updatedAt < b.updatedAt ? 1 : -1))
  }

  mutate(id: string, fn: (r: RunRecord) => void): RunRecord | null {
    const record = this.get(id)
    if (!record) return null
    fn(record)
    record.updatedAt = this.stamp()
    this.persist(record)
    return record
  }

  appendEvent(id: string, type: string, detail?: Record<string, unknown>): void {
    this.mutate(id, (r) => {
      r.events.push({ at: this.stamp(), type, detail })
    })
  }

  setStage(id: string, stage: string, state: StageState): void {
    this.mutate(id, (r) => {
      r.stages[stage] = state
    })
  }

  setStatus(id: string, status: RunStatus): void {
    this.mutate(id, (r) => {
      r.status = status
    })
  }

  prune(keep = 50): number {
    const all = this.list()
    let removed = 0
    for (const r of all.slice(keep)) {
      rmSync(this.dirOf(r.id), { recursive: true, force: true })
      removed++
    }
    return removed
  }

  private persist(record: RunRecord): void {
    mkdirSync(this.dirOf(record.id), { recursive: true, mode: 0o700 })
    const tmp = `${this.fileOf(record.id)}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify(record, null, 2), { mode: 0o600 })
    renameSync(tmp, this.fileOf(record.id))
  }
}
