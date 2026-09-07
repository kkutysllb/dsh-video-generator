/** 四层提示词（规格 §5：dna/模板/手写顺序即权重；injections 负向）+ 移植鲸影模板精华。 */

export interface PromptLayers {
  dna?: string
  shotTemplate?: string
  manual?: string
  injections?: string[]
}

export interface MergedPrompt {
  positive: string
  negative: string
}

export const GENERIC_NEGATIVE = [
  '模糊', '低分辨率', '文字水印', 'logo', '多余肢体', '面部畸形', '画面割裂', '杂乱背景',
]

export const CHARACTER_NEGATIVE = [
  ...GENERIC_NEGATIVE,
  '视图融合', '面板间特征漂移', '风景背景污染',
]

const clean = (s: string | undefined): string => (s ?? '').trim()

/** 前三层顺序拼接（顺序即权重），injections 独立为负向（空则 GENERIC_NEGATIVE）。 */
export function mergePromptLayers(layers: PromptLayers): MergedPrompt {
  const positive = [clean(layers.dna), clean(layers.shotTemplate), clean(layers.manual)].filter(Boolean).join('，')
  const injections = layers.injections?.map(clean).filter(Boolean) ?? []
  const negative = (injections.length ? injections : GENERIC_NEGATIVE).join('，')
  return { positive, negative }
}

export interface CharacterSheetInput {
  name: string
  appearance: string
  style?: string
}

/** 角色三视图卡（一致性锚：版式 + 度量 + 一致性锁，移植鲸影 character-sheet 精华）。 */
export function buildCharacterSheetPrompt(input: CharacterSheetInput): MergedPrompt {
  const dna = clean(input.style)
  const shotTemplate = '角色三视图设定图，左区正脸特写，右区侧面/正面/背面三视图，角色高度为画面高度80%，全身可见，纯色浅灰背景，柔和均匀光照，细节一致'
  const manual = `${clean(input.name)}，${clean(input.appearance)}，同一角色在各视图中完全一致，面部特征一致，服装一致`
  return mergePromptLayers({ dna, shotTemplate, manual, injections: CHARACTER_NEGATIVE })
}

export interface SceneInput {
  name: string
  description: string
  style?: string
}

/** 场景主图（无人物入镜约束）。 */
export function buildScenePrompt(input: SceneInput): MergedPrompt {
  const dna = clean(input.style)
  const shotTemplate = '场景设定图，空镜，高细节，统一光照方向，景深自然'
  const manual = `${clean(input.name)}，${clean(input.description)}，画面中无人物`
  return mergePromptLayers({ dna, shotTemplate, manual, injections: [...GENERIC_NEGATIVE, '人物'] })
}

export interface ShotInput {
  line: string
  characterAnchors: string[]
  camera?: string
  style?: string
  referenceHint?: string
}

/** 单镜画面（分镜行 + 角色锚定 + 景别运镜 + 参考图提示）。 */
export function buildShotPrompt(input: ShotInput): MergedPrompt {
  const dna = clean(input.style)
  const shotTemplate = clean(input.camera)
  const anchors = input.characterAnchors.length ? `角色：${input.characterAnchors.join('、')}` : ''
  const ref = clean(input.referenceHint) ? '画面严格参考参考图中的角色形象与风格' : ''
  const manual = [clean(input.line), anchors, ref].filter(Boolean).join('，')
  return mergePromptLayers({ dna, shotTemplate, manual })
}
