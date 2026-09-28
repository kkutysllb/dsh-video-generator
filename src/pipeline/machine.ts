/** 七段流水线状态机：run.json 事实源推进 + 断点续跑 + gate(auto/ask/manual) + 并发泵 + 记账
 *  （规格 §5；通道层 v2：模型一律来自用途槽绑定，单槽单模型，无候选轮询）。
 *  已知限制：断点续跑从事件流恢复的 shot 参考图为签名 URL（7 天有效）；过期导致 video 段失败时，
 *  将 run.json 中 shot-assets 段状态改回 pending 重推即可重新生成。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { RunEvent, RunStore } from '../store/runs.ts'
import type { Provider } from '../provider.ts'
import { capabilityFlag, type SlotBinding, type SlotId } from '../store/slots.ts'
import { buildCharacterSheetPrompt, buildScenePrompt, buildShotPrompt } from '../prompts.ts'
import { STAGES, type StageId } from '../stages.ts'
import { retryTransient } from '../poll.ts'
import { RelayError } from '../providers/relay-http.ts'
import { bindingUnavailable, isExplicitModelUnavailable, ModelUnavailableError, requireSlotBinding } from '../model-selection.ts'
import { providerForSlot, type ChannelRef } from '../providers/protocols.ts'
import { generateShotClip, saveUrl, SHOT_MOTION_PROMPT } from './shot-clip.ts'
import { buildTimeline, writeSrt, type TimelineData, Timeline } from '../finalcut/timeline.ts'
import { renderTimeline, probeDurationSec } from '../finalcut/render-ffmpeg.ts'
import { resolveVoice, buildMacSayCommand, buildSapiScript, synthesizeCloudSpeech, type CloudTtsConfig } from '../finalcut/voice.ts'

export interface MachineDeps {
  runs: RunStore
  runId: string
  target: StageId
  /** 槽位绑定表（工具层推进前从 vault 取好；未绑定槽在消费点抛 model-unavailable）。 */
  slots: Partial<Record<SlotId, SlotBinding>>
  /** 凭证解析：按绑定取通道；通道不存在时抛 model-unavailable（含槽位上下文）。 */
  channelFor: (binding: SlotBinding) => ChannelRef
  /** Provider 工厂（registry.providerForSlot 的注入形态；测试可替换）。 */
  providers: { forSlot: (binding: SlotBinding, channel: ChannelRef, opts?: { fetchImpl?: typeof fetch }) => Provider }
  /** 按绑定估价（工具层按各槽通道拉价目后注入；失败为 null → 估价未知走确认）。 */
  estimate: (binding: SlotBinding) => number | null
  confirmer: (est: number | null, kind: string) => Promise<boolean>
  ffmpeg: string | null
  concurrency?: number
  fetchImpl?: typeof fetch
  gates?: Partial<Record<StageId, 'auto' | 'ask' | 'manual'>>
  ask?: (stage: StageId, info: string) => Promise<boolean>
  /** 云端 TTS（配置即启用，自然度优先；失败自动回退本地 say/SAPI）。 */
  tts?: CloudTtsConfig
  /** 状态轮询基础间隔（ms），默认 1000。 */
  pollDelayMs?: number
  /** 宿主生命周期信号：插件停用/卸载（HMR）时 abort，在飞的段执行在下一个
   *  检查点停下并置 run 为 failed(host-interrupted)，不再继续调用通道 API。 */
  signal?: AbortSignal
  /** 记账回调（submit 成功后落全局账本；工具层注入 SpendLedger.record）。 */
  recordSpend?: (entry: { channel: string; model: string; kind: 'image' | 'video'; estCny: number | null; jobId: string }) => void
}

/** 宿主停用中断：段执行在检查点抛出，工具层转 interrupted 信封。 */
export class RunInterruptedError extends Error {
  readonly runId: string
  constructor(runId: string) {
    super(`run ${runId} 因宿主停用中断（plugin deactivated）`)
    this.name = 'RunInterruptedError'
    this.runId = runId
  }
}

function wrapBindingError(binding: SlotBinding, err: unknown): Error {
  if (err instanceof ModelUnavailableError) return err
  if (isExplicitModelUnavailable(err)) {
    return bindingUnavailable(binding, err instanceof Error ? err.message : String(err))
  }
  return err instanceof Error ? err : new Error(String(err))
}

/** 9:16 画布用竖版参考图（2:3 为中转普遍支持的最接近竖档，渲染端 crop 归一化消黑边）。 */
const IMAGE_SIZE_PORTRAIT = '1024x1536'
/** 角色三视图卡：横向并排三视图，横版构图。 */
const IMAGE_SIZE_LANDSCAPE = '1536x1024'

/** size 透传 + 服务端 400 单次降级（部分上游不认 size 参数；429/5xx 走外层 retryTransient）。
 *  是否透传 size 由槽位能力位 sizeParam 声明（默认透传，服务端不认时自动降档）。 */
async function submitImageWithSize(
  p: Provider, stage: StageId, prompt: string, size: string | undefined, onFallback: () => void,
): Promise<string> {
  if (!size) return (await p.submit(stage, { prompt })).jobId
  try {
    return (await p.submit(stage, { prompt, size })).jobId
  } catch (err) {
    if (err instanceof RelayError && err.status === 400 && !isExplicitModelUnavailable(err)) {
      onFallback()
      return (await p.submit(stage, { prompt })).jobId
    }
    throw err
  }
}

/** manual gate 拦截（工具层转 manual-gate 信封，指引 vgen_provide）。 */
export class ManualGateError extends Error {}
/** ask gate 被拒（工具层转 gate-approval 信封，指引 gateApprovals 重调）。 */
export class AskGateRejectedError extends Error {}

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

/** 简单并发泵：按 index 顺序发起，至多 limit 个在飞；任一失败即熔断（在飞任务自然完成，不再取新任务）。 */
async function pump<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>, live?: () => void): Promise<void> {
  let next = 0
  let stopped = false
  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    for (;;) {
      if (stopped) return
      live?.() // 宿主停用检查点：在飞任务自然结束，不再取新任务
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

  /** 槽位解析三件套：绑定 + 凭证 + Provider。任何一步失败都是 model-unavailable（确认之前）。 */
  const resolveSlot = (slot: SlotId): { binding: SlotBinding; channel: ChannelRef; provider: Provider } => {
    const binding = requireSlotBinding(deps.slots, slot)
    const channel = deps.channelFor(binding)
    const provider = deps.providers.forSlot(binding, channel, { fetchImpl })
    return { binding, channel, provider }
  }
  const requireImageProvider = (slot: SlotId): { binding: SlotBinding; channel: ChannelRef; provider: Provider } => {
    const r = resolveSlot(slot)
    if (!r.provider.capabilities.image) {
      throw bindingUnavailable(r.binding, `Provider ${r.provider.id} 不支持 image 能力`)
    }
    return r
  }

  // 先校验后序 video 槽，避免前序 image 阶段确认后才发现模型不可用（确认之前零花费）。
  if (targetIdx >= STAGES.indexOf('video') && record.stages['video'] !== 'done') {
    const videoBinding = requireSlotBinding(deps.slots, 'video')
    const canI2v = capabilityFlag(videoBinding, 'imageToVideo', true)
    const canT2v = capabilityFlag(videoBinding, 'textToVideo', false)
    if (!canI2v && !canT2v) {
      throw bindingUnavailable(videoBinding, '能力位 imageToVideo/textToVideo 均未启用（设置页「用途槽 → 视频」勾选其一）')
    }
    const videoChannel = deps.channelFor(videoBinding)
    deps.providers.forSlot(videoBinding, videoChannel, { fetchImpl })  }

  const ensureGate = async (stage: StageId, info: string): Promise<void> => {
    const mode = gates[stage] ?? 'auto'
    if (mode === 'manual') throw new ManualGateError(`段 ${stage} 为 manual 模式：请先在会话中提供该段产物（文件/JSON）后再推进`)
    if (mode === 'ask') {
      if (!deps.ask) throw new Error(`段 ${stage} 需要审批，但未提供 ask 通道`)
      const ok = await deps.ask(stage, info)
      if (ok !== true) throw new AskGateRejectedError(`段 ${stage} 在 ask 审批中被拒绝`)
    }
  }

  /** 宿主停用检查点：置当前 running 段 failed + 事件留痕，再抛中断。
   *  与 dsh-kylin-automation 的 host_interrupted 语义同款；
   *  interruptMarked 保证并发泵多 runner 同时命中时事件只记一次。 */
  let interruptMarked = false
  const ensureLive = (): void => {
    if (deps.signal?.aborted !== true) return
    if (!interruptMarked) {
      interruptMarked = true
      const live = runs.get(runId)
      if (live !== null) {
        for (const [stage, state] of Object.entries(live.stages)) {
          if (state === 'running') runs.setStage(runId, stage, 'failed')
        }
      }
      runs.setStatus(runId, 'failed')
      runs.appendEvent(runId, 'run-interrupted', { reason: 'host-deactivated' })
    }
    throw new RunInterruptedError(runId)
  }
  ensureLive()

  const begin = (st: StageId): void => {
    ensureLive() // 段边界检查点：停用后不再开启新段
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
      const { binding: imageBinding, channel, provider: p } = requireImageProvider('image.master')
      const jobs: Array<{ file: string; prompt: string; size: string }> = [
        ...script.characters.map((c) => ({
          file: join(assetDir, `char-${c.id}.png`),
          prompt: buildCharacterSheetPrompt({ name: c.name, appearance: c.appearance, style: script.style }).positive,
          size: IMAGE_SIZE_LANDSCAPE,
        })),
        ...script.scenes.map((sc) => ({
          file: join(assetDir, `scene-${sc.id}.png`),
          prompt: buildScenePrompt({ name: sc.name, description: sc.description, style: script.style }).positive,
          size: IMAGE_SIZE_PORTRAIT,
        })),
      ]
      const urls: Array<{ key: string; url: string }> = []
      try {
        begin(st)
        await pump(jobs, deps.concurrency ?? 2, async (job) => {
          const est = deps.estimate(imageBinding)
          if (!(await deps.confirmer(est, 'image'))) throw new Error(`用户取消（${st} 段，预测 ${est ?? 'unknown'}）`)
          const size = capabilityFlag(imageBinding, 'sizeParam', true) ? job.size : undefined
          const url = await retryTransient(() =>
            submitImageWithSize(p, st, job.prompt, size, () => runs.appendEvent(runId, 'size-fallback', { stage: st, size: job.size })),
          )
          runs.appendEvent(runId, 'spend', { stage: st, model: imageBinding.model, estCny: est, jobId: String(url).slice(0, 80) })
          deps.recordSpend?.({ channel: channel.id, model: imageBinding.model, kind: 'image', estCny: est, jobId: String(url).slice(0, 80) })
          await saveUrl(fetchImpl, url, job.file)
          urls.push({ key: job.file, url })
        }, ensureLive)
        done(st)
      } catch (err) {
        runs.setStage(runId, st, 'failed')
        throw wrapBindingError(imageBinding, err)
      }
    }
  }

  if (targetIdx >= STAGES.indexOf('shot-assets')) {
    const st: StageId = 'shot-assets'
    const current = runs.get(runId)!.stages
    if (current[st] !== 'done') {
      await ensureGate(st, '逐镜参考图变体')
      const script = readJson<{ characters: Array<{ id: string; name: string; appearance: string }>; style?: string }>(runs, runId, 'script')
      const sb = readJson<{ shots: Array<{ index: number; prompt: string; characterIds: number[] | string[]; camera?: string }> }>(runs, runId, 'storyboard')
      const shotsDir = join(runs.rootDir, runId, 'shots')
      mkdirSync(shotsDir, { recursive: true })
      const { binding: shotBinding, channel, provider: p } = requireImageProvider('image.shot')
      const shotImages: Array<{ index: number; url: string; file: string }> = []
      try {
        begin(st)
        await pump(sb.shots, deps.concurrency ?? 2, async (shot) => {
          const anchors = shot.characterIds.map((cid) => {
            const c = script.characters.find((x) => x.id === cid)
            return c ? `${c.name}（${c.appearance}）` : String(cid)
          })
          const merged = buildShotPrompt({
            line: shot.prompt,
            characterAnchors: anchors,
            camera: shot.camera,
            style: script.style,
            // 参考图提示：P0 仍为提示词级一致性；绑定声明 referenceImage 后 P1 接真参考图输入
            referenceHint: shot.characterIds.length ? '画面主体与服饰严格参考参考图中的角色形象' : undefined,
          })
          const est = deps.estimate(shotBinding)
          if (!(await deps.confirmer(est, 'image'))) throw new Error(`用户取消（shot ${shot.index}）`)
          const size = capabilityFlag(shotBinding, 'sizeParam', true) ? IMAGE_SIZE_PORTRAIT : undefined
          const url = await retryTransient(() =>
            submitImageWithSize(p, st, merged.positive, size, () => runs.appendEvent(runId, 'size-fallback', { stage: st, size: IMAGE_SIZE_PORTRAIT })),
          )
          runs.appendEvent(runId, 'spend', { stage: st, model: shotBinding.model, estCny: est, shot: shot.index, jobId: String(url).slice(0, 80) })
          deps.recordSpend?.({ channel: channel.id, model: shotBinding.model, kind: 'image', estCny: est, jobId: String(url).slice(0, 80) })
          const file = join(shotsDir, `shot-${String(shot.index).padStart(3, '0')}.png`)
          await saveUrl(fetchImpl, url, file)
          shotImages.push({ index: shot.index, url, file })
        }, ensureLive)
        shotImages.sort((a, b) => a.index - b.index)
        result.shotImages = shotImages
        runs.appendEvent(runId, 'shot-urls', { urls: shotImages })
        done(st)
      } catch (err) {
        runs.setStage(runId, st, 'failed')
        throw wrapBindingError(shotBinding, err)
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
      await ensureGate(st, '逐镜视频生成')
      const sb = readJson<{ shots: Array<{ index: number; durationSec?: number }> }>(runs, runId, 'storyboard')
      const ev = lastEvent(runs.get(runId)!.events, 'shot-urls')
      const shotUrls = (ev?.detail as { urls?: Array<{ index: number; url: string; file: string }> } | undefined)?.urls ?? result.shotImages
      const { binding: videoBinding, channel, provider: p } = resolveSlot('video')
      const canI2v = capabilityFlag(videoBinding, 'imageToVideo', true)
      const canT2v = capabilityFlag(videoBinding, 'textToVideo', false)
      // 模态决策：有参考图且声明 i2v → 图生视频；否则声明 t2v → 文生视频降级；两者皆无 → 明确失败
      const useI2v = canI2v && !!shotUrls?.length
      if (!useI2v && !canT2v) {
        throw bindingUnavailable(
          videoBinding,
          shotUrls?.length
            ? '未启用图生视频（imageToVideo 能力位未勾选）'
            : '缺少 shot 参考图且未启用文生视频降级（textToVideo 能力位未勾选）：请先完成 shot-assets 段，或在设置页「用途槽 → 视频」勾选',
        )
      }
      const maxDuration = typeof videoBinding.capabilities['maxDurationSec'] === 'number' ? videoBinding.capabilities['maxDurationSec']! : 10
      const clipsDir = join(runs.rootDir, runId, 'clips')
      mkdirSync(clipsDir, { recursive: true })
      const clipFiles: string[] = []
      try {
        begin(st)
        const jobs = useI2v
          ? (shotUrls ?? []).map((s) => ({ index: s.index, url: s.url as string | null }))
          : sb.shots.map((s) => ({ index: s.index, url: null as string | null }))
        await pump(jobs, deps.concurrency ?? 2, async (shot) => {
          const durationSec = Math.min(sb.shots.find((s) => s.index === shot.index)?.durationSec ?? 5, maxDuration)
          const est = deps.estimate(videoBinding)
          if (!(await deps.confirmer(est, 'video'))) throw new Error(`用户取消（shot ${shot.index}）`)
          const file = join(clipsDir, `shot-${String(shot.index).padStart(3, '0')}.mp4`)
          try {
            await generateShotClip({
              provider: p,
              fetchImpl,
              imageUrl: useI2v ? shot.url : undefined,
              prompt: SHOT_MOTION_PROMPT,
              durationSec,
              outFile: file,
              pollDelayMs: deps.pollDelayMs,
              onSubmit: (jobId) => {
                runs.appendEvent(runId, 'spend', { stage: st, model: videoBinding.model, estCny: est, shot: shot.index, jobId: jobId.slice(0, 80) })
                deps.recordSpend?.({ channel: channel.id, model: videoBinding.model, kind: 'video', estCny: est, jobId: jobId.slice(0, 80) })
              },
            })
          } catch (err) {
            if (isExplicitModelUnavailable(err) || err instanceof ModelUnavailableError) {
              throw wrapBindingError(videoBinding, err)
            }
            // 保留 shot 上下文前缀（原实现的判别性消息形态）
            throw new Error(`shot ${shot.index}: ${err instanceof Error ? err.message : String(err)}`)
          }
          clipFiles.push(file)
        }, ensureLive)
        clipFiles.sort()
        result.clipFiles = clipFiles
        runs.appendEvent(runId, 'clips', { files: clipFiles, mode: useI2v ? 'i2v' : 't2v' })
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
      const ttsBinding = deps.slots['tts']
      try {
        begin(st)
        const timelineShots: Array<{ video: string; durationUs: number; subtitle?: string; audio?: string; audioDurationUs?: number }> = []
        for (const shot of sb.shots) {
          const clip = join(clipsDir, `shot-${String(shot.index).padStart(3, '0')}.mp4`)
          if (!existsSync(clip)) throw new Error(`final-cut 缺少视频片段: ${clip}`)
          const durSec = (await probeDurationSec(clip, deps.ffmpeg)) ?? shot.durationSec ?? 5
          const text = shot.voiceHint ?? ''
          let voice = resolveVoice({ voiceFile: shot.voiceFile, voiceHint: text }, process.platform)
          let audio: string | undefined
          let audioDurUs: number | undefined
          if (deps.tts && text && voice?.kind !== 'file') {
            // 云端优先：失败回退本地（say/SAPI），事件留痕
            try {
              const mp3 = join(clipsDir, `voice-cloud-${shot.index}.mp3`)
              const bytes = await retryTransient(() => synthesizeCloudSpeech(deps.tts!, text, fetchImpl), 3, 3000)
              writeFileSync(mp3, bytes, { mode: 0o600 })
              audio = mp3
              audioDurUs = Math.round(((await probeDurationSec(mp3, deps.ffmpeg)) ?? 0) * 1e6)
              voice = null
            } catch (err) {
              if (isExplicitModelUnavailable(err)) {
                if (ttsBinding) throw bindingUnavailable(ttsBinding, err instanceof Error ? err.message : String(err))
              }
              runs.appendEvent(runId, 'tts-fallback', { shot: shot.index, reason: err instanceof Error ? err.message : String(err) })
              voice = resolveVoice({ voiceHint: text }, process.platform)
            }
          }
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
