import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STAGES } from '../src/stages.ts'
import { mergePromptLayers, buildCharacterSheetPrompt, buildScenePrompt, buildShotPrompt, GENERIC_NEGATIVE } from '../src/prompts.ts'

test('STAGES 七段常量：单一事实源（id 有序）', () => {
  assert.deepEqual(STAGES, ['story', 'script', 'storyboard', 'master-asset', 'shot-assets', 'video', 'final-cut'])
})

test('四层合并：dna+模板+手写顺序拼接为正向，injections 独立为负向', () => {
  const r = mergePromptLayers({
    dna: '赛博朋克，霓虹冷调',
    shotTemplate: '中景，缓慢推进',
    manual: '鲸鱼跃出海面',
    injections: ['模糊', '文字水印'],
  })
  assert.equal(r.positive, '赛博朋克，霓虹冷调，中景，缓慢推进，鲸鱼跃出海面')
  assert.equal(r.negative, '模糊，文字水印')
})

test('空层跳过；负向缺省给 GENERIC_NEGATIVE', () => {
  const r = mergePromptLayers({ manual: '一只鲸鱼' })
  assert.equal(r.positive, '一只鲸鱼')
  assert.ok(r.negative.includes('模糊'))
  assert.ok(GENERIC_NEGATIVE.length >= 5)
})

test('角色三视图模板：外观+风格注入，版式与一致性锁在位', () => {
  const p = buildCharacterSheetPrompt({ name: '林鲸', appearance: '蓝色皮肤的小鲸鱼，圆眼睛', style: '3d render, clean style' })
  assert.ok(p.positive.includes('林鲸'))
  assert.ok(p.positive.includes('蓝色皮肤的小鲸鱼'))
  assert.ok(p.positive.includes('三视图') || p.positive.includes('character sheet'))
  assert.ok(p.positive.includes('clean style'))
  assert.ok(p.negative.length > 0)
})

test('场景主图模板：无人物约束注入', () => {
  const p = buildScenePrompt({ name: '海面', description: '清晨的海面，波光粼粼', style: '3d render' })
  assert.ok(p.positive.includes('海面'))
  assert.ok(p.negative.includes('人物'))
})

test('单镜提示词：分镜行+角色锚定+景别运镜合层', () => {
  const p = buildShotPrompt({
    line: '鲸鱼跃出海面溅起水花',
    characterAnchors: ['林鲸（蓝色皮肤的小鲸鱼）'],
    camera: '中景，缓慢推进',
    style: '3d render, clean style',
    referenceHint: '参考图中的角色形象',
  })
  assert.ok(p.positive.includes('鲸鱼跃出海面'))
  assert.ok(p.positive.includes('林鲸（蓝色皮肤的小鲸鱼）'))
  assert.ok(p.positive.includes('中景，缓慢推进'))
  assert.ok(p.positive.includes('参考图中的角色形象'))
})
