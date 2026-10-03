/** slot-probe 单测（通道槽规格 §10 验收 3）：注入 fetchImpl 离线跑真实序列，
 *  断言结论写回槽位 verifiedAt/verifyNote（成败都留痕）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultStore } from '../src/store/vault.ts'
import { testSlotBinding } from '../src/slot-probe.ts'
import type { SlotBinding } from '../src/store/slots.ts'

function setupVault(): { store: VaultStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-slot-probe-'))
  const store = VaultStore.open({ file: join(dir, 'vault.json') })
  store.createChannel({ id: 'ch-1', label: '测试通道', baseUrl: 'https://x.example/v1', apiKey: 'sk-test-12345678' })
  return { store, dir }
}

function imageBinding(): SlotBinding {
  return { slot: 'image.master', channelId: 'ch-1', model: 'img-1', protocol: 'openai-images', capabilities: { sizeParam: true } }
}

function seqFetch(routes: Array<{ match: (url: string, init?: RequestInit) => boolean; status: number; body?: unknown; bytes?: Buffer }>): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const urlText = String(url)
    const route = routes.find((r) => r.match(urlText, init))
    if (!route) return new Response('no route', { status: 404 })
    if (route.bytes) return new Response(new Uint8Array(route.bytes), { status: route.status })
    return new Response(JSON.stringify(route.body ?? {}), { status: route.status })
  }) as unknown as typeof fetch
}

test('槽位测试成功：真实序列跑通 + verifiedAt/verifyNote 写回 ok 结论', async () => {
  const { store, dir } = setupVault()
  try {
    const fetchImpl = seqFetch([
      {
        match: (url) => url.includes('/images/generations'),
        status: 200,
        body: { created: 1, data: [{ url: 'https://oss.example/probe.png' }] },
      },
      { match: (url) => url.startsWith('https://oss.example/'), status: 200, bytes: Buffer.from('%PNG-fake') },
    ])
    const result = await testSlotBinding(store, imageBinding(), { fetchImpl })
    assert.equal(result.ok, true)
    assert.ok(result.detail.includes('image ok'))
    const saved = store.listSlotBindings().find((b) => b.slot === 'image.master')
    assert.ok(saved?.verifiedAt, 'verifiedAt 已写回')
    assert.ok(saved?.verifyNote?.startsWith('ok:'), `verifyNote 留痕 ok 结论: ${saved?.verifyNote}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('槽位测试失败：上游 401 透出原始错误 + verifyNote 留痕 fail 结论', async () => {
  const { store, dir } = setupVault()
  try {
    const fetchImpl = seqFetch([
      { match: () => true, status: 401, body: { error: { message: 'invalid api key' } } },
    ])
    const result = await testSlotBinding(store, imageBinding(), { fetchImpl })
    assert.equal(result.ok, false)
    assert.ok(result.error?.includes('invalid api key') || result.error?.includes('401'), `透出上游错误: ${result.error}`)
    const saved = store.listSlotBindings().find((b) => b.slot === 'image.master')
    assert.ok(saved?.verifiedAt, '失败同样写 verifiedAt（成败都留痕）')
    assert.ok(saved?.verifyNote?.startsWith('fail:'), `verifyNote 留痕 fail 结论: ${saved?.verifyNote}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('槽位测试：通道不存在/已停用直接失败（不发起请求）', async () => {
  const { store, dir } = setupVault()
  try {
    const missing = await testSlotBinding(store, { ...imageBinding(), channelId: 'nope' }, { fetchImpl: seqFetch([]) })
    assert.equal(missing.ok, false)
    assert.ok(missing.error?.includes('通道不存在'))
    store.updateChannel('ch-1', { enabled: false })
    const disabled = await testSlotBinding(store, imageBinding(), { fetchImpl: seqFetch([]) })
    assert.equal(disabled.ok, false)
    assert.ok(disabled.error?.includes('通道已停用'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
