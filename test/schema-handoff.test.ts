import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateStory, validateScript, validateStoryboard, HandoffError } from '../src/schema/handoff.ts'

const STORY = {
  title: '鲸鱼奇缘',
  logline: '小鲸鱼林鲸跨越大海寻找传说中的鲸群',
  style: '3d render, clean style',
  characters: [{ id: 'linjing', name: '林鲸', appearance: '蓝色皮肤的小鲸鱼，圆眼睛' }],
  chapters: ['第一幕：独自的海洋', '第二幕：风暴与相遇'],
}

test('validateStory：合法结构原样返回；缺字段报 HandoffError', () => {
  assert.equal(validateStory(STORY).title, '鲸鱼奇缘')
  assert.throws(() => validateStory({ title: 'x' }), HandoffError)
  assert.throws(() => validateStory(null), HandoffError)
})

const SCRIPT = {
  ...STORY,
  scenes: [
    { id: 's1', name: '清晨海面', description: '波光粼粼的海面', characters: ['linjing'] },
  ],
  dialog: [
    { sceneId: 's1', characterId: 'linjing', line: '今天也要游过这片海。' },
  ],
}

test('validateScript：场景/对白引用完整性（characterId/sceneId 必须存在）', () => {
  assert.equal(validateScript(SCRIPT).scenes.length, 1)
  assert.throws(() => validateScript({ ...SCRIPT, dialog: [{ sceneId: 's9', characterId: 'linjing', line: 'x' }] }), /sceneId/)
  assert.throws(() => validateScript({ ...SCRIPT, dialog: [{ sceneId: 's1', characterId: 'ghost', line: 'x' }] }), /characterId/)
})

const SHOT1 = { index: 1, line: '鲸鱼跃出海面', prompt: '鲸鱼跃出海面溅起水花', characterIds: ['linjing'], sceneId: 's1', camera: '中景，缓慢推进', durationSec: 5, voiceHint: '轻快旁白' }
const SHOT2 = { index: 2, line: '潜入深海', prompt: '鲸鱼潜入幽蓝深海', characterIds: [], sceneId: 's1', camera: '远景', durationSec: 4 }

test('validateStoryboard：index 连续/时长 2-10/引用存在', () => {
  const sb = validateStoryboard({ shots: [SHOT1, SHOT2], characters: STORY.characters, scenes: SCRIPT.scenes })
  assert.equal(sb.shots.length, 2)
  assert.throws(() => validateStoryboard({ shots: [{ ...SHOT1, index: 2 }, SHOT2], characters: STORY.characters, scenes: SCRIPT.scenes }), /index/)
  assert.throws(() => validateStoryboard({ shots: [{ ...SHOT1, durationSec: 30 }], characters: STORY.characters, scenes: SCRIPT.scenes }), /durationSec/)
  assert.throws(() => validateStoryboard({ shots: [{ ...SHOT1, characterIds: ['ghost'] }], characters: STORY.characters, scenes: SCRIPT.scenes }), /characterIds/)
})
