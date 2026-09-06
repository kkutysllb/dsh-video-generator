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

export class RunStore {
  readonly rootDir: string
  private lastStampMs = 0

  constructor(rootDir: string) {
    this.rootDir = rootDir
  }

  /** 单调逻辑时钟：同实例内每次取号严格递增，毫秒粒度墙钟抖动下排序仍确定。 */
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
    mkdirSync(this.dirOf(id), { recursive: true })
    this.persist(record)
    return record
  }

  get(id: string): RunRecord | null {
    try {
      return JSON.parse(readFileSync(this.fileOf(id), 'utf8')) as RunRecord
    } catch {
      return null
    }
  }

  list(): RunRecord[] {
    let ids: string[] = []
    try {
      ids = readdirSync(this.rootDir)
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
    mkdirSync(this.dirOf(record.id), { recursive: true })
    const tmp = `${this.fileOf(record.id)}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify(record, null, 2))
    renameSync(tmp, this.fileOf(record.id))
  }
}
