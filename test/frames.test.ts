// test/frames.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { frameTimestamps, buildFrameArgs, extractReviewFrames } from '../src/review/frames.ts'

test('frameTimestamps 按 25/50/75% 取点', () => {
  assert.deepEqual(frameTimestamps(8), [2, 4, 6])
  assert.deepEqual(frameTimestamps(5.375), [1.344, 2.688, 4.031])
})

test('frameTimestamps 拒绝非法时长', () => {
  assert.throws(() => frameTimestamps(0), /非法时长/)
  assert.throws(() => frameTimestamps(Number.NaN), /非法时长/)
})

test('buildFrameArgs 产出确定性 ffmpeg 参数（-ss 在 -i 前，快速定位）', () => {
  assert.deepEqual(buildFrameArgs('/tmp/c.mp4', 2.5, '/tmp/f.png'), [
    '-y', '-ss', '2.5', '-i', '/tmp/c.mp4', '-frames:v', '1', '-q:v', '2', '/tmp/f.png',
  ])
})

test('extractReviewFrames 抽 3 帧并返回路径（exec/probe 注入，零 ffmpeg 依赖）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-frames-'))
  const calls: string[][] = []
  const frames = await extractReviewFrames(join(dir, 'clip.mp4'), join(dir, 'out'), '/bin/ffmpeg', {
    probe: async () => 8,
    exec: async (_cmd, args) => {
      calls.push(args)
      const out = args[args.length - 1]!
      writeFileSync(out, 'fake-png')
    },
  })
  assert.equal(frames.length, 3)
  assert.ok(frames.every((f) => existsSync(f)))
  assert.deepEqual(calls[0]!.slice(1, 3), ['-ss', '2'])
  assert.deepEqual(calls[2]!.slice(1, 3), ['-ss', '6'])
})

test('extractReviewFrames probe 失败即抛（不产出半套帧）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-frames2-'))
  await assert.rejects(
    extractReviewFrames(join(dir, 'clip.mp4'), join(dir, 'out'), '/bin/ffmpeg', { probe: async () => null }),
    /无法读取片段时长/,
  )
})

test('extractReviewFrames exec 未产出文件即抛', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-frames3-'))
  await assert.rejects(
    extractReviewFrames(join(dir, 'clip.mp4'), join(dir, 'out'), '/bin/ffmpeg', {
      probe: async () => 8,
      exec: async () => {}, // 不写文件
    }),
    /抽帧未产出/,
  )
})
