import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from 'node:fs'
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

test('confirmSpend：超阈值需确认；null 估价一律走确认（规格 §4.4）', () => {
  assert.equal(confirmSpend(0.2, 1, () => true), true)
  assert.equal(confirmSpend(2, 1, () => false), false)
  assert.equal(confirmSpend(0, 1, () => false), true) // 0 估价（估不出价的）不拦截，由记录兜底
  assert.equal(confirmSpend(null, 1, () => false), false) // null 估价（接口故障）一律走确认
  assert.equal(confirmSpend(null, 1, (est) => est === 'unknown'), true)
})

test('全新目录首笔记账不崩（自动建目录）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-spend-'))
  try {
    const ledger = new SpendLedger(join(dir, 'sub', 'spend.jsonl'))
    ledger.record({ channel: 've', model: 'm', kind: 'image', estCny: 0.1, jobId: 'j' })
    assert.ok(existsSync(join(dir, 'sub', 'spend.jsonl')))
    if (process.platform !== 'win32') {
      assert.equal(statSync(join(dir, 'sub', 'spend.jsonl')).mode & 0o777, 0o600)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
