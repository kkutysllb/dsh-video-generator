// src/review/frames.ts
/** 评审抽帧：ffmpeg 按 25/50/75% 抽 3 帧（规格 §5.3）。exec/probe 注入可测，零真 ffmpeg 依赖。 */

import { existsSync, mkdirSync, statSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { probeDurationSec } from '../finalcut/render-ffmpeg.ts'

export type ExecRunner = (cmd: string, args: string[]) => Promise<void>

function defaultExec(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 60000, maxBuffer: 4 * 1024 * 1024 }, (err) => (err ? reject(err) : resolve()))
  })
}

/** 25/50/75% 三个时间点（秒，3 位小数）；时长非法即抛（评审输入必须已核验）。 */
export function frameTimestamps(durationSec: number): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error(`非法时长: ${durationSec}`)
  return [0.25, 0.5, 0.75].map((r) => Number((durationSec * r).toFixed(3)))
}

/** -ss 放 -i 前 = 输入端快速定位（关键帧精度对评审足够）。 */
export function buildFrameArgs(clip: string, atSec: number, out: string): string[] {
  return ['-y', '-ss', String(atSec), '-i', clip, '-frames:v', '1', '-q:v', '2', out]
}

export interface ExtractOptions {
  probe?: (file: string, ffmpeg: string) => Promise<number | null>
  exec?: ExecRunner
}

export async function extractReviewFrames(
  clip: string,
  outDir: string,
  ffmpeg: string,
  opts: ExtractOptions = {},
): Promise<string[]> {
  const probe = opts.probe ?? probeDurationSec
  const exec = opts.exec ?? defaultExec
  const dur = await probe(clip, ffmpeg)
  if (dur === null) throw new Error(`无法读取片段时长: ${clip}`)
  mkdirSync(outDir, { recursive: true })
  const outs: string[] = []
  const stamps = frameTimestamps(dur)
  for (let i = 0; i < stamps.length; i++) {
    const out = join(outDir, `frame-${i + 1}.png`)
    await exec(ffmpeg, buildFrameArgs(clip, stamps[i]!, out))
    if (!existsSync(out) || statSync(out).size === 0) throw new Error(`抽帧未产出: ${out}`)
    outs.push(out)
  }
  return outs
}
