/** machine/工具测试共用 schema 夹具（文件名不含 .test.，不会被 node --test 执行）。 */

export const STORY = {
  title: '鲸鱼奇缘',
  logline: '小鲸鱼林鲸跨越大海寻找传说中的鲸群',
  style: '3d render, clean style',
  characters: [{ id: 'linjing', name: '林鲸', appearance: '蓝色皮肤的小鲸鱼，圆眼睛' }],
  chapters: ['第一幕：独自的海洋', '第二幕：风暴与相遇'],
}

export const SCRIPT = {
  ...STORY,
  scenes: [{ id: 's1', name: '清晨海面', description: '波光粼粼的海面', characters: ['linjing'] }],
  dialog: [{ sceneId: 's1', characterId: 'linjing', line: '今天也要游过这片海。' }],
}

export const SHOTS = {
  shots: [
    { index: 1, line: '鲸鱼跃出海面', prompt: '鲸鱼跃出海面溅起水花', characterIds: ['linjing'], sceneId: 's1', camera: '中景，缓慢推进', durationSec: 5, voiceHint: '在辽阔的海面上，小鲸鱼纵身一跃。' },
    { index: 2, line: '空中定格', prompt: '鲸鱼在空中定格，水珠飞溅', characterIds: ['linjing'], sceneId: 's1', camera: '特写，慢动作', durationSec: 5, voiceHint: '这一刻，时间仿佛静止。' },
    { index: 3, line: '潜入深海', prompt: '鲸鱼潜入幽蓝深海，气泡上升', characterIds: ['linjing'], sceneId: 's1', camera: '远景，下沉', durationSec: 5, voiceHint: '然后，它回到深海的怀抱。' },
  ],
}
