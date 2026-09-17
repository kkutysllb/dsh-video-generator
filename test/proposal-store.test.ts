/** ProposalStore 单测（规格 §7 / 验收 7/8/9）：提案闭环、留痕、stale、限额。 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DramaError, ProjectStore } from '../src/store/project.ts'
import { ProposalStore } from '../src/store/proposal.ts'

function tmpWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'vgen-proposal-'))
}

function setup() {
  const ws = tmpWorkspace()
  const projects = ProjectStore.open({ workspaceDir: ws })
  const manifest = projects.create({
    title: '测试项目',
    category: '小说',
    language: '中文',
    logline: '一个用于测试的项目',
  })
  const proposals = new ProposalStore(projects)
  return { ws, projects, proposals, projectId: manifest.id }
}

test('propose 落 pending 提案，绝不改权威文件（验收 7 的存储面）', () => {
  const { ws, projects, proposals, projectId } = setup()
  try {
    const before = projects.revisionOf({ label: '', kind: 'json', file: 'story/architecture.json' }, projectId)
    const record = proposals.create(projectId, {
      assetRef: 'architecture',
      baseRevision: 'absent',
      replacement: { mainConflict: 'x', protagonistGoal: 'y', antagonistForce: 'z', cost: '', startingPoint: '', midpointTurn: '', climax: '', ending: '', theme: '', mainline: '', subplots: [], foreshadows: [] },
      summary: '生成故事架构',
      createdBy: 'sess-test',
    })
    assert.equal(record.status, 'pending')
    assert.equal(record.kind, 'architecture')
    assert.ok(existsSync(join(ws, '.dsh-drama', 'projects', projectId, 'proposals', `${record.proposalId}.json`)))
    // 权威文件未被触碰
    const after = projects.revisionOf({ label: '', kind: 'json', file: 'story/architecture.json' }, projectId)
    assert.equal(after, before)
    assert.equal(after, 'absent')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('apply 写入目标文件且内容与 replacement 完全一致，返回新 revision；拒绝留痕（验收 8）', () => {
  const { ws, projects, proposals, projectId } = setup()
  try {
    const replacement = { mainConflict: '三次握手总失败', protagonistGoal: '签收包裹', antagonistForce: '丢件', cost: '耐心', startingPoint: '快递站', midpointTurn: '包裹丢失', climax: '全站寻件', ending: '签收成功', theme: '可靠', mainline: '签收', subplots: [], foreshadows: [] }
    const record = proposals.create(projectId, { assetRef: 'architecture', baseRevision: 'absent', replacement, summary: '架构提案' })
    const { revision } = proposals.apply(projectId, record.proposalId)
    assert.notEqual(revision, 'absent')
    const asset = projects.readAsset(projectId, 'architecture')
    assert.equal(asset.revision, revision)
    assert.deepEqual(asset.data, replacement)
    // 留痕：提案文件 status=applied + decidedAt + appliedRevision
    const raw = JSON.parse(readFileSync(join(ws, '.dsh-drama', 'projects', projectId, 'proposals', `${record.proposalId}.json`), 'utf8')) as { status: string; decidedAt?: string; appliedRevision?: string }
    assert.equal(raw.status, 'applied')
    assert.ok(raw.decidedAt)
    assert.equal(raw.appliedRevision, revision)
    // 已应用的提案不能再次应用
    assert.throws(() => proposals.apply(projectId, record.proposalId), (err: DramaError) => err.code === 'conflict')
    // 拒绝留痕
    const r2 = proposals.create(projectId, { assetRef: 'outline', baseRevision: 'absent', replacement: { rows: [] }, summary: '大纲提案' })
    proposals.reject(projectId, r2.proposalId, '节奏不对，重来')
    const raw2 = JSON.parse(readFileSync(join(ws, '.dsh-drama', 'projects', projectId, 'proposals', `${r2.proposalId}.json`), 'utf8')) as { status: string; note?: string }
    assert.equal(raw2.status, 'rejected')
    assert.equal(raw2.note, '节奏不对，重来')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('baseRevision 过期：apply 被拒置 stale；fresh 标记供页面呈现（验收 9）', () => {
  const { ws, projects, proposals, projectId } = setup()
  try {
    // 先写入一版 architecture，让提案基线 immediately 过期
    const v1 = { mainConflict: 'a', protagonistGoal: 'b', antagonistForce: 'c', cost: '', startingPoint: '', midpointTurn: '', climax: '', ending: '', theme: '', mainline: '', subplots: [], foreshadows: [] }
    const { revision } = projects.writeAsset(projectId, 'architecture', 'absent', v1)
    const record = proposals.create(projectId, { assetRef: 'architecture', baseRevision: revision, replacement: v1, summary: '基于 v1 的提案' })
    assert.ok(proposals.summarize(projectId, proposals.requireProposal(projectId, record.proposalId)!).fresh)
    // 用户手改资产 → 提案过期
    projects.writeAsset(projectId, 'architecture', revision, { ...v1, mainConflict: 'changed' })
    assert.ok(!proposals.summarize(projectId, proposals.requireProposal(projectId, record.proposalId)!).fresh)
    assert.throws(
      () => proposals.apply(projectId, record.proposalId),
      (err: DramaError) => err.code === 'proposal-stale',
    )
    const stale = proposals.requireProposal(projectId, record.proposalId)!
    assert.equal(stale.status, 'stale')
    // stale 提案不能再应用
    assert.throws(() => proposals.apply(projectId, record.proposalId), (err: DramaError) => err.code === 'conflict')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('pending 上限 20：超出拒绝新提案（proposal-limit）', () => {
  const { ws, projects, proposals, projectId } = setup()
  try {
    for (let i = 0; i < 20; i++) {
      proposals.create(projectId, { assetRef: 'outline', baseRevision: 'absent', replacement: { rows: [] }, summary: `提案 ${i}` })
    }
    assert.equal(proposals.pendingCount(projectId), 20)
    assert.throws(
      () => proposals.create(projectId, { assetRef: 'outline', baseRevision: 'absent', replacement: { rows: [] }, summary: '第 21 个' }),
      (err: DramaError) => err.code === 'proposal-limit',
    )
    // 应用一个腾出名额后可再提案
    proposals.apply(projectId, proposals.list(projectId, 'pending')[0]!.proposalId)
    const ok = proposals.create(projectId, { assetRef: 'outline', baseRevision: 'absent', replacement: { rows: [] }, summary: '第 21 个' })
    assert.equal(ok.status, 'pending')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('用户编辑后应用：以编辑后内容落盘（§7 编辑建议路径）', () => {
  const { ws, projects, proposals, projectId } = setup()
  try {
    const record = proposals.create(projectId, {
      assetRef: 'chapters/0001/draft',
      baseRevision: 'absent',
      replacement: 'AI 原稿',
      summary: '第 1 章草稿',
    })
    const { revision } = proposals.apply(projectId, record.proposalId, '用户编辑后的稿子')
    const asset = projects.readAsset(projectId, 'chapters/0001/draft')
    assert.equal(String(asset.data), '用户编辑后的稿子')
    assert.equal(asset.revision, revision)
    // 提案留痕同步更新为编辑后内容
    const applied = proposals.requireProposal(projectId, record.proposalId)!
    assert.equal(applied.replacement, '用户编辑后的稿子')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})
