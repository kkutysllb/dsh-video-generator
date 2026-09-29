/** 内置音乐映射模板（规格 §4.2）：按**协议形态**命名，不是 provider 预设。
 *  纯数据——不含 baseUrl/apiKey/模型名/provider 名；仅作设置页表单初始值，
 *  套用后仍须「测试」真实验证。用户另存的模板落 vault（source=user）。
 */

import type { MusicTemplate } from '../store/slots.ts'

export const BUILTIN_MUSIC_TEMPLATES: readonly MusicTemplate[] = [
  {
    id: 'builtin/sync-audio-url',
    label: '同步 · 直返音频 URL',
    source: 'builtin',
    note: '一次 POST 直接返回音频地址：提交响应里按 audioPath 取 URL。',
    fields: {
      endpoint: { path: '/v1/audio/music', method: 'POST' },
      mode: 'sync',
      request: { promptField: 'prompt', instrumentalField: 'instrumental', durationField: 'duration' },
      response: { audioPath: 'data.audio_url' },
    },
  },
  {
    id: 'builtin/sync-audio-b64',
    label: '同步 · 直返 base64 音频',
    source: 'builtin',
    note: '提交响应直接携带 base64 音频内容（audioIsBase64 开启）。',
    fields: {
      endpoint: { path: '/v1/music/generate', method: 'POST' },
      mode: 'sync',
      request: { promptField: 'prompt', lyricsField: 'lyrics' },
      response: { audioPath: 'data.audio_base64', audioIsBase64: true },
    },
  },
  {
    id: 'builtin/async-task-poll',
    label: '异步 · 任务轮询',
    source: 'builtin',
    note: '提交返回任务 id → 轮询 statusPath（{id} 占位）→ 完成后从轮询响应取音频地址。',
    fields: {
      endpoint: { path: '/v1/music/tasks', method: 'POST', statusPath: '/v1/music/tasks/{id}' },
      mode: 'async',
      request: { promptField: 'prompt', instrumentalField: 'is_instrumental' },
      response: {
        audioPath: 'data.audio_url',
        jobIdPath: 'data.id',
        statusValuePath: 'data.status',
        doneValues: ['completed', 'succeeded'],
        failedValues: ['failed', 'cancelled'],
        pollIntervalMs: 3000,
      },
    },
  },
  {
    id: 'builtin/async-with-sections',
    label: '异步 · 任务轮询 + 段落时间戳',
    source: 'builtin',
    note: '同「异步 · 任务轮询」，且轮询响应带段落时间戳（MV 对点可直用，免本地分析）。',
    fields: {
      endpoint: { path: '/v1/music/generations', method: 'POST', statusPath: '/v1/music/generations/{id}' },
      mode: 'async',
      request: { promptField: 'prompt', lyricsField: 'lyrics', durationField: 'duration' },
      response: {
        audioPath: 'data.audio.url',
        jobIdPath: 'data.task_id',
        statusValuePath: 'data.state',
        doneValues: ['success', 'completed'],
        sectionsPath: 'data.sections',
        sectionsStartField: 'start',
        sectionsEndField: 'end',
        sectionsLabelField: 'label',
        pollIntervalMs: 3000,
      },
    },
  },
]
