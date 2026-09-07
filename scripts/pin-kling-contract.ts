/** M2 实钉：kling-compat 成功信封。用法: VGEN_BASE_URL=... VGEN_API_KEY=... node scripts/pin-kling-contract.ts [model]
 *  上游饱和（429/503）时指数退避重试最多 5 次（60s 起）。key 只从环境变量读取。
 */
import { createKlingCompatProvider } from '../src/providers/kling-compat.ts'

async function main(): Promise<void> {
  const baseUrl = process.env['VGEN_BASE_URL']
  const apiKey = process.env['VGEN_API_KEY']
  if (!baseUrl || !apiKey) {
    console.error('用法: VGEN_BASE_URL=... VGEN_API_KEY=... node scripts/pin-kling-contract.ts [model]')
    process.exit(2)
  }
  const model = process.argv[2] ?? 'kling-video'
  const p = createKlingCompatProvider({ baseUrl, apiKey, model })
  let jobId = ''
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const r = await p.submit('video', { prompt: 'a cute cartoon whale jumps over waves', durationSec: 5 })
      jobId = r.jobId
      break
    } catch (err) {
      const status = (err as { status?: number }).status ?? 0
      if (status === 429 || status === 503 || status === 0) {
        if (attempt === 5) break // 末次失败直接走 jobId 判空退出，不再空睡
        const delay = 60000 * 2 ** (attempt - 1)
        console.log(`提交失败(status=${status})，${delay / 1000}s 后重试 ${attempt}/5`)
        await new Promise((r) => setTimeout(r, delay))
        continue
      }
      throw err
    }
  }
  if (!jobId) {
    console.error('重试耗尽仍未提交成功（上游饱和），本次实钉未完成——不阻塞，记录后择机重跑')
    process.exit(1)
  }
  console.log('task:', jobId)
  for (let i = 1; i <= 40; i++) {
    await new Promise((r) => setTimeout(r, 15000))
    const st = await p.status(jobId)
    console.log(`[${i}] ${st.state} ${st.error ?? ''}`)
    if (st.state === 'done' || st.state === 'failed') {
      const f = await p.fetch(jobId)
      console.log(JSON.stringify({ outputs: f.outputs }, null, 2))
      process.exit(st.state === 'done' ? 0 : 1)
    }
  }
  console.error('轮询超时（10 分钟）')
  process.exit(1)
}

main().catch((err: unknown) => {
  console.error('pin failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
