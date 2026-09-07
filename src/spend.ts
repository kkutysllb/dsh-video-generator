/** 消费记账（JSONL 追加，幂等崩溃安全）+ 预算确认判定（规格 §4.4）。 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface SpendEntry {
  at: string
  channel: string
  model: string
  kind: string
  estCny: number | null
  jobId: string
}

export class SpendLedger {
  readonly file: string

  constructor(file: string) {
    this.file = file
  }

  static open(env: NodeJS.ProcessEnv = process.env): SpendLedger {
    const base = env['DSH_HOME'] ? join(env['DSH_HOME']!, '.dsh-video-generator') : join(homedir(), '.dsh-video-generator')
    return new SpendLedger(join(base, 'spend.jsonl'))
  }

  record(entry: Omit<SpendEntry, 'at'>): void {
    const line = JSON.stringify({ ...entry, at: new Date().toISOString() })
    appendFileSync(this.file, line + '\n', { mode: 0o600 })
  }

  totals(): { count: number; estCny: number } {
    if (!existsSync(this.file)) return { count: 0, estCny: 0 }
    let count = 0
    let estCny = 0
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line) as SpendEntry
        count++
        if (typeof e.estCny === 'number') estCny += e.estCny
      } catch {
        // 跳过损坏行
      }
    }
    return { count, estCny }
  }
}

/** 估算超过阈值 -> 注入的 confirmer 决定；估不出（null）不拦截但必须已记账。 */
export function confirmSpend(estCny: number | null, thresholdCny: number, confirmer: (est: number) => boolean): boolean {
  if (estCny === null || estCny <= thresholdCny) return true
  return confirmer(estCny)
}
