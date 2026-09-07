import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SpendLedger, confirmSpend } from '../src/spend.ts'

function tmpLedger(): { dir: string; ledger: SpendLedger } {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-spend-'))
  return { dir, ledger: new SpendLedger(join(dir, 'spend.jsonl')) }
}

test('记账追加 JSONL 且 totals 汇总', () => {
  const { dir, ledger } = tmpLedger()
  try {
    ledger.record({ channel: 've', model: 'doubao-seedream-4-0-250828', kind: 'image', estCny: 0.2, jobId: 'u1' })
    ledger.record({ channel: 've', model: 'happyhorse-1.1-t2v', kind: 'video', estCny: 0.013, jobId: 't1' })
    const lines = readFileSync(join(dir, 'spend.jsonl'), 'utf8').trim().split('\n')
    assert.equal(lines.length, 2)
    const totals = ledger.totals()
    assert.ok(Math.abs(totals.estCny - 0.213) < 1e-9)
    assert.equal(totals.count, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('confirmSpend：超阈值需确认；无估价(0)放行但记账', () => {
  assert.equal(confirmSpend(0.2, 1, () => true), true)
  assert.equal(confirmSpend(2, 1, () => false), false)
  assert.equal(confirmSpend(0, 1, () => false), true) // 估不出价的（0）不拦截，由记录兜底
  const { dir, ledger } = tmpLedger()
  try {
    ledger.record({ channel: 've', model: 'm', kind: 'video', estCny: null, jobId: 'j' })
    assert.ok(existsSync(join(dir, 'spend.jsonl')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
