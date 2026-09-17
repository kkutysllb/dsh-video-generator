/** 任务指令组装（规格 §5/§6.3）：Host 按 kind 模板在服务端组装任务指令。
 *
 * 「有限上下文」铁律在这里成为可单测断言的纯函数：章节草稿任务只携带
 * 本章蓝图 + 出场角色摘要 + 相关世界观条目 + 上一章相邻定稿末段 + 连续性事实
 * + 用户本次要求，绝不携带整本书。页面只提交 kind/params/用户要求。
 */

import type {
  AdaptationParams,
  ArchitectureAsset,
  ChapterBlueprint,
  CharacterRecord,
  OutlineRow,
  PremiseAsset,
  ReviewProblem,
  WorldEntry,
} from '../store/project.ts'

export type TaskKind =
  | 'generate-architecture'
  | 'generate-worldbuilding'
  | 'complete-characters'
  | 'generate-outline'
  | 'generate-chapter-blueprint'
  | 'generate-chapter-draft'
  | 'review-chapter'
  | 'revise-chapter'
  | 'adapt-chapter'

export const TASK_KINDS: readonly TaskKind[] = [
  'generate-architecture',
  'generate-worldbuilding',
  'complete-characters',
  'generate-outline',
  'generate-chapter-blueprint',
  'generate-chapter-draft',
  'review-chapter',
  'revise-chapter',
  'adapt-chapter',
]

export function isTaskKind(v: unknown): v is TaskKind {
  return typeof v === 'string' && (TASK_KINDS as readonly string[]).includes(v)
}

/** 各 kind 的提案目标资产（产出行的 drama_propose 落点）。 */
export function proposeTarget(kind: TaskKind, chapterNumber?: number): string {
  const cid = chapterNumber !== undefined ? String(chapterNumber).padStart(4, '0') : undefined
  switch (kind) {
    case 'generate-architecture':
      return 'architecture'
    case 'generate-worldbuilding':
      return 'worldbuilding'
    case 'complete-characters':
      return 'characters'
    case 'generate-outline':
      return 'outline'
    case 'generate-chapter-blueprint':
      return `chapters/${cid}/blueprint`
    case 'generate-chapter-draft':
    case 'revise-chapter':
      return `chapters/${cid}/draft`
    case 'review-chapter':
      return `chapters/${cid}/review`
    case 'adapt-chapter':
      return '（改编走 vgen_story → vgen_script → vgen_storyboard，不走 drama_propose）'
  }
}

/* ── 上下文裁剪（纯函数，单测钉死范围） ──────────────── */

const EXCERPT_CHARS = 600
const MAX_WORLD_ENTRIES = 12
const MAX_WORLD_CONTENT_CHARS = 400
const MAX_CHARACTER_SUMMARY_CHARS = 500
const MAX_DRAFT_CONTEXT_CHARS = 30_000

/** 相关世界观条目：「供正文引用」优先；一个都没标时回退全部；截断到上限。 */
export function relevantWorldEntries(entries: WorldEntry[]): WorldEntry[] {
  const cited = entries.filter((e) => e.citedInBody)
  const picked = (cited.length > 0 ? cited : entries).slice(0, MAX_WORLD_ENTRIES)
  return picked.map((e) => ({
    ...e,
    content: e.content.length > MAX_WORLD_CONTENT_CHARS ? `${e.content.slice(0, MAX_WORLD_CONTENT_CHARS)}…` : e.content,
  }))
}

/** 出场角色摘要：指定 ids 时过滤；超长截断。改编任务保留视觉提示词全文。 */
export function characterSummaries(characters: CharacterRecord[], ids: string[] | null, withVisualPrompt: boolean): CharacterRecord[] {
  const picked = ids ? characters.filter((c) => ids.includes(c.id)) : characters
  const clip = (s: string): string => (s.length > MAX_CHARACTER_SUMMARY_CHARS ? `${s.slice(0, MAX_CHARACTER_SUMMARY_CHARS)}…` : s)
  return picked.slice(0, 20).map((c) => ({
    ...c,
    appearance: clip(c.appearance),
    personality: clip(c.personality),
    background: clip(c.background),
    visualPrompt: withVisualPrompt ? c.visualPrompt : clip(c.visualPrompt),
  }))
}

/** 上一章相邻定稿末段 + 连续性事实（承接上下文只有这一点）。 */
export function prevChapterContext(
  prevFinal: string | null,
  prevBlueprint: ChapterBlueprint | null,
): { excerpt: string; facts: string[] } {
  const text = (prevFinal ?? '').trim()
  const excerpt = text.length > EXCERPT_CHARS ? text.slice(-EXCERPT_CHARS) : text
  return { excerpt, facts: (prevBlueprint?.newFacts ?? []).slice(0, 10) }
}

export interface InstructionContext {
  projectId: string
  workspaceId: string
  premise: PremiseAsset | null
  architecture: ArchitectureAsset | null
  outlineRow: OutlineRow | null
  blueprint: ChapterBlueprint | null
  /** 相关性挑选后的世界观条目（调用方用 relevantWorldEntries 裁剪）。 */
  worldEntries: WorldEntry[]
  /** 出场挑选后的角色（调用方用 characterSummaries 裁剪）。 */
  characters: CharacterRecord[]
  chapterNumber?: number
  prevFinalExcerpt?: string
  continuityFacts?: string[]
  /** review/revise 的对象草稿全文（上限内）。 */
  draft?: string
  /** revise 的选中审稿问题。 */
  problems?: ReviewProblem[]
  /** adapt-chapter 专用。 */
  adaptation?: { adaptationId: string; params: AdaptationParams; chapterText: string }
  userRequest?: string
}

function briefPremise(p: PremiseAsset | null): string {
  if (!p) return '（未填写——仅知项目基本信息，请基于用户要求原创）'
  return `梗概：${p.logline || '（无）'}｜主题：${p.theme || '（无）'}｜基调：${p.tone || '（无）'}｜读者：${p.audience || '（无）'}`
}

function briefArchitecture(a: ArchitectureAsset | null): string {
  if (!a) return '（未生成）'
  return `主冲突：${a.mainConflict || '（无）'}｜主角目标：${a.protagonistGoal || '（无）'}｜中段转折：${a.midpointTurn || '（无）'}｜结局：${a.ending || '（无）'}`
}

function outlineRowBrief(row: OutlineRow | null): string {
  if (!row) return '（大纲中无本章行）'
  return [
    `第 ${row.chapter} 章《${row.title}》`,
    `章节目标：${row.goal || '（无）'}`,
    `主要事件：${row.mainEvents || '（无）'}`,
    `场景：${row.scenes || '（无）'}`,
    `情绪：${row.mood || '（无）'}`,
    `线索推进：${row.clueProgress || '（无）'}`,
    `结尾钩子：${row.endingHook || '（无）'}`,
  ].join('｜')
}

function blueprintBrief(b: ChapterBlueprint | null): string {
  if (!b) return '（本章蓝图未填写——请先基于大纲自行归纳本章目标，或提示用户补蓝图）'
  return [
    `本章目标：${b.goal || '（无）'}`,
    `冲突：${b.conflict || '（无）'}`,
    `场景：${b.scenes || '（无)'}`,
    `出场角色：${b.characterIds.join('、') || '（无）'}`,
    `关键事件：${b.keyEvents.join('；') || '（无）'}`,
    `需承接的上一章事实：${b.factsFromPrev.join('；') || '（无）'}`,
    `本章新增事实：${b.newFacts.join('；') || '（无）'}`,
    `结尾钩子：${b.endingHook || '（无）'}`,
  ].join('\n')
}

function charactersBrief(chars: CharacterRecord[], withVisualPrompt: boolean): string {
  if (chars.length === 0) return '（角色库为空）'
  return chars
    .map((c) => {
      const base = `${c.name}（${c.id}）：${c.identity || '身份未定'}｜性格：${c.personality || '（无）'}｜欲望：${c.desire || '（无）'}｜外貌：${c.appearance || '（无）'}`
      return withVisualPrompt && c.visualPrompt ? `${base}｜视觉提示词：${c.visualPrompt}` : base
    })
    .join('\n')
}

function worldBrief(entries: WorldEntry[]): string {
  if (entries.length === 0) return '（无世界观条目）'
  return entries.map((e) => `[${e.category}] ${e.title}：${e.content}`).join('\n')
}

function clipDraft(draft: string | undefined): string {
  const text = (draft ?? '').trim()
  if (!text) return ''
  return text.length > MAX_DRAFT_CONTEXT_CHARS ? `${text.slice(0, MAX_DRAFT_CONTEXT_CHARS)}\n…（超长截断）` : text
}

/** 渲染 §6.3 模板。所有字段都来自 Host 组装的有限上下文。 */
export function assembleInstruction(kind: TaskKind, ctx: InstructionContext): { instruction: string; inputRefs: string[] } {
  const n = ctx.chapterNumber
  const cid = n !== undefined ? String(n).padStart(4, '0') : undefined
  const lines: string[] = []
  const inputRefs: string[] = []

  lines.push('[漫剧工坊任务]')
  lines.push(`任务类型：${kind}`)
  lines.push(`项目：${ctx.projectId}（workspace ${ctx.workspaceId}）`)

  if (kind === 'adapt-chapter') {
    const adapt = ctx.adaptation
    lines.push('输入：')
    lines.push(`- 本章正文（${cid ?? ''}，${clipDraft(adapt?.chapterText).length} 字符）`)
    lines.push('- 出场角色（含漫剧视觉提示词）')
    lines.push('- 相关世界观条目')
    lines.push(`- 改编参数：目标时长 ${adapt?.params.targetDuration ?? '90s'}｜画幅 9:16｜侧重 ${adapt?.params.fidelity === 'condensed' ? '紧凑浓缩' : '忠实改编'}｜旁白语言 ${adapt?.params.narrationLanguage ?? '中文'}`)
    lines.push(`要求：把本章改编为漫剧短片。story 的人物须与角色库视觉提示词一致；${adapt?.params.fidelity === 'condensed' ? '紧凑浓缩：只保留主干事件，允许合并场景' : '忠实改编：保留章节主要事件与顺序'}`)
    lines.push(`产出：依次调用 vgen_story → vgen_script → vgen_storyboard 开 run 并推进三段交接；vgen_story 必须携带 projectId="${ctx.projectId}" 与 adaptationId="${adapt?.adaptationId ?? ''}"（workspaceId="${ctx.workspaceId}"），工具会把产物镜像回改编任务；随后用 vgen_generate 推进 assets/video/final 段（confirm/gate 语义照旧）`)
    lines.push('禁止：虚构角色库之外的主要角色；绕过 vgen_* 工具直接描述产物')
    if (adapt) {
      lines.push('--- 本章正文 ---')
      lines.push(clipDraft(adapt.chapterText) || '（本章尚无定稿/草稿）')
    }
    lines.push('--- 角色库（含视觉提示词） ---')
    lines.push(charactersBrief(ctx.characters, true))
    lines.push('--- 相关世界观 ---')
    lines.push(worldBrief(ctx.worldEntries))
    return { instruction: lines.join('\n'), inputRefs: ['characters', 'worldbuilding'] }
  }

  const target = proposeTarget(kind, n)
  // 输入段（有限上下文）
  lines.push('输入：')
  if (kind === 'generate-architecture') {
    lines.push(`- premise 摘要：${briefPremise(ctx.premise)}`)
    inputRefs.push('premise')
  } else if (kind === 'generate-worldbuilding') {
    lines.push(`- premise 摘要：${briefPremise(ctx.premise)}`)
    lines.push(`- 架构摘要：${briefArchitecture(ctx.architecture)}`)
    inputRefs.push('premise', 'architecture')
  } else if (kind === 'complete-characters') {
    lines.push(`- premise 摘要：${briefPremise(ctx.premise)}`)
    lines.push(`- 架构摘要：${briefArchitecture(ctx.architecture)}`)
    lines.push('- 现有角色库（整库替换提案须保留既有角色，除非用户要求删改）')
    inputRefs.push('premise', 'architecture', 'characters')
  } else if (kind === 'generate-outline') {
    lines.push(`- premise 摘要：${briefPremise(ctx.premise)}`)
    lines.push(`- 架构摘要：${briefArchitecture(ctx.architecture)}`)
    lines.push('- 角色库 id/姓名清单')
    inputRefs.push('premise', 'architecture', 'characters', 'worldbuilding')
  } else {
    // 章节族：蓝图 + 出场角色摘要 + 相关世界观 + 上一章相邻定稿 + 连续性事实 + 用户要求
    if (kind !== 'generate-chapter-blueprint') {
      lines.push(`- 本章蓝图：${blueprintBrief(ctx.blueprint)}`)
      inputRefs.push(`chapters/${cid}/blueprint`)
    } else {
      lines.push(`- 大纲本章行：${outlineRowBrief(ctx.outlineRow)}`)
      lines.push(`- 架构摘要：${briefArchitecture(ctx.architecture)}`)
      inputRefs.push('outline', 'architecture')
    }
    const ids = ctx.blueprint?.characterIds ?? ctx.outlineRow?.characters ?? null
    lines.push('- 出场角色摘要：')
    lines.push(charactersBrief(ctx.characters, false))
    inputRefs.push('characters')
    lines.push('- 相关世界观条目：')
    lines.push(worldBrief(ctx.worldEntries))
    inputRefs.push('worldbuilding')
    if (kind !== 'generate-chapter-blueprint') {
      lines.push(`- 上一章定稿末段：${ctx.prevFinalExcerpt?.trim() ? `\n${ctx.prevFinalExcerpt}` : '（无——本章为第一章或上一章未定稿）'}`)
      lines.push(`- 定稿连续性事实（上一章新增）：${(ctx.continuityFacts ?? []).join('；') || '（无）'}`)
    }
    if (kind === 'review-chapter' || kind === 'revise-chapter') {
      lines.push('--- 当前草稿 ---')
      lines.push(clipDraft(ctx.draft) || '（草稿为空）')
      inputRefs.push(`chapters/${cid}/draft`)
    }
    if (kind === 'revise-chapter') {
      lines.push('- 选中的审稿问题：')
      const problems = ctx.problems ?? []
      lines.push(
        problems.length === 0
          ? '（未选择具体问题——按用户要求整体修订）'
          : problems.map((p) => `[${p.category}] ${p.description}（证据：${p.evidence || '无'}）`).join('\n'),
      )
    }
  }
  lines.push(`要求：${ctx.userRequest?.trim() || defaultRequirement(kind)}`)
  lines.push(`产出：调用 drama_read 核对上述资产 → 调用 drama_propose 提交 ${target} 的完整替换内容`)
  lines.push('禁止：直接修改权威文件；未经 drama_read 就提案；一次提案多个资产')
  if (kind === 'review-chapter') {
    lines.push('审稿口径：逐项给出 连续性/动机/伏笔/目标完成 四类问题；每项必须附正文证据摘录；不确定的问题 status 标 needs-verify（待核实不算通过）')
  }
  return { instruction: lines.join('\n'), inputRefs }
}

function defaultRequirement(kind: TaskKind): string {
  switch (kind) {
    case 'generate-architecture':
      return '基于 premise 生成完整故事架构（主冲突/主角目标/主要阻力/代价/起点/中段转折/高潮/结局/主题/主线/支线/伏笔与回收点）'
    case 'generate-worldbuilding':
      return '生成世界观条目（规则/地理/组织/时代/能力体系/其他），供正文引用的条目标 citedInBody'
    case 'complete-characters':
      return '补全角色库（基本信息/外貌/性格/欲望/恐惧/背景/关系/重要事件/漫剧视觉提示词）'
    case 'generate-outline':
      return '生成全书章节大纲（每章：标题/目标/主要事件/出场角色/场景/情绪/线索推进/结尾钩子）'
    case 'generate-chapter-blueprint':
      return '把大纲本章行细化为本章写作蓝图'
    case 'generate-chapter-draft':
      return '按蓝图写出本章正文，目标字数参照项目设定；只写本章，不越章剧透'
    case 'review-chapter':
      return '审稿当前草稿，产出结构化问题列表（连续性/动机/伏笔/目标完成，逐项附正文证据）'
    case 'revise-chapter':
      return '按选中问题修订草稿，产出修订后的完整新稿（保持未涉及段落原样）'
    case 'adapt-chapter':
      return ''
  }
}
