/** M3b/M4 出口验证：三镜漫剧端到端真机（走与 DSH 工具等价的 execute 链）。
 *  用法: VGEN_BASE_URL=https://api.vectorengine.cn VGEN_API_KEY=sk-xxx node scripts/demo-drama.ts [workDir]
 *  流程：vgen_story → vgen_script → vgen_storyboard（提示词注入）→ vgen_generate target=final
 *       （角色三视图 + 场景主图 + 逐镜参考图 + 逐镜 i2v + 配音（VGEN_TTS_MODEL 云 TTS，缺省 say）+ ffmpeg 成片 + SRT）
 *       → vgen_review 阶段A 抽 shot-1 三帧（零额外花费；带 score 重调触发重拍闭环，花费需 confirm，脚本不自动执行）。
 *  消费全程记账；非交互须显式 VGEN_AUTO_CONFIRM=1 放行，交互终端逐笔询问。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import readline from 'node:readline/promises'
import { buildHandoffTools } from '../src/tools/handoff.ts'
import { buildGenerateTools } from '../src/tools/generate.ts'
import { buildReviewTools } from '../src/tools/review.ts'
import { VaultStore } from '../src/store/vault.ts'
import { RunStore } from '../src/store/runs.ts'

const STORY = {
  title: '鲸鱼奇缘',
  logline: '小鲸鱼林鲸跨越大海寻找传说中的鲸群',
  style: '3d render, clean style, soft ocean lighting',
  characters: [{ id: 'linjing', name: '林鲸', appearance: '蓝色皮肤的小鲸鱼，圆眼睛，白色肚皮' }],
  chapters: ['第一幕：跃出海面', '第二幕：潜入深海'],
}

const SCRIPT = {
  ...STORY,
  scenes: [{ id: 's1', name: '清晨的开阔海面', description: '清晨的开阔海面，波光粼粼，远处有薄雾', characters: ['linjing'] }],
  dialog: [
    { sceneId: 's1', characterId: 'linjing', line: '今天，我要跃过这片海。' },
  ],
}

const SHOTS = {
  shots: [
    { index: 1, line: '鲸鱼从海面跃起，水花四溅', prompt: '鲸鱼从海面跃起，水花四溅，阳光穿透水雾', characterIds: ['linjing'], sceneId: 's1', camera: '中景，缓慢推进', durationSec: 5, voiceHint: '在辽阔的海面上，小鲸鱼纵身一跃。' },
    { index: 2, line: '空中定格，水珠悬停', prompt: '鲸鱼在空中定格，水珠如水晶般悬停', characterIds: ['linjing'], sceneId: 's1', camera: '特写，慢动作', durationSec: 5, voiceHint: '这一刻，整个世界都安静了。' },
    { index: 3, line: '潜入幽蓝深海，气泡上升', prompt: '鲸鱼潜入幽蓝深海，气泡串串上升', characterIds: ['linjing'], sceneId: 's1', camera: '远景，缓慢下沉', durationSec: 5, voiceHint: '然后，它回到深海的怀抱。' },
  ],
}

async function main(): Promise<void> {
  const baseUrl = process.env['VGEN_BASE_URL']
  const apiKey = process.env['VGEN_API_KEY']
  if (!baseUrl || !apiKey) {
    console.error('用法: VGEN_BASE_URL=... VGEN_API_KEY=... node scripts/demo-drama.ts [workDir]')
    process.exit(2)
  }
  const AUTO_CONFIRM = process.env['VGEN_AUTO_CONFIRM'] === '1'
  // 非交互且未显式 opt-in → 拒绝并给出指引（修 M3b 遗留：非 TTY 一律自动确认过于激进）
  if (!process.stdin.isTTY && !AUTO_CONFIRM) {
    console.error('[demo] 非交互终端须显式 VGEN_AUTO_CONFIRM=1 才放行成本确认（预估花费见价目表）')
    process.exit(2)
  }
  const workDir = process.argv[2] ?? '.'
  const env = process.env
  const vault = VaultStore.open({ env: { ...env, DSH_HOME: workDir } })
  const runs = RunStore.open({ env: { ...env, DSH_HOME: workDir } })
  const channel = { id: 'vectorengine', baseUrl, apiKey }

  const confirmer = async (est: number | null): Promise<boolean> => {
    if (AUTO_CONFIRM) {
      console.log(`[auto-confirm: VGEN_AUTO_CONFIRM=1] 预估 ${est ?? 'unknown'}`)
      return true
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    try {
      const ans = await rl.question(`预估成本 ${est ?? 'unknown'}，继续？(y/N) `)
      return ans.trim().toLowerCase() === 'y'
    } finally {
      rl.close()
    }
  }

  const handoff = buildHandoffTools({ vault, runs })
  const generate = buildGenerateTools({ vault, runs, channel: () => channel, env: { ...env, DSH_HOME: workDir }, confirmer })
  // 评审工具与 generate 同源依赖（channel/env/confirmer 同款注入；extract 默认实现，ffmpeg 走 locateFfmpeg(env)）
  const review = buildReviewTools({ vault, runs, channel: () => channel, env: { ...env, DSH_HOME: workDir }, confirmer })

  mkdirSync(workDir, { recursive: true })
  const r1 = await handoff.story.execute({ story: STORY })
  const runId = (r1 as { ok: boolean; value: { runId: string } }).value.runId
  console.log(`[story] run=${runId}`)
  const r2 = await handoff.script.execute({ runId, script: SCRIPT })
  console.log(`[script] ok=${(r2 as { ok: boolean }).ok}`)
  const r3 = await handoff.storyboard.execute({ runId, shots: SHOTS.shots })
  const sb = (r3 as { ok: boolean; value: { shots: Array<{ index: number; prompt: string }> } }).value
  console.log(`[storyboard] ${sb.shots.length} 镜，首镜提示词: ${sb.shots[0]!.prompt.slice(0, 80)}…`)

  console.log('—— 开始生成（assets → video → final）——')
  const rg = await generate.generate.execute({ runId, target: 'final' })
  const value = (rg as { ok: boolean; value?: { clips: number; finalOutput: string | null }; error?: { code: string; message: string } })
  if (!value.ok) {
    console.error(`[generate] FAILED ${value.error?.code}: ${value.error?.message}`)
    process.exit(1)
  }
  const st = await generate.status.execute({ runId })
  console.log(`[status] ${JSON.stringify((st as { value: { stages: unknown } }).value.stages)}`)
  console.log(`[done] final=${value.value!.finalOutput}`)
  console.log(`产物目录: ${join(workDir, 'runs', runId)}`)

  // 评审抽帧（M4）：shot 1 阶段A 无 score，零额外花费；带 score 重调属付费重拍，留给会话内确认，不自动执行
  const rr = await review.review.execute({ runId, shot: 1 })
  const rv = (rr as { ok: boolean; value?: { frames: string[] }; error?: { code: string; message: string } })
  if (!rv.ok) {
    console.error(`[review] FAILED ${rv.error?.code}: ${rv.error?.message}`)
    process.exit(1)
  }
  for (const f of rv.value!.frames) console.log(`[review] 帧: ${f}`)
  console.log('[review] 读图评分后带 score 重调可触发重拍闭环（重拍花费需 confirm）')

  console.log('请核验: ffprobe final.mp4（时长/编码）与 final.srt（三条字幕）')
}

main().catch((err: unknown) => {
  console.error('[demo-drama] FAILED', err instanceof Error ? err.message : err)
  process.exit(1)
})
