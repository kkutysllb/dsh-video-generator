/** 设置页「环境与诊断」（规格 §8）：ffmpeg/drawtext 检测、TTS 能力、产物根目录、插件版本。 */

import { execFile } from 'node:child_process'
import type { VaultStore } from '../store/vault.ts'
import type { RunStore } from '../store/runs.ts'
import { locateFfmpeg } from '../finalcut/render-ffmpeg.ts'

export interface Diagnostics {
  version: string
  platform: string
  ffmpeg: { path: string; version: string | null; drawtext: boolean; error?: string }
  tts: { available: boolean; model?: string; hint?: string }
  runsRoot: string
  projectsRoots: string[]
}

function run(ffmpeg: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    execFile(ffmpeg, args, { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), error: err.message })
      else resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

export async function collectDiagnostics(opts: { vault: VaultStore; runs: RunStore; version: string }): Promise<Diagnostics> {
  const ffmpeg = locateFfmpeg() ?? 'ffmpeg'
  const [version, filters] = await Promise.all([
    run(ffmpeg, ['-version'], 10_000),
    run(ffmpeg, ['-filters', '-hide_banner'], 15_000),
  ])
  const versionLine = version.stdout.split('\n')[0]?.trim() ?? null
  const ffmpegOut = {
    path: ffmpeg,
    version: version.error ? null : versionLine,
    drawtext: !filters.error && /drawtext/i.test(filters.stdout),
    ...(filters.error && version.error ? { error: version.error } : {}),
  }
  const data = opts.vault.load()
  const defaultId = data.defaultChannelId
  const channel = defaultId ? data.channels.find((c) => c.id === defaultId) : null
  const ttsModel = channel?.models.find((m) => m.kind === 'tts')
  return {
    version: opts.version,
    platform: `${process.platform}-${process.arch}`,
    ffmpeg: ffmpegOut,
    tts: ttsModel
      ? { available: true, model: ttsModel.model }
      : {
          available: false,
          hint: channel
            ? '默认通道没有 kind=tts 模型：成片旁白将回退本地系统语音（质量有限），建议在通道管理导入 TTS 模型'
            : '尚未配置默认通道：媒体段与旁白生成不可用，请先在通道管理添加',
        },
    runsRoot: opts.runs.rootDir,
    projectsRoots: [`<workspace>/.dsh-drama`],
  }
}
