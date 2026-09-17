/** drama RPC 面单测（规格 §5 / 验收 5/6/10）：信封、错误码、workspace 未知、
 *  指令组装有限上下文（不含其他章节正文）。 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DramaHost, type WorkspaceRegistryFace } from '../src/drama/gateway.ts'
import { handleDramaApi, assembleTaskInstruction } from '../src/host/project-routes.ts'
import type { ProjectDetail } from '../src/store/project.ts'

function registryWith(dirs: Record<string, string>): WorkspaceRegistryFace {
  return {
    get(id: string) {
      return dirs[id] ? { path: dirs[id], title: id } : undefined
    },
    list() {
      return Object.entries(dirs).map(([id, path]) => ({ id, title: id, path, cwd: path }))
    },
  }
}

interface RpcResult {
  ok: boolean
  value?: unknown
  error?: { code: string; message: string }
}

function call(host: DramaHost, method: string, args: Record<string, unknown>): RpcResult {
  return handleDramaApi(host, method, args) as RpcResult
}

function setup() {
  const wsDir = mkdtempSync(join(tmpdir(), 'vgen-drama-rpc-'))
  const host = new DramaHost({ registry: registryWith({ ws1: wsDir }) })
  const created = call(host, 'drama.project.create', {
    workspaceId: 'ws1',
    project: { title: 'RPC 项目', category: '小说', language: '中文', logline: '测试日志线' },
  })
  assert.ok(created.ok, 'create 失败')
  const projectId = (created.value as { projectId: string }).projectId
  return { host, wsDir, projectId }
}

function basepremise() {
  return {
    title: 'RPC 项目',
    category: '小说',
    language: '中文',
    audience: '',
    logline: '测试日志线',
    theme: '',
    tone: '',
    plannedChapters: 10,
    chapterWordTarget: 2000,
    strategy: 'balanced',
  }
}

test('workspace.resolve 只回 id/title，不带本地路径；未知 workspace → workspace-unknown', () => {
  const { host, wsDir } = setup()
  try {
    const r = call(host, 'drama.workspace.resolve', {})
    assert.ok(r.ok)
    const value = r.value as { registryAvailable: boolean; workspaces: Array<{ id: string; title: string }> }
    assert.equal(value.registryAvailable, true)
    assert.equal(value.workspaces[0]!.id, 'ws1')
    assert.ok(!JSON.stringify(value).includes('vgen-drama-rpc-'), '响应泄漏本地路径片段')
    const bad = call(host, 'drama.project.list', { workspaceId: 'nope' })
    assert.equal(bad.ok, false)
    assert.equal(bad.error!.code, 'workspace-unknown')
  } finally {
    rmSync(wsDir, { recursive: true, force: true })
  }
})

test('project.create/get/list 全链路 + 同名 project-exists（验收 5）', () => {
  const { host, projectId, wsDir } = setup()
  try {
    const dup = call(host, 'drama.project.create', {
      workspaceId: 'ws1',
      project: { title: 'RPC 项目', category: '小说', language: '中文', logline: 'x' },
    })
    assert.equal(dup.ok, false)
    assert.equal(dup.error!.code, 'project-exists')
    const got = call(host, 'drama.project.get', { workspaceId: 'ws1', projectId })
    assert.ok(got.ok)
    const detail = got.value as { manifest: { title: string }; premise: { revision: string }; proposals: unknown[]; status: string }
    assert.equal(detail.manifest.title, 'RPC 项目')
    assert.notEqual(detail.premise.revision, 'absent', 'create 已写入 premise.json：非空资产')
    assert.deepEqual(detail.proposals, [])
    assert.equal(detail.status, 'writing')
    const listed = call(host, 'drama.project.list', {})
    assert.ok(listed.ok)
    const projects = (listed.value as { projects: Array<{ id: string; pendingProposals: number }> }).projects
    assert.equal(projects.length, 1)
    assert.equal(projects[0]!.pendingProposals, 0)
  } finally {
    rmSync(wsDir, { recursive: true, force: true })
  }
})

test('asset.update stale-revision 语义（验收 6）+ 未知方法 bad-request', () => {
  const { host, projectId, wsDir } = setup()
  try {
    // create 后 premise 已存在：取当前 revision 作为基线
    const got = call(host, 'drama.project.get', { workspaceId: 'ws1', projectId })
    assert.ok(got.ok)
    const current = (got.value as { premise: { revision: string } }).premise.revision
    const okWrite = call(host, 'drama.asset.update', {
      workspaceId: 'ws1',
      projectId,
      assetRef: 'premise',
      baseRevision: current,
      replacement: { ...basepremise(), theme: '变化后的主题' },
    })
    assert.ok(okWrite.ok, `asset.update 失败: ${JSON.stringify(okWrite.error)}`)
    const stale = call(host, 'drama.asset.update', {
      workspaceId: 'ws1',
      projectId,
      assetRef: 'premise',
      baseRevision: current,
      replacement: { ...basepremise(), theme: 'again' },
    })
    assert.equal(stale.ok, false)
    assert.equal(stale.error!.code, 'stale-revision')
    assert.equal(call(host, 'drama.nope', {}).error!.code, 'bad-request')
  } finally {
    rmSync(wsDir, { recursive: true, force: true })
  }
})

/** 验收 10：Host 组装的章节草稿指令只含有限上下文。 */
test('指令组装：章节草稿上下文 = 蓝图 + 出场角色摘要 + 相关世界观 + 上一章末段 + 用户要求', () => {
  const { host, projectId, wsDir } = setup()
  try {
    const ws = host.resolve('ws1')
    // 第 2 章蓝图（出场角色只有 alice）
    ws.projects.writeAsset(projectId, 'chapters/0002/blueprint', 'absent', {
      goal: '送出第二次确认',
      conflict: '包裹卡在半路',
      scenes: '中转站',
      characterIds: ['alice'],
      keyEvents: ['第二次挥手'],
      factsFromPrev: ['第一次握手完成'],
      newFacts: ['包裹已到中转站'],
      endingHook: '第三次挥手迟迟不来',
    })
    ws.projects.writeAsset(projectId, 'characters', 'absent', {
      characters: [
        { id: 'alice', name: '爱丽丝', identity: '快递员', status: '在岗', appearanceChapters: [1, 2], hasVisualAsset: false, appearance: '蓝色制服', personality: '执着', desire: '签收', fear: '丢件', background: '老快递员', relationships: [], keyEvents: [], visualPrompt: 'blue uniform courier' },
        { id: 'bob', name: '鲍勃', identity: '收件人', status: '在家', appearanceChapters: [1], hasVisualAsset: false, appearance: '眼镜', personality: '急躁', desire: '收件', fear: '超时', background: '程序员', relationships: [], keyEvents: [], visualPrompt: '' },
      ],
    })
    ws.projects.writeAsset(projectId, 'worldbuilding', 'absent', {
      entries: [
        { id: 'rule-syn', category: 'rule', title: '同步规则', content: '三次握手方可签收', citedInBody: true },
        { id: 'geo-hub', category: 'geography', title: '中转站', content: '城市中心', citedInBody: false },
      ],
    })
    // 第 1 章草稿 + 定稿 + 蓝图（相邻连续性上下文只允许带定稿末段与新增事实）
    ws.projects.writeAsset(projectId, 'chapters/0001/draft', 'absent', '第一章草稿内容（绝不应出现在第 2 章指令中）')
    ws.projects.writeAsset(projectId, 'chapters/0001/final', 'absent', '第一章定稿开头。'.repeat(50) + '末段：第一次挥手完成，包裹发出。')
    ws.projects.writeAsset(projectId, 'chapters/0001/blueprint', 'absent', {
      goal: '第一次握手', conflict: '无人接件', scenes: '门口', characterIds: ['alice'], keyEvents: [], factsFromPrev: [], newFacts: ['首次握手完成'], endingHook: '等回执',
    })
    // 第 3 章定稿（绝不出现）
    ws.projects.writeAsset(projectId, 'chapters/0003/final', 'absent', '第三章绝密内容 XYZ-SECRET-CHAPTER-3')

    const detail = ws.projects.get(projectId) as ProjectDetail
    const { instruction, inputRefs } = assembleTaskInstruction(
      ws,
      projectId,
      'generate-chapter-draft',
      { chapter: 2 },
      '多写一点中转站的描写',
      detail,
    )
    // 必含：蓝图/出场角色摘要/相关世界观/上一章末段/连续性事实/用户要求
    assert.match(instruction, /任务类型：generate-chapter-draft/)
    assert.match(instruction, /送出第二次确认/)
    assert.match(instruction, /爱丽丝（alice）/)
    assert.match(instruction, /三次握手方可签收/)
    assert.match(instruction, /末段：第一次挥手完成/)
    assert.match(instruction, /首次握手完成/)
    assert.match(instruction, /多写一点中转站的描写/)
    // 不含：未出场角色、非引用世界观、其他章节正文
    assert.ok(!instruction.includes('鲍勃'), '未出场角色不应出现')
    assert.ok(!instruction.includes('城市中心'), '未标记供正文引用的条目不应出现（存在引用条目时）')
    assert.ok(!instruction.includes('第一章草稿内容'), '第 1 章草稿不应出现（只带定稿末段）')
    assert.ok(!instruction.includes('XYZ-SECRET-CHAPTER-3'), '第 3 章定稿绝不出现')
    assert.ok(!instruction.includes('第三章绝密内容'))
    assert.deepEqual(inputRefs, ['chapters/0002/blueprint', 'characters', 'worldbuilding'])
  } finally {
    rmSync(wsDir, { recursive: true, force: true })
  }
})

test('drama.task.create 落任务并返回 Host 组装指令；task.update 回写 sessionId', () => {
  const { host, projectId, wsDir } = setup()
  try {
    const r = call(host, 'drama.task.create', {
      workspaceId: 'ws1',
      projectId,
      kind: 'generate-architecture',
      userRequest: '突出荒诞感',
    })
    assert.ok(r.ok)
    const value = r.value as { taskId: string; instruction: string }
    assert.match(value.taskId, /^task-/)
    assert.match(value.instruction, /\[漫剧工坊任务\]/)
    assert.match(value.instruction, /突出荒诞感/)
    assert.match(value.instruction, new RegExp(projectId))
    const upd = call(host, 'drama.task.update', {
      workspaceId: 'ws1',
      projectId,
      taskId: value.taskId,
      patch: { status: 'running', sessionId: 'sess-9' },
    })
    assert.ok(upd.ok)
    const task = (upd.value as { task: { status: string; sessionId?: string } }).task
    assert.equal(task.status, 'running')
    assert.equal(task.sessionId, 'sess-9')
    assert.equal(call(host, 'drama.task.create', { workspaceId: 'ws1', projectId, kind: 'nope' }).error!.code, 'bad-request')
  } finally {
    rmSync(wsDir, { recursive: true, force: true })
  }
})

test('proposal.apply/reject 走 RPC 面；无 registry 时整体降级 workspace-unknown', () => {
  const { host, projectId, wsDir } = setup()
  try {
    // 用户手写资产 → 直写；Agent 提案 → 应用
    const w = call(host, 'drama.asset.update', {
      workspaceId: 'ws1',
      projectId,
      assetRef: 'outline',
      baseRevision: 'absent',
      replacement: { rows: [{ chapter: 1, title: 'T', goal: '', mainEvents: '', characters: [], scenes: '', mood: '', clueProgress: '', endingHook: '', status: 'planned' }] },
    })
    assert.ok(w.ok)
    const revision = (w.value as { revision: string }).revision
    // 直接构造提案（Agent 侧等价路径在 drama-tools.test 覆盖）
    const ws = host.resolve('ws1')
    const record = ws.proposals.create(projectId, { assetRef: 'outline', baseRevision: revision, replacement: { rows: [] }, summary: '清空大纲' })
    const apply = call(host, 'drama.proposal.apply', { workspaceId: 'ws1', projectId, proposalId: record.proposalId })
    assert.ok(apply.ok)
    assert.equal((apply.value as { revision: string }).revision.length, 64)
    const r2 = ws.proposals.create(projectId, { assetRef: 'outline', baseRevision: (w.value as { revision: string }).revision, replacement: { rows: [] }, summary: '再来' })
    const reject = call(host, 'drama.proposal.reject', { workspaceId: 'ws1', projectId, proposalId: r2.proposalId, note: '不要' })
    assert.ok(reject.ok)
    assert.equal(ws.proposals.requireProposal(projectId, r2.proposalId).status, 'rejected')
    // 无 registry 降级：缺省 list 返回空；显式 workspaceId 拒绝
    const bare = new DramaHost({ registry: null })
    assert.ok(call(bare, 'drama.project.list', {}).ok)
    assert.deepEqual((call(bare, 'drama.project.list', {}).value as { projects: unknown[] }).projects, [])
    assert.equal(call(bare, 'drama.project.list', { workspaceId: 'ws1' }).error!.code, 'workspace-unknown')
    const resolveBare = call(bare, 'drama.workspace.resolve', {})
    assert.equal((resolveBare.value as { registryAvailable: boolean }).registryAvailable, false)
  } finally {
    rmSync(wsDir, { recursive: true, force: true })
  }
})
