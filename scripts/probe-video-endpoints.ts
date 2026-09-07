/** M0 CLI：视频任务端点候选活性探测——用注定不存在的模型名，不发真实生成任务：
 *  404 = 路由不存在；400/422 = 路由存在但参数校验拒绝（未计费）；200 = 路由存在（需人工确认是否已建任务）。
 *  用法: VGEN_BASE_URL=... VGEN_API_KEY=... node scripts/probe-video-endpoints.ts
 */

const CANDIDATES = ['videos', 'video/generations', 'video/submit', 'generations']

async function tryOne(url: string, key: string): Promise<number | string> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: '__vgen_probe_nonexistent__', prompt: 'probe', seconds: 5 }),
      signal: AbortSignal.timeout(20000),
    })
    await res.text().catch(() => '')
    return res.status
  } catch (err) {
    return err instanceof Error ? err.message : 'error'
  }
}

async function main(): Promise<void> {
  const base = (process.env['VGEN_BASE_URL'] ?? '').replace(/\/+$/, '')
  const key = process.env['VGEN_API_KEY']
  if (!base || !key) {
    console.error('用法: VGEN_BASE_URL=... VGEN_API_KEY=... node scripts/probe-video-endpoints.ts')
    process.exit(2)
  }
  console.log(`探测 ${base} 的视频任务端点候选（不产生真实生成任务）：`)
  for (const path of CANDIDATES) {
    const status = await tryOne(`${base}/${path}`, key)
    console.log(`  POST /${path.padEnd(20)} -> ${status}`)
  }
  console.log('判定：400/422=路由存在（候选）；404=不存在；200=存在且可能已建任务，人工核实。')
}

main()
