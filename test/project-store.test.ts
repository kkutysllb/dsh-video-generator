/** ProjectStore 单测（规格 §3 / 验收 4/5/6）：CRUD、revision 乐观并发、损坏备份、
 *  id 注入拒绝、章节/候选稿/任务/改编联动。 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DramaError, ProjectStore, parseAssetRef, ABSENT_REVISION } from '../src/store/project.ts'

function tmpWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'vgen-drama-'))
}

function premiseInput() {
  return {
    title: '快递签收的三次握手',
    category: '科普漫剧脚本',
    language: '中文',
    logline: '把 TCP 三次握手做成一场快递签收闹剧',
  }
}

test('create 写 project.json + premise.json，文件 0600/目录 0700，刷新仍在（验收 4）', () => {
  const ws = tmpWorkspace()
  try {
    const store = ProjectStore.open({ workspaceDir: ws })
    const manifest = store.create(premiseInput())
    const dir = join(ws, '.dsh-drama', 'projects', manifest.id)
    assert.ok(existsSync(join(dir, 'project.json')))
    assert.ok(existsSync(join(dir, 'story', 'premise.json')))
    assert.equal(statSync(dir).mode & 0o777, 0o700)
    assert.equal(statSync(join(dir, 'project.json')).mode & 0o777, 0o600)
    // 重新打开（模拟刷新/宿主重启）项目仍在
    const again = ProjectStore.open({ workspaceDir: ws })
    const list = again.list()
    assert.equal(list.length, 1)
    assert.equal(list[0]!.title, premiseInput().title)
    assert.equal(list[0]!.plannedChapters, 10)
    assert.equal(list[0]!.status, 'writing')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('同名活动项目 → project-exists（验收 5）', () => {
  const ws = tmpWorkspace()
  try {
    const store = ProjectStore.open({ workspaceDir: ws })
    store.create(premiseInput())
    assert.throws(() => store.create(premiseInput()), (err: DramaError) => err.code === 'project-exists')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('writeAsset 乐观并发：旧 revision 提交 → stale-revision 且文件未被改动（验收 6）', () => {
  const ws = tmpWorkspace()
  try {
    const store = ProjectStore.open({ workspaceDir: ws })
    const { id } = store.create(premiseInput())
    // create 已写入 premise.json：首读得到真实 revision（非 absent）
    const first = store.readAsset(id, 'premise')
    assert.equal(first.kind, 'json')
    assert.notEqual(first.revision, ABSENT_REVISION)
    const premise = { ...premiseInput(), theme: '协议即人生', plannedChapters: 12, chapterWordTarget: 2000, strategy: 'balanced' as const }
    const w1 = store.writeAsset(id, 'premise', first.revision, premise)
    assert.notEqual(w1.revision, first.revision)
    // 幂等 revision：读到的就是写入后的
    assert.equal(store.readAsset(id, 'premise').revision, w1.revision)
    // 用旧 baseRevision 再写 → stale-revision，文件保持原样
    const before = readFileSync(join(ws, '.dsh-drama', 'projects', id, 'story', 'premise.json'), 'utf8')
    assert.throws(
      () => store.writeAsset(id, 'premise', first.revision, { ...premise, theme: '被篡改' }),
      (err: DramaError) => err.code === 'stale-revision',
    )
    assert.equal(readFileSync(join(ws, '.dsh-drama', 'projects', id, 'story', 'premise.json'), 'utf8'), before)
    // 正确 baseRevision 再写成功
    const w2 = store.writeAsset(id, 'premise', w1.revision, { ...premise, theme: '协议即人生 v2' })
    assert.notEqual(w2.revision, w1.revision)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('markdown 资产（章节草稿/定稿）读写 + 形状校验拒绝', () => {
  const ws = tmpWorkspace()
  try {
    const store = ProjectStore.open({ workspaceDir: ws })
    const { id } = store.create(premiseInput())
    const draft = store.writeAsset(id, 'chapters/0001/draft', ABSENT_REVISION, '# 第一章\n\n三次握手，四次告别。')
    assert.notEqual(draft.revision, ABSENT_REVISION)
    const back = store.readAsset(id, 'chapters/0001/draft')
    assert.equal(back.kind, 'markdown')
    assert.match(String(back.data), /三次握手/)
    assert.throws(
      () => store.writeAsset(id, 'chapters/0001/draft', draft.revision, 42 as unknown as string),
      (err: DramaError) => err.code === 'bad-request',
    )
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('assetRef 白名单：穿越/未知/畸形一律拒绝', () => {
  assert.equal(parseAssetRef('../../etc/passwd'), null)
  assert.equal(parseAssetRef('story/premise.json'), null)
  assert.equal(parseAssetRef('chapters/1/draft'), null)
  assert.equal(parseAssetRef('chapters/0001/secret'), null)
  assert.equal(parseAssetRef(42), null)
  assert.ok(parseAssetRef('premise'))
  assert.ok(parseAssetRef('chapters/0001/final'))
  const ws = tmpWorkspace()
  try {
    const store = ProjectStore.open({ workspaceDir: ws })
    const { id } = store.create(premiseInput())
    assert.throws(() => store.readAsset(id, '../../etc/passwd'), (err: DramaError) => err.code === 'bad-request')
    assert.throws(() => store.projectDir('proj-../evil'), (err: DramaError) => err.code === 'bad-request')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('损坏 JSON 资产：备份 .broken-* 后按缺失处理（revision 归 absent，可重写恢复）', () => {
  const ws = tmpWorkspace()
  try {
    const store = ProjectStore.open({ workspaceDir: ws })
    const { id } = store.create(premiseInput())
    const premiseFile = join(ws, '.dsh-drama', 'projects', id, 'story', 'premise.json')
    writeFileSync(premiseFile, '{broken json', 'utf8')
    const asset = store.readAsset(id, 'premise')
    assert.equal(asset.revision, ABSENT_REVISION, '损坏资产应按缺失处理')
    assert.equal(asset.data, null)
    const entries = readdirSync(join(ws, '.dsh-drama', 'projects', id, 'story'))
    assert.ok(entries.some((n) => n.startsWith('premise.json.broken-')), '损坏文件未备份')
    // 第二次读不重复堆积备份
    store.readAsset(id, 'premise')
    const after = readdirSync(join(ws, '.dsh-drama', 'projects', id, 'story'))
    assert.equal(after.filter((n) => n.startsWith('premise.json.broken-')).length, 1)
    // 恢复路径：以 absent 为基线可整体重写（premise 全量替换契约：必填数值字段带上）
    const recovered = store.writeAsset(id, 'premise', ABSENT_REVISION, {
      ...premiseInput(),
      audience: '',
      theme: '',
      tone: '',
      plannedChapters: 10,
      chapterWordTarget: 2000,
      strategy: 'balanced',
    })
    assert.notEqual(recovered.revision, ABSENT_REVISION)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('任务 create/get/update 事件留痕 + 改编 linkRun 落 run-link.json', () => {
  const ws = tmpWorkspace()
  try {
    const store = ProjectStore.open({ workspaceDir: ws })
    const { id } = store.create(premiseInput())
    const task = store.createTask(id, { kind: 'generate-chapter-draft', params: { chapter: 1 }, instruction: '[漫剧工坊任务]…', inputRefs: ['chapters/0001/blueprint'] })
    assert.equal(task.status, 'pending')
    store.updateTask(id, task.taskId, { status: 'running', sessionId: 'sess-1', event: { type: 'sent-to-session' } })
    const again = store.getTask(id, task.taskId)
    assert.equal(again!.status, 'running')
    assert.equal(again!.sessionId, 'sess-1')
    assert.ok(again!.events.some((e) => e.type === 'sent-to-session'))
    // 改编联动
    const adapt = store.createAdaptation(id, { chapterId: '0001', params: { targetDuration: '90s', aspect: '9:16', fidelity: 'faithful', narrationLanguage: '中文' } })
    store.linkRun(id, adapt.adaptationId, 'run-123-abc')
    const linked = store.getAdaptation(id, adapt.adaptationId)
    assert.equal(linked!.runId, 'run-123-abc')
    assert.ok(existsSync(join(ws, '.dsh-drama', 'projects', id, 'adaptations', adapt.adaptationId, 'run-link.json')))
    store.mirrorAdaptationArtifact(id, adapt.adaptationId, 'script', { scenes: [] })
    assert.ok(existsSync(join(ws, '.dsh-drama', 'projects', id, 'adaptations', adapt.adaptationId, 'script.json')))
    // 非法 runId 拒绝
    assert.throws(() => store.linkRun(id, adapt.adaptationId, '../evil'), (err: DramaError) => err.code === 'bad-request')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('候选稿：另存不覆盖草稿（验收 11 的存储面）', () => {
  const ws = tmpWorkspace()
  try {
    const store = ProjectStore.open({ workspaceDir: ws })
    const { id } = store.create(premiseInput())
    store.writeAsset(id, 'chapters/0001/draft', ABSENT_REVISION, '当前草稿')
    const saved = store.saveCandidate(id, 1, '候选稿 A')
    assert.match(saved.name, /^candidate-\d+\.md$/)
    assert.equal(String(store.readAsset(id, 'chapters/0001/draft').data), '当前草稿')
    assert.equal(store.listCandidates(id, 1).length, 1)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('list 按 updatedAt 倒序；not-found 语义明确', () => {
  const ws = tmpWorkspace()
  try {
    const store = ProjectStore.open({ workspaceDir: ws })
    assert.throws(() => store.requireProject('proj-0000000000-000000'), (err: DramaError) => err.code === 'not-found')
    store.create({ ...premiseInput(), title: 'A' })
    const b = store.create({ ...premiseInput(), title: 'B' })
    // touch B 让它排在前面
    store.touch(b.id)
    const list = store.list()
    assert.equal(list.length, 2)
    assert.equal(list[0]!.id, b.id)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('外部改名损坏场景：project.json 缺失的项目被 list 忽略不抛错', () => {
  const ws = tmpWorkspace()
  try {
    const store = ProjectStore.open({ workspaceDir: ws })
    const a = store.create({ ...premiseInput(), title: 'A' })
    const b = store.create({ ...premiseInput(), title: 'B' })
    // 把 B 的 project.json 改名模拟外部损坏
    renameSync(join(ws, '.dsh-drama', 'projects', b.id, 'project.json'), join(ws, '.dsh-drama', 'projects', b.id, 'project.json.gone'))
    const list = store.list()
    assert.equal(list.length, 1)
    assert.equal(list[0]!.id, a.id)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})
