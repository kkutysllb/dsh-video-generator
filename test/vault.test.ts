import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { maskCredential, resolveVaultPath, VaultStore } from '../src/store/vault.ts'

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), 'vgen-vault-'))
}

test('maskCredential 短串全遮、长串前3后3', () => {
  assert.equal(maskCredential('abc'), '••••')
  assert.equal(maskCredential('sk-1234567890xyz'), 'sk-••••0xyz')
})

test('resolveVaultPath 跟随 DSH_HOME，无则回退 home', () => {
  assert.equal(resolveVaultPath({ DSH_HOME: '/lab' } as NodeJS.ProcessEnv), join('/lab', '.dsh-video-generator', 'vault.json'))
  const p = resolveVaultPath({} as NodeJS.ProcessEnv)
  assert.ok(p.includes(join('.dsh-video-generator', 'vault.json')))
})

test('save 落盘为 0600、目录 0700、内容可回读', () => {
  const home = tmpHome()
  try {
    const store = VaultStore.open({ file: join(home, '.dsh-video-generator', 'vault.json') })
    const data = store.load()
    store.save(data)
    const st = statSync(join(home, '.dsh-video-generator', 'vault.json'))
    assert.equal(st.mode & 0o777, 0o600)
    assert.equal(statSync(join(home, '.dsh-video-generator')).mode & 0o777, 0o700)
    const round = JSON.parse(readFileSync(join(home, '.dsh-video-generator', 'vault.json'), 'utf8')) as { version: number }
    assert.equal(round.version, 1)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('损坏文件从默认空库开始，不抛错', () => {
  const home = tmpHome()
  try {
    const file = join(home, 'vault.json')
    writeFileSync(file, '{broken', 'utf8')
    const store = VaultStore.open({ file })
    assert.deepEqual(store.load().channels, [])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
