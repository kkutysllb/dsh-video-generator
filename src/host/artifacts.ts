// src/host/artifacts.ts
/** run 产物清单（设置页「视频工坊」数据源；rel 为 run 目录内 POSIX 风格相对路径，供 media URL 拼接）。 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { RunStore } from '../store/runs.ts'

export interface ArtifactFile {
  name: string
  rel: string
  size: number
}

export interface RunArtifacts {
  handoff: { story: boolean; script: boolean; storyboard: boolean }
  assets: ArtifactFile[]
  shots: ArtifactFile[]
  clips: ArtifactFile[]
  review: ArtifactFile[]
  final: { mp4: ArtifactFile | null; srt: ArtifactFile | null }
}

function listDir(runDir: string, sub: string, prefix: string): ArtifactFile[] {
  const dir = join(runDir, sub)
  let names: string[] = []
  try {
    names = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort()
  } catch {
    return []
  }
  return names.map((name) => {
    const full = join(dir, name)
    return { name, rel: `${prefix}/${name}`, size: statSync(full).size }
  })
}

function listTree(runDir: string, sub: string, prefix: string): ArtifactFile[] {
  // review/ 有 shot-NNN 子目录：递归一层
  const dir = join(runDir, sub)
  let entries: string[] = []
  try {
    entries = readdirSync(dir, { withFileTypes: true }).map((e) => e.name).sort()
  } catch {
    return []
  }
  const out: ArtifactFile[] = []
  for (const e of entries) {
    const full = join(dir, e)
    if (statSync(full).isFile()) {
      out.push({ name: e, rel: `${prefix}/${e}`, size: statSync(full).size })
    } else {
      for (const f of listDir(runDir, `${sub}/${e}`, `${prefix}/${e}`)) out.push(f)
    }
  }
  return out
}

function finalFile(runDir: string, name: string): ArtifactFile | null {
  const full = join(runDir, name)
  if (!existsSync(full) || !statSync(full).isFile()) return null
  return { name, rel: name, size: statSync(full).size }
}

export function collectArtifacts(runs: RunStore, runId: string): RunArtifacts {
  const runDir = join(runs.rootDir, runId)
  return {
    handoff: {
      story: existsSync(join(runDir, 'story.json')),
      script: existsSync(join(runDir, 'script.json')),
      storyboard: existsSync(join(runDir, 'storyboard.json')),
    },
    assets: listDir(runDir, 'assets', 'assets'),
    shots: listDir(runDir, 'shots', 'shots'),
    clips: listDir(runDir, 'clips', 'clips'),
    review: listTree(runDir, 'review', 'review'),
    final: { mp4: finalFile(runDir, 'final.mp4'), srt: finalFile(runDir, 'final.srt') },
  }
}
