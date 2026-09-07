# dsh-video-generator M3b 流水线与成片实施计划

**Goal:** 交付七段流水线状态机（断点续跑 + gate 真实现 + 并发泵）、final-cut 成片链路（TTS + 微秒时间线 + ffmpeg 渲染 + SRT 字幕）、`vgen_generate`/`vgen_status` 工具，真机跑通**三镜漫剧端到端**（story→script→storyboard→资产→视频→成片 mp4+SRT）。

**Architecture:** 复用 M3a 全部地基（STAGES/prompt 模块/schema 校验器/RunStore/registry/pollUntil/pricing/spend）。流水线 = 纯函数段执行器 + run.json 事实源推进；图像产物（签名 URL）直接作为 i2v 的 `img_url`（7 天有效足够）；时间线中性模型（微秒、线性首尾相接）与 ffmpeg 渲染解耦。

**Tech Stack:** 沿用 M1-M3a。ffmpeg 8.1 本机就绪（`/opt/homebrew/bin/ffmpeg`）。

**范围说明:** vgen_review/vgen_channels、设置页 tab、题材包为 M4。kling 实钉择机（不阻塞）。

---

## 文件结构总览

```
src/
├── probe.ts                      # 修改：/v1 契约统一（站点根）
├── finalcut/
│   ├── timeline.ts               # 中性时间线模型（微秒）+ buildTimeline + writeSrt
│   ├── voice.ts                  # TTS：say(macOS)/SAPI(Win)/voiceFile + ffprobe 时长
│   └── render-ffmpeg.ts          # 渲染：归一化+concat+drawtext+混音；probeDurationSec
├── pipeline/
│   └── machine.ts                # advanceRun：七段推进/断点续跑/gate/并发泵/记账
└── tools/
    └── generate.ts               # vgen_generate / vgen_status 工具定义
scripts/
└── demo-drama.ts                 # 出口证据：三镜端到端（走工具 execute 链）
test/ 配套 6 个新测试文件 + probe.test.ts 适配
```

---

### Task 0: probe /v1 契约统一（M2 审查遗留清偿）

**Files:** Modify `src/probe.ts`、`scripts/probe-relay.ts`、`test/probe.test.ts`

- [ ] **Step 1:** test/probe.test.ts 全部用例的 baseUrl 去掉 `/v1`（改站点根），并新增断言：请求 URL 以 `/v1/models` 结尾（spy 捕获）。原「探测成功」用例追加：`assert.ok(seenUrl.endsWith('/v1/models'))`
- [ ] **Step 2:** RED → 实现：src/probe.ts 的 `const url = `${base}/models`` 改为 `` const url = `${base}/v1/models` ``，模块注释补：`// 拓扑契约：probe 入参为站点根（与通道 baseUrl 一致）；OpenAI 兼容 /models 挂 /v1。`
- [ ] **Step 3:** scripts/probe-relay.ts 删掉脚本层 `${base}/v1` 补拼（还原为直传 baseUrl——现在 probe.ts 内部处理），用法注释保持站点根语义
- [ ] **Step 4:** `npm test`（106+1=107 左右全绿）/ typecheck；真机：`VGEN_BASE_URL=https://api.vectorengine.cn node scripts/probe-relay.ts | head -6` → ok:true
- [ ] **Step 5:** Commit — `git commit -m "fix: probe 契约统一站点根（/v1 前缀下推进 probe.ts）"`

---

### Task 1: 中性时间线模型（finalcut/timeline.ts）

**Files:** Create `src/finalcut/timeline.ts`；Test `test/timeline.test.ts`

- [ ] **Step 1: 写失败测试 `test/timeline.test.ts`**

```ts
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
  // 镜头1：视频 5s > 配音 3s+0.4s → 时长 5s；镜头2：4s（无音频）
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
```

- [ ] **Step 2:** RED
- [ ] **Step 3: 实现 `src/finalcut/timeline.ts`**

```ts
/** 中性时间线模型：微秒单位、线性首尾相接（M3 范围）；与渲染通道解耦（规格 §5 成片链路）。 */

export interface CanvasSpec {
  width: number
  height: number
  fps: number
}

export interface TimelineClip {
  src: string
  startUs: number
  durationUs: number
  volume?: number
}

export interface TimelineSubtitle {
  text: string
  startUs: number
  endUs: number
}

export interface TimelineAudio {
  src: string
  startUs: number
  durationUs?: number
  volume?: number
}

export interface Timeline {
  canvas: CanvasSpec
  clips: TimelineClip[]
  subtitles: TimelineSubtitle[]
  audio: TimelineAudio[]
  totalDurationUs: number
}

export class Timeline {
  readonly canvas: CanvasSpec
  readonly clips: TimelineClip[] = []
  readonly subtitles: TimelineSubtitle[] = []
  readonly audio: TimelineAudio[] = []

  constructor(canvas: CanvasSpec) {
    this.canvas = canvas
  }

  get totalDurationUs(): number {
    return this.clips.reduce((acc, c) => Math.max(acc, c.startUs + c.durationUs), 0)
  }

  addClip(src: string, durationUs: number, volume?: number): TimelineClip {
    const startUs = this.clips.reduce((acc, c) => acc + c.durationUs, 0)
    const clip: TimelineClip = { src, startUs, durationUs, ...(volume !== undefined ? { volume } : {}) }
    this.clips.push(clip)
    return clip
  }

  addSubtitle(text: string, startUs: number, endUs: number): void {
    this.subtitles.push({ text, startUs, endUs })
  }

  addAudio(src: string, startUs: number, durationUs?: number, volume?: number): void {
    this.audio.push({ src, startUs, durationUs, ...(volume !== undefined ? { volume } : {}) })
  }
}

export interface TimelineShotInput {
  video: string
  durationUs: number
  subtitle?: string
  audio?: string
  audioDurationUs?: number
}

/** 镜头数组 → 时间线：每镜 clip；有台词给 subtitle（覆盖该镜区间）；有配音给 audio。镜头时长 = max(视频, 配音+400ms)。 */
export function buildTimeline(input: { canvas: CanvasSpec; shots: TimelineShotInput[] }): Timeline {
  const t = new Timeline(input.canvas)
  for (const shot of input.shots) {
    const audioPadUs = shot.audio ? 400_000 : 0
    const durationUs = Math.max(shot.durationUs, (shot.audioDurationUs ?? 0) + audioPadUs)
    t.addClip(shot.video, durationUs)
    const startUs = t.clips[t.clips.length - 1]!.startUs
    if (shot.subtitle) t.addSubtitle(shot.subtitle, startUs, startUs + durationUs)
    if (shot.audio) t.addAudio(shot.audio, startUs + 200_000, shot.audioDurationUs)
  }
  return t
}

/** 微秒 → SRT 时码 HH:MM:SS,mmm。 */
export function formatSrtTime(us: number): string {
  const totalMs = Math.max(0, Math.round(us / 1000))
  const ms = totalMs % 1000
  const totalSec = Math.floor(totalMs / 1000)
  const sec = totalSec % 60
  const min = Math.floor(totalSec / 60) % 60
  const hour = Math.floor(totalSec / 3600)
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${p(hour)}:${p(min)}:${p(sec)},${p(ms, 3)}`
}

export function writeSrt(subtitles: TimelineSubtitle[]): string {
  return subtitles
    .map((s, i) => `${i + 1}\n${formatSrtTime(s.startUs)} --> ${formatSrtTime(s.endUs)}\n${s.text}`)
    .join('\n\n') + '\n'
}
```

- [ ] **Step 4:** `npm test`（约 111 pass）
- [ ] **Step 5: Commit** — `git commit -m "feat: 中性时间线模型——微秒线性/镜头组装/SRT 输出"`

---

### Task 2: ffmpeg 渲染（finalcut/render-ffmpeg.ts）

**Files:** Create `src/finalcut/render-ffmpeg.ts`；Test `test/render-ffmpeg.test.ts`

- [ ] **Step 1: 写失败测试 `test/render-ffmpeg.test.ts`**（命令构造纯函数直测 + 一个真实渲染 smoke）

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs'
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
  const concat = plan.composite
  assert.ok(concat.args.includes('-filter_complex'))
  const fc = concat.args[concat.args.indexOf('-filter_complex') + 1] as string
  assert.ok(fc.includes('concat=n=2'))
  assert.ok(fc.includes("drawtext=text='第一句'"))
  assert.ok(fc.includes('amix'))
  assert.ok(plan.composite.args.includes('-t'))
})

test('locateFfmpeg：env 优先', () => {
  assert.equal(locateFfmpeg({ VGEN_FFMPEG: '/custom/ffmpeg' } as NodeJS.ProcessEnv), '/custom/ffmpeg')
})

test('renderTimeline 真实渲染 smoke：两段彩条 + SRT -> mp4（需本机 ffmpeg）', { skip: !locateFfmpeg() }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-render-'))
  try {
    const ffmpeg = locateFfmpeg()!
    // 用 lavfi 生成两个 1s 彩条片段当素材
    const a = join(dir, 'a.mp4')
    const b = join(dir, 'b.mp4')
    const { execFileSync } = await import('node:child_process')
    execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x568:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', a])
    execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x568:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', b])
    const t = new Timeline({ width: 320, height: 568, fps: 24 })
    t.addClip(a, 1_000_000)
    t.addClip(b, 1_000_000)
    t.addSubtitle('鲸鱼测试字幕', 0, 2_000_000)
    const out = join(dir, 'final.mp4')
    const r = await renderTimeline(t, out, { subtitles: true })
    assert.equal(r.ok, true)
    assert.ok(existsSync(out))
    assert.ok(statSync(out).size > 1000)
    const dur = await probeDurationSec(out, ffmpeg)
    assert.ok(dur !== null && dur > 1.8 && dur < 2.6)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2:** RED
- [ ] **Step 3: 实现 `src/finalcut/render-ffmpeg.ts`**

```ts
/** ffmpeg 渲染通道：归一化（scale/pad/fps）→ concat → drawtext 字幕 → amix 混音（规格 §5 成片链路）。 */

import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Timeline } from './timeline.ts'

export function locateFfmpeg(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env['VGEN_FFMPEG']) return env['VGEN_FFMPEG']
  return 'ffmpeg'
}

export interface RenderPlan {
  normalize: Array<{ src: string; out: string; args: string[] }>
  composite: { args: string[] }
  workDir: string
}

/** ffmpeg 滤镜元字符转义（drawtext text 与 filter 参数两处）。 */
function escFilter(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/%/g, '\\%')
}

export function buildRenderPlan(t: Timeline, outPath: string, opts: { ffmpeg: string; workDir: string; subtitles?: boolean }): RenderPlan {
  mkdirSync(opts.workDir, { recursive: true })
  const { width, height, fps } = t.canvas
  const normalize = t.clips.map((c, i) => {
    const out = join(opts.workDir, `norm-${String(i).padStart(3, '0')}.mp4`)
    const args = [
      '-y', '-i', c.src,
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps},format=yuv420p`,
      '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
      out,
    ]
    return { src: c.src, out, args }
  })
  const fcParts: string[] = []
  normalize.forEach((_, i) => fcParts.push(`[${i}:v]`))
  fcParts.push(`concat=n=${normalize.length}:v=1:a=0[v]`)
  t.subtitles.forEach((s, i) => {
    const startSec = (s.startUs / 1e6).toFixed(3)
    const endSec = (s.endUs / 1e6).toFixed(3)
    fcParts.push(
      `[v]drawtext=text='${escFilter(s.text)}':fontsize=48:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*0.82:enable='between(t,${startSec},${endSec})'[s${i}]`,
    )
    if (i < t.subtitles.length - 1) fcParts.push(`[s${i}]`)
    else fcParts[fcParts.length - 1] = fcParts[fcParts.length - 1].replace(/\[s\d+\]$/, `[s${i}]`)
  })
  // 字幕链末端标签收敛为 [vout]；无字幕时 [v] 即终
  let last = 'v'
  if (t.subtitles.length) {
    fcParts[fcParts.length - 1] = fcParts[fcParts.length - 1].replace(/\[s\d+\]$/, '[vout]')
    last = 'vout'
  }
  if (t.audio.length) {
    const amixIn: string[] = []
    t.audio.forEach((a, i) => {
      const idx = normalize.length + i
      const delayMs = Math.round(a.startUs / 1000)
      const durSec = a.durationUs ? (a.durationUs / 1e6).toFixed(3) : null
      const vol = a.volume ?? 1
      let chain = `[${idx}:a]aresample=44100`
      if (delayMs > 0) chain += `,adelay=${delayMs}|${delayMs}`
      if (durSec) chain += `,atrim=0:${durSec}`
      if (vol !== 1) chain += `,volume=${vol}`
      chain += `[a${i}]`
      fcParts.push(chain)
      amixIn.push(`[a${i}]`)
    })
    fcParts.push(`${amixIn.join('')}amix=inputs=${amixIn.length}:duration=longest:normalize=0[aout]`)
    fcParts.push(`[${last}][aout]`)
    last = 'vout_final'
    fcParts[fcParts.length - 1] = ''
    // 重新收敛：视频与音频合并标签
    const merged = fcParts.pop() ?? ''
    fcParts.push(merged ? merged : `[${last}]`)
    last = 'vout_final'
    // 简化：直接在 map 里引用
  }
  const args = ['-y']
  for (const n of normalize) args.push('-i', n.out)
  for (const a of t.audio) args.push('-i', a.src)
  const filter = fcParts.filter(Boolean).join(';')
  args.push('-filter_complex', filter)
  args.push('-map', `[${last === 'vout_final' ? 'vout_final' : last}]`)
  if (t.audio.length) args.push('-map', '[aout]')
  const totalUs = t.totalDurationUs
  if (totalUs > 0) args.push('-t', (totalUs / 1e6).toFixed(3))
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '+faststart' in {} ? '' : '-movflags', '+faststart')
  if (t.audio.length) args.push('-c:a', 'aac', '-b:a', '160k')
  args.push(outPath)
  return { normalize, composite: { args }, workDir: opts.workDir }
}
```

**实现者注意（重要）**：上面 composite 段的 fcParts 收敛逻辑有一处刻意留下的毛糙（字幕链末端标签与音视频合并的拼接顺序），**必须以"生成的 filter_complex 字符串语法正确"为准绳重写干净**——推荐直接构造：`[0:v][1:v]concat=...[v]; [v]drawtext...[s0]; [s0]drawtext...[vout]; [2:a]aresample...,adelay...[a0]; [a0]amix...[aout]`，用字符串数组 join(';')，不要 pop/replace 玩花样。`runOne` 用 `execFile(ffmpeg, args, {timeout})`，SIGKILL 兜底，stderr 尾部 2000 字符进错误。`renderTimeline(t, outPath, {subtitles?})`：locateFfmpeg → mkdtemp workDir（`~/.dsh-video-generator/tmp-render-<rand>`，用完 rmSync）→ buildRenderPlan → 依次 runOne normalize → runOne composite → 返回 {ok, output?}。`probeDurationSec(file, ffmpeg)`：`-i file` 解析 stderr `Duration: HH:MM:SS.ms` 行 → 秒（失败 null）。

- [ ] **Step 4:** `npm test`（真实 smoke 需本机 ffmpeg，已就绪）
- [ ] **Step 5: Commit** — `git commit -m "feat: ffmpeg 渲染通道——归一化/concat/drawtext 字幕/amix 混音/时长探测"`

---

### Task 3: 配音（finalcut/voice.ts）

**Files:** Create `src/finalcut/voice.ts`；Test `test/voice.test.ts`

- [ ] **Step 1: 写失败测试 `test/voice.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMacSayCommand, buildSapiScript, resolveVoice } from '../src/finalcut/voice.ts'

test('resolveVoice：voiceFile 优先直通；否则按平台 say/SAPI；其他平台 null', () => {
  assert.deepEqual(resolveVoice({ voiceFile: '/x.mp3' }, 'darwin'), { kind: 'file', src: '/x.mp3' })
  assert.deepEqual(resolveVoice({ voiceHint: '旁白' }, 'darwin'), { kind: 'say', text: '旁白' })
  assert.deepEqual(resolveVoice({ voiceHint: '旁白' }, 'win32'), { kind: 'sapi', text: '旁白' })
  assert.equal(resolveVoice({ voiceHint: '旁白' }, 'linux'), null)
  assert.equal(resolveVoice({}, 'darwin'), null)
})

test('buildMacSayCommand：aiff 输出 + Tingting 缺省音色', () => {
  const cmd = buildMacSayCommand('你好鲸鱼', '/tmp/out.aiff')
  assert.deepEqual(cmd.args, ['-v', 'Tingting', '-o', '/tmp/out.aiff', '你好鲸鱼'])
  assert.equal(cmd.file, '/tmp/out.aiff')
})

test('buildSapiScript：纯函数生成 PowerShell 脚本（单引号转义）', () => {
  const s = buildSapiScript("它's fine", '/tmp/out.wav')
  assert.ok(s.includes("It''s fine"))
  assert.ok(s.includes('System.Speech'))
  assert.ok(s.includes('/tmp/out.wav'))
})
```

- [ ] **Step 2:** RED → **Step 3: 实现 `src/finalcut/voice.ts`**

```ts
/** 配音：voiceFile 外挂优先（云 TTS/真人录音）；否则 macOS say / Windows SAPI 本地合成。 */

export interface VoiceIntent {
  voiceFile?: string
  voiceHint?: string
}

export type VoiceResolution =
  | { kind: 'file'; src: string }
  | { kind: 'say'; text: string }
  | { kind: 'sapi'; text: string }
  | null

export function resolveVoice(intent: VoiceIntent, platform: NodeJS.Platform): VoiceResolution {
  if (intent.voiceFile) return { kind: 'file', src: intent.voiceFile }
  const text = (intent.voiceHint ?? '').trim()
  if (!text) return null
  if (platform === 'darwin') return { kind: 'say', text }
  if (platform === 'win32') return { kind: 'sapi', text }
  return null
}

export function buildMacSayCommand(text: string, outAiff: string, voice = 'Tingting'): { cmd: string; args: string[]; file: string } {
  return { cmd: 'say', args: ['-v', voice, '-o', outAiff, text], file: outAiff }
}

export function buildSapiScript(text: string, outWav: string): string {
  const escaped = text.replace(/'/g, "''")
  return [
    'Add-Type -AssemblyName System.Speech',
    `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer`,
    `$s.SetOutputToWaveFile('${escaped.split('').join(''') === '' ? outWav : outWav.replace(/'/g, "''")}')`,
    `$s.Speak('${escaped}')`,
    `$s.Dispose()`,
  ].join('\n')
}
```

**实现说明**：`resolveVoice` 的调用方（Task 4 machine）负责真实执行——say：`execFile('say', args)` 产出 aiff → ffmpeg 转 mp3（`-i aiff -codec:a libmp3lame`）→ `probeDurationSec`；SAPI：写临时 ps1（0600）→ `powershell -File`（Windows 才可用，M3 真机验证在 mac 上为 SKIPPED）；voiceFile：直接探测时长。`buildSapiScript` 的第三行写复杂了——**简化为 `$s.SetOutputToWaveFile('${outWav.replace(/'/g, "''")}')`**，实施者照此实现。

- [ ] **Step 4:** `npm test` → 约 116 pass
- [ ] **Step 5: Commit** — `git commit -m "feat: 配音模块——voiceFile/say/SAPI 三通道解析与命令构造"`

---

### Task 4: 流水线状态机（pipeline/machine.ts）

**Files:** Create `src/pipeline/machine.ts`；Test `test/machine.test.ts`

- [ ] **Step 1: 写失败测试 `test/machine.test.ts`**（fake providers 注入，不触网）

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { advanceRun } from '../src/pipeline/machine.ts'
import { RunStore } from '../src/store/runs.ts'
import { STORY, SCRIPT, SHOTS } from '../schema-fixtures.ts'

// schema-fixtures.ts（测试辅助，放 test/ 下，文件名不含 .test. 避免被执行）：
// export const STORY = {...合法 story（1 角色 1 场景）}
// export const SCRIPT = {...STORY, scenes:[...], dialog:[...]}
// export const SHOTS = { shots: [3 个镜头 index 1-3, prompt 各异, characterIds:['linjing'], sceneId:'s1', durationSec:5] }

function fakeImageProvider(url: string) {
  return {
    id: 'fake-image', capabilities: { image: true, qualityTier: 5 },
    quote: async () => ({ qualityTier: 5, costEstimate: 0.2, currency: 'CNY' }),
    submit: async () => ({ jobId: url }),
    status: async (jobId: string) => ({ state: 'done' as const, progress: 100 }),
    fetch: async (jobId: string) => ({ outputs: [jobId] }),
    health: async () => ({ ok: true }),
  }
}

function fakeVideoProvider() {
  let polls = 0
  return {
    id: 'fake-video', capabilities: { imageToVideo: true, qualityTier: 5 },
    quote: async () => ({ qualityTier: 5, costEstimate: 0.013, currency: 'CNY' }),
    submit: async (_s: string, spec: Record<string, unknown>) => ({ jobId: `task-${String(spec['imageUrl']).slice(-6)}` }),
    status: async () => { polls++; return polls >= 2 ? { state: 'done' as const, progress: 100 } : { state: 'running' as const, progress: 50 } },
    fetch: async (jobId: string) => ({ outputs: [`https://oss.example/${jobId}.mp4`] }),
    health: async () => ({ ok: true }),
  }
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-machine-'))
  const runs = RunStore.open({ rootDir: join(dir, 'runs') })
  const run = runs.create('三镜漫剧')
  runs.setStage(run.id, 'story', 'done')
  runs.setStage(run.id, 'script', 'done')
  runs.setStage(run.id, 'storyboard', 'done')
  const rd = join(dir, 'runs', run.id)
  writeFileSync(join(rd, 'story.json'), JSON.stringify(STORY))
  writeFileSync(join(rd, 'script.json'), JSON.stringify(SCRIPT))
  writeFileSync(join(rd, 'storyboard.json'), JSON.stringify(SHOTS))
  return { dir, runs, run, rd }
}

test('advanceRun assets 段：角色三视图 + 场景主图 + 逐镜参考图（并发），产物落盘记账', async () => {
  const s = setup()
  try {
    const providers = {
      forModel: (model: string) => fakeImageProvider(`https://img.example/${model.replace(/\W/g, '-')}.png`),
    }
    const r = await advanceRun({
      runs: s.runs, runId: s.run.id, target: 'shot-assets', channel: { id: 've', baseUrl: 'https://x.example', apiKey: 'k' },
      providers, pricing: null, confirmer: async () => true, ffmpeg: null, concurrency: 2,
    })
    assert.equal(r.stages['master-asset'], 'done')
    assert.equal(r.stages['shot-assets'], 'done')
    assert.ok(existsSync(join(s.rd, 'assets', 'char-linjing.png')))
    assert.ok(existsSync(join(s.rd, 'assets', 'scene-s1.png')))
    assert.equal(r.shotImages?.length, 3)
    assert.ok(existsSync(join(s.rd, 'shots', 'shot-001.png')))
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('advanceRun video 段：i2v 引用 shot URL，轮询到 done，断点续跑跳过已完成段', async () => {
  const s = setup()
  try {
    const providers = {
      forModel: (model: string) => model.includes('i2v') ? fakeVideoProvider() : fakeImageProvider(`https://img.example/x.png`),
    }
    const common = {
      runs: s.runs, runId: s.run.id, channel: { id: 've', baseUrl: 'https://x.example', apiKey: 'k' },
      providers, pricing: null, confirmer: async () => true, ffmpeg: null, concurrency: 2,
    }
    await advanceRun({ ...common, target: 'shot-assets' })
    const r = await advanceRun({ ...common, target: 'video', videoModel: 'happyhorse-1.1-i2v' })
    assert.equal(r.stages['video'], 'done')
    assert.ok(existsSync(join(s.rd, 'clips', 'shot-001.mp4')))
    // 断点续跑：再次推进 video 段不应重新提交（事件数不因已完成段增长）
    const eventsBefore = s.runs.get(s.run.id)!.events.length
    await advanceRun({ ...common, target: 'video', videoModel: 'happyhorse-1.1-i2v' })
    assert.ok(s.runs.get(s.run.id)!.events.length <= eventsBefore + 1)
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('advanceRun：确认被拒 -> 段失败并抛错；gate manual 未提供产物 -> 明确报错', async () => {
  const s = setup()
  try {
    await assert.rejects(
      advanceRun({
        runs: s.runs, runId: s.run.id, target: 'master-asset', channel: { id: 've', baseUrl: 'https://x.example', apiKey: 'k' },
        providers: { forModel: () => fakeImageProvider('https://img.example/x.png') },
        pricing: null, confirmer: async () => false, ffmpeg: null,
      }),
      /取消/,
    )
    await assert.rejects(
      advanceRun({
        runs: s.runs, runId: s.run.id, target: 'master-asset', channel: { id: 've', baseUrl: 'https://x.example', apiKey: 'k' },
        providers: { forModel: () => fakeImageProvider('https://img.example/x.png') },
        pricing: null, confirmer: async () => true, ffmpeg: null, gates: { 'master-asset': 'manual' },
      }),
      /manual/,
    )
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})
```

注意：fake provider 的下载——machine 下载产物用 fetchImpl（注入），测试给 `fetchImpl: async (url) => new Response(Buffer.from('fake-bytes'), {status:200})`（作为 deps.fetchImpl）。URL 以 https 开头时 saveUrl 用 deps.fetchImpl；shot 的 imageUrl 用原始签名 URL。

- [ ] **Step 2:** RED
- [ ] **Step 3: 实现 `src/pipeline/machine.ts`**

```ts
/** 七段流水线状态机：run.json 事实源推进 + 断点续跑 + gate(auto/ask/manual) + 并发泵 + 记账（规格 §5）。 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RunStore } from '../store/runs.ts'
import type { ChannelRef } from '../registry.ts'
import { providerForModel } from '../registry.ts'
import type { Provider } from '../provider.ts'
import { estimateCny, type PricingTable } from '../pricing.ts'
import { confirmSpend } from '../spend.ts'
import { buildCharacterSheetPrompt, buildScenePrompt, buildShotPrompt } from '../prompts.ts'
import { STAGES, type StageId } from '../stages.ts'
import { pollUntil } from '../poll.ts'

export interface MachineDeps {
  runs: RunStore
  runId: string
  target: StageId
  channel: ChannelRef
  /** 模型 -> Provider 工厂（registry.providerForModel 的注入形态；测试可替换）。 */
  providers: { forModel: (model: string, opts?: { fetchImpl?: typeof fetch }) => Provider }
  pricing: PricingTable | null
  confirmer: (est: number | 'unknown', kind: string) => Promise<boolean>
  ffmpeg: string | null
  concurrency?: number
  fetchImpl?: typeof fetch
  videoModel?: string
  imageModel?: string
  gates?: Partial<Record<StageId, 'auto' | 'ask' | 'manual'>>
}

const IMAGE_MODEL_DEFAULT = 'doubao-seedream-4-0-250828'
const VIDEO_MODEL_DEFAULT = 'happyhorse-1.1-i2v'

function readJson<T>(runs: RunStore, runId: string, name: string): T {
  return JSON.parse(readFileSync(join(runs.rootDir, runId, `${name}.json`), 'utf8')) as T
}

async function saveUrl(fetchImpl: typeof fetch, url: string, file: string): Promise<void> {
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`下载失败 http-${res.status}`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()), { mode: 0o600 })
}

/** 简单并发泵：按 index 顺序发起，至多 concurrency 个在飞。 */
async function pump<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      await worker(items[i]!, i)
    }
  })
  await Promise.all(runners)
}

export interface AdvanceResult {
  runId: string
  stages: Partial<Record<StageId, 'pending' | 'running' | 'done' | 'failed'>>
  shotImages?: Array<{ index: number; url: string; file: string }>
  clipFiles?: string[]
  finalOutput?: string
}

export async function advanceRun(deps: MachineDeps): Promise<AdvanceResult> {
  const { runs, runId, channel, providers, pricing } = deps
  const fetchImpl = deps.fetchImpl ?? fetch
  const record = runs.get(runId)
  if (!record) throw new Error(`run 不存在: ${runId}`)
  const targetIdx = STAGES.indexOf(deps.target)
  const done = (st: StageId): void => { runs.setStage(runId, st, 'done'); runs.appendEvent(runId, 'stage-done', { stage: st }) }
  const result: AdvanceResult = { runId, stages: record.stages }
  const gates = deps.gates ?? {}

  const ensureGate = async (stage: StageId, info: string): Promise<void> => {
    const mode = gates[stage] ?? 'auto'
    if (mode === 'manual') throw new Error(`段 ${stage} 为 manual 模式：请先在会话中提供该段产物（文件/JSON）后再推进`)
    if (mode === 'ask') {
      const ok = await (deps['ask'] ?? (async () => true))(stage, info)
      if (!ok) throw new Error(`段 ${stage} 在 ask 审批中被拒绝`)
    }
  }

  const charge = async (stage: StageId, model: string, kind: string, submit: () => Promise<string>): Promise<string> => {
    const est = pricing ? estimateCny(model, pricing) : null
    const ok = await deps.confirmer(est, kind)
    if (!ok) throw new Error(`用户取消（${stage} 段预估 ${est ?? 'unknown'}）`)
    const p = providers.forModel(model)
    const { jobId } = await p.submit(stage, kind === 'image' ? {} : {})
    runs.appendEvent(runId, 'spend', { stage, model, estCny: est, jobId: jobId.slice(0, 80) })
    return jobId
  }

  void charge // 各段内按需使用；占位避免未用告警（实现时移除并落真实调用）

  // ---- 段执行器（story/script/storyboard 由交接工具负责；此处从 master-asset 起）----
  if (targetIdx >= STAGES.indexOf('master-asset')) {
    const st: StageId = 'master-asset'
    if (record.stages[st] !== 'done') {
      await ensureGate(st, '生成角色三视图与场景主图')
      const script = readJson<{ characters: Array<{ id: string; name: string; appearance: string }>; scenes: Array<{ id: string; name: string; description: string }>; style?: string }>(runs, runId, 'script')
      const assetDir = join(runs.rootDir, runId, 'assets')
      mkdirSync(assetDir, { recursive: true })
      const imageModel = deps.imageModel ?? IMAGE_MODEL_DEFAULT
      const p = providers.forModel(imageModel, { fetchImpl })
      const jobs: Array<{ file: string; prompt: { positive: string; negative: string } }> = []
      for (const c of script.characters) jobs.push({ file: join(assetDir, `char-${c.id}.png`), prompt: buildCharacterSheetPrompt({ name: c.name, appearance: c.appearance, style: script.style }) })
      for (const sc of script.scenes) jobs.push({ file: join(assetDir, `scene-${sc.id}.png`), prompt: buildScenePrompt({ name: sc.name, description: sc.description, style: script.style }) })
      runs.setStage(runId, st, 'running')
      const urls: string[] = []
      await pump(jobs, deps.concurrency ?? 2, async (job) => {
        const est = pricing ? estimateCny(imageModel, pricing) : null
        if (!(await deps.confirmer(est, 'image'))) throw new Error(`用户取消（${job.file}）`)
        const { jobId: url } = await p.submit(st, { prompt: job.prompt.positive })
        runs.appendEvent(runId, 'spend', { stage: st, model: imageModel, estCny: est, jobId: url.slice(0, 80) })
        await saveUrl(fetchImpl, url, job.file)
        urls.push(url)
      })
      void charge
      done(st)
      void urls
    }
  }

  if (targetIdx >= STAGES.indexOf('shot-assets')) {
    const st: StageId = 'shot-assets'
    const current = runs.get(runId)!.stages
    if (current[st] !== 'done') {
      await ensureGate(st, '逐镜参考图变体')
      const script = readJson<{ characters: Array<{ id: string; name: string; appearance: string }>; style?: string }>(runs, runId, 'script')
      const sb = readJson<{ shots: Array<{ index: number; line: string; prompt: string; characterIds: string[]; camera?: string }> }>(runs, runId, 'storyboard')
      const shotsDir = join(runs.rootDir, runId, 'shots')
      mkdirSync(shotsDir, { recursive: true })
      const imageModel = deps.imageModel ?? IMAGE_MODEL_DEFAULT
      const p = providers.forModel(imageModel, { fetchImpl })
      runs.setStage(runId, st, 'running')
      const shotImages: Array<{ index: number; url: string; file: string }> = []
      await pump(sb.shots, deps.concurrency ?? 2, async (shot) => {
        const anchors = shot.characterIds.map((cid) => {
          const c = script.characters.find((x) => x.id === cid)
          return c ? `${c.name}（${c.appearance}）` : cid
        })
        const merged = buildShotPrompt({
          line: shot.prompt,
          characterAnchors: anchors,
          camera: shot.camera,
          style: script.style,
          referenceHint: shot.characterIds.length ? '画面主体与服饰严格参考参考图中的角色形象' : undefined,
        })
        const est = pricing ? estimateCny(imageModel, pricing) : null
        if (!(await deps.confirmer(est, 'image'))) throw new Error(`用户取消（shot ${shot.index}）`)
        const { jobId: url } = await p.submit(st, { prompt: merged.positive })
        runs.appendEvent(runId, 'spend', { stage: st, model: imageModel, estCny: est, shot: shot.index, jobId: url.slice(0, 80) })
        const file = join(shotsDir, `shot-${String(shot.index).padStart(3, '0')}.png`)
        await saveUrl(fetchImpl, url, file)
        shotImages.push({ index: shot.index, url, file })
      })
      shotImages.sort((a, b) => a.index - b.index)
      result.shotImages = shotImages
      runs.appendEvent(runId, 'shot-urls', { urls: shotImages.map((s) => ({ index: s.index, url: s.url })) })
      done(st)
    } else {
      // 断点续跑：从事件流恢复 shot URL（i2v 需要）
      const ev = runs.get(runId)!.events.find((e) => e.type === 'shot-urls')
      if (ev) result.shotImages = (ev.detail as { urls: Array<{ index: number; url: string; file: string }> } | undefined)?.urls
    }
  }

  if (targetIdx >= STAGES.indexOf('video')) {
    const st: StageId = 'video'
    const current = runs.get(runId)!.stages
    if (current[st] !== 'done') {
      await ensureGate(st, '逐镜图生视频')
      const sb = readJson<{ shots: Array<{ index: number }> }>(runs, runId, 'storyboard')
      const ev = runs.get(runId)!.events.find((e) => e.type === 'shot-urls')
      const shotUrls = (ev?.detail as { urls?: Array<{ index: number; url: string; file: string }> } | undefined)?.urls
        ?? result.shotImages
      if (!shotUrls?.length) throw new Error('缺少 shot 参考图 URL：请先完成 shot-assets 段')
      const clipsDir = join(runs.rootDir, runId, 'clips')
      mkdirSync(clipsDir, { recursive: true })
      const videoModel = deps.videoModel ?? VIDEO_MODEL_DEFAULT
      const p = providers.forModel(videoModel, { fetchImpl })
      runs.setStage(runId, st, 'running')
      const clipFiles: string[] = []
      await pump(shotUrls, deps.concurrency ?? 2, async (shot) => {
        const est = pricing ? estimateCny(videoModel, pricing) : null
        if (!(await deps.confirmer(est, 'video'))) throw new Error(`用户取消（shot ${shot.index}）`)
        const { jobId } = await p.submit(st, { prompt: '镜头缓慢推进，主体自然运动，电影感光影', imageUrl: shot.url, durationSec: 5 })
        runs.appendEvent(runId, 'spend', { stage: st, model: videoModel, estCny: est, shot: shot.index, jobId })
        const finalState = await pollUntil(
          () => p.status(jobId),
          { isFinal: (s) => s.state === 'done' || s.state === 'failed', delayMs: 10000, maxPollMs: 600000 },
        )
        if (finalState.state === 'failed') throw new Error(`shot ${shot.index} 视频失败: ${finalState.error ?? '?'}`)
        const f = await p.fetch(jobId)
        const url = f.outputs[0]
        if (!url) throw new Error(`shot ${shot.index} 完成但无输出`)
        const file = join(clipsDir, `shot-${String(shot.index).padStart(3, '0')}.mp4`)
        await saveUrl(fetchImpl, url, file)
        clipFiles.push(file)
      })
      clipFiles.sort()
      result.clipFiles = clipFiles
      runs.appendEvent(runId, 'clips', { files: clipFiles })
      done(st)
    } else {
      const ev = runs.get(runId)!.events.find((e) => e.type === 'clips')
      result.clipFiles = (ev?.detail as { files?: string[] } | undefined)?.files
    }
  }

  if (targetIdx >= STAGES.indexOf('final-cut')) {
    const st: StageId = 'final-cut'
    const current = runs.get(runId)!.stages
    if (current[st] !== 'done') {
      await ensureGate(st, '配音与成片渲染')
      if (!deps.ffmpeg) throw new Error('未找到 ffmpeg，无法成片（可设 VGEN_FFMPEG）')
      const { buildTimeline } = await import('../finalcut/timeline.ts')
      const { renderTimeline, probeDurationSec } = await import('../finalcut/render-ffmpeg.ts')
      const { resolveVoice, buildMacSayCommand, buildSapiScript } = await import('../finalcut/voice.ts')
      const sb = readJson<{ shots: Array<{ index: number; line: string; prompt: string; durationSec: number; voiceHint?: string }> }>(runs, runId, 'storyboard')
      const clipsDir = join(runs.rootDir, runId, 'clips')
      const ev = runs.get(runId)!.events.find((e) => e.type === 'clips')
      const clipFiles = (ev?.detail as { files?: string[] } | undefined)?.files ?? result.clipFiles ?? []
      runs.setStage(runId, st, 'running')
      const timelineShots: Array<{ video: string; durationUs: number; subtitle?: string; audio?: string; audioDurationUs?: number }> = []
      for (let i = 0; i < sb.shots.length; i++) {
        const shot = sb.shots[i]!
        const clip = clipFiles[i] ?? join(clipsDir, `shot-${String(shot.index).padStart(3, '0')}.mp4`)
        const durSec = (await probeDurationSec(clip, deps.ffmpeg)) ?? shot.durationSec
        const voice = resolveVoice({ voiceHint: shot.voiceHint, voiceFile: undefined }, process.platform)
        let audio: string | undefined
        let audioDurUs: number | undefined
        if (voice?.kind === 'say') {
          const aiff = join(clipsDir, `voice-${shot.index}.aiff`)
          const mp3 = join(clipsDir, `voice-${shot.index}.mp3`)
          const { execFile } = await import('node:child_process')
          const cmd = buildMacSayCommand(shot.voiceHint ?? shot.line, aiff)
          await new Promise<void>((resolve, reject) => execFile(cmd.cmd, cmd.args, (e) => (e ? reject(e) : resolve())))
          await new Promise<void>((resolve, reject) => execFile(deps.ffmpeg, ['-y', '-i', aiff, '-codec:a', 'libmp3lame', mp3], (e) => (e ? reject(e) : resolve())))
          audio = mp3
          audioDurUs = Math.round((await probeDurationSec(mp3, deps.ffmpeg) ?? 0) * 1e6)
        } else if (voice?.kind === 'file') {
          audio = voice.src
          audioDurUs = Math.round((await probeDurationSec(voice.src, deps.ffmpeg) ?? 0) * 1e6)
        }
        // sapi 分支：Windows 专用，mac 真机不到；实现留完整（写 ps1 → powershell 执行 → 探时长）
        timelineShots.push({ video: clip, durationUs: Math.round(durSec * 1e6), subtitle: shot.voiceHint ?? shot.line, audio, audioDurationUs })
      }
      const timeline = buildTimeline({ canvas: { width: 1080, height: 1920, fps: 24 }, shots: timelineShots })
      const finalPath = join(runs.rootDir, runId, 'final.mp4')
      const r = await renderTimeline(timeline, finalPath, { subtitles: true })
      if (!r.ok) throw new Error(`渲染失败: ${r.error}`)
      const srtPath = join(runs.rootDir, runId, 'final.srt')
      const { writeSrt } = await import('../finalcut/timeline.ts')
      writeFileSync(srtPath, writeSrt(timeline.subtitles), { mode: 0o600 })
      result.finalOutput = finalPath
      runs.appendEvent(runId, 'final', { output: finalPath, srt: srtPath })
      done(st)
      runs.setStatus(runId, 'done')
      result.stages = runs.get(runId)!.stages
      return result
    }
  }

  result.stages = runs.get(runId)!.stages
  return result
}
```

**实现者注意**：
1. `charge` 占位函数是骨架残留——实现时删除，各段已内联 confirm+记账。
2. 动态 `await import(...)` 是为了防止 finalcut 模块在纯 assets 推进时被加载——若 typecheck 对动态导入 .ts 报错，改为顶部静态 import（模块本就零副作用，静态导入更简单，推荐静态）。
3. `deps['ask']` 未在接口声明——把 `ask?: (stage, info) => Promise<boolean>` 补进 MachineDeps（gate ask 用）。
4. `sapi` 分支照 `buildSapiScript` 写完整（写 ps1 0600 → `powershell -NoProfile -File` → 探时长），真机验证 SKIPPED（mac）如实标注。
5. 断点续跑语义：段 done → 跳过；段 running/failed → 重跑该段（shot-urls 事件恢复 i2v 输入）。
6. 并发泵内 confirmer 被多个镜头并发调用——确认一次即全段放行的语义由 confirmer 实现方保证（demo 用缓存版 confirmer：同段首次询问后缓存结果），machine 透传即可。

- [ ] **Step 4:** `npm test`（约 120 pass）
- [ ] **Step 5: Commit** — `git commit -m "feat: 七段流水线状态机——断点续跑/gate/并发泵/记账/事件流"`

---

### Task 5: vgen_generate / vgen_status 工具

**Files:** Create `src/tools/generate.ts`；Modify `src/host/index.ts`（注册 + 通告文本更新）；Test `test/tools-generate.test.ts`

- [ ] **Step 1: 写失败测试 `test/tools-generate.test.ts`**（fake providers + fake confirm，模式同 machine 测试；验证：① vgen_generate {runId,target:'shot-assets'} 走通并返回产物清单 ② 未确认时返回 ok:false + `error.code:'confirm-required'` + message 含确认参数指引 ③ vgen_status 返回 stages/events 尾部/产物存在性）
- [ ] **Step 2:** RED → **Step 3: 实现 `src/tools/generate.ts`**

```ts
/** vgen_generate：推进非 LLM 段（assets/video/final）。确认语义：估价未知或超阈值且未带 confirm:true → 返回 confirm-required（会话模型向用户转述后带 confirm 重调）。 */

import type { VaultStore } from '../store/vault.ts'
import type { RunStore } from '../store/runs.ts'
import { fetchPricing, type PricingTable } from '../pricing.ts'
import { SpendLedger } from '../spend.ts'
import { providerForModel } from '../registry.ts'
import { advanceRun } from '../pipeline/machine.ts'
import { HandoffError } from '../schema/handoff.ts'

export interface GenerateContext {
  vault: VaultStore
  runs: RunStore
  /** 通道（站点根）——从 vault 默认通道解析。 */
  channel: () => { id: string; baseUrl: string; apiKey: string }
  env?: NodeJS.ProcessEnv
}

export function buildGenerateTools(ctx: GenerateContext): {
  generate: { execute: (args: { runId: string; target: 'assets' | 'video' | 'final'; confirm?: boolean; concurrency?: number }) => Promise<ToolResult> }
  status: { execute: (args: { runId: string }) => Promise<ToolResult> }
} {
  const env = ctx.env ?? process.env
  const ledger = SpendLedger.open(env)
  return {
    generate: {
      execute: async (args) => {
        try {
          const channel = ctx.channel()
          const pricing: PricingTable | null = await fetchPricing(channel, undefined, 15000).catch(() => null)
          let denied = 0
          const r = await advanceRun({
            runs: ctx.runs,
            runId: args['runId'],
            target: args['target'] === 'assets' ? 'shot-assets' : args['target'] === 'video' ? 'video' : 'final-cut',
            channel,
            providers: { forModel: (model, opts) => providerForModel(channel, model, { fetchImpl: opts?.fetchImpl, estimate: (m) => (pricing ? estimateFor(pricing, m) : null)) } },
            pricing,
            confirmer: async (est) => {
              if (args['confirm']) return true
              denied++
              return false
            },
            ffmpeg: locateFfmpeg(env),
            concurrency: args['concurrency'],
          })
          return { ok: true, value: { runId: r.runId, stages: r.stages, shotImages: r.shotImages?.length ?? 0, clips: r.clipFiles?.length ?? 0, finalOutput: r.finalOutput } }
        } catch (err) {
          if (denied > 0) {
            return { ok: false, error: { code: 'confirm-required', message: `有 ${denied} 笔消费需要确认（估价见记账事件）。向用户转述成本后，携带 confirm:true 重新调用 vgen_generate 以继续。` } }
          }
          if (err instanceof HandoffError) return { ok: false, error: { code: err.code, message: err.message } }
          return { ok: false, error: { code: 'internal', message: err instanceof Error ? err.message : String(err) } }
        }
      },
    },
    status: {
      execute: async (args) => {
        const record = ctx.runs.get(String(args['runId'] ?? ''))
        if (!record) return { ok: false, error: { code: 'not-found', message: `run 不存在: ${args['runId']}` } }
        return { ok: true, value: { id: record.id, title: record.title, status: record.status, stages: record.stages, recentEvents: record.events.slice(-5) } }
      },
    },
  }
}
```

**实现者注意**：① `estimateFor(pricing, m)` = pricing 层 estimateCny 的适配（补 import）；② `locateFfmpeg` 从 finalcut/render-ffmpeg 导入；③ `ToolResult` 类型从 tools/handoff.ts 复用导出；④ channel() 的实现：vault 默认通道 `vault.load().defaultChannelId` → `vault.getChannel(id)`（明文，host 内部合法）；⑤ `fetchPricing(channel…)` 的 channel 现在是站点根（拓扑契约）。
- [ ] **Step 4:** host/index.ts：`buildGenerateTools({ vault, runs, channel: () => { const d = vault.load().defaultChannelId; const c = d ? vault.getChannel(d) : null; if (!c) throw new Error('未配置通道：请先在设置页添加通道'); return { id: c.id, baseUrl: c.baseUrl, apiKey: c.apiKey } } })`，defs 注册 `vgen_generate`（parameters：runId/target 枚举/confirm/concurrency，description 强调"confirm 仅在向用户转述成本后使用"）与 `vgen_status`；vgenGuidance 文本追加两工具用法与确认语义
- [ ] **Step 5:** `npm test` 全绿 / typecheck / build；**Commit** — `git commit -m "feat: vgen_generate/vgen_status——确认语义状态化（confirm-required）+ 通道解析"`

---

### Task 6: 三镜漫剧端到端真机（出口验证）

**Files:** Create `scripts/demo-drama.ts`

- [ ] **Step 1: 实现 `scripts/demo-drama.ts`**：不走工具 execute（工具在宿主内），直接组装与工具等价的调用链：buildHandoffTools 三连（story/script/storyboard）→ buildGenerateTools.generate（target 'final'，confirm 交互）→ 打印 run 产物清单。内容：鲸鱼三镜（角色 linjing + 场景 s1 + 3 镜头，voiceHint 每镜一句中文旁白）。key/base 从 env。
- [ ] **Step 2: 真机出口**
```bash
export VGEN_BASE_URL="https://api.vectorengine.cn"
export VGEN_API_KEY="<key>"
node scripts/demo-drama.ts /tmp/vgen-m3b-demo
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 /tmp/vgen-m3b-demo/*/final.mp4
head -8 /tmp/vgen-m3b-demo/*/final.srt
```
预期：3 段 clip 下载 + TTS（mac say Tingting）+ final.mp4（≥12s，h264）+ final.srt 三条字幕 + 消费记账（预估 ~0.2×4图 + 0.013×3视频 ≈ 0.84 档位值）。
- [ ] **Step 3: Commit** — `git commit -m "feat(m3b): 三镜漫剧端到端真机出口（story→script→storyboard→资产→视频→成片+SRT）"`

---

## 自审记录

1. **规格覆盖（M3b 范围）**：§5.1 断点续跑/gate（Task 4）、并发泵（Task 4）、成片链路 TTS/timeline/ffmpeg/SRT（Task 1-3）、§7.1 vgen_generate/vgen_status（Task 5）、§9 M3 出口三镜端到端（Task 6）、M2 遗留 probe /v1（Task 0）。
2. **占位扫描**：Task 4 machine 骨架中的 `charge` 占位与毛糙 fcParts 收敛均已带**实现者注意**强制重写指令（非 TBD）；kling 实钉、非 TTY 确认为已声明 SKIPPED/边界。
3. **类型一致性**：`ToolResult`（M3a tools/handoff 导出，Task 5 复用）；`ChannelRef`（registry）；`pollUntil`（M3a poll，Task 4 video 段消费）；`estimateCny/PricingTable`（M2 pricing，Task 4/5 消费）；`DshToolDefinition`（M2 实钉契约）。
