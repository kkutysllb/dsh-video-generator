/** 零 key mock 供应商：内存任务状态机，两次 poll 后 done。 */

import { assertProvider, type Provider } from '../provider.ts'

export interface MockOptions {
  /** 前 N 次 submit 注入失败（测退避/换道逻辑）。 */
  failFirst?: number
  seq?: () => number
}

interface MockJob {
  stage: string
  polls: number
}

export function createMockProvider(options: MockOptions = {}): Provider {
  let submits = 0
  let seq = 0
  const jobs = new Map<string, MockJob>()
  const nextSeq = options.seq ?? (() => ++seq)

  const provider: Provider = {
    id: 'mock',
    capabilities: { image: true, textToVideo: true, imageToVideo: true, tts: true, qualityTier: 0 },
    async quote() {
      return { qualityTier: 0, costEstimate: 0, currency: 'CNY' }
    },
    async submit(stage) {
      submits++
      if (options.failFirst !== undefined && submits <= options.failFirst) {
        throw new Error(`mock-注入失败 #${submits}`)
      }
      const jobId = `mock-${nextSeq()}`
      jobs.set(jobId, { stage, polls: 0 })
      return { jobId }
    },
    async status(jobId) {
      const job = jobs.get(jobId)
      if (!job) return { state: 'unknown', progress: null, error: 'no-such-job' }
      job.polls++
      if (job.polls >= 2) return { state: 'done', progress: 100 }
      return { state: 'running', progress: 30 * job.polls }
    },
    async fetch(jobId) {
      const job = jobs.get(jobId)
      if (!job) return { outputs: [] }
      return { outputs: [`mock://${jobId}/${job.stage}.png`], meta: { mock: true } }
    },
    async health() {
      return { ok: true, quotaRemaining: null }
    },
  }
  return assertProvider(provider)
}
