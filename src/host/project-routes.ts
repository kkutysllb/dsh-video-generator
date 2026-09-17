/** 漫剧工坊 RPC 面（规格 §5）：`/dsh-video-generator/drama` POST JSON，
 * {ok,value}/{ok,error:{code,message}} 信封。handler 不碰 node:http，便于无宿主测试。
 *
 * 指令组装（drama.task.create / drama.adaptation.create）在本层完成：页面只提交
 * kind/params/用户要求，「有限上下文」裁剪是 Host 纯函数（见 drama/instruction.ts，
 * 验收 10 对指令文本单测断言）。
 */

import {
  DramaError,
  chapterDirId,
  type ChapterBlueprint,
  type ChapterReview,
  type ProjectDetail,
  type ProjectStatus,
  type ProjectStrategy,
  type AdaptationParams,
  type TaskStatus,
  type OutlineRow,
} from '../store/project.ts'
import type { ProposalStatus } from '../store/proposal.ts'
import type { DramaHost, ResolvedWorkspace } from '../drama/gateway.ts'
import {
  assembleInstruction,
  isTaskKind,
  relevantWorldEntries,
  characterSummaries,
  prevChapterContext,
  type InstructionContext,
  type TaskKind,
} from '../drama/instruction.ts'
import type { Envelope } from './routes.ts'

type Args = Record<string, unknown>

function requireString(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new DramaError('bad-request', `字段 ${field} 须为非空字符串`)
  return v
}

function optionalString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function optionalRecord(v: unknown, field: string): Record<string, unknown> | undefined {
  if (v === undefined) return undefined
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new DramaError('bad-request', `字段 ${field} 须为对象`)
  return v as Record<string, unknown>
}

/** 项目状态合成：待审核提案 > 存储推导状态（§2.3 徽章；已完成优先级最低）。 */
function composeStatus(base: ProjectStatus, pendingProposals: number): ProjectStatus {
  if (pendingProposals > 0 && base !== 'done') return 'pending-review'
  return base
}

function statusOf(detail: ProjectDetail): ProjectStatus {
  const chapters = detail.chapters
  if (detail.adaptations.length > 0) return 'adapting'
  if (chapters.length > 0 && chapters.length >= detail.manifest.plannedChapters && chapters.every((c) => c.finalRevision !== 'absent')) {
    return 'done'
  }
  return 'writing'
}

export function handleDramaApi(host: DramaHost, name: string, args: Args): Envelope {
  try {
    return { ok: true, value: dispatch(host, name, args) }
  } catch (err) {
    if (err instanceof DramaError) {
      return { ok: false, error: { code: err.code, message: err.message } }
    }
    console.error('[dsh-video-generator] drama api error:', err)
    return { ok: false, error: { code: 'internal', message: 'internal error' } }
  }
}

function dispatch(host: DramaHost, name: string, args: Args): unknown {
  switch (name) {
    case 'drama.workspace.resolve':
      return {
        registryAvailable: host.registryAvailable(),
        workspaces: host.workspaceList(),
      }

    case 'drama.project.list': {
      const wid = optionalString(args['workspaceId'])
      // 显式传入未知 workspaceId → 拒绝（§4.1 稳定错误码）；缺省 = 跨全部已注册工作区聚合
      const targets: Array<ResolvedWorkspace | null> = wid ? [host.resolve(wid)] : host.workspaceList().map((w) => safeResolve(host, w.id))
      const projects: Array<Record<string, unknown>> = []
      for (const ws of targets) {
        if (!ws) continue
        for (const s of ws.projects.list()) {
          const pending = ws.proposals.pendingCount(s.id)
          projects.push({ workspaceId: ws.id, ...s, status: composeStatus(s.status, pending), pendingProposals: pending })
        }
      }
      return { projects }
    }

    case 'drama.project.create': {
      const ws = host.resolve(args['workspaceId'])
      const p = optionalRecord(args['project'], 'project')
      if (!p) throw new DramaError('bad-request', '字段 project 须为对象')
      const manifest = ws.projects.create({
        title: requireString(p['title'], 'project.title'),
        category: requireString(p['category'], 'project.category'),
        language: requireString(p['language'], 'project.language'),
        audience: optionalString(p['audience']),
        logline: requireString(p['logline'], 'project.logline'),
        theme: optionalString(p['theme']),
        tone: optionalString(p['tone']),
        plannedChapters: typeof p['plannedChapters'] === 'number' ? p['plannedChapters'] : undefined,
        chapterWordTarget: typeof p['chapterWordTarget'] === 'number' ? p['chapterWordTarget'] : undefined,
        strategy: typeof p['strategy'] === 'string' ? (p['strategy'] as ProjectStrategy) : undefined,
      })
      return { projectId: manifest.id, title: manifest.title }
    }

    case 'drama.project.get': {
      const ws = host.requireProject(args['workspaceId'], args['projectId'])
      const projectId = requireString(args['projectId'], 'projectId')
      const detail = ws.projects.get(projectId)
      if (!detail) throw new DramaError('not-found', `项目不存在: ${projectId}`)
      const proposals = ws.proposals.list(projectId).map((r) => ({
        ...ws.proposals.summarize(projectId, r),
        replacement: r.replacement,
      }))
      const pending = proposals.filter((p) => p.status === 'pending').length
      return {
        workspaceId: ws.id,
        ...detail,
        status: composeStatus(statusOf(detail), pending),
        pendingProposals: pending,
        proposals,
      }
    }

    case 'drama.asset.get': {
      // 页面读取资产内容（diff 基线 / 章节正文按需拉取）；§5 表之外的只读补充方法
      const ws = host.requireProject(args['workspaceId'], args['projectId'])
      const asset = ws.projects.readAsset(requireString(args['projectId'], 'projectId'), requireString(args['assetRef'], 'assetRef'))
      return asset
    }

    case 'drama.asset.update': {
      const ws = host.requireProject(args['workspaceId'], args['projectId'])
      const { revision } = ws.projects.writeAsset(
        requireString(args['projectId'], 'projectId'),
        requireString(args['assetRef'], 'assetRef'),
        requireString(args['baseRevision'], 'baseRevision'),
        args['replacement'],
      )
      return { revision }
    }

    case 'drama.candidate.save': {
      const ws = host.requireProject(args['workspaceId'], args['projectId'])
      const saved = ws.projects.saveCandidate(
        requireString(args['projectId'], 'projectId'),
        typeof args['chapter'] === 'number' ? args['chapter'] : Number.NaN,
        requireString(args['content'], 'content'),
      )
      return saved
    }

    case 'drama.candidate.list': {
      const ws = host.requireProject(args['workspaceId'], args['projectId'])
      const candidates = ws.projects.listCandidates(
        requireString(args['projectId'], 'projectId'),
        typeof args['chapter'] === 'number' ? args['chapter'] : Number.NaN,
      )
      return { candidates }
    }

    case 'drama.proposal.list': {
      const ws = host.requireProject(args['workspaceId'], args['projectId'])
      const projectId = requireString(args['projectId'], 'projectId')
      const status = optionalString(args['status']) as ProposalStatus | undefined
      const proposals = ws.proposals.list(projectId, status).map((r) => ({
        ...ws.proposals.summarize(projectId, r),
        replacement: r.replacement,
      }))
      return { proposals }
    }

    case 'drama.proposal.get': {
      const ws = host.requireProject(args['workspaceId'], args['projectId'])
      const projectId = requireString(args['projectId'], 'projectId')
      const r = ws.proposals.requireProposal(projectId, requireString(args['proposalId'], 'proposalId'))
      return { proposal: { ...ws.proposals.summarize(projectId, r), replacement: r.replacement } }
    }

    case 'drama.proposal.apply': {
      const ws = host.requireProject(args['workspaceId'], args['projectId'])
      const { revision } = ws.proposals.apply(
        requireString(args['projectId'], 'projectId'),
        requireString(args['proposalId'], 'proposalId'),
        args['replacement'],
      )
      return { revision }
    }

    case 'drama.proposal.reject': {
      const ws = host.requireProject(args['workspaceId'], args['projectId'])
      ws.proposals.reject(
        requireString(args['projectId'], 'projectId'),
        requireString(args['proposalId'], 'proposalId'),
        optionalString(args['note']),
      )
      return {}
    }

    case 'drama.task.create': {
      const ws = host.requireProject(args['workspaceId'], args['projectId'])
      const projectId = requireString(args['projectId'], 'projectId')
      const kind = requireString(args['kind'], 'kind')
      if (!isTaskKind(kind)) throw new DramaError('bad-request', `未知任务类型: ${kind}`)
      const params = optionalRecord(args['params'], 'params') ?? {}
      const userRequest = optionalString(args['userRequest'])
      const detail = ws.projects.get(projectId)
      if (!detail) throw new DramaError('not-found', `项目不存在: ${projectId}`)
      const { instruction, inputRefs } = assembleTaskInstruction(ws, projectId, kind, params, userRequest, detail)
      const task = ws.projects.createTask(projectId, { kind, params, instruction, inputRefs })
      return { taskId: task.taskId, instruction, inputRefs }
    }

    case 'drama.task.update': {
      const ws = host.requireProject(args['workspaceId'], args['projectId'])
      const patch = optionalRecord(args['patch'], 'patch') ?? {}
      const event = optionalRecord(patch['event'], 'patch.event')
      const task = ws.projects.updateTask(requireString(args['projectId'], 'projectId'), requireString(args['taskId'], 'taskId'), {
        status: typeof patch['status'] === 'string' ? (patch['status'] as TaskStatus) : undefined,
        sessionId: patch['sessionId'] === null ? null : typeof patch['sessionId'] === 'string' ? patch['sessionId'] : undefined,
        runId: patch['runId'] === null ? null : typeof patch['runId'] === 'string' ? patch['runId'] : undefined,
        error: patch['error'] === null ? null : typeof patch['error'] === 'string' ? patch['error'] : undefined,
        event: event ? { type: requireString(event['type'], 'patch.event.type'), detail: optionalRecord(event['detail'], 'patch.event.detail') } : undefined,
      })
      return { task }
    }

    case 'drama.adaptation.create': {
      const ws = host.requireProject(args['workspaceId'], args['projectId'])
      const projectId = requireString(args['projectId'], 'projectId')
      const chapterId = requireString(args['chapterId'], 'chapterId')
      if (!/^\d{4}$/.test(chapterId)) throw new DramaError('bad-request', `chapterId 须为 4 位章节号: ${chapterId}`)
      const params = optionalRecord(args['params'], 'params') ?? {}
      const detail = ws.projects.get(projectId)
      if (!detail) throw new DramaError('not-found', `项目不存在: ${projectId}`)
      const chapterText = chapterSourceText(ws, projectId, chapterId)
      const record = ws.projects.createAdaptation(projectId, { chapterId, params: params as unknown as AdaptationParams })
      const chapterNumber = Number(chapterId)
      const chapter = detail.chapters.find((c) => c.number === chapterNumber)
      const blueprint =
        chapter && chapter.blueprintRevision !== 'absent'
          ? (readAssetOrNull(ws.projects, projectId, `chapters/${chapterId}/blueprint`) as ChapterBlueprint | null)
          : null
      const chars = asAssetField<{ characters: InstructionContext['characters'] }>(detail.characters.data, 'characters')?.characters ?? []
      const world = asAssetField<{ entries: InstructionContext['worldEntries'] }>(detail.worldbuilding.data, 'entries')?.entries ?? []
      const { instruction, inputRefs } = assembleInstruction('adapt-chapter', {
        projectId,
        workspaceId: ws.id,
        premise: (detail.premise.data ?? null) as InstructionContext['premise'],
        architecture: (detail.architecture.data ?? null) as InstructionContext['architecture'],
        outlineRow: null,
        blueprint,
        worldEntries: relevantWorldEntries(world as never),
        characters: characterSummaries(chars as never, blueprint?.characterIds ?? null, true),
        chapterNumber,
        adaptation: {
          adaptationId: record.adaptationId,
          params: record.params,
          chapterText,
        },
        userRequest: optionalString(args['userRequest']),
      })
      const task = ws.projects.createTask(projectId, {
        kind: 'adapt-chapter',
        params: { adaptationId: record.adaptationId, chapterId, ...params },
        instruction,
        inputRefs,
      })
      return { adaptationId: record.adaptationId, runId: null, taskId: task.taskId, instruction }
    }

    default:
      throw new DramaError('bad-request', `unknown-method: ${name}`)
  }
}

/** 资产数据（sanitize 后对象）安全取字段：非对象返回 undefined。 */
function asAssetField<T>(data: unknown, field: string): T | undefined {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
  const v = (data as Record<string, unknown>)[field]
  if (v === undefined || v === null) return undefined
  return { [field]: v } as unknown as T
}

function safeResolve(host: DramaHost, workspaceId: string): ResolvedWorkspace | null {
  try {
    return host.resolve(workspaceId)
  } catch {
    return null
  }
}

/** 从已取回的 detail 之外按需补读章节资产（detail.chapters 只有 revision 摘要）。 */
function readAssetOrNull(projects: ResolvedWorkspace['projects'], projectId: string, assetRef: string): unknown {
  const asset = projects.readAsset(projectId, assetRef)
  return asset.revision === 'absent' ? null : asset.data
}

function chapterSourceText(ws: ResolvedWorkspace, projectId: string, chapterId: string): string {
  for (const part of ['final', 'draft'] as const) {
    const asset = ws.projects.readAsset(projectId, `chapters/${chapterId}/${part}`)
    if (typeof asset.data === 'string' && asset.data.trim().length > 0) return asset.data
  }
  throw new DramaError('bad-request', `第 ${Number(chapterId)} 章尚无定稿或草稿，不能创建改编任务`)
}

/** 按 kind 组装任务指令（§6.3）：Host 侧完成有限上下文裁剪；导出供单测直调。 */
export function assembleTaskInstruction(
  ws: ResolvedWorkspace,
  projectId: string,
  kind: TaskKind,
  params: Record<string, unknown>,
  userRequest: string | undefined,
  detail: ProjectDetail,
): { instruction: string; inputRefs: string[] } {
  const premise = (detail.premise.data ?? null) as InstructionContext['premise']
  const architecture = (detail.architecture.data ?? null) as InstructionContext['architecture']
  const world = asAssetField<{ entries: InstructionContext['worldEntries'] }>(detail.worldbuilding.data, 'entries')?.entries ?? []
  const chars = asAssetField<{ characters: InstructionContext['characters'] }>(detail.characters.data, 'characters')?.characters ?? []
  const outlineRows = asAssetField<{ rows: OutlineRow[] }>(detail.outline.data, 'rows')?.rows ?? []

  const chapterNumber = typeof params['chapter'] === 'number' ? params['chapter'] : undefined
  const needsChapter = kind === 'generate-chapter-blueprint' || kind === 'generate-chapter-draft' || kind === 'review-chapter' || kind === 'revise-chapter'
  const cid = chapterNumber !== undefined ? chapterDirId(chapterNumber) : null
  if (needsChapter && !cid) {
    throw new DramaError('bad-request', `params.chapter 须为 1..9999 整数（任务类型 ${kind}）`)
  }

  const ctx: InstructionContext = {
    projectId,
    workspaceId: ws.id,
    premise,
    architecture,
    outlineRow: null,
    blueprint: null,
    worldEntries: relevantWorldEntries(world),
    characters: chars,
    userRequest,
  }

  if (cid && chapterNumber !== undefined) {
    ctx.chapterNumber = chapterNumber
    ctx.outlineRow = outlineRows.find((r) => r.chapter === chapterNumber) ?? null
    if (kind === 'generate-chapter-draft' || kind === 'review-chapter' || kind === 'revise-chapter') {
      ctx.blueprint = (readAssetOrNull(ws.projects, projectId, `chapters/${cid}/blueprint`) as ChapterBlueprint | null) ?? null
    }
    if (kind === 'generate-chapter-draft') {
      const ids = ctx.blueprint?.characterIds ?? ctx.outlineRow?.characters ?? null
      ctx.characters = characterSummaries(chars, ids, false)
    } else if (kind === 'generate-chapter-blueprint') {
      ctx.characters = characterSummaries(chars, ctx.outlineRow?.characters ?? null, false)
    } else {
      ctx.characters = characterSummaries(chars, null, false)
    }
    // 上一章相邻定稿（验收 10：连续性上下文只携带相邻一章的末段与新增事实）
    if (kind === 'generate-chapter-draft' && chapterNumber > 1) {
      const prevCid = chapterDirId(chapterNumber - 1)
      if (prevCid) {
        const prevFinal = readAssetOrNull(ws.projects, projectId, `chapters/${prevCid}/final`)
        const prevBlueprint = readAssetOrNull(ws.projects, projectId, `chapters/${prevCid}/blueprint`) as ChapterBlueprint | null
        const prev = prevChapterContext(typeof prevFinal === 'string' ? prevFinal : null, prevBlueprint)
        ctx.prevFinalExcerpt = prev.excerpt
        ctx.continuityFacts = prev.facts
      }
    }
    if (kind === 'review-chapter' || kind === 'revise-chapter') {
      const draft = readAssetOrNull(ws.projects, projectId, `chapters/${cid}/draft`)
      ctx.draft = typeof draft === 'string' ? draft : ''
    }
    if (kind === 'revise-chapter') {
      const review = readAssetOrNull(ws.projects, projectId, `chapters/${cid}/review`) as ChapterReview | null
      const wanted = Array.isArray(params['problemIds'])
        ? (params['problemIds'] as unknown[]).filter((x): x is string => typeof x === 'string')
        : null
      ctx.problems = review ? (wanted ? review.problems.filter((p) => wanted.includes(p.id)) : review.problems) : []
    }
  }
  return assembleInstruction(kind, ctx)
}
