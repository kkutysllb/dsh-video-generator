/** M2 出口验证：单镜图生视频真机出片。
 *  用法: VGEN_BASE_URL=... VGEN_API_KEY=... node scripts/demo-single-shot.ts [workDir]
 *  流程：seedream-4.0 文生图 → URL → happyhorse-1.1-i2v 图生视频 → 轮询 SUCCEEDED → 下载 mp4。
 *  消费全程记账；估价未知或超阈值时经终端确认（规格 §4.4）。
 */

import { mkdirSync, readSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fetchPricing, estimateCny } from '../src/pricing.ts'
import { providerForModel } from '../src/registry.ts'
import { SpendLedger, confirmSpend } from '../src/spend.ts'
import { RunStore } from '../src/store/runs.ts'

/** confirmSpend 的 confirmer 是同步签名：TTY 下用 readSync 阻塞读一行；非 TTY（无 stdin 的 bash）readline 会直接 EOF 误取消，按环境适配自动放行。 */
function askConfirm(message: string): boolean {
  if (!process.stdin.isTTY) {
    console.log('[auto-confirm: non-tty]')
    return true
  }
  process.stdout.write(`${message} (y/N) `)
  const buf = Buffer.alloc(32)
  let n = 0
  try {
    n = readSync(0, buf, 0, 32, null)
  } catch {
    return false
  }
  const ans = buf.subarray(0, n).toString('utf8').trim().toLowerCase()
  return ans === 'y'
}

async function saveUrl(url: string, file: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载失败 http-${res.status}`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()), { mode: 0o600 })
}

async function pollVideo(p: ReturnType<typeof providerForModel>, jobId: string, maxPollMs = 600000): Promise<string> {
  const start = Date.now()
  for (;;) {
    const st = await p.status(jobId)
    if (st.state === 'done') break
    if (st.state === 'failed') throw new Error(`视频生成失败: ${st.error ?? '?'}`)
    if (Date.now() - start > maxPollMs) throw new Error('轮询超时')
    await new Promise((r) => setTimeout(r, 10000))
  }
  const f = await p.fetch(jobId)
  const url = f.outputs[0]
  if (!url) throw new Error('完成但无输出 URL')
  return url
}

async function main(): Promise<void> {
  const baseUrl = process.env['VGEN_BASE_URL']
  const apiKey = process.env['VGEN_API_KEY']
  if (!baseUrl || !apiKey) {
    console.error('用法: VGEN_BASE_URL=... VGEN_API_KEY=... node scripts/demo-single-shot.ts [workDir]')
    process.exit(2)
  }
  const channel = { id: 'vectorengine', baseUrl, apiKey }
  // pricing 在站点根 /api/pricing（无 /v1 前缀）。
  const siteRoot = baseUrl.replace(/\/v1\/?$/, '')
  // 本站拓扑（实测）：OpenAI 兼容端点挂 /v1 前缀；DashScope 原生(/alibailian)与 kling-compat 挂站点根。
  // 适配器路径已含族前缀，故视频通道用去掉 /v1 的站点根，图像通道保留 /v1。
  const channelRoot = { ...channel, baseUrl: siteRoot }
  const workDir = process.argv[2] ?? '.'
  mkdirSync(workDir, { recursive: true })
  const pricing = await fetchPricing({ baseUrl: siteRoot, apiKey })
  const ledger = SpendLedger.open()
  const runs = RunStore.open()
  const run = runs.create('单镜图生视频')

  // 1. 文生图（seedream）
  const IMAGE_MODEL = 'doubao-seedream-4-0-250828'
  const imgEst = estimateCny(IMAGE_MODEL, pricing)
  if (!confirmSpend(imgEst, 1, (est) => askConfirm(`图像预估成本 ${est}，继续？`))) throw new Error('用户取消')
  runs.setStage(run.id, 'master-asset', 'running')
  const imgProvider = providerForModel(channel, IMAGE_MODEL)
  const { jobId: imgUrl } = await imgProvider.submit('master-asset', { prompt: 'a cute cartoon whale jumping over ocean waves, 3d render, clean style', size: '2048x2048' })
  ledger.record({ channel: channel.id, model: IMAGE_MODEL, kind: 'image', estCny: imgEst, jobId: imgUrl.slice(0, 60) })
  const imgFile = join(workDir, 'master.jpeg')
  await saveUrl(imgUrl, imgFile)
  runs.setStage(run.id, 'master-asset', 'done')
  console.log(`[1/2] 图像完成: ${imgFile}`)

  // 2. 图生视频（happyhorse i2v）
  const VIDEO_MODEL = 'happyhorse-1.1-i2v'
  const videoEst = estimateCny(VIDEO_MODEL, pricing)
  if (!confirmSpend(videoEst, 1, (est) => askConfirm(`视频预估成本 ${est}，继续？`))) throw new Error('用户取消')
  runs.setStage(run.id, 'video', 'running')
  const videoProvider = providerForModel(channelRoot, VIDEO_MODEL)
  console.log('[video] submitting task...')
  const { jobId: videoJob } = await videoProvider.submit('video', { prompt: '鲸鱼跃出海面溅起水花，镜头缓慢推进，电影感光影', imageUrl: imgUrl, durationSec: 5 })
  console.log(`[video] taskId=${videoJob}`)
  ledger.record({ channel: channel.id, model: VIDEO_MODEL, kind: 'video', estCny: videoEst, jobId: videoJob })
  const videoUrl = await pollVideo(videoProvider, videoJob)
  const videoFile = join(workDir, 'shot-1.mp4')
  await saveUrl(videoUrl, videoFile)
  runs.setStage(run.id, 'video', 'done')
  runs.setStatus(run.id, 'done')
  runs.appendEvent(run.id, 'demo-done', { image: IMAGE_MODEL, video: VIDEO_MODEL })
  console.log(`[2/2] 视频完成: ${videoFile}`)
  console.log(`消费汇总: ${JSON.stringify(ledger.totals())}`)
}

main().catch((err: unknown) => {
  if (err instanceof Error) console.error('[demo-single-shot] FAILED', err.message, '\n', err.stack)
  else console.error('[demo-single-shot] FAILED', err)
  process.exit(1)
})
