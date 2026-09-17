/** drama 工具单测（规格 §6.1 / 验收 7）：read 有界性、propose 不落盘、stale 语义。 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DramaHost, type WorkspaceRegistryFace } from '../src/drama/gateway.ts'
import { buildDramaTools, dramaToolDefs, boundedContent, DRAMA_READ_LIMIT_BYTES } from '../src/tools/drama.ts'
import { ProjectStore } from '../src/store/project.ts'

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

function setup() {
  const wsDir = mkdtempSync(join(tmpdir(), 'vgen-drama-tools-'))
  const host = new DramaHost({ registry: registryWith({ ws1: wsDir }) })
  const projects = ProjectStore.open({ workspaceDir: wsDir })
  const projectId = projects.create({ title: '工具项目', category: '小说', language: '中文', logline: 'logline' }).id
  const tools = buildDramaTools(host)
  return { host, wsDir, projects, projectId, tools }
}

/** 读回当前 premise（create 落盘的向导字段），供改写用。 */
function premiseOf(store: ProjectStore, projectId: string): Record<string, unknown> {
  return store.readAsset(projectId, 'premise').data as Record<string, unknown>
}

test('drama_read：缺失资产报 absent、json 资产返回内容 + revision、markdown 直读', async () => {
  const { tools, projectId, wsDir } = setup()
  try {
    const missing = (await tools.read.execute({ workspaceId: 'ws1', projectId, assetRef: 'architecture' })) as { value: { missing: boolean; revision: string; content: string } }
    assert.equal(missing.value.missing, true)
    assert.equal(missing.value.revision, 'absent')
    assert.match(String(missing.value.content), /空资产/)

    const store = ProjectStore.open({ workspaceDir: wsDir })
    // create 已写入 premise：以当前 revision 为基线改写
    const current = store.readAsset(projectId, 'premise').revision
    store.writeAsset(projectId, 'premise', current, { ...premiseOf(store, projectId), theme: '主题X' })
    const read = (await tools.read.execute({ workspaceId: 'ws1', projectId, assetRef: 'premise' })) as { value: { missing: boolean; content: string; revision: string; truncated: boolean } }
    assert.equal(read.value.missing, false)
    assert.match(read.value.content, /主题X/)
    assert.equal(read.value.truncated, false)
    const storeRev = store.readAsset(projectId, 'premise').revision
    assert.equal(read.value.revision, storeRev, 'drama_read 的 revision 必须与 store 一致（提案基线的锚）')

    store.writeAsset(projectId, 'chapters/0001/draft', 'absent', '正文第一段')
    const md = (await tools.read.execute({ workspaceId: 'ws1', projectId, assetRef: 'chapters/0001/draft' })) as { value: { content: string; kind: string } }
    assert.equal(md.value.kind, 'markdown')
    assert.equal(md.value.content, '正文第一段')
  } finally {
    rmSync(wsDir, { recursive: true, force: true })
  }
})

test('drama_read 有界性：内容超 512KiB 截断并报告', async () => {
  assert.equal(boundedContent('x'.repeat(100)).truncated, false)
  const big = boundedContent('y'.repeat(DRAMA_READ_LIMIT_BYTES + 9999))
  assert.equal(big.truncated, true)
  assert.ok(Buffer.byteLength(big.content, 'utf8') <= DRAMA_READ_LIMIT_BYTES)
  assert.equal(big.originalBytes, DRAMA_READ_LIMIT_BYTES + 9999)
})

test('drama_propose：落提案且权威文件不动；revision 失配 → stale-revision（验收 7）', async () => {
  const { tools, projects, projectId, wsDir } = setup()
  try {
    const outlineFile = join(wsDir, '.dsh-drama', 'projects', projectId, 'story', 'outline.json')
    const arch = { mainConflict: 'a', protagonistGoal: 'b', antagonistForce: 'c', cost: '', startingPoint: '', midpointTurn: '', climax: '', ending: '', theme: '', mainline: '', subplots: [], foreshadows: [] }
    const { revision } = projects.writeAsset(projectId, 'architecture', 'absent', arch)
    const before = projects.revisionOf({ label: '', kind: 'json', file: 'story/outline.json' }, projectId)

    // 失配提案被拒
    const stale = await tools.propose.execute({
      workspaceId: 'ws1',
      projectId,
      assetRef: 'architecture',
      baseRevision: 'absent',
      replacement: arch,
      summary: '失配提案',
    })
    assert.deepEqual((stale as { ok: boolean; error: { code: string } }).ok, false)
    assert.equal((stale as { ok: boolean; error: { code: string } }).error.code, 'stale-revision')

    // 匹配提案成功：pending + 权威文件未动
    const result = (await tools.propose.execute({
      workspaceId: 'ws1',
      projectId,
      assetRef: 'architecture',
      baseRevision: revision,
      replacement: { ...arch, mainConflict: '升级版冲突' },
      summary: '架构改写提案',
      taskId: 'task-1',
    })) as { ok: boolean; value: { proposalId: string; status: string } }
    assert.equal(result.ok, true)
    assert.equal(result.value.status, 'pending')
    assert.equal(projects.revisionOf({ label: '', kind: 'json', file: 'story/architecture.json' }, projectId), revision, '权威文件被工具改动！')
    const proposals = projects.list() // 触碰不到提案；直接验证 outline 未动
    assert.equal(projects.revisionOf({ label: '', kind: 'json', file: 'story/outline.json' }, projectId), before)
    void proposals
    void outlineFile
    // 提案文件存在
    const ws = new DramaHost({ registry: registryWith({ ws1: wsDir }) }).resolve('ws1')
    const pending = ws.proposals.list(projectId, 'pending')
    assert.equal(pending.length, 1)
    assert.equal(pending[0]!.assetRef, 'architecture')
  } finally {
    rmSync(wsDir, { recursive: true, force: true })
  }
})

test('drama_propose：形状非法 replacement 被拒（与写入同契约）', async () => {
  const { tools, projects, projectId, wsDir } = setup()
  try {
    const result = await tools.propose.execute({
      workspaceId: 'ws1',
      projectId,
      assetRef: 'chapters/0001/draft',
      baseRevision: 'absent',
      replacement: { not: 'a string' },
      summary: '坏形状',
    })
    assert.equal((result as { ok: boolean }).ok, false)
    assert.equal((result as { error: { code: string } }).error.code, 'bad-request')
    // 空资产 + 合法字符串 → 提案成功（baseRevision=absent）
    const ok = (await tools.propose.execute({
      workspaceId: 'ws1',
      projectId,
      assetRef: 'chapters/0001/draft',
      baseRevision: 'absent',
      replacement: '合法草稿',
      summary: '第 1 章草稿提案',
    })) as { ok: boolean }
    assert.equal(ok.ok, true)
    // 权威文件仍未动
    assert.equal(projects.readAsset(projectId, 'chapters/0001/draft').revision, 'absent')
  } finally {
    rmSync(wsDir, { recursive: true, force: true })
  }
})

test('drama 工具定义：名称/必填参数/纪律描述', () => {
  const { host, wsDir } = setup()
  try {
    const tools = buildDramaTools(host)
    const defs = dramaToolDefs(tools)
    assert.deepEqual(defs.map((d) => d.name), ['drama_read', 'drama_propose'])
    const readDef = defs[0]!
    const proposeDef = defs[1]!
    for (const required of ['workspaceId', 'projectId', 'assetRef'] as const) {
      assert.ok((readDef.parameters.required as string[]).includes(required))
    }
    for (const required of ['workspaceId', 'projectId', 'assetRef', 'baseRevision', 'replacement', 'summary'] as const) {
      assert.ok((proposeDef.parameters.required as string[]).includes(required))
    }
    assert.match(proposeDef.description, /绝不直接写权威文件|不直接写权威文件/)
    assert.match(proposeDef.description, /stale-revision/)
    // 渲染契约
    const rendered = readDef.output.render({}, { ok: true })
    assert.equal(rendered[0]!.type, 'text')
  } finally {
    rmSync(wsDir, { recursive: true, force: true })
  }
})

test('宿主 ≤0.1.4（无 workspaceRegistry）：drama 工具返回稳定 workspace-unknown', async () => {
  const host = new DramaHost({ registry: null })
  const tools = buildDramaTools(host)
  const r = (await tools.read.execute({ workspaceId: 'ws1', projectId: 'proj-x', assetRef: 'premise' })) as { ok: boolean; error: { code: string } }
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'workspace-unknown')
})
