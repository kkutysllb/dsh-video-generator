/** ffmpeg 渲染通道：归一化（scale/pad/fps）→ concat → drawtext 字幕 → 混音（规格 §5 成片链路）。 */
// 归一化 -an 会丢弃 clip 自带音轨；配音一律走 timeline.audio 通道。

import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Timeline } from './timeline.ts'

export function locateFfmpeg(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env['VGEN_FFMPEG']) return env['VGEN_FFMPEG']
  return 'ffmpeg'
}

export interface RenderPlan {
  normalize: Array<{ src: string; out: string; args: string[] }>
  composite: { args: string[] }
  workDir: string
}

/** ffmpeg 滤镜元字符转义（drawtext text 与 filter 参数两处）。 */
function escFilter(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/%/g, '\\%')
}

/** 探测常见 CJK 字体（macOS 优先，回退 Linux 常见路径）；找不到返回 null。 */
export function pickFontFile(): string | null {
  const candidates = [
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/STHeiti Light.ttc',
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

/** drawtext 缺失检测：Homebrew 精简构建等场景 ffmpeg 会报 `No such filter: 'drawtext'`。 */
export function drawtextMissing(stderr: string): boolean {
  return /No such filter:\s*'drawtext'/.test(stderr)
}

const DRAWTEXT_HINT = '当前 ffmpeg 缺少 drawtext 滤镜（Homebrew 精简构建常见）：请设置环境变量 VGEN_FFMPEG 指向含 libfreetype 的完整构建，或安装 ffmpeg 完整版'
/** 通用合成失败尾部引导：保证用户在 drawtext 缺失时总能看到出路。 */
const COMPOSITE_HINT = "｜排查提示：若上方 stderr 含 No such filter: 'drawtext'，说明当前 ffmpeg 缺少 drawtext 滤镜（Homebrew 精简构建常见）：请设置环境变量 VGEN_FFMPEG 指向含 libfreetype 的完整构建，或安装 ffmpeg 完整版"

export function buildRenderPlan(t: Timeline, outPath: string, opts: { ffmpeg: string; workDir: string; subtitles?: boolean; fontFile?: string | null }): RenderPlan {
  if (t.clips.length === 0) throw new Error('时间线没有 clip，无法渲染')
  mkdirSync(opts.workDir, { recursive: true })
  const { width, height, fps } = t.canvas
  const normalize = t.clips.map((c, i) => {
    const out = join(opts.workDir, `norm-${String(i).padStart(3, '0')}.mp4`)
    const args = [
      '-y', '-i', c.src,
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps},format=yuv420p`,
      '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
      out,
    ]
    return { src: c.src, out, args }
  })

  // filter_complex 按序构造：视频归一化片段 concat → 逐条 drawtext 链式补字幕 → 音频 aresample/adelay/atrim/volume → amix
  const parts: string[] = []
  const inputs: string[] = []
  normalize.forEach((_, i) => inputs.push(`[${i}:v]`))
  parts.push(`${inputs.join('')}concat=n=${normalize.length}:v=1:a=0[vbase]`)

  let vLabel = 'vbase'
  const fontFile = opts.fontFile ?? null
  const useSubtitles = opts.subtitles !== false && t.subtitles.length > 0
  t.subtitles.forEach((s, i) => {
    if (!useSubtitles) return
    const from = (s.startUs / 1e6).toFixed(3)
    const to = (s.endUs / 1e6).toFixed(3)
    const out = i === t.subtitles.length - 1 ? 'vout' : `vs${i}`
    const font = fontFile ? `fontfile='${escFilter(fontFile)}':` : ''
    parts.push(
      `[${vLabel}]drawtext=${font}text='${escFilter(s.text)}':fontsize=48:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*0.82:enable='between(t,${from},${to})'[${out}]`,
    )
    vLabel = out
  })
  if (!useSubtitles) {
    parts.push(`[${vLabel}]null[vout]`)
    vLabel = 'vout'
  }

  if (t.audio.length) {
    const mixed: string[] = []
    t.audio.forEach((a, i) => {
      const idx = normalize.length + i
      const delayMs = Math.max(0, Math.round(a.startUs / 1000))
      const durSec = a.durationUs !== undefined ? (a.durationUs / 1e6).toFixed(3) : null
      const vol = a.volume ?? 1
      let chain = `[${idx}:a]aresample=44100`
      if (delayMs > 0) chain += `,adelay=${delayMs}|${delayMs}`
      if (durSec !== null) chain += `,atrim=0:${durSec}`
      if (vol !== 1) chain += `,volume=${vol}`
      parts.push(`${chain}[na${i}]`)
      mixed.push(`[na${i}]`)
    })
    parts.push(`${mixed.join('')}amix=inputs=${mixed.length}:duration=longest:normalize=0[aout]`)
  }

  const args: string[] = ['-y']
  for (const n of normalize) args.push('-i', n.out)
  for (const a of t.audio) args.push('-i', a.src)
  args.push('-filter_complex', parts.join(';'))
  args.push('-map', `[${vLabel}]`)
  if (t.audio.length) args.push('-map', '[aout]')
  const totalUs = t.totalDurationUs
  if (totalUs > 0) args.push('-t', (totalUs / 1e6).toFixed(3))
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart')
  if (t.audio.length) args.push('-c:a', 'aac', '-b:a', '160k')
  args.push(outPath)

  return { normalize, composite: { args }, workDir: opts.workDir }
}

function runOne(ffmpeg: string, args: string[], timeoutMs = 300000): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    execFile(ffmpeg, args, { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 }, (err, _stdout, stderr) => {
      const tail = String(stderr ?? '').slice(-2000)
      if (err) resolve({ ok: false, stderr: tail || String(err.message) })
      else resolve({ ok: true, stderr: tail })
    })
  })
}

export async function renderTimeline(t: Timeline, outPath: string, opts: { subtitles?: boolean; ffmpeg?: string; fontFile?: string | null } = {}): Promise<{ ok: boolean; output?: string; error?: string }> {
  const ffmpeg = opts.ffmpeg ?? locateFfmpeg()
  if (!ffmpeg) return { ok: false, error: '未找到 ffmpeg（可设 VGEN_FFMPEG）' }
  const fontFile = opts.fontFile !== undefined ? opts.fontFile : pickFontFile()
  const workDir = mkdtempSync(join(tmpdir(), 'vgen-render-'))
  try {
    const plan = buildRenderPlan(t, outPath, { ffmpeg, workDir, subtitles: opts.subtitles, fontFile })
    for (const n of plan.normalize) {
      const r = await runOne(ffmpeg, n.args)
      if (!r.ok) return { ok: false, error: `归一化失败: ${r.stderr}` }
    }
    const r = await runOne(ffmpeg, plan.composite.args, 600000)
    if (!r.ok) {
      if (drawtextMissing(r.stderr)) return { ok: false, error: DRAWTEXT_HINT }
      return { ok: false, error: `合成失败: ${r.stderr}${COMPOSITE_HINT}` }
    }
    return { ok: true, output: outPath }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    try { rmSync(workDir, { recursive: true, force: true }) } catch { /* 清理失败不阻塞 */ }
  }
}

export async function probeDurationSec(file: string, ffmpeg: string = locateFfmpeg() ?? 'ffmpeg'): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(ffmpeg, ['-i', file], { timeout: 30000 }, (err, _stdout, stderr) => {
      void err
      const m = /Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/.exec(String(stderr ?? ''))
      if (!m) return resolve(null)
      const [, h, min, s, cs] = m
      resolve(Number(h) * 3600 + Number(min) * 60 + Number(s) + Number(cs) / 100)
    })
  })
}
