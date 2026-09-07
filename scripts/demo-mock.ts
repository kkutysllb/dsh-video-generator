/** 零 key 全链路 mock demo（M4 出口标准）：三段交接 → 资产 → 视频 → 成片 → 评审重拍闭环。
 *  mock provider 出 mock:// URL，本地 fetchImpl 供流（1px PNG / lavfi 占位片）；成片走真 ffmpeg。
 *  依赖：VGEN_FFMPEG 必填（须含 drawtext 滤镜——homebrew ffmpeg 8.1 无，用 bilibili 版）。 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultStore } from '../src/store/vault.ts'
import { RunStore } from '../src/store/runs.ts'
import { buildHandoffTools } from '../src/tools/handoff.ts'
import { buildGenerateTools } from '../src/tools/generate.ts'
import { buildReviewTools } from '../src/tools/review.ts'
import { createMockProvider } from '../src/providers/mock.ts'

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

async function main(): Promise<void> {
  const ffmpeg = process.env['VGEN_FFMPEG']
  if (!ffmpeg || !existsSync(ffmpeg)) {
    console.error('[demo:mock] 需要 VGEN_FFMPEG 指向含 drawtext 的 ffmpeg（如 bilibili 客户端自带版）')
    process.exit(2)
  }
  const filters = execFileSync(ffmpeg, ['-hide_banner', '-filters'], { encoding: 'utf8' })
  if (!filters.includes('drawtext')) {
    console.error('[demo:mock] 该 ffmpeg 缺 drawtext 滤镜，成片字幕会失败：换 VGEN_FFMPEG')
    process.exit(2)
  }

  // 全新隔离 HOME（vault/runs/spend 全落 tmp）
  const home = mkdtempSync(join(tmpdir(), 'vgen-demo-mock-'))
  const env = { ...process.env, DSH_HOME: home, VGEN_FFMPEG: ffmpeg, VGEN_POLL_DELAY_MS: '10', VGEN_TTS_MODEL: '' } as NodeJS.ProcessEnv
  const vault = VaultStore.open({ env })
  const runs = RunStore.open({ env })

  // lavfi 占位片（3s 竖版带音轨，充当 mock 视频产物）
  const lavfi = join(home, 'placeholder.mp4')
  execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=540x960:rate=24:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', lavfi])
  const clipBytes = readFileSync(lavfi)

  // mock:// URL 供流：video 段给占位片字节，图像段给 1px PNG
  const fetchImpl = (async (url: string) => {
    const bytes = String(url).includes('/video.png') ? clipBytes : PNG_1PX
    return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
  }) as unknown as typeof fetch

  const mockProvider = createMockProvider()
  const channel = () => ({ id: 'mock', baseUrl: 'https://mock.invalid', apiKey: 'mock-key-000000' })
  const handoff = buildHandoffTools({ vault, runs })
  const gen = buildGenerateTools({
    vault, runs, channel, env,
    providersOverride: { forModel: () => mockProvider },
    fetchImpl, pricing: null, confirmer: async () => true,
  })
  const review = buildReviewTools({
    vault, runs, channel, env,
    providersOverride: { forModel: () => mockProvider },
    fetchImpl, pricing: null, confirmer: async () => true,
  })

  const ok = (r: { ok: boolean; error?: { code: string; message: string } }, step: string): void => {
    if (!r.ok) throw new Error(`${step} 失败: ${r.error?.code} ${r.error?.message}`)
  }

  // 三段交接（疗愈绘本题材包迷你版：2 镜）
  const storyR = await handoff.story.execute({ story: {
    title: '小鲸鱼的月亮船', logline: '小鲸鱼帮月亮找回掉进海里的星星。',
    style: '疗愈绘本风，柔和水彩质感，暖色低饱和',
    characters: [{ id: 'jingyu', name: '小鲸鱼', appearance: '圆滚滚的蓝色小鲸鱼，戴黄色小圆眼镜' }],
    chapters: ['星星掉进海里', '小鲸鱼送回星星'],
  } })
  ok(storyR, 'story')
  const runId = (storyR as { ok: true; value: { runId: string } }).value.runId

  ok(await handoff.script.execute({ runId, script: {
    title: '小鲸鱼的月亮船', logline: '小鲸鱼帮月亮找回掉进海里的星星。',
    style: '疗愈绘本风，柔和水彩质感，暖色低饱和',
    characters: [{ id: 'jingyu', name: '小鲸鱼', appearance: '圆滚滚的蓝色小鲸鱼，戴黄色小圆眼镜' }],
    chapters: ['星星掉进海里', '小鲸鱼送回星星'],
    scenes: [{ id: 's1', name: '夜海', description: '深蓝夜海，月光铺成银路', characters: ['jingyu'] }],
    dialog: [{ sceneId: 's1', characterId: 'jingyu', line: '别怕，我送你回家。' }],
  } }), 'script')
  ok(await handoff.storyboard.execute({ runId, shots: [
    { index: 1, line: '星星掉进了海里', prompt: '深蓝夜海上一颗发光的小星星溅起水花，远景', characterIds: [], sceneId: 's1', camera: '缓慢推近', durationSec: 3, voiceHint: '一颗星星，悄悄掉进了海里。' },
    { index: 2, line: '小鲸鱼送星星回家', prompt: '小鲸鱼用头顶着发光的星星跃出海面，月亮在天上微笑', characterIds: ['jingyu'], sceneId: 's1', camera: '轻摇跟随', durationSec: 3, voiceHint: '小鲸鱼说，别怕，我送你回家。' },
  ] }), 'storyboard')

  // 生成到成片
  const genR = await gen.generate.execute({ runId, target: 'final', confirm: true })
  ok(genR, 'generate')
  const finalPath = join(runs.rootDir, runId, 'final.mp4')
  if (!existsSync(finalPath)) throw new Error('final.mp4 未产出')

  // 评审闭环：抽帧 → 打 2 分触发重拍（mock 零成本）→ 再抽帧 → 打 4 分通过
  const framesR = await review.review.execute({ runId, shot: 1 })
  ok(framesR, 'review:frames')
  const frames = (framesR as { ok: true; value: { frames: string[] } }).value.frames
  if (frames.length !== 3 || !frames.every((f) => existsSync(f))) throw new Error('抽帧未产出 3 帧')
  const reshootR = await review.review.execute({ runId, shot: 1, score: 2, negativeHint: '画面过暗' })
  ok(reshootR, 'review:reshoot')
  if ((reshootR as { ok: true; value: { action: string } }).value.action !== 'reshoot') throw new Error('未触发重拍')
  const passR = await review.review.execute({ runId, shot: 1, score: 4 })
  ok(passR, 'review:pass')

  const rec = runs.get(runId)!
  if (rec.reviews?.['shot-1']?.passed !== true || rec.reviews['shot-1'].retries !== 1) throw new Error('评审档案未落 run.json')
  for (const st of ['story', 'script', 'storyboard', 'master-asset', 'shot-assets', 'video', 'final-cut']) {
    if (rec.stages[st] !== 'done') throw new Error(`段未 done: ${st}`)
  }

  console.log(`[demo:mock] OK 零 key 全链路 run=${runId}`)
  console.log(`  成片: ${finalPath}`)
  console.log(`  评审: shot-1 scores=${JSON.stringify(rec.reviews['shot-1'].scores)} retries=1 passed=true`)
  console.log(`  HOME: ${home}（tmp 隔离，可随时删除）`)
}

main().catch((err: unknown) => {
  console.error('[demo:mock] FAILED', err)
  process.exit(1)
})
