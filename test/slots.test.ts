/** slots.ts 纯函数单测（规格 2026-09-28 §2）：绑定守卫 / 能力位白名单 / 通用音乐映射守卫。 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isProtocolFamily, isSlotId, parseSlotBinding, sanitizeCapabilities,
  sanitizeMusicMapping, slotUnavailableMessage,
} from '../src/store/slots.ts'

const SYNC_MUSIC = {
  endpoint: { path: '/v1/audio/music', method: 'POST' },
  mode: 'sync',
  request: { promptField: 'prompt', instrumentalField: 'instrumental', durationField: 'duration' },
  response: { audioPath: 'data.audio_url' },
}

test('parseSlotBinding 六槽 happy path：能力缺省显式落库（写入即含全部缺省键）', () => {
  const master = parseSlotBinding('image.master', { channelId: 'ch-1', model: 'img-1', protocol: 'openai-images' })
  assert.ok(master)
  assert.equal(master.slot, 'image.master')
  assert.equal(master.channelId, 'ch-1')
  assert.equal(master.model, 'img-1')
  assert.equal(master.protocol, 'openai-images')
  assert.deepEqual(master.capabilities, { sizeParam: true })

  const shot = parseSlotBinding('image.shot', { channelId: 'ch-1', model: 'img-1', protocol: 'openai-images' })
  assert.ok(shot)
  assert.deepEqual(shot.capabilities, { referenceImage: true })

  const video = parseSlotBinding('video', { channelId: 'ch-1', model: 'vid-1', protocol: 'dashscope-video' })
  assert.ok(video)
  assert.deepEqual(video.capabilities, { imageToVideo: true, textToVideo: false, maxDurationSec: 10 })

  const tts = parseSlotBinding('tts', { channelId: 'ch-1', model: 'tts-1', protocol: 'openai-tts' })
  assert.ok(tts)
  assert.deepEqual(tts.capabilities, {})

  const bgm = parseSlotBinding('music.bgm', { channelId: 'ch-1', model: 'music-1', protocol: 'generic-music', music: SYNC_MUSIC })
  assert.ok(bgm)
  assert.deepEqual(bgm.capabilities, { instrumental: true, loopable: true, durationControl: true })
  assert.ok(bgm.music)
  assert.equal(bgm.music.endpoint.path, '/v1/audio/music')
  assert.equal(bgm.music.mode, 'sync')
  assert.deepEqual(bgm.music.response, { audioPath: 'data.audio_url' })

  const song = parseSlotBinding('music.song', { channelId: 'ch-1', model: 'music-2', protocol: 'generic-music', music: SYNC_MUSIC })
  assert.ok(song)
  assert.deepEqual(song.capabilities, { vocals: true, lyricsInput: true })
  assert.ok(song.music)
})

test('parseSlotBinding 能力覆盖 + verifiedAt/verifyNote 透传（超长丢弃、trim）', () => {
  const video = parseSlotBinding('video', {
    channelId: 'ch-1', model: 'vid-1', protocol: 'kling-video',
    capabilities: { textToVideo: true, maxDurationSec: 5 },
  })
  assert.ok(video)
  assert.deepEqual(video.capabilities, { imageToVideo: true, textToVideo: true, maxDurationSec: 5 })

  const noted = parseSlotBinding('tts', {
    channelId: 'ch-1', model: 'tts-1', protocol: 'openai-tts',
    verifiedAt: '  2026-09-28T00:00:00.000Z  ', verifyNote: '实测 200',
  })
  assert.ok(noted)
  assert.equal(noted.verifiedAt, '2026-09-28T00:00:00.000Z')
  assert.equal(noted.verifyNote, '实测 200')

  const over = parseSlotBinding('tts', {
    channelId: 'ch-1', model: 'tts-1', protocol: 'openai-tts',
    verifiedAt: 'v'.repeat(41), verifyNote: 'n'.repeat(501),
  })
  assert.ok(over)
  assert.equal(over.verifiedAt, undefined)
  assert.equal(over.verifyNote, undefined)
})

test('parseSlotBinding 非法输入整条丢弃（返回 null）', () => {
  // 缺 channelId / model
  assert.equal(parseSlotBinding('video', { model: 'v', protocol: 'kling-video' }), null)
  assert.equal(parseSlotBinding('video', { channelId: 'ch-1', protocol: 'kling-video' }), null)
  assert.equal(parseSlotBinding('video', 'not-an-object'), null)
  // 非法协议（不在白名单）
  assert.equal(parseSlotBinding('video', { channelId: 'ch-1', model: 'v', protocol: 'minimax-video' }), null)
  assert.equal(parseSlotBinding('video', { channelId: 'ch-1', model: 'v', protocol: 42 }), null)
  // 协议与槽位错位：非 music 槽禁止 generic-music；music 槽必须 generic-music
  assert.equal(parseSlotBinding('video', { channelId: 'ch-1', model: 'v', protocol: 'generic-music' }), null)
  assert.equal(parseSlotBinding('tts', { channelId: 'ch-1', model: 't', protocol: 'generic-music', music: SYNC_MUSIC }), null)
  // music 槽缺映射 / 映射不完整
  assert.equal(parseSlotBinding('music.bgm', { channelId: 'ch-1', model: 'm', protocol: 'generic-music' }), null)
  assert.equal(parseSlotBinding('music.bgm', { channelId: 'ch-1', model: 'm', protocol: 'generic-music', music: { mode: 'sync' } }), null)
  // 超长字段
  assert.equal(parseSlotBinding('video', { channelId: 'c'.repeat(65), model: 'v', protocol: 'kling-video' }), null)
  assert.equal(parseSlotBinding('video', { channelId: 'ch-1', model: 'm'.repeat(201), protocol: 'kling-video' }), null)
})

test('sanitizeCapabilities：白名单外键丢弃 + 类型校正（负数丢弃、字符串 trim 且截 500）', () => {
  // 白名单外键丢弃
  const video = sanitizeCapabilities('video', { imageToVideo: true, noise: 'x', model: 'hack' })
  assert.deepEqual(Object.keys(video).sort(), ['imageToVideo', 'maxDurationSec', 'textToVideo'])
  assert.equal(video['noise'], undefined)

  // boolean 强转：真值字符串 → true，0 → false
  assert.equal(sanitizeCapabilities('video', { imageToVideo: 'yes' })['imageToVideo'], true)
  assert.equal(sanitizeCapabilities('video', { textToVideo: 0 })['textToVideo'], false)

  // number：数值字符串强转、负数/非有限丢弃（回落缺省 10）
  assert.equal(sanitizeCapabilities('video', { maxDurationSec: '8' })['maxDurationSec'], 8)
  assert.equal(sanitizeCapabilities('video', { maxDurationSec: -5 })['maxDurationSec'], 10)
  assert.equal(sanitizeCapabilities('video', { maxDurationSec: Number.POSITIVE_INFINITY })['maxDurationSec'], 10)

  // string：trim；非字符串丢弃；超长截 500
  assert.equal(sanitizeCapabilities('tts', { voice: '  alloy  ' })['voice'], 'alloy')
  assert.equal(sanitizeCapabilities('tts', { voice: 123 })['voice'], undefined)
  const longVoice = sanitizeCapabilities('tts', { voice: 'x'.repeat(600) })['voice']
  assert.equal(typeof longVoice, 'string')
  assert.equal(String(longVoice).length, 500)

  // 非对象输入 → 仅缺省
  assert.deepEqual(sanitizeCapabilities('image.master', 'oops'), { sizeParam: true })
  assert.deepEqual(sanitizeCapabilities('tts', undefined), {})
})

test('sanitizeMusicMapping sync：合法归一；携带 async 专属字段判配置矛盾 → null', () => {
  const ok = sanitizeMusicMapping(SYNC_MUSIC)
  assert.ok(ok)
  assert.deepEqual(ok, {
    endpoint: { path: '/v1/audio/music', method: 'POST' },
    mode: 'sync',
    request: { promptField: 'prompt', instrumentalField: 'instrumental', durationField: 'duration' },
    response: { audioPath: 'data.audio_url' },
  })

  // sync 携带 doneValues / statusValuePath / jobIdPath 任意一个 → null
  assert.equal(sanitizeMusicMapping({ ...SYNC_MUSIC, response: { audioPath: 'data.url', doneValues: ['ok'] } }), null)
  assert.equal(sanitizeMusicMapping({ ...SYNC_MUSIC, response: { audioPath: 'data.url', statusValuePath: 's' } }), null)
  assert.equal(sanitizeMusicMapping({ ...SYNC_MUSIC, response: { audioPath: 'data.url', jobIdPath: 'data.id' } }), null)

  // 缺必填（mode 非法 / promptField 空 / audioPath 空）
  assert.equal(sanitizeMusicMapping({ ...SYNC_MUSIC, mode: 'poll' }), null)
  assert.equal(sanitizeMusicMapping({ ...SYNC_MUSIC, request: { promptField: '' } }), null)
  assert.equal(sanitizeMusicMapping({ ...SYNC_MUSIC, response: { audioPath: '' } }), null)
  assert.equal(sanitizeMusicMapping(null), null)
  assert.equal(sanitizeMusicMapping('x'), null)
})

test('sanitizeMusicMapping async：statusPath 与 jobIdPath 缺一不可；缺省补齐 statusValuePath/doneValues', () => {
  const base = {
    endpoint: { path: '/v1/music/tasks' },
    mode: 'async',
    request: { promptField: 'prompt' },
    response: { audioPath: 'data.audio_url', jobIdPath: 'data.id' },
  }
  // 缺 statusPath → null
  assert.equal(sanitizeMusicMapping(base), null)
  // 缺 jobIdPath → null
  assert.equal(
    sanitizeMusicMapping({
      ...base,
      endpoint: { path: '/v1/music/tasks', statusPath: '/v1/music/tasks/{id}' },
      response: { audioPath: 'data.audio_url' },
    }),
    null,
  )
  // 齐备：缺省补齐 statusValuePath='status'、doneValues 四缺省
  const full = sanitizeMusicMapping({ ...base, endpoint: { path: '/v1/music/tasks', statusPath: '/v1/music/tasks/{id}' } })
  assert.ok(full)
  assert.equal(full.endpoint.statusPath, '/v1/music/tasks/{id}')
  assert.equal(full.response.statusValuePath, 'status')
  assert.deepEqual(full.response.doneValues, ['completed', 'succeeded', 'done', 'success'])

  // 显式 doneValues/failedValues 保留；pollIntervalMs < 200 丢弃、>60000 收敛
  const custom = sanitizeMusicMapping({
    ...base,
    endpoint: { path: '/v1/music/tasks', statusPath: '/v1/music/tasks/{id}' },
    response: {
      audioPath: 'data.audio_url', jobIdPath: 'data.id', statusValuePath: 'data.state',
      doneValues: ['success', '', 'completed'], failedValues: ['failed'], pollIntervalMs: 90_000,
    },
  })
  assert.ok(custom)
  assert.deepEqual(custom.response.doneValues, ['success', 'completed'])
  assert.deepEqual(custom.response.failedValues, ['failed'])
  assert.equal(custom.response.pollIntervalMs, 60_000)
  assert.equal(sanitizeMusicMapping({ ...base, endpoint: { path: '/p', statusPath: '/s' }, response: { audioPath: 'a', jobIdPath: 'j', pollIntervalMs: 100 } })?.response.pollIntervalMs, undefined)
})

test('sanitizeMusicMapping 路径含空白 / 查询串 / 完整 URL → null（只认点号+[n]）', () => {
  const mk = (over: Record<string, unknown>) => sanitizeMusicMapping({
    endpoint: { path: '/v1/music' },
    mode: 'sync',
    request: { promptField: 'prompt' },
    response: { audioPath: 'data.audio_url', ...over },
  })
  assert.equal(mk({ audioPath: 'data.audio url' }), null)
  assert.equal(mk({ audioPath: 'data?url=1' }), null)
  assert.equal(mk({ audioPath: 'https://cdn.example/a.mp3' }), null)
  const p = sanitizeMusicMapping({
    endpoint: { path: '/v1/music tasks' },
    mode: 'sync',
    request: { promptField: 'prompt' },
    response: { audioPath: 'data.audio_url' },
  })
  assert.equal(p, null)
})

test('slotUnavailableMessage 含中文槽名与漫剧工坊指引；isSlotId/isProtocolFamily 白名单', () => {
  const msg = slotUnavailableMessage('video')
  assert.ok(msg.includes('视频'))
  assert.ok(msg.includes('(video)'))
  assert.ok(msg.includes('漫剧工坊'))
  const bgm = slotUnavailableMessage('music.bgm')
  assert.ok(bgm.includes('BGM'))
  assert.ok(bgm.includes('漫剧工坊'))

  assert.equal(isSlotId('video'), true)
  assert.equal(isSlotId('image.shot'), true)
  assert.equal(isSlotId('music.song'), true)
  assert.equal(isSlotId('image.hero'), false)
  assert.equal(isSlotId(42), false)
  assert.equal(isProtocolFamily('generic-music'), true)
  assert.equal(isProtocolFamily('openai-tts'), true)
  assert.equal(isProtocolFamily('minimax-music'), false)
  assert.equal(isProtocolFamily(''), false)
})
