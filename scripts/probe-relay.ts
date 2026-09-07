/** M0 CLI：对任一 OpenAI 兼容通道跑探测。
 *  用法: VGEN_BASE_URL=https://api.vectorengine.ai/v1 VGEN_API_KEY=sk-xxx node scripts/probe-relay.ts
 *  key 只从环境变量读取，不落代码库。
 */

import { probeChannel } from '../src/probe.ts'

async function main(): Promise<void> {
  const baseUrl = process.env['VGEN_BASE_URL']
  const apiKey = process.env['VGEN_API_KEY']
  if (!baseUrl || !apiKey) {
    console.error('用法: VGEN_BASE_URL=... VGEN_API_KEY=... node scripts/probe-relay.ts')
    process.exit(2)
  }
  const r = await probeChannel({ baseUrl, apiKey })
  console.log(JSON.stringify({ ok: r.ok, status: r.status, error: r.error ?? null, modelCount: r.models.length }, null, 2))
  if (r.models.length) console.log('models:\n  ' + r.models.join('\n  '))
  process.exit(r.ok ? 0 : 1)
}

main().catch((err: unknown) => {
  console.error('probe failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
