import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
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
