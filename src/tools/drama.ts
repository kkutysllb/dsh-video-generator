/** Agent 创作工具（规格 §6.1）：drama_read / drama_propose。
 *
 * 纪律（写进工具描述与能力通告）：先 drama_read 取最新 revision → 产出建议 →
 * drama_propose 一次性提交完整替换内容 → 在收到「用户已应用」前不得声称已保存。
 * drama_propose 绝不直接写权威文件；baseRevision 失配 → stale-revision，
 * Agent 须重读后再提案。
 */

import { DramaError, parseAssetRef, validateReplacement, type AssetKind } from '../store/project.ts'
import type { DramaHost } from '../drama/gateway.ts'
import type { DshToolDefinition } from './handoff.ts'

export interface DramaTools {
  read: { execute: (args: Record<string, unknown>) => Promise<unknown> }
  propose: { execute: (args: Record<string, unknown>) => Promise<unknown> }
}

export interface DramaToolResult {
  ok: true
  value: unknown
}

/** 单资产读取上限（§6.1）：超过截断并报告。 */
export const DRAMA_READ_LIMIT_BYTES = 512 * 1024

/** 读取有界化：内容超限截断，返回 truncated 标记与原始大小。 */
export function boundedContent(content: string): { content: string; truncated: boolean; originalBytes: number } {
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes <= DRAMA_READ_LIMIT_BYTES) return { content, truncated: false, originalBytes: bytes }
  // 按字符截断到字节上限以内（UTF-8 保守 3 字节/字符估算后再校验）
  let cut = Math.floor(DRAMA_READ_LIMIT_BYTES / 3)
  let sliced = content.slice(0, cut)
  while (Buffer.byteLength(sliced, 'utf8') > DRAMA_READ_LIMIT_BYTES && cut > 0) {
    cut = Math.floor(cut * 0.9)
    sliced = content.slice(0, cut)
  }
  return { content: sliced, truncated: true, originalBytes: bytes }
}

function requireProjectId(args: Record<string, unknown>): string {
  const projectId = args['projectId']
  if (typeof projectId !== 'string' || projectId.length === 0) {
    throw new DramaError('bad-request', '缺少 projectId（来自任务指令的「项目」字段）')
  }
  return projectId
}

function requireAssetRef(args: Record<string, unknown>): string {
  const assetRef = args['assetRef']
  if (!parseAssetRef(assetRef)) {
    throw new DramaError('bad-request', `未知资产: ${String(assetRef)}（合法：premise/architecture/worldbuilding/outline/characters/chapters/<nnnn>/<blueprint|draft|review|final>）`)
  }
  return assetRef as string
}

export function buildDramaTools(host: DramaHost): DramaTools {
  /** 对齐 vgen_* 契约：错误以 {ok:false,error} 信封返回给会话模型（不向工具层抛裸异常）。 */
  const wrap = (fn: () => unknown): unknown => {
    try {
      return { ok: true, value: fn() }
    } catch (err) {
      if (err instanceof DramaError) return { ok: false, error: { code: err.code, message: err.message } }
      return { ok: false, error: { code: 'internal', message: err instanceof Error ? err.message : String(err) } }
    }
  }
  return {
    read: {
      execute: async (args) =>
        wrap(() => {
          const ws = host.resolve(args['workspaceId'])
          const projectId = requireProjectId(args)
          const assetRef = requireAssetRef(args)
          const parsed = parseAssetRef(assetRef)!
          const asset = ws.projects.readAsset(projectId, assetRef)
          const missing = asset.revision === 'absent' || asset.data === null
          const raw = missing
            ? ''
            : asset.kind === 'markdown'
              ? String(asset.data)
              : JSON.stringify(asset.data, null, 2)
          const bounded = boundedContent(raw)
          return {
            assetRef,
            kind: asset.kind as AssetKind,
            revision: asset.revision,
            missing,
            content: missing ? '（空资产：尚无内容，可作为全新生成处理，baseRevision 提交 "absent"）' : bounded.content,
            truncated: bounded.truncated,
            originalBytes: bounded.originalBytes,
            hint: '提案时 baseRevision 必须使用本次返回的 revision',
          }
        }),
    },
    propose: {
      execute: async (args) =>
        wrap(() => {
          const ws = host.resolve(args['workspaceId'])
          const projectId = requireProjectId(args)
          const assetRef = requireAssetRef(args)
          const parsed = parseAssetRef(assetRef)!
          const baseRevision = typeof args['baseRevision'] === 'string' && args['baseRevision'] ? args['baseRevision'] : 'absent'
          const replacement = args['replacement']
          const summary = typeof args['summary'] === 'string' ? args['summary'] : ''
          if (!summary.trim()) throw new DramaError('bad-request', '缺少 summary（提案摘要，供用户审核）')
          // 形状校验（与最终写入同契约），失败给 Agent 可修的明确错误
          validateReplacement(parsed.label, parsed.kind, replacement)
          // 提案时基线核验：失配直接拒绝，避免生成注定过期的提案（§6.1）
          const current = ws.projects.revisionOf(parsed, projectId)
          if (current !== baseRevision) {
            throw new DramaError(
              'stale-revision',
              `资产 ${assetRef} 当前 revision 与提交的 baseRevision 不一致（当前 ${current === 'absent' ? 'absent' : current.slice(0, 8)}），请先 drama_read 重读再提案`,
            )
          }
          const record = ws.proposals.create(projectId, {
            assetRef,
            baseRevision,
            replacement,
            summary,
            taskId: typeof args['taskId'] === 'string' ? args['taskId'] : undefined,
            createdBy: typeof args['sessionId'] === 'string' && args['sessionId'] ? args['sessionId'] : 'agent',
          })
          return {
            proposalId: record.proposalId,
            assetRef: record.assetRef,
            status: record.status,
            message: '提案已提交待审核。在用户于漫剧工坊页面「应用」之前，内容尚未写入权威文件，不得声称已保存。',
          }
        }),
    },
  }
}

/* ── DSH tools registry 定义（plain object，照 vgen_* 契约） ── */

function jsonRender(_args: unknown, value: unknown): Array<{ type: string; text: string }> {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

const ASSET_REF_PARAM = {
  type: 'string',
  description:
    '资产引用（白名单）：premise | architecture | worldbuilding | outline | characters | chapters/<4位章节号>/<blueprint|draft|review|final>',
} as const

export function dramaToolDefs(tools: DramaTools): DshToolDefinition[] {
  return [
    {
      name: 'drama_read',
      description:
        '读取漫剧工坊项目的一个权威资产（内容 + revision）。单次最多一个资产；内容超过 512KiB 截断并报告。提案前必须先读取以获取最新 revision。',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string', description: 'workspaceId（来自任务指令的「项目」字段括号内）' },
          projectId: { type: 'string', description: '项目 id（proj- 前缀，来自任务指令）' },
          assetRef: ASSET_REF_PARAM,
        },
        required: ['workspaceId', 'projectId', 'assetRef'],
      },
      output: { schema: { type: 'object' }, render: jsonRender },
      timeoutMs: 10_000,
      execute: (args) => tools.read.execute((args ?? {}) as Record<string, unknown>),
    },
    {
      name: 'drama_propose',
      description:
        '向漫剧工坊项目提交内容提案（pending），绝不直接写权威文件；用户在工坊页面审核（可编辑）后显式应用才生效。baseRevision 失配返回 stale-revision，须重读后再提案。一次只提案一个资产，replacement 必须是目标资产的完整替换内容。',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string', description: 'workspaceId（来自任务指令）' },
          projectId: { type: 'string', description: '项目 id（proj- 前缀）' },
          assetRef: ASSET_REF_PARAM,
          baseRevision: { type: 'string', description: 'drama_read 返回的 revision；资产为空时传 "absent"' },
          replacement: { type: ['object', 'string'], description: '完整替换内容：json 资产为对象（须符合资产形状），markdown 资产为字符串' },
          summary: { type: 'string', description: '提案摘要（供用户在审核卡片上快速理解改动）' },
          taskId: { type: 'string', description: '可选：关联任务 id（task- 前缀）' },
          sessionId: { type: 'string', description: '可选：发起会话 id（留痕用）' },
        },
        required: ['workspaceId', 'projectId', 'assetRef', 'baseRevision', 'replacement', 'summary'],
      },
      output: { schema: { type: 'object' }, render: jsonRender },
      timeoutMs: 10_000,
      execute: (args) => tools.propose.execute((args ?? {}) as Record<string, unknown>),
    },
  ]
}
