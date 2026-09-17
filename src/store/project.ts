/** 创作项目持久化（规格 §3）：workspace 内 `.dsh-drama/projects/<projectId>/`。
 *
 * 三条铁律的存储面：
 * - 资产文件存在即权威，缺失视为空资产（revision = 'absent'）；
 * - 版本 = 文件规范化 UTF-8 字节的 SHA-256，写必须携带读到的 revision（乐观并发）；
 * - 写入一律 tmp + rename 原子替换；目录 0700、文件 0600；损坏文件备份 `<name>.broken-<ts>` 后按缺失处理。
 */

import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'

/* ── 错误 ─────────────────────────────────────────────── */

export type DramaErrorCode =
  | 'bad-request'
  | 'not-found'
  | 'conflict'
  | 'stale-revision'
  | 'workspace-unknown'
  | 'project-exists'
  | 'proposal-stale'
  | 'proposal-limit'
  | 'too-large'
  | 'internal'

export class DramaError extends Error {
  readonly code: DramaErrorCode

  constructor(code: DramaErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/* ── assetRef 词汇表 ──────────────────────────────────── */

export type AssetKind = 'json' | 'markdown'

export interface AssetRef {
  /** 规范引用串（原样回显给调用方） */
  label: string
  kind: AssetKind
  /** 项目目录内相对路径（POSIX 风格，白名单生成，无穿越可能） */
  file: string
}

const TOP_JSON_ASSETS: Record<string, string> = {
  premise: 'story/premise.json',
  architecture: 'story/architecture.json',
  worldbuilding: 'story/worldbuilding.json',
  outline: 'story/outline.json',
  characters: 'characters/characters.json',
}

const CHAPTER_PARTS = ['blueprint', 'draft', 'review', 'final'] as const
type ChapterPart = (typeof CHAPTER_PARTS)[number]

/** 白名单解析：'premise'…'characters' | 'chapters/<nnnn>/<part>'；其余一律 null（调用方转 bad-request）。 */
export function parseAssetRef(ref: unknown): AssetRef | null {
  if (typeof ref !== 'string') return null
  const top = TOP_JSON_ASSETS[ref]
  if (top) return { label: ref, kind: 'json', file: top }
  const m = /^chapters\/(\d{4})\/(blueprint|draft|review|final)$/.exec(ref)
  if (!m) return null
  const part = m[2] as ChapterPart
  const ext = part === 'draft' || part === 'final' ? 'md' : 'json'
  return { label: ref, kind: ext === 'md' ? 'markdown' : 'json', file: `chapters/${m[1]}/${part}.${ext}` }
}

export const ABSENT_REVISION = 'absent'
export type Revision = string

/** 章节号 → 4 位目录 id（1 → '0001'）；越界返回 null。 */
export function chapterDirId(n: number): string | null {
  if (!Number.isInteger(n) || n < 1 || n > 9999) return null
  return String(n).padStart(4, '0')
}

/* ── 资产形状 ─────────────────────────────────────────── */

export type ProjectStrategy = 'balanced' | 'fluency' | 'consistency' | 'deep-planning'
const STRATEGIES: readonly ProjectStrategy[] = ['balanced', 'fluency', 'consistency', 'deep-planning']

export interface ProjectManifest {
  schemaVersion: 1
  id: string
  title: string
  category: string
  language: string
  strategy: ProjectStrategy
  plannedChapters: number
  chapterWordTarget: number
  createdAt: string
  updatedAt: string
}

export interface PremiseAsset {
  title: string
  category: string
  language: string
  audience: string
  logline: string
  theme: string
  tone: string
  plannedChapters: number
  chapterWordTarget: number
  strategy: ProjectStrategy
}

export interface ArchitectureAsset {
  mainConflict: string
  protagonistGoal: string
  antagonistForce: string
  cost: string
  startingPoint: string
  midpointTurn: string
  climax: string
  ending: string
  theme: string
  mainline: string
  subplots: string[]
  foreshadows: string[]
}

export type WorldCategory = 'rule' | 'geography' | 'organization' | 'era' | 'power' | 'misc'
const WORLD_CATEGORIES: readonly WorldCategory[] = ['rule', 'geography', 'organization', 'era', 'power', 'misc']

export interface WorldEntry {
  id: string
  category: WorldCategory
  title: string
  content: string
  /** 「供正文引用」标记：章节草稿上下文只携带标记条目。 */
  citedInBody: boolean
}

export interface WorldbuildingAsset {
  entries: WorldEntry[]
}

export interface CharacterRecord {
  id: string
  name: string
  identity: string
  status: string
  appearanceChapters: number[]
  hasVisualAsset: boolean
  appearance: string
  personality: string
  desire: string
  fear: string
  background: string
  relationships: string[]
  keyEvents: string[]
  /** 漫剧视觉提示词（供 master-asset 用）。 */
  visualPrompt: string
}

export interface CharactersAsset {
  characters: CharacterRecord[]
}

export type OutlineStatus = 'none' | 'planned' | 'written' | 'reviewed' | 'final'
const OUTLINE_STATUSES: readonly OutlineStatus[] = ['none', 'planned', 'written', 'reviewed', 'final']

export interface OutlineRow {
  chapter: number
  title: string
  goal: string
  mainEvents: string
  characters: string[]
  scenes: string
  mood: string
  clueProgress: string
  endingHook: string
  status: OutlineStatus
}

export interface OutlineAsset {
  rows: OutlineRow[]
}

export interface ChapterBlueprint {
  goal: string
  conflict: string
  scenes: string
  characterIds: string[]
  keyEvents: string[]
  factsFromPrev: string[]
  newFacts: string[]
  endingHook: string
}

export type ReviewCategory = 'continuity' | 'motivation' | 'foreshadow' | 'goal'
export type ReviewProblemStatus = 'resolved' | 'unresolved' | 'needs-verify'

export interface ReviewProblem {
  id: string
  category: ReviewCategory
  description: string
  /** 正文证据（原文摘录）。 */
  evidence: string
  status: ReviewProblemStatus
}

export interface ChapterReview {
  problems: ReviewProblem[]
  createdAt: string
}

/* ── 任务 / 改编 ──────────────────────────────────────── */

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'canceled'

export interface TaskEvent {
  at: string
  type: string
  detail?: Record<string, unknown>
}

export interface TaskRecord {
  taskId: string
  projectId: string
  kind: string
  status: TaskStatus
  params: Record<string, unknown>
  /** Host 组装的完整任务指令（§6.3 模板），会话发送桥原样转发。 */
  instruction: string
  inputRefs: string[]
  sessionId?: string
  runId?: string
  events: TaskEvent[]
  error?: string
  createdAt: string
  updatedAt: string
}

export interface AdaptationParams {
  /** 目标时长档位（如 '60s' / '90s' / '120s'，自由文本档位标签）。 */
  targetDuration: string
  aspect: '9:16'
  /** 忠实改编 / 紧凑浓缩。 */
  fidelity: 'faithful' | 'condensed'
  narrationLanguage: string
}

export interface AdaptationRecord {
  adaptationId: string
  projectId: string
  chapterId: string
  params: AdaptationParams
  runId?: string
  createdAt: string
  updatedAt: string
}

/* ── 列表 / 详情投影 ──────────────────────────────────── */

export type ProjectStatus = 'writing' | 'pending-review' | 'adapting' | 'done'

export interface ProjectSummary {
  id: string
  title: string
  category: string
  language: string
  status: ProjectStatus
  chaptersFinal: number
  plannedChapters: number
  latestTask: { kind: string; status: TaskStatus; at: string } | null
  latestAdaptation: { adaptationId: string; runId?: string; at: string } | null
  updatedAt: string
  createdAt: string
}

export interface AssetWithRevision {
  assetRef: string
  kind: AssetKind
  revision: Revision
  /** json 资产为 sanitize 后的对象；markdown 为字符串；缺失为 null。 */
  data: unknown
}

export interface ChapterSummary {
  id: string
  number: number
  blueprintRevision: Revision
  draftRevision: Revision
  reviewRevision: Revision
  finalRevision: Revision
}

export interface ProjectDetail {
  manifest: ProjectManifest
  premise: AssetWithRevision
  architecture: AssetWithRevision
  worldbuilding: AssetWithRevision
  outline: AssetWithRevision
  characters: AssetWithRevision
  chapters: ChapterSummary[]
  tasks: TaskRecord[]
  adaptations: AdaptationRecord[]
}

/* ── 输入 ─────────────────────────────────────────────── */

export interface ProjectCreateInput {
  title: string
  category: string
  language: string
  audience?: string
  logline: string
  theme?: string
  tone?: string
  plannedChapters?: number
  chapterWordTarget?: number
  strategy?: ProjectStrategy
}

const ID_RE = /^proj-[0-9a-z][0-9a-z-]{0,63}$/
const TASK_ID_RE = /^task-[0-9a-z][0-9a-z-]{0,63}$/
const ADAPT_ID_RE = /^adapt-[0-9a-z][0-9a-z-]{0,63}$/
const MAX_PROJECTS = 50
const MAX_ASSET_BYTES = 2 * 1024 * 1024

/* ── 形状守卫工具（读侧失败→按损坏处理；写侧失败→bad-request） ── */

function asObject(v: unknown, label: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new DramaError('bad-request', `${label} 须为对象`)
  return v as Record<string, unknown>
}

function asArray(v: unknown, label: string): unknown[] {
  if (!Array.isArray(v)) throw new DramaError('bad-request', `${label} 须为数组`)
  return v
}

function str(v: unknown, field: string, max: number): string {
  const s = typeof v === 'string' ? v.replace(/\r\n/g, '\n') : ''
  if (s.length > max) throw new DramaError('bad-request', `${field} 超过 ${max} 字符上限`)
  return s.trim()
}

function intIn(v: unknown, field: string, min: number, max: number, fallback?: number): number {
  if (v === undefined && fallback !== undefined) return fallback
  const n = typeof v === 'number' ? v : NaN
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new DramaError('bad-request', `${field} 须为 ${min}..${max} 整数`)
  }
  return n
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string, fallback?: T): T {
  if (v === undefined && fallback !== undefined) return fallback
  if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T
  throw new DramaError('bad-request', `${field} 须为 ${allowed.join('/')}`)
}

function strArray(v: unknown, field: string, maxItems: number, maxLen: number): string[] {
  return asArray(v, field).slice(0, maxItems).map((item, i) => str(item, `${field}[${i}]`, maxLen))
}

/* ── 资产 sanitizer（读写共用；throw = 调用方决定降级或拒绝） ── */

// 梗概是用户建项目时整段粘贴的入口（常见几千字），上限放宽到 2 万字符；
// 读写共用 sanitizer，此上限改动对存量数据天然兼容（只可能更宽松）。
export const PREMISE_LOGLINE_MAX = 20_000

function sanitizePremise(v: unknown): PremiseAsset {
  const o = asObject(v, 'premise')
  return {
    title: str(o['title'], 'premise.title', 120),
    category: str(o['category'], 'premise.category', 40),
    language: str(o['language'], 'premise.language', 20),
    audience: str(o['audience'], 'premise.audience', 200),
    logline: str(o['logline'], 'premise.logline', PREMISE_LOGLINE_MAX),
    theme: str(o['theme'], 'premise.theme', 300),
    tone: str(o['tone'], 'premise.tone', 200),
    plannedChapters: intIn(o['plannedChapters'], 'premise.plannedChapters', 1, 500),
    chapterWordTarget: intIn(o['chapterWordTarget'], 'premise.chapterWordTarget', 100, 50000),
    strategy: oneOf(o['strategy'], STRATEGIES, 'premise.strategy'),
  }
}

function sanitizeArchitecture(v: unknown): ArchitectureAsset {
  const o = asObject(v, 'architecture')
  return {
    mainConflict: str(o['mainConflict'], 'architecture.mainConflict', 600),
    protagonistGoal: str(o['protagonistGoal'], 'architecture.protagonistGoal', 600),
    antagonistForce: str(o['antagonistForce'], 'architecture.antagonistForce', 600),
    cost: str(o['cost'], 'architecture.cost', 300),
    startingPoint: str(o['startingPoint'], 'architecture.startingPoint', 600),
    midpointTurn: str(o['midpointTurn'], 'architecture.midpointTurn', 600),
    climax: str(o['climax'], 'architecture.climax', 600),
    ending: str(o['ending'], 'architecture.ending', 600),
    theme: str(o['theme'], 'architecture.theme', 300),
    mainline: str(o['mainline'], 'architecture.mainline', 600),
    subplots: strArray(o['subplots'], 'architecture.subplots', 20, 600),
    foreshadows: strArray(o['foreshadows'], 'architecture.foreshadows', 50, 300),
  }
}

const WORLD_ENTRY_ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/

function sanitizeWorldbuilding(v: unknown): WorldbuildingAsset {
  const o = asObject(v, 'worldbuilding')
  const entries = asArray(o['entries'] ?? [], 'worldbuilding.entries').slice(0, 300).map((raw, i) => {
    const e = asObject(raw, `worldbuilding.entries[${i}]`)
    const id = str(e['id'], `worldbuilding.entries[${i}].id`, 48)
    if (!WORLD_ENTRY_ID_RE.test(id)) throw new DramaError('bad-request', `worldbuilding.entries[${i}].id 非法: ${id}`)
    return {
      id,
      category: oneOf(e['category'], WORLD_CATEGORIES, `worldbuilding.entries[${i}].category`),
      title: str(e['title'], `worldbuilding.entries[${i}].title`, 120),
      content: str(e['content'], `worldbuilding.entries[${i}].content`, 4000),
      citedInBody: e['citedInBody'] === true,
    }
  })
  return { entries }
}

const CHARACTER_ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/

function sanitizeCharacters(v: unknown): CharactersAsset {
  const o = asObject(v, 'characters')
  const characters = asArray(o['characters'] ?? [], 'characters.characters').slice(0, 100).map((raw, i) => {
    const c = asObject(raw, `characters.characters[${i}]`)
    const id = str(c['id'], `characters.characters[${i}].id`, 48)
    if (!CHARACTER_ID_RE.test(id)) throw new DramaError('bad-request', `characters.characters[${i}].id 非法: ${id}`)
    return {
      id,
      name: str(c['name'], `characters.characters[${i}].name`, 80),
      identity: str(c['identity'], `characters.characters[${i}].identity`, 120),
      status: str(c['status'], `characters.characters[${i}].status`, 40),
      appearanceChapters: asArray(c['appearanceChapters'] ?? [], `characters.characters[${i}].appearanceChapters`)
        .slice(0, 500)
        .map((n, j) => intIn(n, `characters.characters[${i}].appearanceChapters[${j}]`, 1, 9999)),
      hasVisualAsset: c['hasVisualAsset'] === true,
      appearance: str(c['appearance'], `characters.characters[${i}].appearance`, 2000),
      personality: str(c['personality'], `characters.characters[${i}].personality`, 2000),
      desire: str(c['desire'], `characters.characters[${i}].desire`, 1000),
      fear: str(c['fear'], `characters.characters[${i}].fear`, 1000),
      background: str(c['background'], `characters.characters[${i}].background`, 4000),
      relationships: strArray(c['relationships'], `characters.characters[${i}].relationships`, 50, 500),
      keyEvents: strArray(c['keyEvents'], `characters.characters[${i}].keyEvents`, 50, 500),
      visualPrompt: str(c['visualPrompt'], `characters.characters[${i}].visualPrompt`, 2000),
    }
  })
  return { characters }
}

function sanitizeOutline(v: unknown): OutlineAsset {
  const o = asObject(v, 'outline')
  const rows = asArray(o['rows'] ?? [], 'outline.rows').slice(0, 500).map((raw, i) => {
    const r = asObject(raw, `outline.rows[${i}]`)
    return {
      chapter: intIn(r['chapter'], `outline.rows[${i}].chapter`, 1, 9999),
      title: str(r['title'], `outline.rows[${i}].title`, 200),
      goal: str(r['goal'], `outline.rows[${i}].goal`, 600),
      mainEvents: str(r['mainEvents'], `outline.rows[${i}].mainEvents`, 2000),
      characters: strArray(r['characters'], `outline.rows[${i}].characters`, 50, 48),
      scenes: str(r['scenes'], `outline.rows[${i}].scenes`, 1000),
      mood: str(r['mood'], `outline.rows[${i}].mood`, 200),
      clueProgress: str(r['clueProgress'], `outline.rows[${i}].clueProgress`, 600),
      endingHook: str(r['endingHook'], `outline.rows[${i}].endingHook`, 600),
      status: oneOf(r['status'], OUTLINE_STATUSES, `outline.rows[${i}].status`),
    }
  })
  return { rows }
}

function sanitizeBlueprint(v: unknown): ChapterBlueprint {
  const o = asObject(v, 'blueprint')
  return {
    goal: str(o['goal'], 'blueprint.goal', 600),
    conflict: str(o['conflict'], 'blueprint.conflict', 600),
    scenes: str(o['scenes'], 'blueprint.scenes', 2000),
    characterIds: strArray(o['characterIds'], 'blueprint.characterIds', 50, 48),
    keyEvents: strArray(o['keyEvents'], 'blueprint.keyEvents', 30, 500),
    factsFromPrev: strArray(o['factsFromPrev'], 'blueprint.factsFromPrev', 30, 500),
    newFacts: strArray(o['newFacts'], 'blueprint.newFacts', 30, 500),
    endingHook: str(o['endingHook'], 'blueprint.endingHook', 600),
  }
}

const REVIEW_CATEGORIES: readonly ReviewCategory[] = ['continuity', 'motivation', 'foreshadow', 'goal']
const REVIEW_STATUSES: readonly ReviewProblemStatus[] = ['resolved', 'unresolved', 'needs-verify']

function sanitizeReview(v: unknown): ChapterReview {
  const o = asObject(v, 'review')
  const problems = asArray(o['problems'] ?? [], 'review.problems').slice(0, 100).map((raw, i) => {
    const p = asObject(raw, `review.problems[${i}]`)
    return {
      id: str(p['id'], `review.problems[${i}].id`, 64) || `p${i + 1}`,
      category: oneOf(p['category'], REVIEW_CATEGORIES, `review.problems[${i}].category`),
      description: str(p['description'], `review.problems[${i}].description`, 2000),
      evidence: str(p['evidence'], `review.problems[${i}].evidence`, 2000),
      status: oneOf(p['status'], REVIEW_STATUSES, `review.problems[${i}].status`),
    }
  })
  const createdAt = typeof o['createdAt'] === 'string' ? o['createdAt'] : new Date().toISOString()
  return { problems, createdAt }
}

/** 按 assetRef 分派的 JSON 资产校验。写入与提案形状校验共用（同一资产同一形状契约）。 */
export function sanitizeJsonAsset(assetRef: string, v: unknown): unknown {
  switch (assetRef) {
    case 'premise':
      return sanitizePremise(v)
    case 'architecture':
      return sanitizeArchitecture(v)
    case 'worldbuilding':
      return sanitizeWorldbuilding(v)
    case 'characters':
      return sanitizeCharacters(v)
    case 'outline':
      return sanitizeOutline(v)
    default: {
      const m = /^chapters\/(\d{4})\/(blueprint|review)$/.exec(assetRef)
      if (!m) throw new DramaError('bad-request', `未知资产: ${assetRef}`)
      return m[2] === 'blueprint' ? sanitizeBlueprint(v) : sanitizeReview(v)
    }
  }
}

function sanitizeMarkdown(v: unknown, label: string): string {
  if (typeof v !== 'string') throw new DramaError('bad-request', `${label} 须为字符串（Markdown）`)
  const s = v.replace(/\r\n/g, '\n')
  if (s.includes('\u0000')) throw new DramaError('bad-request', `${label} 含非法控制字符`)
  if (s.length > MAX_ASSET_BYTES) throw new DramaError('too-large', `${label} 超过 ${MAX_ASSET_BYTES} 字节上限`)
  return s
}

/** 供给 ProposalStore 复用的「校验不落盘」。json 资产返回规范对象，markdown 返回字符串。 */
export function validateReplacement(assetRef: string, kind: AssetKind, replacement: unknown): unknown {
  return kind === 'markdown' ? sanitizeMarkdown(replacement, assetRef) : sanitizeJsonAsset(assetRef, replacement)
}

/* ── ProjectStore ─────────────────────────────────────── */

/** 约束：单进程使用（同步 API 串行化）；跨进程并发写同一项目目录不在保障范围。 */
export class ProjectStore {
  /** `.dsh-drama` 根目录（workspace 内）。 */
  readonly rootDir: string
  private brokenBackedUp = new Set<string>()

  constructor(rootDir: string) {
    this.rootDir = rootDir
  }

  static open(opts: { workspaceDir: string }): ProjectStore {
    return new ProjectStore(join(opts.workspaceDir, '.dsh-drama'))
  }

  private projectsDir(): string {
    return join(this.rootDir, 'projects')
  }

  /** 项目目录（不校验存在）。id 必须先过形状校验，防路径注入。 */
  projectDir(projectId: string): string {
    if (!ID_RE.test(projectId)) throw new DramaError('bad-request', `非法项目 id: ${projectId}`)
    return join(this.projectsDir(), projectId)
  }

  private stamp(): string {
    return new Date().toISOString()
  }

  /* ── 原子写 / 读 ── */

  private writeFileAtomic(file: string, content: string): void {
    mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 })
    chmodSync(join(file, '..'), 0o700)
    const tmp = `${file}.tmp-${process.pid}`
    writeFileSync(tmp, content, { mode: 0o600 })
    renameSync(tmp, file)
  }

  private readFileBytes(file: string): Buffer | null {
    try {
      return readFileSync(file)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  revisionOf(assetRef: AssetRef, projectId: string): Revision {
    const file = join(this.projectDir(projectId), assetRef.file)
    const buf = this.readFileBytes(file)
    if (buf === null) return ABSENT_REVISION
    // 「按缺失处理」的完整语义：JSON 资产解析/形状失败 → absent（备份已由读取路径触发），
    // 使 stale 检查放行「基于空资产的重写」这一恢复路径。
    if (assetRef.kind === 'json') {
      try {
        const parsed: unknown = JSON.parse(buf.toString('utf8'))
        sanitizeJsonAsset(this.labelOf(assetRef), parsed)
      } catch {
        return ABSENT_REVISION
      }
    }
    return createHash('sha256').update(buf).digest('hex')
  }

  /** assetRef.label 缺省时按 file 反查（内部构造的 AssetRef 允许省略 label）。 */
  private labelOf(assetRef: AssetRef): string {
    if (assetRef.label) return assetRef.label
    for (const [ref, file] of Object.entries(TOP_JSON_ASSETS)) {
      if (file === assetRef.file) return ref
    }
    const m = /^chapters\/(\d{4})\/(blueprint|draft|review|final)\.(json|md)$/.exec(assetRef.file)
    return m ? `chapters/${m[1]}/${m[2]}` : assetRef.file
  }

  /** 损坏 JSON 备份原字节（0600）；同实例同文件只备份一次。 */
  private backupBroken(file: string, raw: string): void {
    if (this.brokenBackedUp.has(file)) return
    this.brokenBackedUp.add(file)
    try {
      writeFileSync(`${file}.broken-${Date.now()}`, raw, { mode: 0o600 })
    } catch {
      // 备份失败不阻塞按缺失处理
    }
  }

  /** 读 JSON 资产：缺失 → null；损坏/形状不符 → 备份后按缺失。 */
  private readJsonFile<T>(file: string, sanitize: (v: unknown) => T): T | null {
    const buf = this.readFileBytes(file)
    if (buf === null) return null
    try {
      return sanitize(JSON.parse(buf.toString('utf8')))
    } catch (err) {
      if (err instanceof DramaError && err.code === 'bad-request') {
        // 形状损坏与 JSON 损坏同路径：备份 + 按缺失
      }
      this.backupBroken(file, buf.toString('utf8'))
      return null
    }
  }

  /* ── 项目 CRUD ── */

  list(): ProjectSummary[] {
    let ids: string[] = []
    try {
      ids = readdirSync(this.projectsDir(), { withFileTypes: true })
        .filter((e) => e.isDirectory() && ID_RE.test(e.name))
        .map((e) => e.name)
    } catch {
      return []
    }
    const out: ProjectSummary[] = []
    for (const id of ids) {
      const s = this.summary(id)
      if (s) out.push(s)
    }
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  }

  private readManifest(projectId: string): ProjectManifest | null {
    return this.readJsonFile(join(this.projectDir(projectId), 'project.json'), sanitizeManifest)
  }

  summary(projectId: string): ProjectSummary | null {
    const manifest = this.readManifest(projectId)
    if (!manifest) return null
    const dir = this.projectDir(projectId)
    // 章节进度：定稿数 = 存在 final.md 的章节目录数
    let chaptersFinal = 0
    let chapterCount = 0
    try {
      for (const e of readdirSync(join(dir, 'chapters'), { withFileTypes: true })) {
        if (!e.isDirectory() || !/^\d{4}$/.test(e.name)) continue
        chapterCount++
        if (this.readFileBytes(join(dir, 'chapters', e.name, 'final.md')) !== null) chaptersFinal++
      }
    } catch {
      // 无章节目录
    }
    // 任务/改编最新一条
    let latestTask: ProjectSummary['latestTask'] = null
    try {
      const taskFiles = readdirSync(join(dir, 'tasks'), { withFileTypes: true })
        .filter((e) => e.isFile() && TASK_ID_RE.test(e.name.replace(/\.json$/, '')))
        .map((e) => e.name)
      for (const f of taskFiles) {
        const t = this.readJsonFile(join(dir, 'tasks', f), sanitizeTaskLoose)
        if (!t) continue
        if (!latestTask || t.updatedAt > latestTask.at) latestTask = { kind: t.kind, status: t.status, at: t.updatedAt }
      }
    } catch {
      // 无 tasks 目录
    }
    let latestAdaptation: ProjectSummary['latestAdaptation'] = null
    try {
      for (const e of readdirSync(join(dir, 'adaptations'), { withFileTypes: true })) {
        if (!e.isDirectory()) continue
        const a = this.readJsonFile(join(dir, 'adaptations', e.name, 'source.json'), sanitizeAdaptationLoose)
        if (!a) continue
        if (!latestAdaptation || a.updatedAt > latestAdaptation.at) {
          latestAdaptation = { adaptationId: a.adaptationId, runId: a.runId, at: a.updatedAt }
        }
      }
    } catch {
      // 无 adaptations 目录
    }
    // 状态推导（§2.3 徽章）：有改编 → adapting；全定稿（有章节且全 final）→ done；否则 writing。
    // pending-review 由 routes 依 pendingProposals>0 覆盖（store 不依赖 ProposalStore）。
    let status: ProjectStatus = 'writing'
    if (latestAdaptation) status = 'adapting'
    if (chapterCount > 0 && chaptersFinal >= chapterCount && chapterCount >= manifest.plannedChapters) status = 'done'
    return {
      id: manifest.id,
      title: manifest.title,
      category: manifest.category,
      language: manifest.language,
      status,
      chaptersFinal,
      plannedChapters: manifest.plannedChapters,
      latestTask,
      latestAdaptation,
      updatedAt: manifest.updatedAt,
      createdAt: manifest.createdAt,
    }
  }

  create(input: ProjectCreateInput): ProjectManifest {
    const premise = sanitizePremise({
      title: input.title,
      category: input.category,
      language: input.language,
      audience: input.audience ?? '',
      logline: input.logline,
      theme: input.theme ?? '',
      tone: input.tone ?? '',
      plannedChapters: input.plannedChapters ?? 10,
      chapterWordTarget: input.chapterWordTarget ?? 2000,
      strategy: input.strategy ?? 'balanced',
    })
    if (!premise.title) throw new DramaError('bad-request', '项目名称不能为空')
    if (!premise.logline) throw new DramaError('bad-request', '一句话梗概不能为空')
    // 同 workspace 同名活动项目拒绝（§2.4 / 验收 5）
    for (const s of this.list()) {
      if (s.title === premise.title) throw new DramaError('project-exists', `同名活动项目已存在: ${premise.title}`)
    }
    let ids: string[] = []
    try {
      ids = readdirSync(this.projectsDir(), { withFileTypes: true }).map((e) => e.name)
    } catch {
      // 首个项目
    }
    if (ids.length >= MAX_PROJECTS) throw new DramaError('conflict', `项目数超过上限 ${MAX_PROJECTS}`)
    const now = this.stamp()
    const id = `proj-${Date.now()}-${randomBytes(3).toString('hex')}`
    const manifest: ProjectManifest = {
      schemaVersion: 1,
      id,
      title: premise.title,
      category: premise.category,
      language: premise.language,
      strategy: premise.strategy,
      plannedChapters: premise.plannedChapters,
      chapterWordTarget: premise.chapterWordTarget,
      createdAt: now,
      updatedAt: now,
    }
    const dir = this.projectDir(id)
    this.writeFileAtomic(join(dir, 'project.json'), JSON.stringify(manifest, null, 2) + '\n')
    this.writeFileAtomic(join(dir, 'story', 'premise.json'), JSON.stringify(premise, null, 2) + '\n')
    return manifest
  }

  get(projectId: string): ProjectDetail | null {
    const manifest = this.readManifest(projectId)
    if (!manifest) return null
    const dir = this.projectDir(projectId)
    const readAsset = (ref: string): AssetWithRevision => {
      const parsed = parseAssetRef(ref)
      if (!parsed) throw new DramaError('bad-request', `未知资产: ${ref}`)
      const file = join(dir, parsed.file)
      if (parsed.kind === 'markdown') {
        const buf = this.readFileBytes(file)
        return { assetRef: ref, kind: parsed.kind, revision: buf === null ? ABSENT_REVISION : createHash('sha256').update(buf).digest('hex'), data: buf === null ? null : buf.toString('utf8') }
      }
      const data = this.readJsonFile(file, (v) => sanitizeJsonAsset(ref, v))
      const revision = this.revisionOf(parsed, projectId)
      return { assetRef: ref, kind: parsed.kind, revision, data }
    }
    const chapters: ChapterSummary[] = []
    try {
      const nums = readdirSync(join(dir, 'chapters'), { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^\d{4}$/.test(e.name))
        .map((e) => e.name)
        .sort()
      for (const cid of nums) {
        chapters.push({
          id: cid,
          number: Number(cid),
          blueprintRevision: this.revisionOf({ label: `chapters/${cid}/blueprint`, kind: 'json', file: `chapters/${cid}/blueprint.json` }, projectId),
          draftRevision: this.revisionOf({ label: `chapters/${cid}/draft`, kind: 'markdown', file: `chapters/${cid}/draft.md` }, projectId),
          reviewRevision: this.revisionOf({ label: `chapters/${cid}/review`, kind: 'json', file: `chapters/${cid}/review.json` }, projectId),
          finalRevision: this.revisionOf({ label: `chapters/${cid}/final`, kind: 'markdown', file: `chapters/${cid}/final.md` }, projectId),
        })
      }
    } catch {
      // 无章节目录
    }
    const tasks: TaskRecord[] = []
    try {
      for (const e of readdirSync(join(dir, 'tasks'), { withFileTypes: true })) {
        if (!e.isFile()) continue
        const t = this.readJsonFile(join(dir, 'tasks', e.name), sanitizeTask)
        if (t) tasks.push(t)
      }
    } catch {
      // 无 tasks 目录
    }
    tasks.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    const adaptations: AdaptationRecord[] = []
    try {
      for (const e of readdirSync(join(dir, 'adaptations'), { withFileTypes: true })) {
        if (!e.isDirectory()) continue
        const a = this.readJsonFile(join(dir, 'adaptations', e.name, 'source.json'), sanitizeAdaptation)
        if (a) adaptations.push(a)
      }
    } catch {
      // 无 adaptations 目录
    }
    adaptations.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    return {
      manifest,
      premise: readAsset('premise'),
      architecture: readAsset('architecture'),
      worldbuilding: readAsset('worldbuilding'),
      outline: readAsset('outline'),
      characters: readAsset('characters'),
      chapters,
      tasks,
      adaptations,
    }
  }

  requireProject(projectId: string): ProjectDetail {
    const detail = this.get(projectId)
    if (!detail) throw new DramaError('not-found', `项目不存在: ${projectId}`)
    return detail
  }

  touch(projectId: string): void {
    const manifest = this.readManifest(projectId)
    if (!manifest) return
    manifest.updatedAt = this.stamp()
    this.writeFileAtomic(join(this.projectDir(projectId), 'project.json'), JSON.stringify(manifest, null, 2) + '\n')
  }

  /* ── 资产读写 ── */

  readAsset(projectId: string, assetRef: string): { kind: AssetKind; revision: Revision; data: unknown } {
    const parsed = parseAssetRef(assetRef)
    if (!parsed) throw new DramaError('bad-request', `未知资产: ${String(assetRef)}`)
    const file = join(this.projectDir(projectId), parsed.file)
    if (parsed.kind === 'markdown') {
      const buf = this.readFileBytes(file)
      return { kind: parsed.kind, revision: buf === null ? ABSENT_REVISION : createHash('sha256').update(buf).digest('hex'), data: buf === null ? null : buf.toString('utf8') }
    }
    const data = this.readJsonFile(file, (v) => sanitizeJsonAsset(parsed.label, v))
    return { kind: parsed.kind, revision: this.revisionOf(parsed, projectId), data }
  }

  /** 乐观并发写：baseRevision 与当前不符 → stale-revision，不落盘（验收 6）。 */
  writeAsset(projectId: string, assetRef: string, baseRevision: Revision, replacement: unknown): { revision: Revision } {
    const parsed = parseAssetRef(assetRef)
    if (!parsed) throw new DramaError('bad-request', `未知资产: ${String(assetRef)}`)
    this.requireProject(projectId)
    const file = join(this.projectDir(projectId), parsed.file)
    const current = this.revisionOf(parsed, projectId)
    if (current !== baseRevision) {
      throw new DramaError(
        'stale-revision',
        `资产 ${assetRef} 已被其他修改更新（提交基于 ${baseRevision === ABSENT_REVISION ? '空资产' : baseRevision.slice(0, 8)}，当前 ${current === ABSENT_REVISION ? '空资产' : current.slice(0, 8)}），请刷新后基于最新版本重试`,
      )
    }
    const clean = validateReplacement(parsed.label, parsed.kind, replacement)
    const content = parsed.kind === 'markdown' ? String(clean) : JSON.stringify(clean, null, 2) + '\n'
    this.writeFileAtomic(file, content)
    this.touch(projectId)
    return { revision: this.revisionOf(parsed, projectId) }
  }

  /* ── 候选稿（非权威，§3.1 chapters/<n>/candidates/） ── */

  saveCandidate(projectId: string, chapterNumber: number, content: string): { name: string } {
    const cid = chapterDirId(chapterNumber)
    if (!cid) throw new DramaError('bad-request', `非法章节号: ${chapterNumber}`)
    this.requireProject(projectId)
    const text = sanitizeMarkdown(content, 'candidate')
    const name = `candidate-${Date.now()}.md`
    this.writeFileAtomic(join(this.projectDir(projectId), 'chapters', cid, 'candidates', name), text)
    return { name }
  }

  listCandidates(projectId: string, chapterNumber: number): Array<{ name: string; rel: string }> {
    const cid = chapterDirId(chapterNumber)
    if (!cid) throw new DramaError('bad-request', `非法章节号: ${chapterNumber}`)
    try {
      return readdirSync(join(this.projectDir(projectId), 'chapters', cid, 'candidates'), { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => ({ name: e.name, rel: `chapters/${cid}/candidates/${e.name}` }))
        .sort((a, b) => (a.name < b.name ? 1 : -1))
    } catch {
      return []
    }
  }

  /* ── 创作任务 ── */

  createTask(projectId: string, input: { kind: string; params?: Record<string, unknown>; instruction: string; inputRefs: string[] }): TaskRecord {
    this.requireProject(projectId)
    const now = this.stamp()
    const task: TaskRecord = {
      taskId: `task-${Date.now()}-${randomBytes(3).toString('hex')}`,
      projectId,
      kind: String(input.kind),
      status: 'pending',
      params: input.params ?? {},
      instruction: input.instruction,
      inputRefs: input.inputRefs,
      events: [{ at: now, type: 'task-created', detail: { kind: input.kind } }],
      createdAt: now,
      updatedAt: now,
    }
    this.writeFileAtomic(join(this.projectDir(projectId), 'tasks', `${task.taskId}.json`), JSON.stringify(task, null, 2) + '\n')
    this.touch(projectId)
    return task
  }

  getTask(projectId: string, taskId: string): TaskRecord | null {
    if (!TASK_ID_RE.test(taskId)) throw new DramaError('bad-request', `非法任务 id: ${taskId}`)
    return this.readJsonFile(join(this.projectDir(projectId), 'tasks', `${taskId}.json`), sanitizeTask)
  }

  requireTask(projectId: string, taskId: string): TaskRecord {
    const t = this.getTask(projectId, taskId)
    if (!t) throw new DramaError('not-found', `任务不存在: ${taskId}`)
    return t
  }

  updateTask(projectId: string, taskId: string, patch: { status?: TaskStatus; sessionId?: string | null; runId?: string | null; error?: string | null; event?: { type: string; detail?: Record<string, unknown> } }): TaskRecord {
    const task = this.requireTask(projectId, taskId)
    if (patch.status !== undefined) {
      if (!(TASK_STATUSES as readonly string[]).includes(patch.status)) throw new DramaError('bad-request', `非法任务状态: ${String(patch.status)}`)
      task.status = patch.status
      task.events.push({ at: this.stamp(), type: `status-${patch.status}` })
    }
    if (patch.sessionId !== undefined) {
      if (patch.sessionId === null) delete task.sessionId
      else task.sessionId = patch.sessionId.slice(0, 120)
    }
    if (patch.runId !== undefined) {
      if (patch.runId === null) delete task.runId
      else task.runId = patch.runId.slice(0, 120)
    }
    if (patch.error !== undefined) {
      if (patch.error === null) delete task.error
      else task.error = patch.error.slice(0, 2000)
    }
    if (patch.event) {
      task.events.push({ at: this.stamp(), type: patch.event.type, ...(patch.event.detail ? { detail: patch.event.detail } : {}) })
    }
    if (task.events.length > 200) task.events = task.events.slice(-200)
    task.updatedAt = this.stamp()
    this.writeFileAtomic(join(this.projectDir(projectId), 'tasks', `${task.taskId}.json`), JSON.stringify(task, null, 2) + '\n')
    this.touch(projectId)
    return task
  }

  /* ── 漫剧改编 ── */

  createAdaptation(projectId: string, input: { chapterId: string; params: AdaptationParams }): AdaptationRecord {
    if (!/^\d{4}$/.test(input.chapterId)) throw new DramaError('bad-request', `非法章节 id: ${input.chapterId}`)
    this.requireProject(projectId)
    const now = this.stamp()
    const record: AdaptationRecord = {
      adaptationId: `adapt-${Date.now()}-${randomBytes(3).toString('hex')}`,
      projectId,
      chapterId: input.chapterId,
      params: sanitizeAdaptationParams(input.params),
      createdAt: now,
      updatedAt: now,
    }
    this.writeFileAtomic(join(this.projectDir(projectId), 'adaptations', record.adaptationId, 'source.json'), JSON.stringify(record, null, 2) + '\n')
    this.touch(projectId)
    return record
  }

  getAdaptation(projectId: string, adaptationId: string): AdaptationRecord | null {
    if (!ADAPT_ID_RE.test(adaptationId)) throw new DramaError('bad-request', `非法改编任务 id: ${adaptationId}`)
    return this.readJsonFile(join(this.projectDir(projectId), 'adaptations', adaptationId, 'source.json'), sanitizeAdaptation)
  }

  requireAdaptation(projectId: string, adaptationId: string): AdaptationRecord {
    const a = this.getAdaptation(projectId, adaptationId)
    if (!a) throw new DramaError('not-found', `改编任务不存在: ${adaptationId}`)
    return a
  }

  /** vgen_story 落 run 后回填 run-link（验收 12）。 */
  linkRun(projectId: string, adaptationId: string, runId: string): AdaptationRecord {
    const record = this.requireAdaptation(projectId, adaptationId)
    if (!/^run-[0-9a-z-]{1,64}$/.test(runId)) throw new DramaError('bad-request', `非法 runId: ${runId}`)
    record.runId = runId
    record.updatedAt = this.stamp()
    const dir = join(this.projectDir(projectId), 'adaptations', adaptationId)
    this.writeFileAtomic(join(dir, 'source.json'), JSON.stringify(record, null, 2) + '\n')
    this.writeFileAtomic(join(dir, 'run-link.json'), JSON.stringify({ runId, createdAt: this.stamp() }, null, 2) + '\n')
    this.touch(projectId)
    return record
  }

  /** story/script/storyboard 三段产物镜像（§2.6）。 */
  mirrorAdaptationArtifact(projectId: string, adaptationId: string, name: 'script' | 'storyboard' | 'story', data: unknown): void {
    this.requireAdaptation(projectId, adaptationId)
    const file = join(this.projectDir(projectId), 'adaptations', adaptationId, `${name}.json`)
    this.writeFileAtomic(file, JSON.stringify(data, null, 2) + '\n')
  }
}

/* ── 宽松读取 sanitizer（清单/任务/改编的读侧形状守卫） ── */

function sanitizeManifest(v: unknown): ProjectManifest {
  const o = asObject(v, 'project.json')
  return {
    schemaVersion: 1,
    id: str(o['id'], 'project.id', 64),
    title: str(o['title'], 'project.title', 120),
    category: str(o['category'], 'project.category', 40),
    language: str(o['language'], 'project.language', 20),
    strategy: oneOf(o['strategy'], STRATEGIES, 'project.strategy'),
    plannedChapters: intIn(o['plannedChapters'], 'project.plannedChapters', 1, 500),
    chapterWordTarget: intIn(o['chapterWordTarget'], 'project.chapterWordTarget', 100, 50000),
    createdAt: typeof o['createdAt'] === 'string' ? o['createdAt'] : '',
    updatedAt: typeof o['updatedAt'] === 'string' ? o['updatedAt'] : '',
  }
}

const TASK_STATUSES: readonly TaskStatus[] = ['pending', 'running', 'done', 'failed', 'canceled']

function sanitizeTask(v: unknown): TaskRecord {
  const t = asObject(v, 'task')
  const status = oneOf(t['status'], TASK_STATUSES, 'task.status')
  return {
    taskId: str(t['taskId'], 'task.taskId', 64),
    projectId: str(t['projectId'], 'task.projectId', 64),
    kind: str(t['kind'], 'task.kind', 64),
    status,
    params: typeof t['params'] === 'object' && t['params'] !== null && !Array.isArray(t['params']) ? t['params'] as Record<string, unknown> : {},
    instruction: str(t['instruction'], 'task.instruction', 100_000),
    inputRefs: strArray(t['inputRefs'] ?? [], 'task.inputRefs', 20, 120),
    ...(typeof t['sessionId'] === 'string' ? { sessionId: t['sessionId'] } : {}),
    ...(typeof t['runId'] === 'string' ? { runId: t['runId'] } : {}),
    events: Array.isArray(t['events'])
      ? (t['events'] as unknown[]).slice(0, 200).map((e, i) => {
          const ev = asObject(e, `task.events[${i}]`)
          return {
            at: typeof ev['at'] === 'string' ? ev['at'] : '',
            type: str(ev['type'], `task.events[${i}].type`, 64),
            ...(ev['detail'] !== undefined ? { detail: ev['detail'] as Record<string, unknown> } : {}),
          }
        })
      : [],
    ...(typeof t['error'] === 'string' ? { error: t['error'] } : {}),
    createdAt: typeof t['createdAt'] === 'string' ? t['createdAt'] : '',
    updatedAt: typeof t['updatedAt'] === 'string' ? t['updatedAt'] : '',
  }
}

/** 列表页宽松版：只取 kind/status/updatedAt（latestTask 展示用），形状不符整条丢弃。 */
function sanitizeTaskLoose(v: unknown): { kind: string; status: TaskStatus; updatedAt: string } | null {
  try {
    const t = sanitizeTask(v)
    return { kind: t.kind, status: t.status, updatedAt: t.updatedAt }
  } catch {
    return null
  }
}

function sanitizeAdaptationParams(v: unknown): AdaptationParams {
  const o = asObject(v, 'adaptation.params')
  return {
    targetDuration: str(o['targetDuration'], 'adaptation.targetDuration', 20) || '90s',
    aspect: '9:16',
    fidelity: oneOf(o['fidelity'], ['faithful', 'condensed'] as const, 'adaptation.fidelity', 'faithful'),
    narrationLanguage: str(o['narrationLanguage'], 'adaptation.narrationLanguage', 20) || '中文',
  }
}

function sanitizeAdaptation(v: unknown): AdaptationRecord {
  const a = asObject(v, 'adaptation.source.json')
  return {
    adaptationId: str(a['adaptationId'], 'adaptation.adaptationId', 64),
    projectId: str(a['projectId'], 'adaptation.projectId', 64),
    chapterId: str(a['chapterId'], 'adaptation.chapterId', 8),
    params: sanitizeAdaptationParams(a['params'] ?? {}),
    ...(typeof a['runId'] === 'string' ? { runId: a['runId'] } : {}),
    createdAt: typeof a['createdAt'] === 'string' ? a['createdAt'] : '',
    updatedAt: typeof a['updatedAt'] === 'string' ? a['updatedAt'] : '',
  }
}

/** 列表页宽松版。 */
function sanitizeAdaptationLoose(v: unknown): { adaptationId: string; runId?: string; updatedAt: string } | null {
  try {
    const a = sanitizeAdaptation(v)
    return { adaptationId: a.adaptationId, ...(a.runId ? { runId: a.runId } : {}), updatedAt: a.updatedAt }
  } catch {
    return null
  }
}
