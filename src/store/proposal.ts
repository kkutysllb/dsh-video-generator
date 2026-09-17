/** 提案持久化与审核闭环（规格 §7）：Agent 的一切内容产出先落 Proposal，
 * 用户在页面审核（可编辑）并显式「应用」后才写入权威文件。
 *
 * - 提案文件不删除：applied/rejected + 时间 + 备注留痕，供版本历史追溯；
 * - pending 上限 20/项目，超出拒绝新提案；
 * - 应用时的 revision 检查以目标资产**当前 revision** 为准：当前 revision ≠ 提案
 *   baseRevision → 置 stale 并拒绝（proposal-stale），需重新生成或基于最新重审。
 */

import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAssetRef, ProjectStore, validateReplacement, ABSENT_REVISION, DramaError, type Revision } from './project.ts'

export type ProposalStatus = 'pending' | 'applied' | 'rejected' | 'stale'

export interface ProposalRecord {
  proposalId: string
  projectId: string
  taskId?: string
  assetRef: string
  baseRevision: Revision
  /** 提案正文：json 资产为对象，markdown 资产为字符串。 */
  replacement: unknown
  summary: string
  /** 由 assetRef 派生的提案类别（premise / architecture / … / chapter-draft / chapter-final）。 */
  kind: string
  status: ProposalStatus
  createdBy: string
  createdAt: string
  decidedAt?: string
  note?: string
  /** 应用后的新版本号（留痕）。 */
  appliedRevision?: Revision
}

export interface ProposalSummary {
  proposalId: string
  assetRef: string
  kind: string
  status: ProposalStatus
  summary: string
  baseRevision: Revision
  /** 目标资产当前 revision 与提案 baseRevision 是否一致（false = 已过期）。 */
  fresh: boolean
  createdBy: string
  createdAt: string
  decidedAt?: string
  note?: string
  taskId?: string
}

const PROPOSAL_ID_RE = /^prop-[0-9a-z][0-9a-z-]{0,63}$/
const MAX_PENDING = 20
const MAX_SUMMARY = 2000
const MAX_NOTE = 2000

function proposalKind(assetRef: string): string {
  const chapter = /^chapters\/(\d{4})\/(blueprint|draft|review|final)$/.exec(assetRef)
  if (chapter) return `chapter-${chapter[2]}`
  return assetRef
}

/** 读写共用形状守卫：任一字段非法整体拒绝（读侧返回 null 按损坏处理）。 */
function sanitizeProposal(v: unknown): ProposalRecord | null {
  try {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
    const p = v as Record<string, unknown>
    const s = (x: unknown, max: number): string => (typeof x === 'string' ? x.slice(0, max) : '')
    const assetRef = s(p['assetRef'], 120)
    if (!parseAssetRef(assetRef)) return null
    const status = p['status']
    if (status !== 'pending' && status !== 'applied' && status !== 'rejected' && status !== 'stale') return null
    const baseRevision = s(p['baseRevision'], 80) || ABSENT_REVISION
    return {
      proposalId: s(p['proposalId'], 64),
      projectId: s(p['projectId'], 64),
      ...(typeof p['taskId'] === 'string' && p['taskId'] ? { taskId: p['taskId'].slice(0, 64) } : {}),
      assetRef,
      baseRevision,
      replacement: p['replacement'],
      summary: s(p['summary'], MAX_SUMMARY),
      kind: s(p['kind'], 64) || proposalKind(assetRef),
      status,
      createdBy: s(p['createdBy'], 120) || 'agent',
      createdAt: typeof p['createdAt'] === 'string' ? p['createdAt'] : '',
      ...(typeof p['decidedAt'] === 'string' ? { decidedAt: p['decidedAt'] } : {}),
      ...(typeof p['note'] === 'string' ? { note: p['note'].slice(0, MAX_NOTE) } : {}),
      ...(typeof p['appliedRevision'] === 'string' ? { appliedRevision: p['appliedRevision'] } : {}),
    }
  } catch {
    return null
  }
}

export class ProposalStore {
  private projects: ProjectStore

  constructor(projects: ProjectStore) {
    this.projects = projects
  }

  private fileOf(projectId: string, proposalId: string): string {
    if (!PROPOSAL_ID_RE.test(proposalId)) throw new DramaError('bad-request', `非法提案 id: ${proposalId}`)
    return join(this.projects.projectDir(projectId), 'proposals', `${proposalId}.json`)
  }

  private read(projectId: string, proposalId: string): ProposalRecord | null {
    let raw: string
    try {
      raw = readFileSync(this.fileOf(projectId, proposalId), 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
    try {
      const record = sanitizeProposal(JSON.parse(raw))
      if (record) return record
    } catch {
      // JSON 损坏 → 按不存在（留痕文件缺一条不阻塞项目使用）
    }
    return null
  }

  private write(record: ProposalRecord): void {
    const file = this.fileOf(record.projectId, record.proposalId)
    mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 })
    const tmp = `${file}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 })
    renameSync(tmp, file)
  }

  list(projectId: string, status?: ProposalStatus): ProposalRecord[] {
    this.projects.requireProject(projectId)
    const dir = join(this.projects.projectDir(projectId), 'proposals')
    let names: string[] = []
    try {
      names = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && PROPOSAL_ID_RE.test(e.name.replace(/\.json$/, '')))
        .map((e) => e.name)
    } catch {
      return []
    }
    const out: ProposalRecord[] = []
    for (const name of names) {
      const r = this.read(projectId, name.replace(/\.json$/, ''))
      if (r && (!status || r.status === status)) out.push(r)
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }

  get(projectId: string, proposalId: string): ProposalRecord | null {
    return this.read(projectId, proposalId)
  }

  requireProposal(projectId: string, proposalId: string): ProposalRecord {
    const p = this.read(projectId, proposalId)
    if (!p) throw new DramaError('not-found', `提案不存在: ${proposalId}`)
    return p
  }

  pendingCount(projectId: string): number {
    return this.list(projectId, 'pending').length
  }

  /** 落提案（Agent / 页面共用）：绝不写权威文件；形状校验与写入同契约。 */
  create(
    projectId: string,
    input: { assetRef: string; baseRevision: Revision; replacement: unknown; summary: string; taskId?: string; createdBy?: string },
  ): ProposalRecord {
    const parsed = parseAssetRef(input.assetRef)
    if (!parsed) throw new DramaError('bad-request', `未知资产: ${String(input.assetRef)}`)
    this.projects.requireProject(projectId)
    // 形状校验（不落盘）：提案正文与最终写入同一形状契约
    validateReplacement(parsed.label, parsed.kind, input.replacement)
    if (this.pendingCount(projectId) >= MAX_PENDING) {
      throw new DramaError('proposal-limit', `待审核提案已达上限 ${MAX_PENDING}/项目，请先处理既有提案`)
    }
    const record: ProposalRecord = {
      proposalId: `prop-${Date.now()}-${randomBytes(3).toString('hex')}`,
      projectId,
      ...(input.taskId ? { taskId: input.taskId.slice(0, 64) } : {}),
      assetRef: parsed.label,
      baseRevision: input.baseRevision || ABSENT_REVISION,
      replacement: input.replacement,
      summary: String(input.summary ?? '').slice(0, MAX_SUMMARY),
      kind: proposalKind(parsed.label),
      status: 'pending',
      createdBy: input.createdBy ? input.createdBy.slice(0, 120) : 'agent',
      createdAt: new Date().toISOString(),
    }
    this.write(record)
    this.projects.touch(projectId)
    return record
  }

  /** 应用提案（可选携带用户编辑后的 replacement）：revision 以目标资产当前值为准。 */
  apply(projectId: string, proposalId: string, replacement?: unknown): { revision: Revision } {
    const record = this.requireProposal(projectId, proposalId)
    if (record.status !== 'pending') {
      throw new DramaError('conflict', `提案状态为 ${record.status}，仅 pending 提案可应用`)
    }
    const parsed = parseAssetRef(record.assetRef)
    if (!parsed) throw new DramaError('internal', `提案资产引用损坏: ${record.assetRef}`)
    const current = this.projects.revisionOf(parsed, projectId)
    if (current !== record.baseRevision) {
      record.status = 'stale'
      record.decidedAt = new Date().toISOString()
      this.write(record)
      throw new DramaError(
        'proposal-stale',
        `提案已过期：资产 ${record.assetRef} 当前版本与提案基线不一致，请刷新后基于最新版本重新审阅或重新生成`,
      )
    }
    const finalReplacement = replacement === undefined ? record.replacement : replacement
    // 用户编辑后的内容走与提案同样的形状/限额校验（§7）
    const { revision } = this.projects.writeAsset(projectId, record.assetRef, current, finalReplacement)
    record.status = 'applied'
    record.decidedAt = new Date().toISOString()
    record.appliedRevision = revision
    if (replacement !== undefined) record.replacement = validateReplacement(parsed.label, parsed.kind, replacement)
    this.write(record)
    return { revision }
  }

  reject(projectId: string, proposalId: string, note?: string): void {
    const record = this.requireProposal(projectId, proposalId)
    if (record.status !== 'pending') {
      throw new DramaError('conflict', `提案状态为 ${record.status}，仅 pending 提案可拒绝`)
    }
    record.status = 'rejected'
    record.decidedAt = new Date().toISOString()
    if (note !== undefined && note !== '') record.note = String(note).slice(0, MAX_NOTE)
    this.write(record)
  }

  /** 详情投影：fresh 标记供页面在应用前暴露「提案已过期」。 */
  summarize(projectId: string, record: ProposalRecord): ProposalSummary {
    const parsed = parseAssetRef(record.assetRef)
    const current = parsed ? this.projects.revisionOf(parsed, projectId) : ABSENT_REVISION
    return {
      proposalId: record.proposalId,
      assetRef: record.assetRef,
      kind: record.kind,
      status: record.status,
      summary: record.summary,
      baseRevision: record.baseRevision,
      fresh: current === record.baseRevision,
      createdBy: record.createdBy,
      createdAt: record.createdAt,
      ...(record.decidedAt ? { decidedAt: record.decidedAt } : {}),
      ...(record.note ? { note: record.note } : {}),
      ...(record.taskId ? { taskId: record.taskId } : {}),
    }
  }
}
