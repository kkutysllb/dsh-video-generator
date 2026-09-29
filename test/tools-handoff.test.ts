import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildHandoffTools } from '../src/tools/handoff.ts'
import { VaultStore } from '../src/store/vault.ts'
import { RunStore } from '../src/store/runs.ts'

const STORY = {
  title: '鲸鱼奇缘',
  logline: '小鲸鱼林鲸跨越大海寻找传说中的鲸群',
  style: '3d render, clean style',
  characters: [{ id: 'linjing', name: '林鲸', appearance: '蓝色皮肤的小鲸鱼，圆眼睛' }],
  chapters: ['第一幕：独自的海洋', '第二幕：风暴与相遇'],
}

const SCRIPT = {
  ...STORY,
  scenes: [{ id: 's1', name: '清晨海面', description: '波光粼粼的海面', characters: ['linjing'] }],
  dialog: [{ sceneId: 's1', characterId: 'linjing', line: '今天也要游过这片海。' }],
}

function ctx() {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-tools-'))
  const vault = VaultStore.open({ file: join(dir, 'vault.json') })
  const runs = RunStore.open({ rootDir: join(dir, 'runs') })
  const tools = buildHandoffTools({ vault, runs })
  return { dir, vault, runs, tools }
}

test('vgen_story：开 run 并落盘 story.json；缺字段走 HandoffError 信封', async () => {
  const c = ctx()
  try {
    const r = await c.tools.story.execute({ story: STORY }) as { ok: boolean; value: { runId: string; stages: string[] } }
    assert.equal(r.ok, true)
    assert.ok(r.value.runId.startsWith('run-'))
    assert.deepEqual(r.value.stages, ['story'])
    const bad = await c.tools.story.execute({ story: { title: 'x' } }) as { ok: boolean; error: { code: string } }
    assert.equal(bad.ok, false)
    assert.equal(bad.error.code, 'bad-request')
    const got = c.runs.get(r.value.runId)
    assert.equal(got?.stages['story'], 'done')
  } finally {
    rmSync(c.dir, { recursive: true, force: true })
  }
})

test('vgen_script：挂到已有 run；未知 runId 报 not-found', async () => {
  const c = ctx()
  try {
    const open = await c.tools.story.execute({ story: STORY }) as { value: { runId: string } }
    const r = await c.tools.script.execute({ runId: open.value.runId, script: { ...SCRIPT } }) as { ok: boolean }
    assert.equal(r.ok, true)
    const miss = await c.tools.script.execute({ runId: 'run-nope', script: { ...SCRIPT } }) as { ok: boolean; error: { code: string } }
    assert.equal(miss.error.code, 'not-found')
  } finally {
    rmSync(c.dir, { recursive: true, force: true })
  }
})

test('vgen_storyboard：分镜校验 + 四层提示词注入落盘 storyboard.json', async () => {
  const c = ctx()
  try {
    const open = await c.tools.story.execute({ story: STORY }) as { value: { runId: string } }
    await c.tools.script.execute({ runId: open.value.runId, script: { ...SCRIPT } })
    const r = await c.tools.storyboard.execute({
      runId: open.value.runId,
      shots: [
        { index: 1, line: '鲸鱼跃出海面', prompt: '鲸鱼跃出海面溅起水花', characterIds: ['linjing'], sceneId: 's1', camera: '中景，缓慢推进', durationSec: 5 },
      ],
      style: '3d render, clean style',
    }) as { ok: boolean; value: { shots: Array<{ prompt: string }> } }
    assert.equal(r.ok, true)
    assert.ok(r.value.shots[0]!.prompt.includes('鲸鱼跃出海面溅起水花'))
    assert.ok(r.value.shots[0]!.prompt.includes('3d render, clean style'))
    assert.ok(r.value.shots[0]!.prompt.includes('林鲸（蓝色皮肤的小鲸鱼，圆眼睛）'))
  } finally {
    rmSync(c.dir, { recursive: true, force: true })
  }
})

/* ── P2：mode=mv（先曲后镜）────────────────────────────── */

test('vgen_story mode=mv：run.mode 落盘；缺省 drama 不带 mode 键', async () => {
  const c = ctx()
  try {
    const mv = await c.tools.story.execute({ story: STORY, mode: 'mv' }) as { value: { runId: string; mode: string } }
    assert.equal(mv.value.mode, 'mv')
    assert.equal(c.runs.get(mv.value.runId)?.mode, 'mv')
    const d = await c.tools.story.execute({ story: STORY }) as { value: { runId: string; mode: string } }
    assert.equal(d.value.mode, 'drama')
    assert.equal('mode' in (c.runs.get(d.value.runId) ?? {}), false, 'drama 不落 mode 键')
  } finally {
    rmSync(c.dir, { recursive: true, force: true })
  }
})

test('vgen_storyboard：mode=mv 且 score.json 就绪 → 每镜 durationSec 预算到歌曲时长（偏差 ≤±2%）', async () => {
  const c = ctx()
  try {
    const open = await c.tools.story.execute({ story: STORY, mode: 'mv' }) as { value: { runId: string } }
    const runId = open.value.runId
    await c.tools.script.execute({ runId, script: { ...SCRIPT } })
    const rd = join(c.runs.rootDir, runId)
    mkdirSync(join(rd, 'music'), { recursive: true })
    writeFileSync(join(rd, 'music', 'score.json'), JSON.stringify({ kind: 'song', durationSec: 9, file: 'music/song.mp3', grid: { source: 'estimate', bpm: null, offsetSec: null, sections: [], beats: [] }, lyrics: [], model: 'x', channelId: 'c' }))
    const shots = {
      shots: [
        { index: 1, line: '一', prompt: '画面一', characterIds: ['linjing'], durationSec: 6 },
        { index: 2, line: '二', prompt: '画面二', characterIds: ['linjing'], durationSec: 6 },
        { index: 3, line: '三', prompt: '画面三', characterIds: ['linjing'], durationSec: 6 },
      ],
    }
    const r = await c.tools.storyboard.execute({ runId, shots: shots.shots }) as { ok: boolean }
    assert.equal(r.ok, true)
    const sb = JSON.parse(readFileSync(join(rd, 'storyboard.json'), 'utf8')) as { shots: Array<{ durationSec: number }> }
    const sum = sb.shots.reduce((a, x) => a + x.durationSec, 0)
    assert.ok(Math.abs(sum - 9) / 9 <= 0.02, `预算后总长 ${sum} 应在 9s ±2% 内`)
    const ev = c.runs.get(runId)!.events.find((e) => e.type === 'mv-budget')
    assert.ok(ev, 'mv-budget 事件留痕')
    assert.equal((ev!.detail as { targetSec: number }).targetSec, 9)
    assert.ok(existsSync(join(rd, 'storyboard.json')))
  } finally {
    rmSync(c.dir, { recursive: true, force: true })
  }
})

test('vgen_storyboard：drama 模式不施加 MV 预算（时长原样）', async () => {
  const c = ctx()
  try {
    const open = await c.tools.story.execute({ story: STORY }) as { value: { runId: string } }
    const runId = open.value.runId
    await c.tools.script.execute({ runId, script: { ...SCRIPT } })
    const rd = join(c.runs.rootDir, runId)
    mkdirSync(join(rd, 'music'), { recursive: true })
    writeFileSync(join(rd, 'music', 'score.json'), JSON.stringify({ durationSec: 9 }))
    const shots = [
      { index: 1, line: '一', prompt: '画面一', characterIds: ['linjing'], durationSec: 6 },
      { index: 2, line: '二', prompt: '画面二', characterIds: ['linjing'], durationSec: 6 },
    ]
    const r = await c.tools.storyboard.execute({ runId, shots }) as { ok: boolean }
    assert.equal(r.ok, true)
    const sb = JSON.parse(readFileSync(join(rd, 'storyboard.json'), 'utf8')) as { shots: Array<{ durationSec: number }> }
    assert.equal(sb.shots.reduce((a, x) => a + x.durationSec, 0), 12, 'drama 不动时长')
    assert.ok(!c.runs.get(runId)!.events.some((e) => e.type === 'mv-budget'))
  } finally {
    rmSync(c.dir, { recursive: true, force: true })
  }
})
