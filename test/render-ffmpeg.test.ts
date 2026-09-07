import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildRenderPlan, renderTimeline, locateFfmpeg, probeDurationSec } from '../src/finalcut/render-ffmpeg.ts'
import { Timeline } from '../src/finalcut/timeline.ts'

function sampleTimeline(): Timeline {
  const t = new Timeline({ width: 1080, height: 1920, fps: 24 })
  t.addClip('/a.mp4', 3_000_000)
  t.addClip('/b.mp4', 2_500_000)
  t.addSubtitle('第一句', 0, 3_000_000)
  t.addSubtitle('第二句', 3_000_000, 5_500_000)
  t.addAudio('/n1.mp3', 200_000, 2_000_000)
  return t
}

test('buildRenderPlan：两阶段命令（逐 clip 归一化 + concat/drawtext/amix 合成）', () => {
  const plan = buildRenderPlan(sampleTimeline(), '/out/final.mp4', { ffmpeg: '/usr/bin/ffmpeg', workDir: '/tmp/work', subtitles: true })
  assert.equal(plan.normalize.length, 2)
  assert.ok(plan.normalize[0]!.args.includes('-vf'))
  assert.ok(plan.normalize[0]!.args.some((a) => a.includes('scale=1080:1920')))
  const fc = plan.composite.args[plan.composite.args.indexOf('-filter_complex') + 1] as string
  assert.ok(fc.includes('concat=n=2'))
  assert.ok(fc.includes("drawtext=text='第一句'"))
  assert.ok(fc.includes('amix'))
  assert.ok(plan.composite.args.includes('-map'))
  const maps = plan.composite.args.filter((a) => a === '-map')
  assert.equal(maps.length, 2) // 视频 + 音频
})

test('drawtext 转义：引号/冒号/百分号', () => {
  const t = new Timeline({ width: 320, height: 568, fps: 24 })
  t.addClip('/a.mp4', 1_000_000)
  t.addSubtitle("It's 100% ok: go", 0, 1_000_000)
  const plan = buildRenderPlan(t, '/out/f.mp4', { ffmpeg: 'ffmpeg', workDir: '/tmp/w', subtitles: true })
  const fc = plan.composite.args[plan.composite.args.indexOf('-filter_complex') + 1] as string
  assert.ok(fc.includes("It\\'s 100\\% ok\\: go"))
})

test('locateFfmpeg：env 优先', () => {
  assert.equal(locateFfmpeg({ VGEN_FFMPEG: '/custom/ffmpeg' } as NodeJS.ProcessEnv), '/custom/ffmpeg')
  assert.equal(locateFfmpeg({} as NodeJS.ProcessEnv), 'ffmpeg')
})

function supportsDrawtextFilter(bin: string): boolean {
  try {
    const out = execFileSync(bin, ['-hide_banner', '-filters'], { stdio: ['pipe', 'pipe', 'ignore'] }).toString()
    return /\bdrawtext\b/.test(out)
  } catch {
    return false
  }
}

const ffmpegCandidates = [locateFfmpeg()!, '/usr/local/ffmpeg-sub/bin/ffmpeg', '/Users/libing/Library/Application Support/bilibili/ffmpeg/ffmpeg']
const capableFfmpeg = ffmpegCandidates.find((b) => b && supportsDrawtextFilter(b)) ?? null

test('renderTimeline 真实渲染 smoke：两段彩条 + 字幕 -> mp4（需本机 ffmpeg 且支持 drawtext）', { skip: !capableFfmpeg }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-render-'))
  try {
    const ffmpeg = capableFfmpeg!
    const a = join(dir, 'a.mp4')
    const b = join(dir, 'b.mp4')
    execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x568:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', a])
    execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x568:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', b])
    const t = new Timeline({ width: 320, height: 568, fps: 24 })
    t.addClip(a, 1_000_000)
    t.addClip(b, 1_000_000)
    t.addSubtitle('鲸鱼测试字幕', 0, 2_000_000)
    const out = join(dir, 'final.mp4')
    const r = await renderTimeline(t, out, { subtitles: true, ffmpeg: ffmpeg })
    assert.equal(r.ok, true, r.error)
    assert.ok(existsSync(out))
    assert.ok(statSync(out).size > 1000)
    const dur = await probeDurationSec(out, ffmpeg)
    assert.ok(dur !== null && dur > 1.8 && dur < 2.6)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
