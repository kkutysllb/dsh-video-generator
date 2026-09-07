import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Timeline, buildTimeline, writeSrt, formatSrtTime } from '../src/finalcut/timeline.ts'

test('Timeline.addClip 线性追加（微秒），startUs 由前序累加', () => {
  const t = new Timeline({ width: 1080, height: 1920, fps: 24 })
  t.addClip('/a.mp4', 3_000_000)
  t.addClip('/b.mp4', 2_500_000)
  assert.equal(t.clips.length, 2)
  assert.equal(t.clips[0]!.startUs, 0)
  assert.equal(t.clips[1]!.startUs, 3_000_000)
  assert.equal(t.totalDurationUs, 5_500_000)
})

test('buildTimeline：按镜头组装 clip+subtitle+audio（时长取视频与配音+400ms 的较大者）', () => {
  const t = buildTimeline({
    canvas: { width: 1080, height: 1920, fps: 24 },
    shots: [
      { video: '/v1.mp4', durationUs: 5_000_000, subtitle: '第一句台词', audio: '/v1.mp3', audioDurationUs: 3_000_000 },
      { video: '/v2.mp4', durationUs: 4_000_000, subtitle: '第二句台词' },
    ],
  })
  assert.equal(t.clips.length, 2)
  assert.equal(t.subtitles.length, 2)
  assert.equal(t.audio.length, 1)
  assert.equal(t.totalDurationUs, 9_000_000)
  assert.equal(t.subtitles[1]!.startUs, 5_000_000)
})

test('writeSrt：标准 SRT 格式（序号/时码/文本）', () => {
  const srt = writeSrt([
    { text: '第一句', startUs: 0, endUs: 3_500_000 },
    { text: '第二句', startUs: 62_000_000, endUs: 65_000_000 },
  ])
  assert.ok(srt.includes('1\n00:00:00,000 --> 00:00:03,500\n第一句'))
  assert.ok(srt.includes('2\n00:01:02,000 --> 00:01:05,000\n第二句'))
})

test('formatSrtTime：时/分/秒/毫秒补零', () => {
  assert.equal(formatSrtTime(3_500_000), '00:00:03,500')
  assert.equal(formatSrtTime(3_723_500_000), '01:02:03,500')
})
