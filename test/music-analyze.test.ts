/** 音乐网格本地分析单测（P2）：合成 PCM → 包络/onset/BPM/段落——零依赖、离线确定性。 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pcmEnvelope, onsetTimes, estimateTempo, sectionBoundaries, sectionsFromBoundaries } from '../src/music/analyze.ts'

const SR = 22050

/** 合成 PCM：片段序列（sine 或静音），段长秒。 */
function synth(parts: Array<{ kind: 'sine' | 'silence'; sec: number; freq?: number; amp?: number }>): Buffer {
  const total = Math.round(parts.reduce((a, p) => a + p.sec, 0) * SR)
  const buf = Buffer.alloc((total + SR) * 2) // +1s 余量：分段 round 累积可能略超
  let idx = 0
  for (const p of parts) {
    const n = Math.round(p.sec * SR)
    for (let i = 0; i < n; i++) {
      const v = p.kind === 'silence' ? 0 : Math.round((p.amp ?? 0.6) * 26000 * Math.sin((2 * Math.PI * (p.freq ?? 440) * i) / SR))
      buf.writeInt16LE(v, idx)
      idx += 2
    }
  }
  return buf
}

test('pcmEnvelope：帧率/时长正确，静音段 rms≈0、正弦段 rms>0', () => {
  const pcm = synth([{ kind: 'sine', sec: 1 }, { kind: 'silence', sec: 1 }, { kind: 'sine', sec: 1, freq: 880 }])
  const frames = pcmEnvelope(pcm)
  assert.ok(frames.length > 30, `1kHz hop≈23ms，1 秒应有 ~40 帧，实际 ${frames.length}`)
  const mid = frames.filter((f) => f.t > 1.1 && f.t < 1.9)
  const edges = frames.filter((f) => f.t < 0.9)
  assert.ok(mid.every((f) => f.rms < 0.005), '静音段 rms 近零')
  assert.ok(edges.every((f) => f.rms > 0.1), '正弦段有能量')
})

test('estimateTempo：120BPM 节拍脉冲 → bpm≈120、offset 对齐首拍', () => {
  // 6 秒，每 0.5s 一个 30ms 脉冲（120 BPM）
  const parts: Array<{ kind: 'sine' | 'silence'; sec: number; freq?: number; amp?: number }> = []
  for (let i = 0; i < 12; i++) {
    parts.push({ kind: 'sine', sec: 0.03, freq: 1000, amp: 0.9 })
    parts.push({ kind: 'silence', sec: 0.47 })
  }
  const frames = pcmEnvelope(synth(parts))
  const onsets = onsetTimes(frames, { floor: 0.05 })
  assert.ok(onsets.length >= 8, `onset 数 ${onsets.length}`)
  const tempo = estimateTempo(onsets, 6)
  assert.ok(tempo, '应估出节拍')
  assert.ok(Math.abs(tempo!.bpm - 120) <= 6, `bpm ${tempo!.bpm} 偏离 120`)
  assert.ok(tempo!.offsetSec >= 0 && tempo!.offsetSec < 0.55, `offset ${tempo!.offsetSec} 应落在节拍附近（首脉冲可被热身窗漏检）`)
})

test('sectionBoundaries：响-静-响 → 三段切分（S1/S2/S3）', () => {
  const pcm = synth([{ kind: 'sine', sec: 1.2 }, { kind: 'silence', sec: 1.2 }, { kind: 'sine', sec: 1.2, freq: 880 }])
  const frames = pcmEnvelope(pcm)
  const boundaries = sectionBoundaries(frames)
  const sections = sectionsFromBoundaries(boundaries, 3.6)
  assert.ok(sections.length >= 2, `至少两段，实际 ${sections.length}（boundaries=${JSON.stringify(boundaries)}）`)
  assert.equal(sections[0]!.label, 'S1')
  assert.ok(sections[0]!.startSec < 0.6)
})

test('estimateTempo：onset 不足 → null（不瞎猜）', () => {
  const frames = pcmEnvelope(synth([{ kind: 'sine', sec: 2 }]))
  const onsets = onsetTimes(frames)
  assert.equal(estimateTempo(onsets.length > 3 ? onsets.slice(0, 2) : onsets, 2), null)
})
