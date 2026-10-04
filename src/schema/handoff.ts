/** LLM 三段交接 Schema：story / script / storyboard 手写校验器（零依赖，规格 §5）。 */

export class HandoffError extends Error {
  readonly code: 'bad-request' | 'not-found'

  constructor(code: 'bad-request' | 'not-found', message: string) {
    super(message)
    this.code = code
  }
}

export interface StoryCharacter {
  id: string
  name: string
  appearance: string
  voiceHint?: string
}

export interface Story {
  title: string
  logline: string
  style?: string
  characters: StoryCharacter[]
  chapters: string[]
}

export interface ScriptScene {
  id: string
  name: string
  description: string
  characters: string[]
}

export interface DialogLine {
  sceneId: string
  characterId: string
  line: string
}

export interface Script extends Story {
  /** 歌词（可选）：会话模型产出，段落标签体系；供 music.song（P2）与成片字幕。 */
  lyrics?: string
  scenes: ScriptScene[]
  dialog: DialogLine[]
}

export interface StoryboardShot {
  index: number
  line: string
  prompt: string
  characterIds: string[]
  sceneId?: string
  camera?: string
  durationSec: number
  voiceHint?: string
}

export interface Storyboard {
  shots: StoryboardShot[]
  characters: StoryCharacter[]
  scenes: ScriptScene[]
}

/* ── 长度/规模上限（防 LLM 失控产出撑爆落盘与提示词） ── */

const MAX = {
  title: 200,
  logline: 500,
  appearance: 500,
  name: 48,
  id: 48,
  chapters: 50,
  chapterLine: 200,
  characters: 20,
  scenes: 30,
  dialog: 200,
  shots: 200,
  line: 500,
  prompt: 4000,
  camera: 200,
  voiceHint: 200,
  sceneId: 48,
  characterId: 48,
} as const

const ID_RE = /^[a-z0-9_-]+$/

/** 歌词段落标签白名单（规格 §6.2，14 标签体系；校验大小写不敏感，允许 ≤16 字符序号/重复后缀如 [Verse 1]）。 */
export const LYRICS_SECTION_TAGS = [
  'Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Post-Chorus', 'Bridge', 'Hook',
  'Refrain', 'Interlude', 'Break', 'Instrumental', 'Solo', 'Drop', 'Outro',
] as const
const LYRICS_TAG_RE = new RegExp(`^\\[(${LYRICS_SECTION_TAGS.join('|')})[^\\]\\n]{0,16}]$`, 'i')

function fail(message: string): never {
  throw new HandoffError('bad-request', message)
}

function asRecord(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(`${path} 须为对象`)
  return v as Record<string, unknown>
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string' || !v.trim()) fail(`${path} 须为非空字符串`)
  return v
}

/** 非空字符串 + 长度上限（超限 fail 并报实际长度）。 */
function boundedStr(v: unknown, path: string, max: number): string {
  const s = str(v, path)
  if (s.length > max) fail(`${path} 长度超限：实际 ${s.length}，上限 ${max}`)
  return s
}

/** 角色引用 id：^[a-z0-9_-]+$ 格式 + ≤48。 */
function idStr(v: unknown, path: string): string {
  const s = boundedStr(v, path, MAX.id)
  if (!ID_RE.test(s)) fail(`${path} 须匹配 ^[a-z0-9_-]+$: ${s}`)
  return s
}

function strArray(v: unknown, path: string): string[] {
  if (!Array.isArray(v)) fail(`${path} 须为数组`)
  return v.map((x, i) => str(x, `${path}[${i}]`))
}

interface ParseCharactersOpts {
  requireNonEmpty: boolean
}

/** 角色表解析（story/script/storyboard 复用）：非空数组、逐条 {id,name,appearance}、id 格式 + 唯一。 */
function parseCharacters(raw: unknown, path: string, opts: ParseCharactersOpts): StoryCharacter[] {
  if (!Array.isArray(raw)) fail(`${path} 须为数组`)
  if (opts.requireNonEmpty && raw.length === 0) fail(`${path} 须为非空数组`)
  if (raw.length > MAX.characters) fail(`${path} 数量超限：实际 ${raw.length}，上限 ${MAX.characters}`)
  const characters = raw.map((c, i) => {
    const cr = asRecord(c, `${path}[${i}]`)
    const character: StoryCharacter = {
      id: idStr(cr['id'], `${path}[${i}].id`),
      name: boundedStr(cr['name'], `${path}[${i}].name`, MAX.name),
      appearance: boundedStr(cr['appearance'], `${path}[${i}].appearance`, MAX.appearance),
    }
    if (cr['voiceHint'] !== undefined) character.voiceHint = boundedStr(cr['voiceHint'], `${path}[${i}].voiceHint`, MAX.voiceHint)
    return character
  })
  const ids = new Set(characters.map((c) => c.id))
  if (ids.size !== characters.length) fail(`${path} 存在重复 id`)
  return characters
}

interface ParseScenesOpts {
  requireNonEmpty: boolean
}

/** 场景表解析（script/storyboard 复用）：逐条校验 + id 格式 + 唯一；storyboard 里允许整表缺省（不提供即 []）。 */
function parseScenes(raw: unknown, path: string, opts: ParseScenesOpts): ScriptScene[] {
  if (raw === undefined && !opts.requireNonEmpty) return []
  if (!Array.isArray(raw)) fail(`${path} 须为数组`)
  if (opts.requireNonEmpty && raw.length === 0) fail(`${path} 须为非空数组`)
  if (raw.length > MAX.scenes) fail(`${path} 数量超限：实际 ${raw.length}，上限 ${MAX.scenes}`)
  const scenes = raw.map((s, i) => {
    const sr = asRecord(s, `${path}[${i}]`)
    return {
      id: idStr(sr['id'], `${path}[${i}].id`),
      name: str(sr['name'], `${path}[${i}].name`),
      description: str(sr['description'], `${path}[${i}].description`),
      characters: strArray(sr['characters'], `${path}[${i}].characters`),
    }
  })
  const sceneIds = new Set(scenes.map((s) => s.id))
  if (sceneIds.size !== scenes.length) fail(`${path} 存在重复 id`)
  return scenes
}

export function validateStory(v: unknown, pathPrefix = 'story'): Story {
  const r = asRecord(v, pathPrefix)
  const characters = parseCharacters(r['characters'], `${pathPrefix}.characters`, { requireNonEmpty: true })
  const chapters = strArray(r['chapters'], `${pathPrefix}.chapters`)
  if (chapters.length > MAX.chapters) fail(`${pathPrefix}.chapters 数量超限：实际 ${chapters.length}，上限 ${MAX.chapters}`)
  return {
    title: boundedStr(r['title'], `${pathPrefix}.title`, MAX.title),
    logline: boundedStr(r['logline'], `${pathPrefix}.logline`, MAX.logline),
    ...(r['style'] !== undefined ? { style: boundedStr(r['style'], `${pathPrefix}.style`, MAX.prompt) } : {}),
    characters,
    chapters: chapters.map((c, i) => boundedStr(c, `${pathPrefix}.chapters[${i}]`, MAX.chapterLine)),
  }
}

export function validateScript(v: unknown): Script {
  const r = asRecord(v, 'script')
  const story = validateStory(r, 'script')
  const scenes = parseScenes(r['scenes'], 'script.scenes', { requireNonEmpty: true })
  const charIds = new Set(story.characters.map((c) => c.id))
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i]!
    for (const cid of s.characters) {
      if (!charIds.has(cid)) fail(`script.scenes[${i}].characters 引用不存在的 characterId: ${cid}`)
    }
  }
  const dialogRaw = r['dialog']
  if (!Array.isArray(dialogRaw)) fail('script.dialog 须为数组')
  if (dialogRaw.length > MAX.dialog) fail(`script.dialog 数量超限：实际 ${dialogRaw.length}，上限 ${MAX.dialog}`)
  const sceneIds = new Set(scenes.map((s) => s.id))
  const dialog = dialogRaw.map((d, i) => {
    const dr = asRecord(d, `script.dialog[${i}]`)
    const sceneId = boundedStr(dr['sceneId'], `script.dialog[${i}].sceneId`, MAX.sceneId)
    const characterId = boundedStr(dr['characterId'], `script.dialog[${i}].characterId`, MAX.characterId)
    if (!sceneIds.has(sceneId)) fail(`script.dialog[${i}].sceneId 引用不存在的场景: ${sceneId}`)
    if (!charIds.has(characterId)) fail(`script.dialog[${i}].characterId 引用不存在的角色: ${characterId}`)
    return { sceneId, characterId, line: boundedStr(dr['line'], `script.dialog[${i}].line`, MAX.line) }
  })
  // 歌词（可选，P1 §6.2）：会话模型产出，14 段落标签体系；非空字符串上限 20000；
  // 段落标签须来自白名单（大小写不敏感，可带序号/重复后缀），且至少一个标签
  const lyricsRaw = r['lyrics']
  let lyrics: string | undefined
  if (lyricsRaw !== undefined && lyricsRaw !== null && lyricsRaw !== '') {
    if (typeof lyricsRaw !== 'string') fail('script.lyrics 须为字符串')
    const trimmed = lyricsRaw.trim()
    if (trimmed.length > 20000) fail(`script.lyrics 超限：${trimmed.length} > 20000`)
    const tagLines = trimmed.split(/\r?\n/).filter((line) => /^\s*\[[^\]\n]{1,32}]\s*$/.test(line))
    if (tagLines.length === 0) {
      fail('script.lyrics 至少需要一个段落标签（[Intro]/[Verse]/[Chorus]/[Bridge]/[Outro]…，14 标签体系）')
    }
    for (const line of tagLines) {
      if (!LYRICS_TAG_RE.test(line.trim())) {
        fail(`script.lyrics 段落标签须为 14 标签体系（${LYRICS_SECTION_TAGS.join('/')}，可带序号/重复后缀）: ${line.trim().slice(0, 40)}`)
      }
    }
    lyrics = trimmed
  }
  return { ...story, scenes, dialog, ...(lyrics !== undefined ? { lyrics } : {}) }
}

export function validateStoryboard(v: unknown): Storyboard {
  const r = asRecord(v, 'storyboard')
  const shotsRaw = r['shots']
  if (!Array.isArray(shotsRaw) || shotsRaw.length === 0) fail('storyboard.shots 须为非空数组')
  if (shotsRaw.length > MAX.shots) fail(`storyboard.shots 数量超限：实际 ${shotsRaw.length}，上限 ${MAX.shots}`)
  const characters = parseCharacters(r['characters'], 'storyboard.characters', { requireNonEmpty: true })
  const scenes = parseScenes(r['scenes'], 'storyboard.scenes', { requireNonEmpty: false })
  const charIds = new Set(characters.map((c) => c.id))
  const sceneIds = new Set(scenes.map((s) => s.id))
  const validCharacterIds = characters.map((c) => c.id)
  const shots = shotsRaw.map((s, i) => {
    const sr = asRecord(s, `storyboard.shots[${i}]`)
    const index = Number(sr['index'])
    if (!Number.isInteger(index) || index !== i + 1) fail(`storyboard.shots[${i}].index 须为连续序号（从 1 开始），期望 ${i + 1}`)
    const durationSec = Number(sr['durationSec'])
    if (!Number.isFinite(durationSec) || durationSec < 2 || durationSec > 10) fail(`storyboard.shots[${i}].durationSec 须在 2..10`)
    // characterIds：数组或逗号/顿号分隔字符串（宽容形态——Agent 常见把 id 列表写成字符串）；
    // 未命中的引用依次尝试 大小写不敏感 id → 唯一角色名 映射；仍失败则报错并列出有效 id。
    const rawCids = sr['characterIds'] ?? []
    let characterIds: string[]
    if (typeof rawCids === 'string') {
      characterIds = rawCids.split(/[,，、\s]+/).map((s) => s.trim()).filter((s) => s.length > 0)
    } else if (Array.isArray(rawCids)) {
      characterIds = rawCids.map((x, j) => {
        if (typeof x !== 'string') fail(`storyboard.shots[${i}].characterIds[${j}] 须为字符串 id（有效 id：${validCharacterIds.join('、') || '（story 无角色）'}）`)
        return x
      })
    } else {
      fail(`storyboard.shots[${i}].characterIds 须为字符串 id 数组或逗号分隔字符串（有效 id：${validCharacterIds.join('、') || '（story 无角色）'}）`)
    }
    characterIds = characterIds.map((cid) => {
      if (cid.length > MAX.characterId) fail(`storyboard.shots[${i}].characterIds 引用 id 超长（上限 ${MAX.characterId}）: ${cid}`)
      if (charIds.has(cid)) return cid
      const caseHit = validCharacterIds.find((x) => x.toLowerCase() === cid.toLowerCase())
      if (caseHit !== undefined) return caseHit
      const nameHits = characters.filter((c) => c.name === cid)
      if (nameHits.length === 1) return nameHits[0]!.id
      fail(`storyboard.shots[${i}].characterIds 引用不存在的角色: ${cid}（有效 id：${validCharacterIds.join('、') || '（story 无角色）'}）`)
    })
    const sceneId = sr['sceneId'] === undefined ? undefined : boundedStr(sr['sceneId'], `storyboard.shots[${i}].sceneId`, MAX.sceneId)
    if (sceneId !== undefined && !sceneIds.has(sceneId)) fail(`storyboard.shots[${i}].sceneId 引用不存在的场景: ${sceneId}`)
    const shot: StoryboardShot = {
      index,
      line: boundedStr(sr['line'], `storyboard.shots[${i}].line`, MAX.line),
      prompt: boundedStr(sr['prompt'], `storyboard.shots[${i}].prompt`, MAX.prompt),
      characterIds,
      durationSec,
    }
    if (sceneId !== undefined) shot.sceneId = sceneId
    if (sr['camera'] !== undefined) shot.camera = boundedStr(sr['camera'], `storyboard.shots[${i}].camera`, MAX.camera)
    if (sr['voiceHint'] !== undefined) shot.voiceHint = boundedStr(sr['voiceHint'], `storyboard.shots[${i}].voiceHint`, MAX.voiceHint)
    return shot
  })
  return { shots, characters, scenes }
}
