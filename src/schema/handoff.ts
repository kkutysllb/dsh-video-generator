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

function strArray(v: unknown, path: string): string[] {
  if (!Array.isArray(v)) fail(`${path} 须为数组`)
  return v.map((x, i) => str(x, `${path}[${i}]`))
}

export function validateStory(v: unknown): Story {
  const r = asRecord(v, 'story')
  const charactersRaw = r['characters']
  if (!Array.isArray(charactersRaw) || charactersRaw.length === 0) fail('story.characters 须为非空数组')
  const characters = charactersRaw.map((c, i) => {
    const cr = asRecord(c, `story.characters[${i}]`)
    return {
      id: str(cr['id'], `story.characters[${i}].id`),
      name: str(cr['name'], `story.characters[${i}].name`),
      appearance: str(cr['appearance'], `story.characters[${i}].appearance`),
      ...(cr['voiceHint'] !== undefined ? { voiceHint: str(cr['voiceHint'], `story.characters[${i}].voiceHint`) } : {}),
    }
  })
  const ids = new Set(characters.map((c) => c.id))
  if (ids.size !== characters.length) fail('story.characters 存在重复 id')
  return {
    title: str(r['title'], 'story.title'),
    logline: str(r['logline'], 'story.logline'),
    ...(r['style'] !== undefined ? { style: str(r['style'], 'story.style') } : {}),
    characters,
    chapters: strArray(r['chapters'], 'story.chapters'),
  }
}

export function validateScript(v: unknown): Script {
  const r = asRecord(v, 'script')
  const story = validateStory(r)
  const scenesRaw = r['scenes']
  if (!Array.isArray(scenesRaw) || scenesRaw.length === 0) fail('script.scenes 须为非空数组')
  const scenes = scenesRaw.map((s, i) => {
    const sr = asRecord(s, `script.scenes[${i}]`)
    return {
      id: str(sr['id'], `script.scenes[${i}].id`),
      name: str(sr['name'], `script.scenes[${i}].name`),
      description: str(sr['description'], `script.scenes[${i}].description`),
      characters: strArray(sr['characters'], `script.scenes[${i}].characters`),
    }
  })
  const sceneIds = new Set(scenes.map((s) => s.id))
  if (sceneIds.size !== scenes.length) fail('script.scenes 存在重复 id')
  const charIds = new Set(story.characters.map((c) => c.id))
  for (const s of scenes) {
    for (const cid of s.characters) {
      if (!charIds.has(cid)) fail(`script.scenes[${s.id}].characters 引用不存在的 characterId: ${cid}`)
    }
  }
  const dialogRaw = r['dialog']
  if (!Array.isArray(dialogRaw)) fail('script.dialog 须为数组')
  const dialog = dialogRaw.map((d, i) => {
    const dr = asRecord(d, `script.dialog[${i}]`)
    const sceneId = str(dr['sceneId'], `script.dialog[${i}].sceneId`)
    const characterId = str(dr['characterId'], `script.dialog[${i}].characterId`)
    if (!sceneIds.has(sceneId)) fail(`script.dialog[${i}].sceneId 引用不存在的场景: ${sceneId}`)
    if (!charIds.has(characterId)) fail(`script.dialog[${i}].characterId 引用不存在的角色: ${characterId}`)
    return { sceneId, characterId, line: str(dr['line'], `script.dialog[${i}].line`) }
  })
  return { ...story, scenes, dialog }
}

export function validateStoryboard(v: unknown): Storyboard {
  const r = asRecord(v, 'storyboard')
  const shotsRaw = r['shots']
  if (!Array.isArray(shotsRaw) || shotsRaw.length === 0) fail('storyboard.shots 须为非空数组')
  const charIds = new Set(Array.isArray(r['characters']) ? (r['characters'] as Array<Record<string, unknown>>).map((c) => c['id']) : [])
  const sceneIds = new Set(Array.isArray(r['scenes']) ? (r['scenes'] as Array<Record<string, unknown>>).map((s) => s['id']) : [])
  const shots = shotsRaw.map((s, i) => {
    const sr = asRecord(s, `storyboard.shots[${i}]`)
    const index = Number(sr['index'])
    if (!Number.isInteger(index) || index !== i + 1) fail(`storyboard.shots[${i}].index 须为连续序号（从 1 开始），期望 ${i + 1}`)
    const durationSec = Number(sr['durationSec'])
    if (!Number.isFinite(durationSec) || durationSec < 2 || durationSec > 10) fail(`storyboard.shots[${i}].durationSec 须在 2..10`)
    const characterIds = strArray(sr['characterIds'] ?? [], `storyboard.shots[${i}].characterIds`)
    for (const cid of characterIds) {
      if (!charIds.has(cid)) fail(`storyboard.shots[${i}].characterIds 引用不存在的角色: ${cid}`)
    }
    const sceneId = sr['sceneId'] === undefined ? undefined : str(sr['sceneId'], `storyboard.shots[${i}].sceneId`)
    if (sceneId !== undefined && !sceneIds.has(sceneId)) fail(`storyboard.shots[${i}].sceneId 引用不存在的场景: ${sceneId}`)
    const shot: StoryboardShot = {
      index,
      line: str(sr['line'], `storyboard.shots[${i}].line`),
      prompt: str(sr['prompt'], `storyboard.shots[${i}].prompt`),
      characterIds,
      durationSec,
    }
    if (sceneId !== undefined) shot.sceneId = sceneId
    if (sr['camera'] !== undefined) shot.camera = str(sr['camera'], `storyboard.shots[${i}].camera`)
    if (sr['voiceHint'] !== undefined) shot.voiceHint = str(sr['voiceHint'], `storyboard.shots[${i}].voiceHint`)
    return shot
  })
  return {
    shots,
    characters: (r['characters'] ?? []) as unknown as StoryCharacter[],
    scenes: (r['scenes'] ?? []) as unknown as ScriptScene[],
  }
}
