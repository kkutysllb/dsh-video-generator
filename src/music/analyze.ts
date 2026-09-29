/** 音乐网格本地分析（规格 §6.4 二级来源）：ffmpeg 抽裸 PCM（s16le 单声道 22050Hz）
 *  → RMS 包络 → onset 检测 → 自相关估 BPM → 段落边界（能量谷）。零运行时依赖。
 *
 *  精度口径：够"切镜/对点"级，不做科研级节拍跟踪；grid.source 必须如实标
 *  'local-analysis'（规格 §6.4：不许假装是 API 给的）。
 */

import { execFile } from 'node:child_process'

export interface RmsFrame {
  /** 帧中心时间（秒）。 */
  t: number
  /** 帧内样本 RMS（0..1 近似，int16 满幅=1）。 */
  rms: number
}

export interface MusicSection {
  label: string
  startSec: number
  endSec: number
}

export interface MusicAnalysis {
  /** 估计 BPM（拍/分钟）；onset 不足时 null。 */
  bpm: number | null
  /** 第一强 onset（秒），BPM 网格相位。 */
  offsetSec: number | null
  /** 段落边界切出的段落（label 为 S1..Sn 的匿名段）。 */
  sections: MusicSection[]
  /** onset 时刻（秒，升序）。 */
  onsets: number[]
}

const PCM_SAMPLE_RATE = 22050

/** ffmpeg 抽裸 PCM 到内存（s16le mono）。上限 120s 源（防护：异常长音频截断分析）。 */
export async function extractPcm(file: string, ffmpeg: string, maxSeconds = 120): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpeg,
      ['-i', file, '-ac', '1', '-ar', String(PCM_SAMPLE_RATE), '-f', 's16le', '-'],
      { timeout: 60000, maxBuffer: PCM_SAMPLE_RATE * 2 * (maxSeconds + 5), encoding: 'buffer' },
      (err, stdout) => {
        if (err && !(stdout as unknown as Buffer)?.length) {
          reject(new Error(`PCM 抽取失败: ${err.message}`))
          return
        }
        resolve(stdout as unknown as Buffer)
      },
    )
  })
}

/** PCM → RMS 包络（窗口 1024 样本、步进 512 → ≈23ms/帧 @22.05k）。 */
export function pcmEnvelope(pcm: Buffer, sampleRate = PCM_SAMPLE_RATE, hop = 512, win = 1024): RmsFrame[] {
  const frames: RmsFrame[] = []
  const samples = pcm.length >> 1 // int16
  for (let start = 0; start + win <= samples; start += hop) {
    let sum = 0
    for (let i = 0; i < win; i++) {
      const v = pcm.readInt16LE((start + i) << 1) / 32768
      sum += v * v
    }
    frames.push({ t: (start + win / 2) / sampleRate, rms: Math.sqrt(sum / win) })
  }
  return frames
}

/** onset 检测：能量显著上跳（当前帧 > factor × 前向局部均值）且过绝对门限。 */
export function onsetTimes(frames: RmsFrame[], opts: { factor?: number; floor?: number; minGapSec?: number } = {}): number[] {
  const factor = opts.factor ?? 2.2
  const floor = opts.floor ?? 0.01
  const minGapSec = opts.minGapSec ?? 0.12
  const win = 12 // 前向局部均值窗口（帧）
  const onsets: number[] = []
  for (let i = win; i < frames.length; i++) {
    const prev = frames.slice(i - win, i).reduce((a, f) => a + f.rms, 0) / win
    const cur = frames[i]!.rms
    if (cur > floor && cur > prev * factor) {
      const t = frames[i]!.t
      if (onsets.length === 0 || t - onsets[onsets.length - 1]! >= minGapSec) onsets.push(t)
    }
  }
  return onsets
}

/** 节拍估计：onset 脉冲串自相关，lag ∈ [0.3, 1.0]s（60–200 BPM）取峰。 */
export function estimateTempo(onsets: number[], durationSec: number): { bpm: number; offsetSec: number } | null {
  if (onsets.length < 4 || durationSec < 4) return null
  const gridHz = 100
  const n = Math.floor(durationSec * gridHz)
  const train = new Float32Array(n)
  for (const t of onsets) {
    const idx = Math.round(t * gridHz)
    // ±1 格膨胀（±10ms 容差）：帧量化抖动会让等间隔 onset 在整数格上交替偏移，
    // 不膨胀时 lag/2 的对齐峰被随机错位打散（120BPM 被误判 60 的根因）。
    for (const d of [-3, -2, -1, 0, 1, 2, 3]) {
      const j = idx + d
      if (j >= 0 && j < n) train[j] = 1
    }
  }
  const minLag = Math.floor(0.3 * gridHz) // 200 BPM
  const maxLag = Math.min(Math.floor(1.0 * gridHz), Math.floor(n / 2)) // 60 BPM
  const scores: Array<{ lag: number; norm: number }> = []
  for (let lag = minLag; lag <= maxLag; lag++) {
    // 全量点积（n ≤ 1.2 万格点 × ≤100 个 lag，量级可忽略）——粗步进会整体错过对齐峰
    let score = 0
    for (let i = 0; i + lag < n; i++) {
      score += (train[i] ?? 0) * (train[i + lag] ?? 0)
    }
    scores.push({ lag, norm: score / (n - lag) })
  }
  if (scores.length === 0) return null
  // 倍频梳状打分（节拍二义性消解）：comb(L)=Σ norm(m·L)/m（m·L ≤ maxLag）。
  // - 真 120（onset 每 0.5s）：comb(50) 聚合 norm(50)+norm(100)+… 完胜 comb(100)=norm(100)
  // - 真 60（onset 每 1.0s）：norm(50)≈0，comb(50)≈½norm(100) < comb(100) → 判 60
  const byLag = new Map(scores.map((x) => [x.lag, x.norm]))
  const comb = (L: number): number => {
    let sum = 0
    for (let m = 1, lm = L; lm <= maxLag; m++, lm = L * m) sum += (byLag.get(lm) ?? 0) / m
    return sum
  }
  let bestComb = 0
  for (const x of scores) bestComb = Math.max(bestComb, comb(x.lag))
  if (bestComb <= 0) return null
  const best = scores.reduce((a, x) => (x.norm > a.norm ? x : a), { lag: -1, norm: 0 })
  const pick = scores.find((x) => comb(x.lag) >= bestComb * 0.9) ?? best
  const bestLag = pick.lag
  const bpm = Math.round((60 * gridHz) / bestLag)
  // 相位：第一个 onset 对齐网格
  const offsetSec = onsets[0]!
  return { bpm: Math.min(200, Math.max(60, bpm)), offsetSec: Math.round(offsetSec * 100) / 100 }
}

/** 段落边界：平滑 RMS 的显著能量谷（静默/过渡），相邻边界 ≥ minGapSec。 */
export function sectionBoundaries(frames: RmsFrame[], opts: { minGapSec?: number; smooth?: number } = {}): number[] {
  const minGapSec = opts.minGapSec ?? 2
  const smooth = opts.smooth ?? 9
  if (frames.length < smooth * 4) return []
  const rms = frames.map((f) => f.rms)
  const sm = rms.map((_, i) => {
    const a = Math.max(0, i - smooth)
    const b = Math.min(rms.length, i + smooth + 1)
    let sum = 0
    for (let k = a; k < b; k++) sum += rms[k]!
    return sum / (b - a)
  })
  const boundaries: number[] = []
  for (let i = smooth; i < sm.length - smooth; i++) {
    const v = sm[i] ?? 0
    const left = sm.slice(Math.max(0, i - smooth), i)
    const right = sm.slice(i + 1, i + smooth + 1)
    const lMax = left.length ? Math.max(...left) : 0
    const rMax = right.length ? Math.max(...right) : 0
    const neighMax = Math.max(lMax, rMax)
    // 谷：显著低于两侧较高侧，且不是平直段
    if (v < neighMax * 0.45 && v < 0.5 * lMax + 0.5 * rMax) {
      const t = frames[i]!.t
      if (boundaries.length === 0 || t - boundaries[boundaries.length - 1]! >= minGapSec) boundaries.push(t)
    }
  }
  return boundaries
}

export function sectionsFromBoundaries(boundaries: readonly number[], durationSec: number): MusicSection[] {
  const cuts = [0, ...boundaries.filter((b) => b > 0.5 && b < durationSec - 0.5), durationSec]
  const sections: MusicSection[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const startSec = Math.round(cuts[i]! * 100) / 100
    const endSec = Math.round(cuts[i + 1]! * 100) / 100
    if (endSec - startSec >= 1) sections.push({ label: `S${sections.length + 1}`, startSec, endSec })
  }
  return sections
}

/** 一站式：文件 → 分析结果（供 music 段 grid 组装）。 */
export async function analyzeMusicFile(file: string, ffmpeg: string): Promise<MusicAnalysis> {
  const pcm = await extractPcm(file, ffmpeg)
  const frames = pcmEnvelope(pcm)
  const durationSec = frames.length ? frames[frames.length - 1]!.t : 0
  const onsets = onsetTimes(frames)
  const tempo = estimateTempo(onsets, durationSec)
  const boundaries = sectionBoundaries(frames)
  const sections = sectionsFromBoundaries(boundaries, durationSec)
  return {
    bpm: tempo?.bpm ?? null,
    offsetSec: tempo?.offsetSec ?? null,
    sections,
    onsets,
  }
}
