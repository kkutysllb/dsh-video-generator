import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunStore } from '../src/store/runs.ts'
import { collectArtifacts } from '../src/host/artifacts.ts'

test('collectArtifacts 汇总各子目录 + final + handoff 标志（缺失容错空表）', () => {
  const root = mkdtempSync(join(tmpdir(), 'vgen-art-'))
  try {
    const runs = RunStore.open({ rootDir: root })
    const run = runs.create('产物清单')
    const dir = join(runs.rootDir, run.id)
    mkdirSync(join(dir, 'assets'), { recursive: true })
    mkdirSync(join(dir, 'review', 'shot-001'), { recursive: true })
    writeFileSync(join(dir, 'assets', 'char-a.png'), '12345')
    writeFileSync(join(dir, 'story.json'), '{}')
    writeFileSync(join(dir, 'final.mp4'), 'movie')
    writeFileSync(join(dir, 'review', 'shot-001', 'frame-1.png'), 'f')
    const a = collectArtifacts(runs, run.id)
    assert.deepEqual(a.handoff, { story: true, script: false, storyboard: false })
    assert.deepEqual(a.assets, [{ name: 'char-a.png', rel: 'assets/char-a.png', size: 5 }])
    assert.equal(a.clips.length, 0)
    assert.deepEqual(a.review, [{ name: 'frame-1.png', rel: 'review/shot-001/frame-1.png', size: 1 }])
    assert.equal(a.final.mp4?.rel, 'final.mp4')
    assert.equal(a.final.srt, null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('collectArtifacts 空 run 目录全空不抛', () => {
  const root = mkdtempSync(join(tmpdir(), 'vgen-art2-'))
  try {
    const runs = RunStore.open({ rootDir: root })
    const run = runs.create('空')
    const a = collectArtifacts(runs, run.id)
    assert.deepEqual(a.shots, [])
    assert.equal(a.final.mp4, null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
