/** 断点续跑指定 run 的 video→final 段（图片/分镜段已 done 不重消费）。
 *  用途：上游分组晚高峰饱和时真机 demo 挂账，冷却后一键补跑。
 *  用法:
 *    VGEN_BASE_URL=... VGEN_API_KEY=... VGEN_FFMPEG=... VGEN_AUTO_CONFIRM=1 \
 *      [VGEN_VIDEO_MODEL=wan2.6-i2v-flash] [RESUME_MAX_ATTEMPTS=8] [RESUME_WAIT_MS=120000] \
 *      node scripts/resume-video.ts <workDir> <runId>
 *  饱和错误（消息含「饱和」）按间隔重试；其他错误立即退出。 */

import { VaultStore } from '../src/store/vault.ts'
import { RunStore } from '../src/store/runs.ts'
import { buildGenerateTools } from '../src/tools/generate.ts'
import { buildReviewTools } from '../src/tools/review.ts'

async function main(): Promise<void> {
  const workDir = process.argv[2]
  const runId = process.argv[3]
  if (!workDir || !runId) {
    console.error('用法: node scripts/resume-video.ts <workDir> <runId>')
    process.exit(2)
  }
  const env = { ...process.env, DSH_HOME: workDir } as NodeJS.ProcessEnv
  const vault = VaultStore.open({ env })
  const runs = RunStore.open({ env })
  const channel = { id: 've', baseUrl: process.env.VGEN_BASE_URL ?? '', apiKey: process.env.VGEN_API_KEY ?? '' }
  const gen = buildGenerateTools({ vault, runs, channel: () => channel, env, confirmer: async () => true })
  const review = buildReviewTools({ vault, runs, channel: () => channel, env, confirmer: async () => true })

  const maxAttempts = Number(process.env['RESUME_MAX_ATTEMPTS'] ?? 8)
  const waitMs = Number(process.env['RESUME_WAIT_MS'] ?? 120000)
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  let r = await gen.generate.execute({ runId, target: 'final', confirm: true })
  for (let i = 1; i <= maxAttempts && !r.ok; i++) {
    const saturated = String(r.error?.message ?? '').includes('饱和')
    console.log(`[attempt ${i}/${maxAttempts}] ${r.error?.code}: ${String(r.error?.message).slice(0, 80)}${saturated ? ` → ${Math.round(waitMs / 1000)}s 后重试` : ' → 非饱和错误，放弃'}`)
    if (!saturated) process.exit(1)
    await sleep(waitMs)
    r = await gen.generate.execute({ runId, target: 'final', confirm: true })
  }
  if (!r.ok) {
    console.error(`[resume] ${maxAttempts} 轮重试后仍失败（上游饱和未缓解，可稍后再跑本命令）`)
    process.exit(1)
  }
  console.log('[resume] OK', JSON.stringify(r.value))

  const rr = await review.review.execute({ runId, shot: 1 })
  if (!rr.ok) {
    console.error('[review] FAILED', JSON.stringify(rr.error))
    process.exit(1)
  }
  const frames = (rr.value as { frames: string[] }).frames
  console.log('[review] 抽帧:', frames.join(', '))
}

void main()
