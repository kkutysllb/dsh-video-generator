/** 七段流水线状态机：run.json 事实源推进 + 断点续跑 + gate(auto/ask/manual) + 并发泵 + 记账（规格 §5）。
 *  已知限制：断点续跑从事件流恢复的 shot 参考图为签名 URL（7 天有效）；过期导致 video 段失败时，
 *  将 run.json 中 shot-assets 段状态改回 pending 重推即可重新生成。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { RunEvent, RunStore } from '../store/runs.ts'
import type { ChannelRef } from '../registry.ts'
import type { Provider } from '../provider.ts'
import { estimateCny, type PricingTable } from '../pricing.ts'
import { buildCharacterSheetPrompt, buildScenePrompt, buildShotPrompt } from '../prompts.ts'
import { STAGES, type StageId } from '../stages.ts'
import { pollUntil } from '../poll.ts'
import { buildTimeline, writeSrt, type TimelineData, Timeline } from '../finalcut/timeline.ts'
import { renderTimeline, probeDurationSec } from '../finalcut/render-ffmpeg.ts'
import { resolveVoice, buildMacSayCommand, buildSapiScript } from '../finalcut/voice.ts'

export interface MachineDeps {
  runs: RunStore
  runId: string
  target: StageId
  channel: ChannelRef
  /** 模型 -> Provider 工厂（registry.providerForModel 的注入形态；测试可替换）。 */
  providers: { forModel: (model: string, opts?: { fetchImpl?: typeof fetch }) => Provider }
  pricing: PricingTable | null
  confirmer: (est: number | null, kind: string) => Promise<boolean>
  ffmpeg: string | null
  concurrency?: number
  fetchImpl?: typeof fetch
  videoModel?: string
  imageModel?: string
  gates?: Partial<Record<StageId, 'auto' | 'ask' | 'manual'>>
  ask?: (stage: StageId, info: string) => Promise<boolean>
  /** 状态轮询基础间隔（ms），默认 1000。 */
  pollDelayMs?: number
}

const IMAGE_MODEL_DEFAULT = 'doubao-seedream-4-0-250828'
const VIDEO_MODEL_DEFAULT = 'happyhorse-1.1-i2v'

function runExec(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 120000, maxBuffer: 8 * 1024 * 1024 }, (err) => (err ? reject(err) : resolve()))
  })
}

function readJson<T>(runs: RunStore, runId: string, name: string): T {
  return JSON.parse(readFileSync(join(runs.rootDir, runId, `${name}.json`), 'utf8')) as T
}

/** 最新一条同类型事件（事件流取尾，兼容旧 lib 无 findLast）。 */
function lastEvent(events: RunEvent[], type: string): RunEvent | undefined {
  const hits = events.filter((e) => e.type === type)
  return hits.length ? hits[hits.length - 1] : undefined
}

async function saveUrl(fetchImpl: typeof fetch, url: string, file: string): Promise<void> {
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`下载失败 http-${res.status}`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()), { mode: 0o600 })
}

/** 简单并发泵：按 index 顺序发起，至多 limit 个在飞；任一失败即熔断（在飞任务自然完成，不再取新任务）。 */
async function pump<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0
  let stopped = false
  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    for (;;) {
      if (stopped) return
      const i = next++
      if (i >= items.length) return
      try {
        await worker(items[i]!, i)
      } catch (err) {
        stopped = true
        throw err
      }
    }
  })
  await Promise.all(runners)
}

export interface AdvanceResult {
  runId: string
  stages: Partial<Record<StageId, 'pending' | 'running' | 'done' | 'failed'>>
  shotImages?: Array<{ index: number; url: string; file: string }>
  clipFiles?: string[]
  finalOutput?: string
}

/** mac say 文本防护：以 - 开头的文本会被 say 当参数解析，改走临时文本文件 -f 注入（voice.ts 契约）。 */
function sayArgs(text: string, aiff: string): string[] {
  const cmd = buildMacSayCommand(text, aiff)
  if (!text.startsWith('-')) return cmd.args
  return ['-v', 'Tingting', '-o', aiff, '-f', writeSayTextFile(text)]
}

function writeSayTextFile(text: string): string {
  const file = join(tmpdir(), `vgen-say-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
  writeFileSync(file, text, { mode: 0o600 })
  return file
}

/** TimelineData -> Timeline 实例（按线性顺序 addClip 保序保位；渲染通道需要 Timeline 实例）。 */
function toTimeline(d: TimelineData): Timeline {
  const t = new Timeline(d.canvas)
  for (const c of d.clips) t.addClip(c.src, c.durationUs, c.volume)
  for (const s of d.subtitles) t.addSubtitle(s.text, s.startUs, s.endUs)
  for (const a of d.audio) t.addAudio(a.src, a.startUs, a.durationUs, a.volume)
  return t
}

export async function advanceRun(deps: MachineDeps): Promise<AdvanceResult> {
  const { runs, runId } = deps
  const fetchImpl = deps.fetchImpl ?? fetch
  const record = runs.get(runId)
  if (!record) throw new Error(`run 不存在: ${runId}`)
  const targetIdx = STAGES.indexOf(deps.target)
  const result: AdvanceResult = { runId, stages: { ...record.stages } }
  const gates = deps.gates ?? {}

  const ensureGate = async (stage: StageId, info: string): Promise<void> => {
    const mode = gates[stage] ?? 'auto'
    if (mode === 'manual') throw new Error(`段 ${stage} 为 manual 模式：请先在会话中提供该段产物（文件/JSON）后再推进`)
    if (mode === 'ask') {
      if (!deps.ask) throw new Error(`段 ${stage} 需要审批，但未提供 ask 通道`)
      const ok = await deps.ask(stage, info)
      if (ok !== true) throw new Error(`段 ${stage} 在 ask 审批中被拒绝`)
    }
  }

  const begin = (st: StageId): void => {
    runs.setStage(runId, st, 'running')
    runs.appendEvent(runId, 'stage-start', { stage: st })
  }
  const done = (st: StageId): void => {
    runs.setStage(runId, st, 'done')
    runs.appendEvent(runId, 'stage-done', { stage: st })
  }

  // ---- 段执行器（story/script/storyboard 由交接工具负责；machine 从 master-asset 起）----
  if (targetIdx >= STAGES.indexOf('master-asset')) {
    const st: StageId = 'master-asset'
    if (runs.get(runId)!.stages[st] !== 'done') {
      await ensureGate(st, '生成角色三视图与场景主图')
      const script = readJson<{ characters: Array<{ id: string; name: string; appearance: string }>; scenes: Array<{ id: string; name: string; description: string }>; style?: string }>(runs, runId, 'script')
      const assetDir = join(runs.rootDir, runId, 'assets')
      mkdirSync(assetDir, { recursive: true })
      const imageModel = deps.imageModel ?? IMAGE_MODEL_DEFAULT
      const p = deps.providers.forModel(imageModel, { fetchImpl })
      const jobs: Array<{ file: string; prompt: string }> = [
        ...script.characters.map((c) => ({
          file: join(assetDir, `char-${c.id}.png`),
          prompt: buildCharacterSheetPrompt({ name: c.name, appearance: c.appearance, style: script.style }).positive,
        })),
        ...script.scenes.map((sc) => ({
          file: join(assetDir, `scene-${sc.id}.png`),
          prompt: buildScenePrompt({ name: sc.name, description: sc.description, style: script.style }).positive,
        })),
      ]
      const urls: Array<{ key: string; url: string }> = []
      try {
        begin(st)
        await pump(jobs, deps.concurrency ?? 2, async (job) => {
          const est = deps.pricing ? estimateCny(imageModel, deps.pricing) : null
          if (!(await deps.confirmer(est, 'image'))) throw new Error(`用户取消（${st} 段，预测 ${est ?? 'unknown'}）`)
          const { jobId: url } = await p.submit(st, { prompt: job.prompt })
          runs.appendEvent(runId, 'spend', { stage: st, model: imageModel, estCny: est, jobId: String(url).slice(0, 80) })
          await saveUrl(fetchImpl, url, job.file)
          urls.push({ key: job.file, url })
        })
        done(st)
      } catch (err) {
        runs.setStage(runId, st, 'failed')
        throw err
      }
    }
  }

  if (targetIdx >= STAGES.indexOf('shot-assets')) {
    const st: StageId = 'shot-assets'
    const current = runs.get(runId)!.stages
    if (current[st] !== 'done') {
      await ensureGate(st, '逐镜参考图变体')
      const script = readJson<{ characters: Array<{ id: string; name: string; appearance: string }>; style?: string }>(runs, runId, 'script')
      const sb = readJson<{ shots: Array<{ index: number; prompt: string; characterIds: string[]; camera?: string }> }>(runs, runId, 'storyboard')
      const shotsDir = join(runs.rootDir, runId, 'shots')
      mkdirSync(shotsDir, { recursive: true })
      const imageModel = deps.imageModel ?? IMAGE_MODEL_DEFAULT
      const p = deps.providers.forModel(imageModel, { fetchImpl })
      const shotImages: Array<{ index: number; url: string; file: string }> = []
      try {
        begin(st)
        await pump(sb.shots, deps.concurrency ?? 2, async (shot) => {
          const anchors = shot.characterIds.map((cid) => {
            const c = script.characters.find((x) => x.id === cid)
            return c ? `${c.name}（${c.appearance}）` : cid
          })
          const merged = buildShotPrompt({
            line: shot.prompt,
            characterAnchors: anchors,
            camera: shot.camera,
            style: script.style,
            referenceHint: shot.characterIds.length ? '画面主体与服饰严格参考参考图中的角色形象' : undefined,
          })
          const est = deps.pricing ? estimateCny(imageModel, deps.pricing) : null
          if (!(await deps.confirmer(est, 'image'))) throw new Error(`用户取消（shot ${shot.index}）`)
          const { jobId: url } = await p.submit(st, { prompt: merged.positive })
          runs.appendEvent(runId, 'spend', { stage: st, model: imageModel, estCny: est, shot: shot.index, jobId: String(url).slice(0, 80) })
          const file = join(shotsDir, `shot-${String(shot.index).padStart(3, '0')}.png`)
          await saveUrl(fetchImpl, url, file)
          shotImages.push({ index: shot.index, url, file })
        })
        shotImages.sort((a, b) => a.index - b.index)
        result.shotImages = shotImages
        runs.appendEvent(runId, 'shot-urls', { urls: shotImages })
        done(st)
      } catch (err) {
        runs.setStage(runId, st, 'failed')
        throw err
      }
    } else {
      // 断点续跑：从事件流恢复 shot-urls（i2v 输入）
      const ev = lastEvent(runs.get(runId)!.events, 'shot-urls')
      const urls = (ev?.detail as { urls?: Array<{ index: number; url: string; file: string }> } | undefined)?.urls
      if (urls) result.shotImages = [...urls].sort((a, b) => a.index - b.index)
    }
  }

  if (targetIdx >= STAGES.indexOf('video')) {
    const st: StageId = 'video'
    const current = runs.get(runId)!.stages
    if (current[st] !== 'done') {
      await ensureGate(st, '逐镜图生视频')
      const sb = readJson<{ shots: Array<{ index: number; durationSec?: number }> }>(runs, runId, 'storyboard')
      const ev = lastEvent(runs.get(runId)!.events, 'shot-urls')
      const shotUrls = (ev?.detail as { urls?: Array<{ index: number; url: string; file: string }> } | undefined)?.urls ?? result.shotImages
      if (!shotUrls?.length) throw new Error('缺少 shot 参考图 URL：请先完成 shot-assets 段')
      const clipsDir = join(runs.rootDir, runId, 'clips')
      mkdirSync(clipsDir, { recursive: true })
      const videoModel = deps.videoModel ?? VIDEO_MODEL_DEFAULT
      const p = deps.providers.forModel(videoModel, { fetchImpl })
      const clipFiles: string[] = []
      try {
        begin(st)
        await pump(shotUrls, deps.concurrency ?? 2, async (shot) => {
          const durationSec = sb.shots.find((s) => s.index === shot.index)?.durationSec ?? 5
          const est = deps.pricing ? estimateCny(videoModel, deps.pricing) : null
          if (!(await deps.confirmer(est, 'video'))) throw new Error(`用户取消（shot ${shot.index}）`)
          const { jobId } = await p.submit(st, {
            prompt: '镜头缓慢推进，主体自然运动，电影感光影',
            imageUrl: shot.url,
            durationSec,
          })
          runs.appendEvent(runId, 'spend', { stage: st, model: videoModel, estCny: est, shot: shot.index, jobId: String(jobId).slice(0, 80) })
          const finalState = await pollUntil(
            () => p.status(String(jobId)),
            { isFinal: (s) => s.state === 'done' || s.state === 'failed', delayMs: deps.pollDelayMs ?? 1000, maxPollMs: 600000 },
          )
          if (finalState.state === 'failed') throw new Error(`shot ${shot.index} 视频失败: ${finalState.error ?? '?'}`)
          const f = await p.fetch(String(jobId))
          const url = f.outputs[0]
          if (!url) throw new Error(`shot ${shot.index} 完成但无输出`)
          const file = join(clipsDir, `shot-${String(shot.index).padStart(3, '0')}.mp4`)
          await saveUrl(fetchImpl, url, file)
          clipFiles.push(file)
        })
        clipFiles.sort()
        result.clipFiles = clipFiles
        runs.appendEvent(runId, 'clips', { files: clipFiles })
        done(st)
      } catch (err) {
        runs.setStage(runId, st, 'failed')
        throw err
      }
    } else {
      // 断点续跑：从事件流恢复 clips 清单
      const ev = lastEvent(runs.get(runId)!.events, 'clips')
      result.clipFiles = (ev?.detail as { files?: string[] } | undefined)?.files
    }
  }

  if (targetIdx >= STAGES.indexOf('final-cut')) {
    const st: StageId = 'final-cut'
    const current = runs.get(runId)!.stages
    if (current[st] !== 'done') {
      await ensureGate(st, '配音与成片渲染')
      if (!deps.ffmpeg) throw new Error('未找到 ffmpeg，无法成片（可设 VGEN_FFMPEG）')
      const sb = readJson<{ shots: Array<{ index: number; line?: string; durationSec?: number; voiceHint?: string; voiceFile?: string }> }>(runs, runId, 'storyboard')
      const clipsDir = join(runs.rootDir, runId, 'clips')
      const ev = lastEvent(runs.get(runId)!.events, 'clips')
      const clipFiles = (ev?.detail as { files?: string[] } | undefined)?.files ?? result.clipFiles ?? []
      try {
        begin(st)
        const timelineShots: Array<{ video: string; durationUs: number; subtitle?: string; audio?: string; audioDurationUs?: number }> = []
        for (const shot of sb.shots) {
          const clip = join(clipsDir, `shot-${String(shot.index).padStart(3, '0')}.mp4`)
          if (!existsSync(clip)) throw new Error(`final-cut 缺少视频片段: ${clip}`)
          const durSec = (await probeDurationSec(clip, deps.ffmpeg)) ?? shot.durationSec ?? 5
          const text = shot.voiceHint ?? ''
          const voice = resolveVoice({ voiceFile: shot.voiceFile, voiceHint: text }, process.platform)
          let audio: string | undefined
          let audioDurUs: number | undefined
          if (voice?.kind === 'say') {
            const aiff = join(clipsDir, `voice-${shot.index}.aiff`)
            const mp3 = join(clipsDir, `voice-${shot.index}.mp3`)
            await runExec('say', sayArgs(voice.text, aiff))
            await runExec(deps.ffmpeg, ['-y', '-i', aiff, '-codec:a', 'libmp3lame', mp3])
            audio = mp3
            audioDurUs = Math.round(((await probeDurationSec(mp3, deps.ffmpeg)) ?? 0) * 1e6)
          } else if (voice?.kind === 'sapi') {
            // Windows SAPI：写临时 .ps1（0600）后 powershell -File 执行（不得 -Command 内联，防引号剥离重开解析面）。
            // 真机验证 SKIPPED：开发平台 mac，Windows 端到端验证留待 Windows 机器。
            const ps1 = join(clipsDir, `voice-${shot.index}.ps1`)
            const wav = join(clipsDir, `voice-${shot.index}.wav`)
            writeFileSync(ps1, buildSapiScript(voice.text, wav), { mode: 0o600 })
            await runExec('powershell', ['-NoProfile', '-File', ps1])
            audio = wav
            audioDurUs = Math.round(((await probeDurationSec(wav, deps.ffmpeg)) ?? 0) * 1e6)
          } else if (voice?.kind === 'file') {
            audio = voice.src
            audioDurUs = Math.round(((await probeDurationSec(voice.src, deps.ffmpeg)) ?? 0) * 1e6)
          } else {
            // 无配音（voiceHint/voiceFile 均缺）：字幕保留 line，事件透明化
            runs.appendEvent(runId, 'tts-skip', { shot: shot.index })
          }
          const subtitle = shot.voiceHint ?? shot.line ?? ''
          timelineShots.push({
            video: clip,
            durationUs: Math.round(durSec * 1e6),
            subtitle,
            audio,
            audioDurationUs: audioDurUs,
          })
        }
        const data = buildTimeline({ canvas: { width: 1080, height: 1920, fps: 24 }, shots: timelineShots })
        const timeline = toTimeline(data)
        const finalPath = join(runs.rootDir, runId, 'final.mp4')
        const r = await renderTimeline(timeline, finalPath, { subtitles: true, ffmpeg: deps.ffmpeg })
        if (!r.ok) throw new Error(`渲染失败: ${r.error}`)
        const srtPath = join(runs.rootDir, runId, 'final.srt')
        writeFileSync(srtPath, writeSrt(timeline.subtitles), { mode: 0o600 })
        result.finalOutput = finalPath
        runs.appendEvent(runId, 'final', { output: finalPath, srt: srtPath })
        done(st)
        runs.setStatus(runId, 'done')
      } catch (err) {
        runs.setStage(runId, st, 'failed')
        throw err
      }
    }
  }

  result.stages = runs.get(runId)!.stages as AdvanceResult['stages']
  return result
}
