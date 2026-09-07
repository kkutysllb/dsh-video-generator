/** 七段词汇表单一事实源（修 M2 审查遗留：stage 自由字符串散落）。 */

export const STAGES = ['story', 'script', 'storyboard', 'master-asset', 'shot-assets', 'video', 'final-cut'] as const

export type StageId = (typeof STAGES)[number]

export function isStage(s: string): s is StageId {
  return (STAGES as readonly string[]).includes(s)
}
