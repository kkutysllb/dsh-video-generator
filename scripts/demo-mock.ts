/** 零 key 冒烟：mock 供应商 submit -> poll -> fetch，产物与 run 状态落盘。 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMockProvider } from '../src/providers/mock.ts'
import { RunStore } from '../src/store/runs.ts'

async function main(): Promise<void> {
  const runs = RunStore.open({ env: process.env })
  const run = runs.create('mock 冒烟')
  const p = createMockProvider()

  runs.setStage(run.id, 'video', 'running')
  const { jobId } = await p.submit('video', { prompt: 'mock 冒烟' })
  let status = await p.status(jobId)
  let polls = 0
  while (status.state === 'running') {
    if (++polls > 50) throw new Error('mock poll 超过上限')
    status = await p.status(jobId)
  }
  if (status.state !== 'done') throw new Error(`mock 未完成: ${status.state}`)

  const fetched = await p.fetch(jobId)
  const outDir = join(runs.rootDir, run.id, 'clips')
  mkdirSync(outDir, { recursive: true })
  for (const [i, out] of fetched.outputs.entries()) {
    writeFileSync(join(outDir, `shot-${i}.txt`), `placeholder for ${out}`)
  }
  runs.setStage(run.id, 'video', 'done')
  runs.setStatus(run.id, 'done')
  runs.appendEvent(run.id, 'mock-done', { jobId, outputs: fetched.outputs })

  const final = runs.get(run.id)
  if (final?.stages['video'] !== 'done' || final?.status !== 'done') throw new Error('run 状态未落盘')
  console.log(`[demo:mock] OK run=${run.id} clips=${join(outDir, 'shot-0.txt')}`)
}

main().catch((err: unknown) => {
  console.error('[demo:mock] FAILED', err)
  process.exit(1)
})
