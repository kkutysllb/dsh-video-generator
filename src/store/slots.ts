/** 用途槽（Use-Slot）单一事实源：槽位词汇表、能力位白名单、通用音乐映射与纯函数校验
 *  （规格 2026-09-28 §2）。vault.ts 依赖本模块做形状守卫；Host 与客户端共用同一份
 *  槽位元数据（SLOT_META），杜绝"双份实现漂移"。
 *
 *  核心设计约束：`slots` 在 vault 中是 `SlotId → 单条 SlotBinding` 映射——
 *  结构上无法表达第二候选，"多模型轮询/自动兜底"由此在类型层被排除。
 */

export type SlotId = 'image.master' | 'image.shot' | 'video' | 'tts' | 'music.bgm' | 'music.song'

export const SLOT_IDS: readonly SlotId[] = ['image.master', 'image.shot', 'video', 'tts', 'music.bgm', 'music.song']

export function isSlotId(v: unknown): v is SlotId {
  return typeof v === 'string' && (SLOT_IDS as readonly string[]).includes(v)
}

export type SlotKind = 'image' | 'video' | 'tts' | 'music'

/** 协议族：适配器与协议一一对应；绑定级声明（同一中转站可同时提供多族协议）。 */
export type ProtocolFamily =
  | 'openai-images'      // POST {base}/v1/images/generations
  | 'openai-tts'         // POST {base}/v1/audio/speech
  | 'dashscope-video'    // DashScope 原生异步透传（wan/happyhorse 系）
  | 'kling-video'        // kling-compat 原生
  | 'openai-video'       // 通用异步视频任务（/v1/videos 系）
  | 'generic-music'      // 声明式映射（本模块 GenericMusicMapping）

export const PROTOCOL_FAMILIES: readonly ProtocolFamily[] = [
  'openai-images', 'openai-tts', 'dashscope-video', 'kling-video', 'openai-video', 'generic-music',
]

export function isProtocolFamily(v: unknown): v is ProtocolFamily {
  return typeof v === 'string' && (PROTOCOL_FAMILIES as readonly string[]).includes(v)
}

export type CapabilityValue = boolean | number | string

/** 每槽允许的能力位白名单（键 → 值类型）。白名单外的键在守卫时丢弃。 */
const CAPABILITY_KEYS: Record<SlotId, Record<string, 'boolean' | 'number' | 'string'>> = {
  'image.master': { sizeParam: 'boolean' },
  'image.shot': { referenceImage: 'boolean' },
  video: { imageToVideo: 'boolean', textToVideo: 'boolean', maxDurationSec: 'number' },
  tts: { voice: 'string', instructions: 'string' },
  'music.bgm': { instrumental: 'boolean', loopable: 'boolean', durationControl: 'boolean', maxDurationSec: 'number' },
  'music.song': { vocals: 'boolean', lyricsInput: 'boolean', referenceAudio: 'boolean', returnsSections: 'boolean', maxDurationSec: 'number' },
}

/** 写入时归一化的能力位缺省（显式落库，UI 展示与运行时读取同源）。 */
const CAPABILITY_DEFAULTS: Record<SlotId, Record<string, CapabilityValue>> = {
  'image.master': { sizeParam: true },
  'image.shot': { referenceImage: true },
  video: { imageToVideo: true, textToVideo: false, maxDurationSec: 10 },
  tts: {},
  'music.bgm': { instrumental: true, loopable: true, durationControl: true },
  'music.song': { vocals: true, lyricsInput: true },
}

/** 通用音乐映射（声明式端点，零 provider 绑定）：必填 4 项 = endpoint.path /
 *  request.promptField / response.audioPath / mode；async 模式另需 endpoint.statusPath
 *  （可含 {id} 占位符）+ response.jobIdPath。 */
export interface GenericMusicMapping {
  endpoint: {
    path: string
    method?: 'POST'
    /** async 轮询 URL 模板，`{id}` 会替换为提交返回的任务 id，如 '/v1/music/tasks/{id}'。 */
    statusPath?: string
  }
  mode: 'sync' | 'async'
  request: {
    promptField: string
    lyricsField?: string
    instrumentalField?: string
    durationField?: string
    referenceAudioField?: string
    extra?: Record<string, unknown>
  }
  response: {
    /** 音频取值路径（sync：提交响应；async：轮询响应），如 'data.audio_url' 或 'data[0].url'。 */
    audioPath: string
    /** async 必填：提交响应里的任务 id 路径。 */
    jobIdPath?: string
    /** async 必填：轮询响应里的状态值路径（缺省按 'status' 读）。 */
    statusValuePath?: string
    doneValues?: string[]
    failedValues?: string[]
    pollIntervalMs?: number
    audioIsBase64?: boolean
    urlIsSigned?: boolean
    durationPath?: string
    /** MV 对点：API 返回段落/时间戳时填写（多数家不返回 → 走本地分析）。 */
    sectionsPath?: string
    sectionsStartField?: string
    sectionsEndField?: string
    sectionsLabelField?: string
  }
}

export interface SlotBinding {
  slot: SlotId
  channelId: string
  model: string
  protocol: ProtocolFamily
  capabilities: Record<string, CapabilityValue>
  music?: GenericMusicMapping
  verifiedAt?: string
  verifyNote?: string
}

export interface MusicTemplate {
  id: string
  label: string
  source: 'builtin' | 'user'
  fields: GenericMusicMapping
  note?: string
}

export interface SlotMeta {
  slot: SlotId
  kind: SlotKind
  label: string
  purpose: string
  required: boolean
  consumer: string
}

/** 槽位元数据（Host 错误文案与客户端渲染共用）。 */
export const SLOT_META: Record<SlotId, SlotMeta> = {
  'image.master': { slot: 'image.master', kind: 'image', label: '主图', purpose: '角色三视图卡与场景主图（文生图）', required: true, consumer: 'master-asset 段' },
  'image.shot': { slot: 'image.shot', kind: 'image', label: '逐镜图', purpose: '逐镜参考图（可参考主图，图生图）', required: true, consumer: 'shot-assets 段（未绑定时回落主图槽）' },
  video: { slot: 'video', kind: 'video', label: '视频', purpose: '逐镜图生视频（可勾选文生视频降级）', required: true, consumer: 'video 段与评审重拍' },
  tts: { slot: 'tts', kind: 'tts', label: '配音', purpose: '旁白语音合成（缺省回退本地 say/SAPI）', required: false, consumer: 'final-cut 段' },
  'music.bgm': { slot: 'music.bgm', kind: 'music', label: 'BGM', purpose: '纯器乐垫底（循环补长 + ducking）', required: false, consumer: 'music 段（P1 接线）' },
  'music.song': { slot: 'music.song', kind: 'music', label: 'MV 主曲', purpose: '带人声整曲（吃歌词，MV 模式先曲后镜）', required: false, consumer: 'music 段 MV 模式（P2 接线）' },
}

/** 未绑定槽被消费时的统一错误文案（含槽位名与指引；spec 验收 2）。 */
export function slotUnavailableMessage(slot: SlotId): string {
  const meta = SLOT_META[slot]
  return `用途槽「${meta.label}」(${slot}) 未绑定模型：请在设置页「漫剧工坊 → 用途槽」为${meta.consumer}配置模型后重试`
}

function limitedString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (s.length === 0 || s.length > max) return null
  return s
}

/** 能力位归一化：白名单过滤 + 类型校正 + 缺省补齐（显式落库）。 */
export function sanitizeCapabilities(slot: SlotId, raw: unknown): Record<string, CapabilityValue> {
  const out: Record<string, CapabilityValue> = {}
  const defaults = CAPABILITY_DEFAULTS[slot] ?? {}
  for (const [k, v] of Object.entries(defaults)) out[k] = v
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  const schema = CAPABILITY_KEYS[slot]
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const type = schema[k]
    if (!type) continue
    if (type === 'boolean') out[k] = Boolean(v)
    else if (type === 'number') {
      const n = Number(v)
      if (Number.isFinite(n) && n >= 0) out[k] = n
    } else {
      const s = typeof v === 'string' ? v.trim().slice(0, 500) : ''
      if (s) out[k] = s
    }
  }
  return out
}

function boundedPath(v: unknown): string | null {
  const s = limitedString(v, 200)
  // 路径求值器只认 点号 + [n] 下标；含空白/查询串的写法直接拒绝（防误配成完整 URL）
  if (s === null || /\s/.test(s) || s.includes('?') || s.includes('://')) return null
  return s
}

/** 通用音乐映射守卫：缺任一必填 → null（整条绑定按缺必填丢弃）。 */
export function sanitizeMusicMapping(raw: unknown): GenericMusicMapping | null {
  if (typeof raw !== 'object' || raw === null) return null
  const m = raw as Record<string, unknown>
  const endpointRaw = (typeof m.endpoint === 'object' && m.endpoint !== null ? m.endpoint : {}) as Record<string, unknown>
  const requestRaw = (typeof m.request === 'object' && m.request !== null ? m.request : {}) as Record<string, unknown>
  const responseRaw = (typeof m.response === 'object' && m.response !== null ? m.response : {}) as Record<string, unknown>
  const path = boundedPath(endpointRaw.path)
  const promptField = limitedString(requestRaw.promptField, 100)
  const audioPath = boundedPath(responseRaw.audioPath)
  const mode = m.mode === 'async' ? 'async' : m.mode === 'sync' ? 'sync' : null
  if (!path || !promptField || !audioPath || mode === null) return null
  const out: GenericMusicMapping = {
    endpoint: { path },
    mode,
    request: { promptField },
    response: { audioPath },
  }
  if (endpointRaw.method === 'POST') out.endpoint.method = 'POST'
  const statusEndpoint = boundedPath(endpointRaw.statusPath)
  if (statusEndpoint) out.endpoint.statusPath = statusEndpoint
  const optReq = out.request
  const lyricsField = limitedString(requestRaw.lyricsField, 100)
  if (lyricsField) optReq.lyricsField = lyricsField
  const instrumentalField = limitedString(requestRaw.instrumentalField, 100)
  if (instrumentalField) optReq.instrumentalField = instrumentalField
  const durationField = limitedString(requestRaw.durationField, 100)
  if (durationField) optReq.durationField = durationField
  const referenceAudioField = limitedString(requestRaw.referenceAudioField, 100)
  if (referenceAudioField) optReq.referenceAudioField = referenceAudioField
  if (typeof requestRaw.extra === 'object' && requestRaw.extra !== null && !Array.isArray(requestRaw.extra)) {
    out.request.extra = requestRaw.extra as Record<string, unknown>
  }
  const res = out.response
  if (mode === 'async') {
    // async 契约闭环：轮询 URL + 任务 id 路径缺一不可（否则任务永远查不到状态）
    const jobIdPath = boundedPath(responseRaw.jobIdPath)
    if (!statusEndpoint || !jobIdPath) return null
    res.jobIdPath = jobIdPath
    const statusValuePath = boundedPath(responseRaw.statusValuePath)
    res.statusValuePath = statusValuePath ?? 'status'
    const done = Array.isArray(responseRaw.doneValues)
      ? responseRaw.doneValues.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(0, 10)
      : []
    res.doneValues = done.length > 0 ? done : ['completed', 'succeeded', 'done', 'success']
    if (Array.isArray(responseRaw.failedValues)) {
      const failed = responseRaw.failedValues.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(0, 10)
      if (failed.length > 0) res.failedValues = failed
    }
    if (typeof responseRaw.pollIntervalMs === 'number' && Number.isFinite(responseRaw.pollIntervalMs) && responseRaw.pollIntervalMs >= 200) {
      res.pollIntervalMs = Math.min(60_000, Math.round(responseRaw.pollIntervalMs))
    }
  } else if (Array.isArray(responseRaw.doneValues) || responseRaw.statusValuePath !== undefined || responseRaw.jobIdPath !== undefined) {
    // sync 模式带 async 专属字段 = 配置矛盾，按缺必填丢弃
    return null
  }
  if (responseRaw.audioIsBase64 === true) res.audioIsBase64 = true
  if (responseRaw.urlIsSigned === true) res.urlIsSigned = true
  const durationPath = boundedPath(responseRaw.durationPath)
  if (durationPath) res.durationPath = durationPath
  const sectionsPath = boundedPath(responseRaw.sectionsPath)
  if (sectionsPath) res.sectionsPath = sectionsPath
  const sStart = limitedString(responseRaw.sectionsStartField, 100)
  if (sStart) res.sectionsStartField = sStart
  const sEnd = limitedString(responseRaw.sectionsEndField, 100)
  if (sEnd) res.sectionsEndField = sEnd
  const sLabel = limitedString(responseRaw.sectionsLabelField, 100)
  if (sLabel) res.sectionsLabelField = sLabel
  return out
}

/** 槽位绑定守卫：缺必填/非法协议/music 映射错位 → null（调用方整条丢弃，spec §2.1）。 */
export function parseSlotBinding(slot: SlotId, raw: unknown): SlotBinding | null {
  if (typeof raw !== 'object' || raw === null) return null
  const b = raw as Record<string, unknown>
  const channelId = limitedString(b.channelId, 64)
  const model = limitedString(b.model, 200)
  if (!channelId || !model) return null
  if (!isProtocolFamily(b.protocol)) return null
  const protocol = b.protocol
  // music 槽必须走 generic-music 且带映射；非 music 槽禁止 generic-music（契约错位直接拒绝）
  const isMusic = slot === 'music.bgm' || slot === 'music.song'
  if (isMusic !== (protocol === 'generic-music')) return null
  const binding: SlotBinding = {
    slot,
    channelId,
    model,
    protocol,
    capabilities: sanitizeCapabilities(slot, b.capabilities),
  }
  if (isMusic) {
    const music = sanitizeMusicMapping(b.music)
    if (!music) return null
    binding.music = music
  }
  const verifiedAt = limitedString(b.verifiedAt, 40)
  if (verifiedAt) binding.verifiedAt = verifiedAt
  const verifyNote = limitedString(b.verifyNote, 500)
  if (verifyNote) binding.verifyNote = verifyNote
  return binding
}

/** 音乐模板守卫：label 必填；fields 走同一映射守卫；source 只认 builtin|user。 */
export function parseMusicTemplate(raw: unknown): MusicTemplate | null {
  if (typeof raw !== 'object' || raw === null) return null
  const t = raw as Record<string, unknown>
  const label = limitedString(t.label, 80)
  if (!label) return null
  const fields = sanitizeMusicMapping(t.fields)
  if (!fields) return null
  const source = t.source === 'builtin' ? 'builtin' : 'user'
  const id = limitedString(t.id, 64)
  if (!id) return null
  const out: MusicTemplate = { id, label, source, fields }
  const note = limitedString(t.note, 300)
  if (note) out.note = note
  return out
}

/** 读侧便捷：能力位取值（带缺省）。 */
export function capabilityOf(binding: SlotBinding, key: string): CapabilityValue | undefined {
  return binding.capabilities[key]
}

export function capabilityFlag(binding: SlotBinding, key: string, fallback = false): boolean {
  const v = binding.capabilities[key]
  return typeof v === 'boolean' ? v : fallback
}
