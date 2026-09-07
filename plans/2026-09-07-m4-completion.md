# M4 收官实施计划：vgen_review 评审重拍 + 设置页 2 tab + gate manual + 题材包

**Goal:** 完成规格 §9 M4 里程碑——质量评审闭环（抽帧评分 + 自动重拍 ≤2）、manual gate 真接线（人工产物注入）、设置页双 tab（视频工坊 / 通道管理）、1 个题材包预设，出口 = 无 key mock demo + 真机 demo 双达标。

**Architecture:** 延续既有分层——run.json 事实源（新增 `reviews`/`gates` 字段）、工具面纯函数 + 依赖注入（fetchImpl/providersOverride/confirmer/extract 全可替换）、host 路由信封 + loopback 围栏（新增 media 流式路由，防穿越）、客户端沿用 super-ppts 手写自注册 bundle 形态（`window.__ModuleLoader__.load`，零构建依赖）。单镜生成序列（submit→poll→fetch→save）从 machine 抽出为 `shot-clip.ts`，供 video 段与评审重拍共用。

**Tech Stack:** TypeScript strict（erasableSyntaxOnly，Node 24 strip-types 直跑测试）、node:test、零运行时依赖、ffmpeg（抽帧/lavfi 占位片/crop 归一化）、React（宿主注入，客户端 bundle 仅 `require("react")`）。

**对规格的两处显式偏离（记录在案）：**
1. 工具数 7 → **8**：manual gate 产物注入需要独立入口 `vgen_provide`（规格 §5.2 要求"用户在会话中提供该段产物文件/JSON，插件校验后接管管线"，但 §7.1 工具表未给它位置；塞进 vgen_generate 会污染其语义）。
2. 题材包以 **Agent 预设 persona**（super-ppts presets 模式）承载，不做独立 JSON 主题文件（YAGNI：会话模型经预设获得题材词汇/ archetype/节奏模板已闭环）。

**已知限制（写进 README，不在本计划内修）：**
- 手动提供的 shot 参考图无公网 URL → video 段自动 i2v 不可用（vgen_provide 响应内警示 + 评审重拍拒绝并给出 rerunStage 指引）。
- kling 上游饱和，`pin-kling-contract.ts` 真机钉契约继续挂起；Windows SAPI 真机验证继续 SKIPPED（无 Windows 机器）。
- happyhorse 等免费档模型带平台水印 → 仅文档警示 + 设置页备注（二期做通道白名单/降档选项）。

---

## 文件结构总览

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/store/runs.ts` | 修改 | RunRecord 增 `reviews`/`gates` 可选字段 + sanitize + `setReview`/`setGates` |
| `src/review/frames.ts` | 新建 | 25/50/75% 抽帧（时间戳/参数纯函数 + exec/probe 注入） |
| `src/pipeline/shot-clip.ts` | 新建 | `saveUrl`（自 machine 迁入）+ `SHOT_MOTION_PROMPT` + `generateShotClip` 共用序列 |
| `src/pipeline/machine.ts` | 修改 | video 段改用 generateShotClip；导出 VIDEO_MODEL_DEFAULT；gate 错误类；图像 size 透传 + 400 降级 |
| `src/tools/review.ts` | 新建 | vgen_review 两阶段（抽帧 / 评分 + 自动重拍 ≤2 + confirm 语义） |
| `src/tools/provide.ts` | 新建 | vgen_provide manual 产物注入（4 个媒体段分策略校验） |
| `src/tools/generate.ts` | 修改 | gates 持久化 + gateApprovals（ask 接线）+ rerunStage + status 增 reviews/gates |
| `src/tools/channels.ts` | 新建 | vgen_channels list/health/spend |
| `src/host/artifacts.ts` | 新建 | collectArtifacts 产物清单（设置页工坊 tab 数据源） |
| `src/host/routes.ts` | 修改 | runs.get / channels.adoptModels / settings.update gateDefaults / resolveMediaPath |
| `src/host/index.ts` | 修改 | media 路由 + runs prefix 路由 + GET /channels 与 POST /settings 便捷路由 + 3 个新工具注册 + 预设安装 + guidance 更新 |
| `src/finalcut/render-ffmpeg.ts` | 修改 | 归一化 pad→crop（消黑边） |
| `lib/client.js` | 新建（手写） | 设置页双 tab 自注册 bundle |
| `src/client/index.ts` | 新建（类型参考，tsconfig exclude） | 与 lib/client.js 同构的服务声明文档 |
| `package.json` | 修改 | dsh.client + exports["./client"] + files 加 presets |
| `tsconfig.json` | 修改 | exclude src/client |
| `presets/preset.yml`、`presets/agent.cordis.yml` | 新建 | 漫剧导演预设（含疗愈绘本题材包） |
| `scripts/demo-mock.ts` | 重写 | 零 key 全链路（三段交接→成片→评审重拍闭环） |
| `scripts/demo-drama.ts` | 修改 | VGEN_AUTO_CONFIRM 收紧 + 评审抽帧步骤 |
| `scripts/demo-single-shot.ts` | 修改 | VGEN_AUTO_CONFIRM 收紧 |
| `README.md` | 修改 | M4 工具面/设置页/限制/水印说明 |
| 测试 | 新建/修改 | `test/frames.test.ts`、`test/review.test.ts`、`test/provide.test.ts`、`test/channels.test.ts`、`test/artifacts.test.ts`、`test/client-bundle.test.ts`；扩 `runs/generate/routes/host-index/machine/render-ffmpeg` 既有测试 |

**执行约定：** 分支 `feat/m4-completion`；每任务末尾全量 `npm run typecheck && npm test` 绿后提交；ffmpeg 相关真机验证统一用 `VGEN_FFMPEG="/Users/libing/Library/Application Support/bilibili/ffmpeg/ffmpeg"`（含 drawtext；homebrew 8.1 无 drawtext）。

---

### Task 0: 分支与基线

**Files:** 无代码改动

- [ ] **Step 1: 确认基线绿**

Run: `cd /Users/libing/kk_Projects/dsh-video-generator && npm run typecheck && npm test 2>&1 | tail -3`
Expected: typecheck 零错误；`# pass 128`（或当前全绿数）

- [ ] **Step 2: 开分支**

```bash
git checkout -b feat/m4-completion
```

---

### Task 1: RunRecord 扩展——reviews / gates 持久化

**Files:**
- Modify: `src/store/runs.ts`
- Test: `test/runs.test.ts`（追加）

- [ ] **Step 1: 写失败测试（追加到 test/runs.test.ts 末尾）**

```ts
test('M4: reviews/gates 合法形状往返持久化', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-runs-m4-'))
  const store = RunStore.open({ rootDir: dir })
  const run = store.create('评审往返')
  store.setReview(run.id, 'shot-1', { scores: [2, 4], retries: 1, passed: true })
  store.setGates(run.id, { video: 'ask', 'final-cut': 'manual' })
  const got = store.get(run.id)!
  assert.deepEqual(got.reviews?.['shot-1'], { scores: [2, 4], retries: 1, passed: true })
  assert.deepEqual(got.gates, { video: 'ask', 'final-cut': 'manual' })
})

test('M4: setGates 增量合并不清空既有键', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-runs-m4b-'))
  const store = RunStore.open({ rootDir: dir })
  const run = store.create('gates 合并')
  store.setGates(run.id, { video: 'ask' })
  store.setGates(run.id, { 'final-cut': 'manual' })
  assert.deepEqual(store.get(run.id)!.gates, { video: 'ask', 'final-cut': 'manual' })
})

test('M4: 非法 reviews/gates 形状整体丢弃（记录仍有效）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-runs-m4c-'))
  const store = RunStore.open({ rootDir: dir })
  const run = store.create('形状守卫')
  const file = join(dir, run.id, 'run.json')
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  raw.reviews = { 'shot-1': { scores: 'bad', retries: 0, passed: true } }
  raw.gates = { video: 'teleport' }
  writeFileSync(file, JSON.stringify(raw))
  const got = store.get(run.id)!
  assert.equal(got.reviews, undefined)
  assert.equal(got.gates, undefined)
  assert.equal(got.id, run.id)
})
```

注意：`test/runs.test.ts` 顶部现有 import 若无 `readFileSync`/`writeFileSync` 则补上（`node:fs`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --test-reporter tap test/runs.test.ts 2>&1 | tail -5`
Expected: FAIL（`store.setReview is not a function`）

- [ ] **Step 3: 实现（src/store/runs.ts）**

在 `RunEvent` 接口后新增：

```ts
/** 单镜评审档案（规格 §5.3：评分与重拍次数记录进 run.json）。key 形如 `shot-3`。 */
export interface ReviewEntry {
  scores: number[]
  retries: number
  passed: boolean
}
```

`import type { GateMode } from './vault.ts'` 加到顶部 type import 区；`RunRecord` 增加两个可选字段：

```ts
export interface RunRecord {
  id: string
  title: string
  status: RunStatus
  stages: Record<string, StageState>
  events: RunEvent[]
  createdAt: string
  updatedAt: string
  /** 评审档案（可选：旧 run.json 无此字段仍合法）。 */
  reviews?: Record<string, ReviewEntry>
  /** 每段 gate 模式覆盖（可选；生效优先级 = vault.gateDefaults < run.gates < 本次调用参数）。 */
  gates?: Record<string, GateMode>
}
```

`sanitizeRun` 中，在 `if (!Array.isArray(r.events)) return null` 之后、return 对象之前加校验函数并组装：

```ts
function sanitizeReviews(raw: unknown): Record<string, ReviewEntry> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const out: Record<string, ReviewEntry> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'object' || v === null) return undefined
    const e = v as Partial<ReviewEntry>
    if (!Array.isArray(e.scores) || !e.scores.every((s) => typeof s === 'number' && Number.isFinite(s))) return undefined
    if (typeof e.retries !== 'number' || !Number.isInteger(e.retries) || e.retries < 0) return undefined
    if (typeof e.passed !== 'boolean') return undefined
    out[k] = { scores: e.scores, retries: e.retries, passed: e.passed }
  }
  return out
}

function sanitizeGates(raw: unknown): Record<string, GateMode> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const out: Record<string, GateMode> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v !== 'auto' && v !== 'ask' && v !== 'manual') return undefined
    out[k] = v
  }
  return out
}
```

sanitizeRun 返回值追加（保持既有字段在前）：

```ts
  const reviews = sanitizeReviews((raw as Partial<RunRecord>).reviews)
  const gates = sanitizeGates((raw as Partial<RunRecord>).gates)
  return {
    ...既有七字段原样...,
    ...(reviews ? { reviews } : {}),
    ...(gates ? { gates } : {}),
  }
```

RunStore 类在 `setStatus` 之后新增：

```ts
  setReview(id: string, key: string, entry: ReviewEntry): void {
    this.mutate(id, (r) => {
      if (!r.reviews) r.reviews = {}
      r.reviews[key] = entry
    })
  }

  /** 增量合并 gate 覆盖（undefined 值不清空既有键）。 */
  setGates(id: string, gates: Record<string, GateMode>): void {
    this.mutate(id, (r) => {
      r.gates = { ...(r.gates ?? {}), ...gates }
    })
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --test-reporter tap test/runs.test.ts 2>&1 | tail -3`
Expected: PASS（全绿）

- [ ] **Step 5: 全量校验 + 提交**

```bash
npm run typecheck && npm test 2>&1 | tail -3
git add src/store/runs.ts test/runs.test.ts
git commit -m "feat(m4): RunRecord reviews/gates 持久化 + 形状守卫（sanitize 非法整体丢弃）"
```

---

### Task 2: 抽帧模块 src/review/frames.ts

**Files:**
- Create: `src/review/frames.ts`
- Test: `test/frames.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --test-reporter tap test/frames.test.ts 2>&1 | tail -3`
Expected: FAIL（Cannot find module '../src/review/frames.ts'）

- [ ] **Step 3: 实现**

```ts
// src/review/frames.ts
/** 评审抽帧：ffmpeg 按 25/50/75% 抽 3 帧（规格 §5.3）。exec/probe 注入可测，零真 ffmpeg 依赖。 */

import { existsSync, mkdirSync, statSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { probeDurationSec } from '../finalcut/render-ffmpeg.ts'

export type ExecRunner = (cmd: string, args: string[]) => Promise<void>

function defaultExec(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 60000, maxBuffer: 4 * 1024 * 1024 }, (err) => (err ? reject(err) : resolve()))
  })
}

/** 25/50/75% 三个时间点（秒，3 位小数）；时长非法即抛（评审输入必须已核验）。 */
export function frameTimestamps(durationSec: number): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error(`非法时长: ${durationSec}`)
  return [0.25, 0.5, 0.75].map((r) => Number((durationSec * r).toFixed(3)))
}

/** -ss 放 -i 前 = 输入端快速定位（关键帧精度对评审足够）。 */
export function buildFrameArgs(clip: string, atSec: number, out: string): string[] {
  return ['-y', '-ss', String(atSec), '-i', clip, '-frames:v', '1', '-q:v', '2', out]
}

export interface ExtractOptions {
  probe?: (file: string, ffmpeg: string) => Promise<number | null>
  exec?: ExecRunner
}

export async function extractReviewFrames(
  clip: string,
  outDir: string,
  ffmpeg: string,
  opts: ExtractOptions = {},
): Promise<string[]> {
  const probe = opts.probe ?? probeDurationSec
  const exec = opts.exec ?? defaultExec
  const dur = await probe(clip, ffmpeg)
  if (dur === null) throw new Error(`无法读取片段时长: ${clip}`)
  mkdirSync(outDir, { recursive: true })
  const outs: string[] = []
  const stamps = frameTimestamps(dur)
  for (let i = 0; i < stamps.length; i++) {
    const out = join(outDir, `frame-${i + 1}.png`)
    await exec(ffmpeg, buildFrameArgs(clip, stamps[i]!, out))
    if (!existsSync(out) || statSync(out).size === 0) throw new Error(`抽帧未产出: ${out}`)
    outs.push(out)
  }
  return outs
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --test-reporter tap test/frames.test.ts 2>&1 | tail -3`
Expected: PASS（6 tests）

- [ ] **Step 5: 全量校验 + 提交**

```bash
npm run typecheck && npm test 2>&1 | tail -3
git add src/review/frames.ts test/frames.test.ts
git commit -m "feat(m4): 评审抽帧模块——25/50/75% 三帧，exec/probe 注入零 ffmpeg 依赖测试"
```

---

### Task 3: 单镜生成序列抽取 shot-clip.ts + machine 重构（行为不变）

**Files:**
- Create: `src/pipeline/shot-clip.ts`
- Modify: `src/pipeline/machine.ts`（video 段 worker、saveUrl 迁移、导出 VIDEO_MODEL_DEFAULT、gate 错误类）
- Test: `test/machine.test.ts`（仅修消息断言，如有）

- [ ] **Step 1: 新建 shot-clip.ts**

```ts
// src/pipeline/shot-clip.ts
/** 单镜视频片段生成序列（machine video 段与 vgen_review 重拍共用，DRY）。
 *  职责边界：只做 submit→poll→fetch→save；成本确认/记账/事件由调用方负责。 */

import { writeFileSync } from 'node:fs'
import type { Provider } from '../provider.ts'
import { pollUntil, retryTransient } from '../poll.ts'

/** i2v 通用运动提示词（重拍时在其后追加负面要求）。 */
export const SHOT_MOTION_PROMPT = '镜头缓慢推进，主体自然运动，电影感光影'

/** 下载 URL 到本地（0600）；120s 超时（对偶发慢 CDN 的实测收紧值）。 */
export async function saveUrl(fetchImpl: typeof fetch, url: string, file: string): Promise<void> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(120000) })
  if (!res.ok) throw new Error(`下载失败 http-${res.status}`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()), { mode: 0o600 })
}

export interface ShotClipOptions {
  provider: Provider
  fetchImpl: typeof fetch
  imageUrl: string
  prompt: string
  durationSec: number
  outFile: string
  pollDelayMs?: number
  maxPollMs?: number
  /** submit 成功即回调（调用方在此落 spend 事件，保持与原 machine 相同的事件顺序）。 */
  onSubmit?: (jobId: string) => void
}

export async function generateShotClip(o: ShotClipOptions): Promise<string> {
  const { jobId } = await retryTransient(() => o.provider.submit('video', {
    prompt: o.prompt,
    imageUrl: o.imageUrl,
    durationSec: o.durationSec,
  }))
  o.onSubmit?.(String(jobId))
  const finalState = await pollUntil(
    () => o.provider.status(String(jobId)),
    { isFinal: (s) => s.state === 'done' || s.state === 'failed', delayMs: o.pollDelayMs ?? 1000, maxPollMs: o.maxPollMs ?? 600000 },
  )
  if (finalState.state === 'failed') throw new Error(`视频生成失败: ${finalState.error ?? '?'}`)
  const f = await o.provider.fetch(String(jobId))
  const url = f.outputs[0]
  if (!url) throw new Error('任务完成但无输出')
  await saveUrl(o.fetchImpl, url, o.outFile)
  return o.outFile
}
```

- [ ] **Step 3a: machine.ts 重构（改前先跑一遍现有 machine 测试记录基线）**

Run: `node --test --test-reporter tap test/machine.test.ts 2>&1 | tail -3`（记下 pass 数）

machine.ts 修改点（保持既有行为与事件顺序）：

1. 顶部：删除本地 `saveUrl` 函数；import 改为：

```ts
import { generateShotClip, saveUrl, SHOT_MOTION_PROMPT } from './shot-clip.ts'
```

（`saveUrl` 仍被 master-asset/shot-assets 段使用；`pollUntil, retryTransient` 的 import 中 `pollUntil` 若仅 video 段使用则保留 `retryTransient` 供图像段，删除不再引用者，以 typecheck 为准。）

2. `const VIDEO_MODEL_DEFAULT = 'happyhorse-1.1-i2v'` 前加 `export`（vgen_review 复用同一缺省）。

3. gate 错误类（供工具层按 instanceof 转信封，替代字符串嗅探）：

```ts
/** manual gate 拦截（工具层转 manual-gate 信封，指引 vgen_provide）。 */
export class ManualGateError extends Error {}
/** ask gate 被拒（工具层转 gate-approval 信封，指引 gateApprovals 重调）。 */
export class AskGateRejectedError extends Error {}
```

ensureGate 内两处 throw 替换（**消息文本保持不变**，仅换错误类）：

```ts
if (mode === 'manual') throw new ManualGateError(`段 ${stage} 为 manual 模式：请先在会话中提供该段产物（文件/JSON）后再推进`)
...
if (ok !== true) throw new AskGateRejectedError(`段 ${stage} 在 ask 审批中被拒绝`)
```

4. video 段 pump worker 替换为（spend 事件顺序 = 原实现：submit 成功后、poll 前）：

```ts
await pump(shotUrls, deps.concurrency ?? 2, async (shot) => {
  const durationSec = sb.shots.find((s) => s.index === shot.index)?.durationSec ?? 5
  const est = deps.pricing ? estimateCny(videoModel, deps.pricing) : null
  if (!(await deps.confirmer(est, 'video'))) throw new Error(`用户取消（shot ${shot.index}）`)
  const file = join(clipsDir, `shot-${String(shot.index).padStart(3, '0')}.mp4`)
  try {
    await generateShotClip({
      provider: p,
      fetchImpl,
      imageUrl: shot.url,
      prompt: SHOT_MOTION_PROMPT,
      durationSec,
      outFile: file,
      pollDelayMs: deps.pollDelayMs,
      onSubmit: (jobId) => {
        runs.appendEvent(runId, 'spend', { stage: st, model: videoModel, estCny: est, shot: shot.index, jobId: jobId.slice(0, 80) })
      },
    })
  } catch (err) {
    // 保留 shot 上下文前缀（原实现的判别性消息形态）
    throw new Error(`shot ${shot.index}: ${err instanceof Error ? err.message : String(err)}`)
  }
  clipFiles.push(file)
})
```

5. 检查 `test/machine.test.ts` 中断言旧错误消息的用例：`shot N 视频失败: X` → 新形态 `shot N: 视频生成失败: X`；`shot N 完成但无输出` → `shot N: 任务完成但无输出`。用 `grep -n "视频失败\|完成但无输出" test/machine.test.ts` 定位并同步修改断言（这是预期行为微调：消息加统一前缀，语义不变）。

- [ ] **Step 3b: 跑全量测试**

Run: `npm run typecheck && npm test 2>&1 | tail -3`
Expected: 全绿（基线 pass 数不减）

- [ ] **Step 4: 提交**

```bash
git add src/pipeline/shot-clip.ts src/pipeline/machine.ts test/machine.test.ts
git commit -m "refactor(m4): 单镜生成序列抽出 shot-clip.ts（machine/重拍共用）+ gate 错误类判别化"
```

---

### Task 4: vgen_review 工具（抽帧 → 评分 → 自动重拍 ≤2）

**Files:**
- Create: `src/tools/review.ts`
- Test: `test/review.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// test/review.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunStore } from '../src/store/runs.ts'
import { VaultStore } from '../src/store/vault.ts'
import { buildReviewTools, reviewToolDefs } from '../src/tools/review.ts'
import type { Provider } from '../src/provider.ts'

/** 种一个已完成 video 段的 run：storyboard + clip 文件 + shot-urls 事件。 */
function seedRun(runs: RunStore, opts: { url?: string } = {}): string {
  const run = runs.create('评审 run')
  const dir = join(runs.rootDir, run.id)
  mkdirSync(join(dir, 'clips'), { recursive: true })
  writeFileSync(join(dir, 'storyboard.json'), JSON.stringify({ shots: [{ index: 1, durationSec: 5 }, { index: 2, durationSec: 4 }] }))
  writeFileSync(join(dir, 'clips', 'shot-001.mp4'), 'old-clip')
  runs.setStage(run.id, 'video', 'done')
  runs.appendEvent(run.id, 'shot-urls', { urls: [{ index: 1, url: opts.url ?? 'mock://img/1.png', file: join(dir, 'shots', 'shot-001.png') }] })
  return run.id
}

function fakeCtx(runs: RunStore, providerCalls: string[] = []) {
  const vaultFile = join(mkdtempSync(join(tmpdir(), 'vgen-vault-')), 'vault.json')
  const fakeProvider: Provider = {
    id: 'fake', capabilities: {},
    async quote() { return { qualityTier: 5, costEstimate: 0, currency: 'CNY' } },
    async submit(_s, spec) { providerCalls.push(`submit:${String(spec['prompt']).slice(0, 20)}`); return { jobId: 'job-1' } },
    async status() { return { state: 'done', progress: 100 } },
    async fetch() { return { outputs: ['mock://out/new.mp4'] } },
    async health() { return { ok: true } },
  }
  return {
    vault: VaultStore.open({ file: vaultFile }),
    runs,
    channel: () => ({ id: 'c', baseUrl: 'https://mock.invalid', apiKey: 'k' }),
    providersOverride: { forModel: () => fakeProvider },
    fetchImpl: (async (_u: string) => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })) as unknown as typeof fetch,
    extract: async (_c: string, outDir: string) => {
      mkdirSync(outDir, { recursive: true })
      return [1, 2, 3].map((i) => { const p = join(outDir, `frame-${i}.png`); writeFileSync(p, 'f'); return p })
    },
    ffmpeg: '/bin/true',
    confirmer: async () => true,
    pricing: null,
    providerCalls,
  }
}

test('阶段A：无 score → 抽 3 帧返回路径 + 评分指引', async () => {
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-rev-')) })
  const runId = seedRun(runs)
  const ctx = fakeCtx(runs)
  const tools = buildReviewTools(ctx)
  const r = await tools.review.execute({ runId, shot: 1 })
  assert.equal(r.ok, true)
  if (!r.ok) return
  const v = r.value as { frames: string[]; next: string }
  assert.equal(v.frames.length, 3)
  assert.ok(v.frames.every((f) => existsSync(f)))
  assert.match(v.next, /score/)
})

test('阶段A：clip 不存在 → bad-request 指引先完成 video 段', async () => {
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-rev2-')) })
  const runId = seedRun(runs)
  const tools = buildReviewTools(fakeCtx(runs))
  const r = await tools.review.execute({ runId, shot: 2 })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.error.code, 'bad-request')
  assert.match(r.error.message, /尚无成片片段/)
})

test('阶段B：score≥3 → passed 记录进 run.json', async () => {
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-rev3-')) })
  const runId = seedRun(runs)
  const tools = buildReviewTools(fakeCtx(runs))
  const r = await tools.review.execute({ runId, shot: 1, score: 4 })
  assert.equal(r.ok, true)
  const rec = runs.get(runId)!
  assert.deepEqual(rec.reviews?.['shot-1'], { scores: [4], retries: 0, passed: true })
})

test('阶段B：score 越界 clamp 进 1..5', async () => {
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-rev4-')) })
  const runId = seedRun(runs)
  const tools = buildReviewTools(fakeCtx(runs))
  await tools.review.execute({ runId, shot: 1, score: 9 })
  assert.deepEqual(runs.get(runId)!.reviews?.['shot-1']?.scores, [5])
})

test('阶段B：非法 score（字符串）→ review-invalid 事件，不重拍不记录', async () => {
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-rev5-')) })
  const runId = seedRun(runs)
  const calls: string[] = []
  const tools = buildReviewTools(fakeCtx(runs, calls))
  const r = await tools.review.execute({ runId, shot: 1, score: '很棒' as unknown as number })
  assert.equal(r.ok, true)
  assert.equal((r.value as { action: string }).action, 'ignored')
  assert.equal(calls.length, 0)
  assert.equal(runs.get(runId)!.reviews, undefined)
  assert.ok(runs.get(runId)!.events.some((e) => e.type === 'review-invalid'))
})

test('阶段B：score≤2 → 自动重拍（备份旧片 + 负面词入 prompt + retries=1 + 新帧返回）', async () => {
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-rev6-')) })
  const runId = seedRun(runs)
  const calls: string[] = []
  const tools = buildReviewTools(fakeCtx(runs, calls))
  const r = await tools.review.execute({ runId, shot: 1, score: 2, negativeHint: '肢体扭曲' })
  assert.equal(r.ok, true)
  const v = r.value as { action: string; retriesUsed: number; frames: string[] }
  assert.equal(v.action, 'reshoot')
  assert.equal(v.retriesUsed, 1)
  assert.equal(v.frames.length, 3)
  // 旧片备份、新片落位
  const clips = join(runs.rootDir, runId, 'clips')
  assert.ok(existsSync(join(clips, 'shot-001.rejected-1.mp4')))
  assert.ok(existsSync(join(clips, 'shot-001.mp4')))
  assert.notEqual(readFileSync(join(clips, 'shot-001.mp4'), 'utf8'), 'old-clip')
  // 负面词进了重拍 prompt（通用负面 + 自定义 hint）
  assert.equal(calls.length, 1)
  assert.match(calls[0]!, /镜头缓慢推进/)
  const rec = runs.get(runId)!
  assert.deepEqual(rec.reviews?.['shot-1'], { scores: [2], retries: 1, passed: false })
  assert.ok(rec.events.some((e) => e.type === 'reshoot'))
  assert.ok(rec.events.some((e) => e.type === 'spend'))
})

test('阶段B：重拍 2 次耗尽 → retry-exhausted，不再调 provider', async () => {
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-rev7-')) })
  const runId = seedRun(runs)
  const calls: string[] = []
  const ctx = fakeCtx(runs, calls)
  const tools = buildReviewTools(ctx)
  await tools.review.execute({ runId, shot: 1, score: 1 })
  await tools.review.execute({ runId, shot: 1, score: 1 })
  const callsBefore = calls.length
  const r = await tools.review.execute({ runId, shot: 1, score: 1 })
  assert.equal((r.value as { action: string }).action, 'retry-exhausted')
  assert.equal(calls.length, callsBefore)
  assert.equal(runs.get(runId)!.reviews?.['shot-1']?.retries, 2)
})

test('阶段B：重拍花费未确认 → confirm-required 信封', async () => {
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-rev8-')) })
  const runId = seedRun(runs)
  const ctx = fakeCtx(runs)
  delete (ctx as { confirmer?: unknown }).confirmer
  const tools = buildReviewTools(ctx)
  const r = await tools.review.execute({ runId, shot: 1, score: 2 })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.error.code, 'confirm-required')
})

test('阶段B：参考图无公网 URL（手动提供）→ bad-request 指引 rerunStage', async () => {
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-rev9-')) })
  const runId = seedRun(runs, { url: '' })
  const tools = buildReviewTools(fakeCtx(runs))
  const r = await tools.review.execute({ runId, shot: 1, score: 2, confirm: true })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.error.code, 'bad-request')
  assert.match(r.error.message, /rerunStage=shot-assets/)
})

test('未知 runId → not-found；shot 越界 → bad-request', async () => {
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-rev10-')) })
  const tools = buildReviewTools(fakeCtx(runs))
  const r1 = await tools.review.execute({ runId: 'run-nope', shot: 1 })
  assert.equal(r1.ok, false)
  if (!r1.ok) assert.equal(r1.error.code, 'not-found')
  const runId = seedRun(runs)
  const r2 = await tools.review.execute({ runId, shot: 0 })
  assert.equal(r2.ok, false)
  if (!r2.ok) assert.equal(r2.error.code, 'bad-request')
})

test('reviewToolDefs 契约：名称/参数/渲染', () => {
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-rev11-')) })
  const defs = reviewToolDefs(buildReviewTools(fakeCtx(runs)))
  assert.equal(defs.length, 1)
  assert.equal(defs[0]!.name, 'vgen_review')
  assert.deepEqual((defs[0]!.parameters as { required: string[] }).required, ['runId', 'shot'])
  const rendered = defs[0]!.output.render({}, { a: 1 })
  assert.deepEqual(rendered, [{ type: 'text', text: '{"a":1}' }])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --test-reporter tap test/review.test.ts 2>&1 | tail -3`
Expected: FAIL（Cannot find module '../src/tools/review.ts'）

- [ ] **Step 3: 实现 src/tools/review.ts**

```ts
/** vgen_review：两阶段质量评审闭环（规格 §5.3）。
 *  阶段A（无 score）：抽该镜成片 25/50/75% 三帧，返回路径 + 评分指引（会话模型用读图工具查看）。
 *  阶段B（带 score）：1-5 clamp 记录进 run.json；≤2 自动追加负面词重拍（每镜 ≤2 次，花费走 confirm 语义）；
 *  非法 score 兜底不重拍（review-invalid 事件留痕）。重拍后自动重新抽帧，闭环回阶段B。 */

import { existsSync, readFileSync, renameSync } from 'node:fs'
import { join, basename } from 'node:path'
import type { VaultStore } from '../store/vault.ts'
import type { RunStore, RunEvent } from '../store/runs.ts'
import type { ChannelRef } from '../registry.ts'
import type { Provider } from '../provider.ts'
import { providerForModel } from '../registry.ts'
import { fetchPricing, estimateCny, type PricingTable } from '../pricing.ts'
import { locateFfmpeg } from '../finalcut/render-ffmpeg.ts'
import { extractReviewFrames } from '../review/frames.ts'
import { generateShotClip, SHOT_MOTION_PROMPT } from '../pipeline/shot-clip.ts'
import { GENERIC_NEGATIVE } from '../prompts.ts'
import { VIDEO_MODEL_DEFAULT } from '../pipeline/machine.ts'
import { HandoffError } from '../schema/handoff.ts'
import type { ToolResult, DshToolDefinition } from './handoff.ts'

export interface ReviewContext {
  vault: VaultStore
  runs: RunStore
  /** 默认通道解析（与 vgen_generate 同一注入形态）。 */
  channel: () => ChannelRef
  env?: NodeJS.ProcessEnv
  /** undefined → 按需 fetchPricing（失败容错 null）；测试传 null 跳过。 */
  pricing?: PricingTable | null
  /** 测试注入：重拍花费确认。生产 = args.confirm 语义。 */
  confirmer?: (est: number | null) => Promise<boolean>
  providersOverride?: { forModel: (model: string, opts?: { fetchImpl?: typeof fetch }) => Provider }
  fetchImpl?: typeof fetch
  /** 测试注入：抽帧实现。 */
  extract?: typeof extractReviewFrames
  /** undefined → locateFfmpeg(env)。 */
  ffmpeg?: string | null
  videoModel?: string
}

export interface ReviewArgs {
  runId: string
  shot: number
  score?: number
  negativeHint?: string
  confirm?: boolean
}

const MAX_RETRIES = 2

function shotFileBase(shot: number): string {
  return `shot-${String(shot).padStart(3, '0')}`
}

function lastEventOf(events: RunEvent[], type: string): RunEvent | undefined {
  const hits = events.filter((e) => e.type === type)
  return hits.length ? hits[hits.length - 1] : undefined
}

export function buildReviewTools(ctx: ReviewContext): {
  review: { execute: (args: ReviewArgs) => Promise<ToolResult> }
} {
  const env = ctx.env ?? process.env
  return {
    review: {
      execute: async (args): Promise<ToolResult> => {
        try {
          const runId = typeof args?.runId === 'string' ? args.runId : ''
          const record = ctx.runs.get(runId)
          if (!record) throw new HandoffError('not-found', `run 不存在: ${runId}`)
          const shot = Number(args?.shot)
          if (!Number.isInteger(shot) || shot < 1 || shot > 200) throw new HandoffError('bad-request', `shot 须为 1..200 整数: ${args?.shot}`)
          const runDir = join(ctx.runs.rootDir, runId)
          const clip = join(runDir, 'clips', `${shotFileBase(shot)}.mp4`)
          const reviewDir = join(runDir, 'review', shotFileBase(shot))
          const key = `shot-${shot}`
          const entry = { ...(record.reviews?.[key] ?? { scores: [], retries: 0, passed: false }) }
          const ffmpeg = ctx.ffmpeg !== undefined ? ctx.ffmpeg : locateFfmpeg(env)
          const extract = ctx.extract ?? extractReviewFrames
          const fetchImpl = ctx.fetchImpl ?? fetch

          // ---- 阶段A：抽帧 ----
          if (args?.score === undefined) {
            if (!existsSync(clip)) throw new HandoffError('bad-request', `shot ${shot} 尚无成片片段：先完成 video 段（vgen_generate target=video）`)
            if (!ffmpeg) throw new HandoffError('internal', '未找到 ffmpeg，无法抽帧（可设 VGEN_FFMPEG）')
            const frames = await extract(clip, reviewDir, ffmpeg)
            ctx.runs.appendEvent(runId, 'review-frames', { shot, frames })
            return {
              ok: true,
              value: {
                runId, shot, frames, retriesUsed: entry.retries,
                next: '用读图工具逐帧查看（构图/角色一致性/画面畸变），再携带 score（1-5 整数）重调 vgen_review：≥3 记通过；≤2 自动追加负面词重拍（每镜至多 2 次）',
              },
            }
          }

          // ---- 阶段B：评分 ----
          const raw: unknown = args.score
          if (typeof raw !== 'number' || !Number.isFinite(raw)) {
            ctx.runs.appendEvent(runId, 'review-invalid', { shot, raw: String(raw).slice(0, 80) })
            return { ok: true, value: { runId, shot, action: 'ignored', reason: 'score 须为 1-5 有限数字；本次不重拍' } }
          }
          const score = Math.min(5, Math.max(1, Math.round(raw)))
          entry.scores.push(score)

          if (score >= 3) {
            entry.passed = true
            ctx.runs.setReview(runId, key, entry)
            ctx.runs.appendEvent(runId, 'review', { shot, score, action: 'passed' })
            return { ok: true, value: { runId, shot, action: 'passed', score, scores: entry.scores, retriesUsed: entry.retries } }
          }

          if (entry.retries >= MAX_RETRIES) {
            ctx.runs.setReview(runId, key, entry)
            ctx.runs.appendEvent(runId, 'review', { shot, score, action: 'retry-exhausted' })
            return {
              ok: true,
              value: {
                runId, shot, action: 'retry-exhausted', score, scores: entry.scores, retriesUsed: entry.retries,
                next: `重拍已达上限 ${MAX_RETRIES} 次：建议人工处理（vgen_provide 注入替换片段）或调整分镜后 vgen_generate rerunStage=video 重跑`,
              },
            }
          }

          // ---- 重拍 ----
          if (!existsSync(clip)) throw new HandoffError('bad-request', `shot ${shot} 尚无成片片段，无可重拍`)
          const urlsEv = lastEventOf(record.events, 'shot-urls')
          const urls = (urlsEv?.detail as { urls?: Array<{ index: number; url: string; file: string }> } | undefined)?.urls ?? []
          const shotUrl = urls.find((u) => u.index === shot)?.url ?? ''
          if (!shotUrl) {
            throw new HandoffError('bad-request', `shot ${shot} 参考图无公网 URL（可能为手动提供）：无法自动重拍，先 vgen_generate rerunStage=shot-assets 重新生成参考图后再评审`)
          }
          const sbFile = join(runDir, 'storyboard.json')
          if (!existsSync(sbFile)) throw new HandoffError('bad-request', `run ${runId} 缺少 storyboard.json，无法重拍`)
          const sb = JSON.parse(readFileSync(sbFile, 'utf8')) as { shots: Array<{ index: number; durationSec?: number }> }
          const durationSec = sb.shots.find((s) => s.index === shot)?.durationSec ?? 5

          const hint = typeof args.negativeHint === 'string' ? args.negativeHint.trim() : ''
          const negatives = [...GENERIC_NEGATIVE, ...(hint ? [hint] : [])]
          const prompt = `${SHOT_MOTION_PROMPT}。负面要求：${negatives.join('、')}`

          // 花费确认（与 vgen_generate 同语义）
          const channel = ctx.channel()
          let pricingMaybe = ctx.pricing
          if (pricingMaybe === undefined) pricingMaybe = await fetchPricing(channel, undefined, 15000).catch(() => null)
          const pricing = pricingMaybe
          const videoModel = ctx.videoModel ?? env['VGEN_VIDEO_MODEL'] ?? VIDEO_MODEL_DEFAULT
          const est = pricing ? estimateCny(videoModel, pricing) : null
          let approved = false
          if (ctx.confirmer) approved = await ctx.confirmer(est)
          else if (args.confirm === true) approved = true
          if (!approved) {
            return {
              ok: false,
              error: { code: 'confirm-required', message: `重拍 shot ${shot} 需 1 次视频生成（估价 ${est ?? 'unknown'} CNY）：向用户转述成本后携带 confirm:true 重调` },
            }
          }

          const provider = ctx.providersOverride
            ? ctx.providersOverride.forModel(videoModel, { fetchImpl })
            : providerForModel(channel, videoModel, { fetchImpl, estimate: pricing ? (m: string) => estimateCny(m, pricing) : undefined })

          const backup = join(runDir, 'clips', `${shotFileBase(shot)}.rejected-${entry.retries + 1}.mp4`)
          renameSync(clip, backup)
          try {
            await generateShotClip({
              provider, fetchImpl, imageUrl: shotUrl, prompt, durationSec, outFile: clip,
              pollDelayMs: pollDelayFromEnv(env),
              // spend 事件在 submit 成功即落（与 machine video 段同序）：重拍中途失败花费也有账
              onSubmit: (jobId) => {
                ctx.runs.appendEvent(runId, 'spend', { stage: 'video', model: videoModel, estCny: est, shot, jobId: jobId.slice(0, 80) })
              },
            })
          } catch (err) {
            if (!existsSync(clip)) renameSync(backup, clip) // 重拍失败回滚旧片，run 保持可用
            ctx.runs.appendEvent(runId, 'reshoot-failed', { shot, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) })
            throw err
          }
          entry.retries += 1
          ctx.runs.setReview(runId, key, entry)
          ctx.runs.appendEvent(runId, 'reshoot', { shot, score, retry: entry.retries, prompt: prompt.slice(0, 200), backup: basename(backup) })

          let frames: string[] = []
          if (ffmpeg) {
            try { frames = await extract(clip, reviewDir, ffmpeg) } catch { frames = [] }
          }
          return {
            ok: true,
            value: {
              runId, shot, action: 'reshoot', score, retriesUsed: entry.retries, clip, frames,
              next: frames.length
                ? '重新查看新帧后再次携带 score 调用 vgen_review（剩余重拍次数 ' + (MAX_RETRIES - entry.retries) + '）'
                : '重拍完成但抽帧失败（可手动查看新片段后再次评分）',
            },
          }
        } catch (err) {
          if (err instanceof HandoffError) return { ok: false, error: { code: err.code, message: err.message } }
          return { ok: false, error: { code: 'internal', message: err instanceof Error ? err.message : String(err) } }
        }
      },
    },
  }
}

/** VGEN_POLL_DELAY_MS 环境覆盖（demo 提速用），未设/非法 → undefined（走缺省 1000）。 */
function pollDelayFromEnv(env: NodeJS.ProcessEnv): number | undefined {
  const v = Number(env['VGEN_POLL_DELAY_MS'])
  return Number.isFinite(v) && v > 0 ? v : undefined
}

export function reviewToolDefs(tools: ReturnType<typeof buildReviewTools>): DshToolDefinition[] {
  const jsonRender = (_args: unknown, value: unknown): Array<{ type: string; text: string }> => [
    { type: 'text', text: JSON.stringify(value) },
  ]
  return [
    {
      name: 'vgen_review',
      description:
        '单镜质量评审闭环：不带 score 调用 → 返回成片 25/50/75% 三帧路径（用读图工具查看后评分）；带 score（1-5 整数）重调 → ≥3 记通过，≤2 自动追加负面词重拍（每镜至多 2 次；重拍花费走 confirm-required 语义）。评分与重拍次数记录进 run.json。',
      parameters: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'run id' },
          shot: { type: 'number', description: '镜头 index（1 起）' },
          score: { type: 'number', description: '评分 1-5（整数，越界 clamp）；缺省 = 抽帧阶段' },
          negativeHint: { type: 'string', description: '可选：重拍追加负面词（如"肢体扭曲"）' },
          confirm: { type: 'boolean', description: '重拍成本确认；收到 confirm-required 后向用户转述成本再置 true' },
        },
        required: ['runId', 'shot'],
      },
      output: { schema: { type: 'object' }, render: jsonRender },
      timeoutMs: 600000,
      execute: (args: unknown) => tools.review.execute(args as ReviewArgs),
    },
  ]
}
```

实现注意：`mkdirSync` import 若未用到（renameSync/existsSync/readFileSync 用到）按 typecheck 清理；测试 fakeCtx 未提供 `env` → buildReviewTools 用 process.env，`VGEN_VIDEO_MODEL` 未设走 VIDEO_MODEL_DEFAULT，符合预期。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --test-reporter tap test/review.test.ts 2>&1 | tail -3`
Expected: PASS（11 tests）

- [ ] **Step 5: 全量校验 + 提交**

```bash
npm run typecheck && npm test 2>&1 | tail -3
git add src/tools/review.ts test/review.test.ts
git commit -m "feat(m4): vgen_review 评审闭环——抽帧/评分 clamp/自动重拍≤2/confirm 语义/失败回滚"
```

---

### Task 5: gate manual 接线——vgen_provide + generate gates/gateApprovals/rerunStage

**Files:**
- Create: `src/tools/provide.ts`
- Modify: `src/tools/generate.ts`
- Modify: `src/host/index.ts`（仅本任务的工具注册；guidance 文案在 Task 10 统一更新）
- Test: `test/provide.test.ts`、`test/tools-generate.test.ts`（追加）

- [ ] **Step 1: 写失败测试 test/provide.test.ts**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunStore } from '../src/store/runs.ts'
import { buildProvideTools, provideToolDefs } from '../src/tools/provide.ts'

function seed(runs: RunStore, withStoryboard = true): string {
  const run = runs.create('provide run')
  const dir = join(runs.rootDir, run.id)
  mkdirSync(dir, { recursive: true })
  if (withStoryboard) {
    writeFileSync(join(dir, 'storyboard.json'), JSON.stringify({ shots: [{ index: 1 }, { index: 2 }] }))
  }
  return run.id
}

function srcFile(dir: string, name: string, content = 'x'): string {
  const p = join(dir, name)
  writeFileSync(p, content)
  return p
}

test('master-asset：合法命名注入 → 拷贝进 assets/ + 段 done + 事件', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vgen-prov-'))
  const runs = RunStore.open({ rootDir: root })
  const runId = seed(runs)
  const src = mkdtempSync(join(tmpdir(), 'vgen-src-'))
  const tools = buildProvideTools({ runs, ffmpeg: null })
  const r = await tools.provide.execute({
    runId, stage: 'master-asset',
    files: [{ path: srcFile(src, 'a.png'), name: 'char-linjing.png' }, { path: srcFile(src, 'b.png'), name: 'scene-s1.png' }],
  })
  assert.equal(r.ok, true)
  assert.ok(existsSync(join(root, runId, 'assets', 'char-linjing.png')))
  assert.equal(runs.get(runId)!.stages['master-asset'], 'done')
  assert.ok(runs.get(runId)!.events.some((e) => e.type === 'manual-provided'))
})

test('master-asset：非法命名拒绝（不半注入）', async () => {
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-prov2-')) })
  const runId = seed(runs)
  const src = mkdtempSync(join(tmpdir(), 'vgen-src2-'))
  const tools = buildProvideTools({ runs, ffmpeg: null })
  const r = await tools.provide.execute({ runId, stage: 'master-asset', files: [{ path: srcFile(src, 'a.png'), name: '../evil.png' }] })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.error.code, 'bad-request')
  assert.equal(runs.get(runId)!.stages['master-asset'], undefined)
})

test('shot-assets：逐镜注入 → shot-urls 事件（url 空串）+ i2v 警示', async () => {
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-prov3-')) })
  const runId = seed(runs)
  const src = mkdtempSync(join(tmpdir(), 'vgen-src3-'))
  const tools = buildProvideTools({ runs, ffmpeg: null })
  const r = await tools.provide.execute({
    runId, stage: 'shot-assets',
    files: [{ path: srcFile(src, 'a.png'), shot: 1 }, { path: srcFile(src, 'b.png'), shot: 2 }],
  })
  assert.equal(r.ok, true)
  const v = r.value as { warnings: string[] }
  assert.ok(v.warnings.some((w) => w.includes('公网 URL')))
  const ev = runs.get(runId)!.events.find((e) => e.type === 'shot-urls')
  const urls = (ev?.detail as { urls: Array<{ index: number; url: string }> }).urls
  assert.deepEqual(urls.map((u) => u.url), ['', ''])
  assert.ok(existsSync(join(runs.rootDir, runId, 'shots', 'shot-001.png')))
})

test('video：缺镜拒绝（须覆盖 storyboard 全部镜头）', async () => {
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-prov4-')) })
  const runId = seed(runs)
  const src = mkdtempSync(join(tmpdir(), 'vgen-src4-'))
  const tools = buildProvideTools({ runs, ffmpeg: null, probe: async () => 3 })
  const r = await tools.provide.execute({ runId, stage: 'video', files: [{ path: srcFile(src, 'a.mp4'), shot: 1 }] })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.error.message, /缺少镜头/)
})

test('video：全镜 + 时长≥0.5s → clips 事件 + 段 done', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vgen-prov5-'))
  const runs = RunStore.open({ rootDir: root })
  const runId = seed(runs)
  const src = mkdtempSync(join(tmpdir(), 'vgen-src5-'))
  const tools = buildProvideTools({ runs, ffmpeg: '/bin/true', probe: async () => 3.2 })
  const r = await tools.provide.execute({
    runId, stage: 'video',
    files: [{ path: srcFile(src, 'a.mp4'), shot: 1 }, { path: srcFile(src, 'b.mp4'), shot: 2 }],
  })
  assert.equal(r.ok, true)
  const ev = runs.get(runId)!.events.find((e) => e.type === 'clips')
  assert.equal(((ev?.detail as { files: string[] }).files).length, 2)
  assert.equal(runs.get(runId)!.stages['video'], 'done')
})

test('video：时长 <0.5s 拒绝（鲸影规则层继承）', async () => {
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-prov6-')) })
  const runId = seed(runs)
  const src = mkdtempSync(join(tmpdir(), 'vgen-src6-'))
  const tools = buildProvideTools({ runs, ffmpeg: '/bin/true', probe: async () => 0.2 })
  const r = await tools.provide.execute({
    runId, stage: 'video',
    files: [{ path: srcFile(src, 'a.mp4'), shot: 1 }, { path: srcFile(src, 'b.mp4'), shot: 2 }],
  })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.error.message, /时长/)
})

test('final-cut：mp4+srt 注入 → run 直接 done', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vgen-prov7-'))
  const runs = RunStore.open({ rootDir: root })
  const runId = seed(runs)
  const src = mkdtempSync(join(tmpdir(), 'vgen-src7-'))
  const tools = buildProvideTools({ runs, ffmpeg: null })
  const r = await tools.provide.execute({
    runId, stage: 'final-cut',
    files: [{ path: srcFile(src, 'movie.mp4', 'final-bytes') }, { path: srcFile(src, 'subs.srt', '1\n00:00:00,000 --> 00:00:01,000\nhi\n') }],
  })
  assert.equal(r.ok, true)
  assert.equal(readFileSync(join(root, runId, 'final.mp4'), 'utf8'), 'final-bytes')
  assert.ok(existsSync(join(root, runId, 'final.srt')))
  assert.equal(runs.get(runId)!.status, 'done')
  assert.equal(runs.get(runId)!.stages['final-cut'], 'done')
})

test('源文件不存在 → bad-request；stage 非法 → bad-request', async () => {
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-prov8-')) })
  const runId = seed(runs)
  const tools = buildProvideTools({ runs, ffmpeg: null })
  const r1 = await tools.provide.execute({ runId, stage: 'video', files: [{ path: '/nope/x.mp4', shot: 1 }] })
  assert.equal(r1.ok, false)
  const r2 = await tools.provide.execute({ runId, stage: 'story' as 'video', files: [{ path: 'x' }] })
  assert.equal(r2.ok, false)
  if (!r2.ok) assert.equal(r2.error.code, 'bad-request')
})

test('provideToolDefs 契约', () => {
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-prov9-')) })
  const defs = provideToolDefs(buildProvideTools({ runs, ffmpeg: null }))
  assert.equal(defs[0]!.name, 'vgen_provide')
  assert.deepEqual((defs[0]!.parameters as { required: string[] }).required, ['runId', 'stage', 'files'])
})
```

- [ ] **Step 2: 追加 test/tools-generate.test.ts 测试（gates/gateApprovals/rerunStage/status 扩展）**

先 `grep -n "buildGenerateTools\|fake\|stub" test/tools-generate.test.ts | head` 摸清既有测试装置，复用其 ctx 构造 helper。追加用例（若既有 helper 名不同，按现场改名）：

```ts
test('M4: gates 参数校验非法模式 → bad-request，合法 → 持久化进 run.json', async () => {
  // ctx = 既有测试装置（providersOverride 让 advanceRun 立即可跑或直接 not-run 到 gate）
  const r = await tools.generate.execute({ runId, target: 'assets', gates: { video: 'teleport' } })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error.code, 'bad-request')
  const r2 = await tools.generate.execute({ runId, target: 'assets', gates: { video: 'manual' } })
  // video 段在 assets 目标下不执行，gates 仅持久化
  assert.deepEqual(runs.get(runId)!.gates, { video: 'manual' })
})

test('M4: manual gate → manual-gate 信封（指引 vgen_provide）', async () => {
  runs.setGates(runId, { 'master-asset': 'manual' })
  const r = await tools.generate.execute({ runId, target: 'assets' })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.error.code, 'manual-gate')
  assert.match(r.error.message, /vgen_provide/)
})

test('M4: ask gate 未批 → gate-approval 信封；gateApprovals 放行后通过', async () => {
  runs.setGates(runId, { 'master-asset': 'ask' })
  const r = await tools.generate.execute({ runId, target: 'assets' })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.error.code, 'gate-approval')
  const r2 = await tools.generate.execute({ runId, target: 'assets', gateApprovals: ['master-asset'] })
  assert.notEqual(r2.ok ? '' : r2.error.code, 'gate-approval')
})

test('M4: rerunStage 把已 done 段重置 pending 后重跑', async () => {
  runs.setStage(runId, 'master-asset', 'done')
  await tools.generate.execute({ runId, target: 'assets', rerunStage: 'master-asset' })
  // mock provider 全链路会重新生成 → 段回到 done 且出现第二次 stage-start 事件
  const starts = runs.get(runId)!.events.filter((e) => e.type === 'stage-start' && e.detail?.['stage'] === 'master-asset')
  assert.ok(starts.length >= 1)
})

test('M4: rerunStage 非媒体段 → bad-request', async () => {
  const r = await tools.generate.execute({ runId, target: 'assets', rerunStage: 'story' })
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error.message, /媒体段/)
})

test('M4: vgen_status 返回 reviews/gates', async () => {
  runs.setGates(runId, { video: 'ask' })
  runs.setReview(runId, 'shot-1', { scores: [4], retries: 0, passed: true })
  const r = await tools.status.execute({ runId })
  assert.equal(r.ok, true)
  const v = r.value as { gates: Record<string, string>; reviews: Record<string, unknown> }
  assert.deepEqual(v.gates, { video: 'ask' })
  assert.ok(v.reviews['shot-1'])
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test --test-reporter tap test/provide.test.ts test/tools-generate.test.ts 2>&1 | tail -5`
Expected: FAIL（provide 模块不存在；generate 新参数未实现）

- [ ] **Step 4: 实现 src/tools/provide.ts**

```ts
/** vgen_provide：manual gate 产物注入（规格 §5.2）。用户在会话中给出本地文件路径，
 *  插件按段校验（存在/非空/命名/全镜覆盖/时长）后拷贝进 run 目录并置段 done，管线接管。
 *  约束：注入 shot-assets 后 video 段自动 i2v 不可用（无公网 URL），响应内显式警示。 */

import { copyFileSync, existsSync, statSync, mkdirSync, readFileSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import type { RunStore } from '../store/runs.ts'
import { locateFfmpeg, probeDurationSec } from '../finalcut/render-ffmpeg.ts'
import { HandoffError } from '../schema/handoff.ts'
import type { ToolResult, DshToolDefinition } from './handoff.ts'

export type ProvideStage = 'master-asset' | 'shot-assets' | 'video' | 'final-cut'
const PROVIDE_STAGES: readonly ProvideStage[] = ['master-asset', 'shot-assets', 'video', 'final-cut']

export interface ProvideFile {
  path: string
  shot?: number
  name?: string
}

export interface ProvideArgs {
  runId: string
  stage: ProvideStage
  files: ProvideFile[]
}

export interface ProvideContext {
  runs: RunStore
  env?: NodeJS.ProcessEnv
  /** undefined → locateFfmpeg(env)；null = 无 ffmpeg（video 段时长校验拒绝）。测试注入。 */
  ffmpeg?: string | null
  /** 测试注入：时长探测。 */
  probe?: (file: string, ffmpeg: string) => Promise<number | null>
}

const ASSET_NAME_RE = /^(char|scene)-[a-z0-9_-]+\.(png|jpe?g|webp)$/i
const MIN_CLIP_SEC = 0.5

function isProvideStage(s: unknown): s is ProvideStage {
  return typeof s === 'string' && (PROVIDE_STAGES as readonly string[]).includes(s)
}

function shotName(shot: number, ext: string): string {
  return `shot-${String(shot).padStart(3, '0')}${ext}`
}

export function buildProvideTools(ctx: ProvideContext): {
  provide: { execute: (args: ProvideArgs) => Promise<ToolResult> }
} {
  const env = ctx.env ?? process.env
  const probe = ctx.probe ?? probeDurationSec
  return {
    provide: {
      execute: async (args): Promise<ToolResult> => {
        try {
          const runId = typeof args?.runId === 'string' ? args.runId : ''
          if (!ctx.runs.get(runId)) throw new HandoffError('not-found', `run 不存在: ${runId}`)
          const stage = args?.stage
          if (!isProvideStage(stage)) throw new HandoffError('bad-request', `stage 须为 ${PROVIDE_STAGES.join('|')}: ${String(args?.stage)}`)
          const files = args?.files
          if (!Array.isArray(files) || files.length === 0 || files.length > 200) throw new HandoffError('bad-request', 'files 须为 1..200 项数组')
          // 通用存在性校验（先全验后拷贝，不半注入）
          for (const f of files) {
            if (typeof f?.path !== 'string' || !f.path) throw new HandoffError('bad-request', 'files[].path 须为非空字符串')
            if (!existsSync(f.path) || !statSync(f.path).isFile() || statSync(f.path).size === 0) {
              throw new HandoffError('bad-request', `文件不存在或为空: ${f.path}`)
            }
          }
          const runDir = join(ctx.runs.rootDir, runId)
          const warnings: string[] = []
          let ingested = 0

          if (stage === 'master-asset') {
            const dest = join(runDir, 'assets')
            const planned = files.map((f) => {
              const name = String(f.name ?? '').trim().toLowerCase()
              if (!ASSET_NAME_RE.test(name)) throw new HandoffError('bad-request', `master-asset 文件名须为 char-<id>.png / scene-<id>.png 形态: ${f.name ?? '(缺)'}`)
              return { src: f.path!, dest: join(dest, name) }
            })
            mkdirSync(dest, { recursive: true, mode: 0o700 })
            for (const p of planned) { copyFileSync(p.src, p.dest); ingested++ }
          } else if (stage === 'shot-assets') {
            const dest = join(runDir, 'shots')
            mkdirSync(dest, { recursive: true, mode: 0o700 })
            const urls: Array<{ index: number; url: string; file: string }> = []
            for (const f of files) {
              const shot = Number(f.shot)
              if (!Number.isInteger(shot) || shot < 1) throw new HandoffError('bad-request', `shot-assets 每项须带 shot（≥1 整数）: ${JSON.stringify(f)}`)
              const ext = extname(f.path!).toLowerCase() || '.png'
              const out = join(dest, shotName(shot, ext))
              copyFileSync(f.path!, out)
              urls.push({ index: shot, url: '', file: out })
              ingested++
            }
            urls.sort((a, b) => a.index - b.index)
            ctx.runs.appendEvent(runId, 'shot-urls', { urls })
            warnings.push('手动参考图无公网 URL：video 段自动 i2v 需要 URL。若需继续自动生成视频，请将 shot-assets gate 切回 auto 并 vgen_generate rerunStage=shot-assets 重新生成；或后续 video 段也用 vgen_provide 手动注入。')
          } else if (stage === 'video') {
            const sbFile = join(runDir, 'storyboard.json')
            if (!existsSync(sbFile)) throw new HandoffError('bad-request', `run ${runId} 缺少 storyboard.json：请先完成分镜段`)
            const sb = JSON.parse(readFileSync(sbFile, 'utf8')) as { shots: Array<{ index: number }> }
            const dest = join(runDir, 'clips')
            mkdirSync(dest, { recursive: true, mode: 0o700 })
            for (const f of files) {
              const shot = Number(f.shot)
              if (!Number.isInteger(shot) || shot < 1) throw new HandoffError('bad-request', `video 每项须带 shot（≥1 整数）: ${JSON.stringify(f)}`)
              copyFileSync(f.path!, join(dest, shotName(shot, '.mp4')))
              ingested++
            }
            // 全镜覆盖校验：storyboard 每一镜的 clip 都必须在位（本次注入或此前已存在）
            const missing: number[] = []
            const clipFiles: string[] = []
            for (const s of sb.shots) {
              const p = join(dest, shotName(s.index, '.mp4'))
              if (existsSync(p)) clipFiles.push(p)
              else missing.push(s.index)
            }
            if (missing.length) throw new HandoffError('bad-request', `video 段缺少镜头: ${missing.join(', ')}（须覆盖 storyboard 全部 ${sb.shots.length} 镜）`)
            // 时长校验（鲸影规则层继承：≥0.5s）
            const ffmpeg = ctx.ffmpeg !== undefined ? ctx.ffmpeg : locateFfmpeg(env)
            if (!ffmpeg) throw new HandoffError('internal', '未找到 ffmpeg，无法校验片段时长（可设 VGEN_FFMPEG）')
            for (const p of clipFiles) {
              const dur = await probe(p, ffmpeg)
              if (dur === null) throw new HandoffError('bad-request', `无法读取片段时长: ${basename(p)}`)
              if (dur < MIN_CLIP_SEC) throw new HandoffError('bad-request', `片段 ${basename(p)} 时长 ${dur}s < ${MIN_CLIP_SEC}s`)
            }
            clipFiles.sort()
            ctx.runs.appendEvent(runId, 'clips', { files: clipFiles })
          } else {
            // final-cut：files[0] = mp4（必须 .mp4），files[1] 可选 = srt
            const mp4 = files[0]!
            if (extname(mp4.path!).toLowerCase() !== '.mp4') throw new HandoffError('bad-request', `final-cut 首文件须为 .mp4: ${basename(mp4.path!)}`)
            copyFileSync(mp4.path!, join(runDir, 'final.mp4'))
            ingested++
            const srt = files[1]
            if (srt) {
              if (extname(srt.path!).toLowerCase() !== '.srt') throw new HandoffError('bad-request', `final-cut 第二文件须为 .srt: ${basename(srt.path!)}`)
              copyFileSync(srt.path!, join(runDir, 'final.srt'))
              ingested++
            } else {
              warnings.push('未提供 final.srt：成片无字幕文件（不影响 final.mp4）')
            }
            ctx.runs.appendEvent(runId, 'final', { output: join(runDir, 'final.mp4'), srt: srt ? join(runDir, 'final.srt') : null, manual: true })
          }

          ctx.runs.setStage(runId, stage, 'done')
          if (stage === 'final-cut') ctx.runs.setStatus(runId, 'done')
          ctx.runs.appendEvent(runId, 'manual-provided', { stage, count: ingested })
          return { ok: true, value: { runId, stage, ingested, stageState: 'done', warnings } }
        } catch (err) {
          if (err instanceof HandoffError) return { ok: false, error: { code: err.code, message: err.message } }
          return { ok: false, error: { code: 'internal', message: err instanceof Error ? err.message : String(err) } }
        }
      },
    },
  }
}

export function provideToolDefs(tools: ReturnType<typeof buildProvideTools>): DshToolDefinition[] {
  const jsonRender = (_args: unknown, value: unknown): Array<{ type: string; text: string }> => [
    { type: 'text', text: JSON.stringify(value) },
  ]
  return [
    {
      name: 'vgen_provide',
      description:
        'manual gate 产物注入：把用户提供的本地文件校验后接管进管线。stage=master-asset（files[].name 须为 char-<id>.png/scene-<id>.png）；shot-assets/video（files[].shot 必填；video 须覆盖全部镜头且时长≥0.5s，需 ffmpeg）；final-cut（首文件 .mp4，可选第二文件 .srt，注入后 run 直接 done）。',
      parameters: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'run id' },
          stage: { type: 'string', enum: ['master-asset', 'shot-assets', 'video', 'final-cut'], description: '注入目标段' },
          files: {
            type: 'array',
            description: '文件清单：[{ path: 本地绝对路径, shot?: 镜头号(shot-assets/video 必填), name?: 目标文件名(master-asset 必填) }]',
          },
        },
        required: ['runId', 'stage', 'files'],
      },
      output: { schema: { type: 'object' }, render: jsonRender },
      timeoutMs: 60000,
      execute: (args: unknown) => tools.provide.execute(args as ProvideArgs),
    },
  ]
}
```

- [ ] **Step 5: 修改 src/tools/generate.ts**

1. import 增补：

```ts
import { advanceRun, ManualGateError, AskGateRejectedError } from '../pipeline/machine.ts'
import { isStage } from '../stages.ts'
```

2. `GenerateArgs` 扩展：

```ts
export interface GenerateArgs {
  runId: string
  target: 'assets' | 'video' | 'final'
  confirm?: boolean
  concurrency?: number
  /** 每段 gate 模式覆盖（持久化进 run.json；优先级 = vault 缺省 < run.json < 本参数）。 */
  gates?: Record<string, 'auto' | 'ask' | 'manual'>
  /** ask gate 的本次放行清单（用户已在会话中批准后由会话模型带上）。 */
  gateApprovals?: string[]
  /** 把某个媒体段（master-asset/shot-assets/video/final-cut）重置 pending 后重跑。 */
  rerunStage?: string
}
```

3. execute 主体在 `const channel = ctx.channel()` 之前插入 gates/rerunStage 预处理（在 try 内）：

```ts
const runId = String(args['runId'] ?? '')
if (!ctx.runs.get(runId)) return { ok: false, error: { code: 'not-found', message: `run 不存在: ${runId}` } }
let argGates: Record<string, 'auto' | 'ask' | 'manual'> | undefined
if (args['gates'] !== undefined) {
  const g = args['gates']
  if (typeof g !== 'object' || g === null || Array.isArray(g)) return { ok: false, error: { code: 'bad-request', message: 'gates 须为对象 {段名: auto|ask|manual}' } }
  argGates = {}
  for (const [k, v] of Object.entries(g as Record<string, unknown>)) {
    if (!isStage(k)) return { ok: false, error: { code: 'bad-request', message: `gates 键须为合法段名: ${k}` } }
    if (v !== 'auto' && v !== 'ask' && v !== 'manual') return { ok: false, error: { code: 'bad-request', message: `gates[${k}] 须为 auto|ask|manual: ${String(v)}` } }
    argGates[k] = v
  }
  ctx.runs.setGates(runId, argGates)
}
const MEDIA_STAGES = ['master-asset', 'shot-assets', 'video', 'final-cut']
if (args['rerunStage'] !== undefined) {
  const rs = String(args['rerunStage'])
  if (!MEDIA_STAGES.includes(rs)) return { ok: false, error: { code: 'bad-request', message: `rerunStage 须为媒体段（${MEDIA_STAGES.join('|')}）: ${rs}` } }
  ctx.runs.setStage(runId, rs, 'pending')
}
const recGates = ctx.runs.get(runId)?.gates ?? {}
const effectiveGates = { ...ctx.vault.getGateDefaults(), ...recGates } as MachineDeps['gates']
const approvals = Array.isArray(args['gateApprovals']) ? (args['gateApprovals'] as unknown[]).filter((s): s is string => typeof s === 'string') : []
```

4. advanceRun 调用增两个字段（runId 用上面提取的变量替换 `args['runId']`）：

```ts
gates: effectiveGates,
ask: async (stage) => approvals.includes(stage),
```

5. catch 分支在 `denied > 0` 判断之后、HandoffError 之前插入：

```ts
if (err instanceof ManualGateError) {
  return { ok: false, error: { code: 'manual-gate', message: `${err.message}。用法：vgen_provide { runId, stage, files: [{ path, shot?, name? }] }` } }
}
if (err instanceof AskGateRejectedError) {
  return { ok: false, error: { code: 'gate-approval', message: `${err.message}。请与用户确认该段执行，然后携带 gateApprovals（如 ["master-asset"]）重新调用；或改 gates 为 auto/manual。` } }
}
```

6. status execute 的 value 扩展：

```ts
return {
  ok: true,
  value: {
    id: record.id, title: record.title, status: record.status, stages: record.stages,
    gates: record.gates ?? {}, reviews: record.reviews ?? {},
    recentEvents: record.events.slice(-5),
  },
}
```

7. generateToolDefs 的 vgen_generate parameters.properties 增补三个字段：

```ts
gates: { type: 'object', description: '可选：每段 gate 模式 {段名: "auto"|"ask"|"manual"}，持久化进 run.json' },
gateApprovals: { type: 'array', description: '可选：ask 段本次放行清单（用户已批准后携带）' },
rerunStage: { type: 'string', enum: ['master-asset', 'shot-assets', 'video', 'final-cut'], description: '可选：重置该媒体段为 pending 后重跑' },
```

- [ ] **Step 6: host/index.ts 注册 vgen_provide（review/channels 分别在 Task 4/6 已注册或本步一并接）**

host/index.ts：import `buildProvideTools, provideToolDefs`；apply() 中构造：

```ts
const provideTools = buildProvideTools({ runs, env: process.env })
```

注册循环加入 `...provideToolDefs(provideTools).map((def) => ctx.tools.register(def))`。（Task 4 的 reviewToolDefs 注册在此步一并接入：`buildReviewTools({ vault, runs, channel: <与 generate 同一 resolver> })`——把两处重复的 channel resolver 提取为 `const resolveChannel = (): ChannelRef => {...}` 共用。）

- [ ] **Step 7: 跑测试确认通过 + 全量 + 提交**

Run: `npm run typecheck && npm test 2>&1 | tail -3`
Expected: 全绿

```bash
git add src/tools/provide.ts src/tools/generate.ts src/host/index.ts test/provide.test.ts test/tools-generate.test.ts
git commit -m "feat(m4): gate manual 真接线——vgen_provide 四段产物注入 + gates 持久化/gateApprovals/rerunStage + review 注册"
```

---

### Task 6: vgen_channels 工具 + API 面扩展（runs.get / adoptModels / settings gateDefaults）

**Files:**
- Create: `src/tools/channels.ts`、`src/host/artifacts.ts`
- Modify: `src/host/routes.ts`
- Modify: `src/host/index.ts`（注册 vgen_channels）
- Test: `test/channels.test.ts`、`test/artifacts.test.ts`、`test/routes.test.ts`（追加）

- [ ] **Step 1: artifacts.ts（先建，routes 依赖）**

```ts
// src/host/artifacts.ts
/** run 产物清单（设置页「视频工坊」数据源；rel 为 run 目录内 POSIX 风格相对路径，供 media URL 拼接）。 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { RunStore } from '../store/runs.ts'

export interface ArtifactFile {
  name: string
  rel: string
  size: number
}

export interface RunArtifacts {
  handoff: { story: boolean; script: boolean; storyboard: boolean }
  assets: ArtifactFile[]
  shots: ArtifactFile[]
  clips: ArtifactFile[]
  review: ArtifactFile[]
  final: { mp4: ArtifactFile | null; srt: ArtifactFile | null }
}

function listDir(runDir: string, sub: string, prefix: string): ArtifactFile[] {
  const dir = join(runDir, sub)
  let names: string[] = []
  try {
    names = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort()
  } catch {
    return []
  }
  return names.map((name) => {
    const full = join(dir, name)
    return { name, rel: `${prefix}/${name}`, size: statSync(full).size }
  })
}

function listTree(runDir: string, sub: string, prefix: string): ArtifactFile[] {
  // review/ 有 shot-NNN 子目录：递归一层
  const dir = join(runDir, sub)
  let entries: string[] = []
  try {
    entries = readdirSync(dir, { withFileTypes: true }).map((e) => e.name).sort()
  } catch {
    return []
  }
  const out: ArtifactFile[] = []
  for (const e of entries) {
    const full = join(dir, e)
    if (statSync(full).isFile()) {
      out.push({ name: e, rel: `${prefix}/${e}`, size: statSync(full).size })
    } else {
      for (const f of listDir(runDir, `${sub}/${e}`, `${prefix}/${e}`)) out.push(f)
    }
  }
  return out
}

function finalFile(runDir: string, name: string): ArtifactFile | null {
  const full = join(runDir, name)
  if (!existsSync(full) || !statSync(full).isFile()) return null
  return { name, rel: name, size: statSync(full).size }
}

export function collectArtifacts(runs: RunStore, runId: string): RunArtifacts {
  const runDir = join(runs.rootDir, runId)
  return {
    handoff: {
      story: existsSync(join(runDir, 'story.json')),
      script: existsSync(join(runDir, 'script.json')),
      storyboard: existsSync(join(runDir, 'storyboard.json')),
    },
    assets: listDir(runDir, 'assets', 'assets'),
    shots: listDir(runDir, 'shots', 'shots'),
    clips: listDir(runDir, 'clips', 'clips'),
    review: listTree(runDir, 'review', 'review'),
    final: { mp4: finalFile(runDir, 'final.mp4'), srt: finalFile(runDir, 'final.srt') },
  }
}
```

test/artifacts.test.ts：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunStore } from '../src/store/runs.ts'
import { collectArtifacts } from '../src/host/artifacts.ts'

test('collectArtifacts 汇总各子目录 + final + handoff 标志（缺失容错空表）', () => {
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-art-')) })
  const run = runs.create('产物清单')
  const dir = join(runs.rootDir, run.id)
  mkdirSync(join(dir, 'assets'), { recursive: true })
  mkdirSync(join(dir, 'review', 'shot-001'), { recursive: true })
  writeFileSync(join(dir, 'assets', 'char-a.png'), '12345')
  writeFileSync(join(dir, 'story.json'), '{}')
  writeFileSync(join(dir, 'final.mp4'), 'movie')
  writeFileSync(join(dir, 'review', 'shot-001', 'frame-1.png'), 'f')
  const a = collectArtifacts(runs, run.id)
  assert.deepEqual(a.handoff, { story: true, script: false, storyboard: false })
  assert.deepEqual(a.assets, [{ name: 'char-a.png', rel: 'assets/char-a.png', size: 5 }])
  assert.equal(a.clips.length, 0)
  assert.deepEqual(a.review, [{ name: 'frame-1.png', rel: 'review/shot-001/frame-1.png', size: 1 }])
  assert.equal(a.final.mp4?.rel, 'final.mp4')
  assert.equal(a.final.srt, null)
})

test('collectArtifacts 空 run 目录全空不抛', () => {
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-art2-')) })
  const run = runs.create('空')
  const a = collectArtifacts(runs, run.id)
  assert.deepEqual(a.shots, [])
  assert.equal(a.final.mp4, null)
})
```

- [ ] **Step 2: channels.ts 工具 + test/channels.test.ts**

```ts
// src/tools/channels.ts
/** vgen_channels：通道健康 / 价目估算 / 累计消耗（规格 §7.1）。全出口脱敏（vault.listChannels 已脱敏）。 */

import type { VaultStore } from '../store/vault.ts'
import type { RunStore } from '../store/runs.ts'
import { probeChannel } from '../probe.ts'
import { fetchPricing, estimateCny } from '../pricing.ts'
import { SpendLedger } from '../spend.ts'
import { HandoffError } from '../schema/handoff.ts'
import type { ToolResult, DshToolDefinition } from './handoff.ts'

export interface ChannelsContext {
  vault: VaultStore
  runs: RunStore
  env?: NodeJS.ProcessEnv
  /** 测试注入：探测实现。 */
  probe?: typeof probeChannel
  /** 测试注入：定价表拉取。 */
  fetchPricingImpl?: typeof fetchPricing
}

export interface ChannelsArgs {
  action?: 'list' | 'health' | 'spend'
  channelId?: string
}

function sumRunSpend(events: Array<{ type: string; detail?: Record<string, unknown> }>): { entries: number; estCny: number } {
  let entries = 0
  let estCny = 0
  for (const e of events) {
    if (e.type !== 'spend') continue
    entries++
    const v = e.detail?.['estCny']
    if (typeof v === 'number' && Number.isFinite(v)) estCny += v
  }
  return { entries, estCny: Number(estCny.toFixed(4)) }
}

export function buildChannelsTools(ctx: ChannelsContext): {
  channels: { execute: (args: ChannelsArgs) => Promise<ToolResult> }
} {
  const env = ctx.env ?? process.env
  const probe = ctx.probe ?? probeChannel
  const fetchPricingFn = ctx.fetchPricingImpl ?? fetchPricing
  return {
    channels: {
      execute: async (args): Promise<ToolResult> => {
        try {
          const action = args?.action ?? 'list'
          if (action === 'list') {
            const d = ctx.vault.load()
            return { ok: true, value: { channels: ctx.vault.listChannels(), defaultChannelId: d.defaultChannelId, budget: d.budget, gateDefaults: d.gateDefaults } }
          }
          if (action === 'health') {
            const id = typeof args?.channelId === 'string' && args.channelId ? args.channelId : ctx.vault.load().defaultChannelId
            const ch = id ? ctx.vault.getChannel(id) : null
            if (!ch) throw new HandoffError('not-found', id ? `通道不存在: ${id}` : '尚未配置任何通道（设置页「通道管理」或 channels.create）')
            const probeResult = await probe({ baseUrl: ch.baseUrl, apiKey: ch.apiKey })
            const pricing = await fetchPricingFn({ id: ch.id, baseUrl: ch.baseUrl, apiKey: ch.apiKey }, undefined, 15000).catch(() => null)
            const estimates = ch.models.map((m) => ({
              model: m.model, kind: m.kind,
              estCny: pricing ? estimateCny(m.model, pricing) : m.pricingCny ?? null,
            }))
            // 不回显任何 key 形态（含脱敏串）：health 面只出通道元信息 + 探测/估价
            return {
              ok: true,
              value: {
                channelId: ch.id, label: ch.label, baseUrl: ch.baseUrl,
                probe: { ok: probeResult.ok, models: probeResult.models.length, sample: probeResult.models.slice(0, 5), error: probeResult.error ?? null },
                pricingAvailable: pricing !== null,
                estimates,
              },
            }
          }
          if (action === 'spend') {
            const ledger = SpendLedger.open(env)
            const perRun = ctx.runs.list().map((r) => ({ id: r.id, title: r.title, status: r.status, ...sumRunSpend(r.events) }))
            return { ok: true, value: { totals: ledger.totals(), runs: perRun, note: 'estCny 为提交时估价（CNY），非账单实扣' } }
          }
          throw new HandoffError('bad-request', `action 须为 list|health|spend: ${String(action)}`)
        } catch (err) {
          if (err instanceof HandoffError) return { ok: false, error: { code: err.code, message: err.message } }
          return { ok: false, error: { code: 'internal', message: err instanceof Error ? err.message : String(err) } }
        }
      },
    },
  }
}

export function channelsToolDefs(tools: ReturnType<typeof buildChannelsTools>): DshToolDefinition[] {
  const jsonRender = (_args: unknown, value: unknown): Array<{ type: string; text: string }> => [
    { type: 'text', text: JSON.stringify(value) },
  ]
  return [
    {
      name: 'vgen_channels',
      description: '通道面板：action=list 通道列表（脱敏）+默认通道+预算阈值+gate 缺省；action=health 探测通道（模型枚举/鉴权）+按通道模型估价；action=spend 累计消耗（全局 + 按 run）。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'health', 'spend'], description: '缺省 list' },
          channelId: { type: 'string', description: 'health 专用：缺省用默认通道' },
        },
      },
      output: { schema: { type: 'object' }, render: jsonRender },
      timeoutMs: 60000,
      execute: (args: unknown) => tools.channels.execute(args as ChannelsArgs),
    },
  ]
}
```

注意：`fetchPricing` 首参形态以 `src/pricing.ts` 实际签名为准（实现前 `grep -n "export function fetchPricing\|export async function fetchPricing" src/pricing.ts` 核对；若首参是 `{baseUrl, apiKey}` 结构就按其传）。health value 里 `apiKeyMasked: undefined` 一行直接删掉——不回显任何 key 形态。

test/channels.test.ts：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultStore } from '../src/store/vault.ts'
import { RunStore } from '../src/store/runs.ts'
import { buildChannelsTools } from '../src/tools/channels.ts'

function seedVault(): VaultStore {
  const vault = VaultStore.open({ file: join(mkdtempSync(join(tmpdir(), 'vgen-ch-v-')), 'vault.json') })
  vault.createChannel({ id: 'relay-a', baseUrl: 'https://api.example.com', apiKey: 'sk-abcdefgh12345678', label: 'A 站', models: [{ model: 'happyhorse-1.1-i2v', kind: 'video' }] })
  return vault
}

test('list：脱敏通道 + 默认 + 预算 + gateDefaults', async () => {
  const vault = seedVault()
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-ch-r-')) })
  const tools = buildChannelsTools({ vault, runs })
  const r = await tools.channels.execute({ action: 'list' })
  assert.equal(r.ok, true)
  const s = JSON.stringify(r)
  assert.ok(!s.includes('sk-abcdefgh12345678'))
  assert.ok(s.includes('••••'))
  const v = (r as { value: { defaultChannelId: string } }).value
  assert.equal(v.defaultChannelId, 'relay-a')
})

test('health：probe 注入结果透传 + 估价（pricing 注入）', async () => {
  const vault = seedVault()
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-ch-r2-')) })
  const tools = buildChannelsTools({
    vault, runs,
    probe: async () => ({ ok: true, baseUrl: 'https://api.example.com', models: ['m1', 'm2', 'm3'], status: 200 }),
    // PricingTable = Map<string, PricingRow>（src/pricing.ts），quota_type=1 才可按次估价
    fetchPricingImpl: async () => new Map([['happyhorse-1.1-i2v', { model_name: 'happyhorse-1.1-i2v', quota_type: 1, model_ratio: 1, model_price: 0.35 }]]),
  })
  const r = await tools.channels.execute({ action: 'health' })
  assert.equal(r.ok, true)
  const v = (r as { value: { probe: { ok: boolean; models: number }; estimates: Array<{ estCny: number | null }> } }).value
  assert.equal(v.probe.ok, true)
  assert.equal(v.probe.models, 3)
  assert.equal(v.estimates[0]?.estCny, 0.35)
  assert.ok(!JSON.stringify(r).includes('sk-abcdefgh'))
})

test('health：无通道 → not-found', async () => {
  const vault = VaultStore.open({ file: join(mkdtempSync(join(tmpdir(), 'vgen-ch-v3-')), 'vault.json') })
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-ch-r3-')) })
  const tools = buildChannelsTools({ vault, runs, probe: async () => ({ ok: true, baseUrl: '', models: [], status: 200 }) })
  const r = await tools.channels.execute({ action: 'health' })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error.code, 'not-found')
})

test('spend：run 事件聚合（非数字 estCny 忽略）', async () => {
  const vault = seedVault()
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-ch-r4-')) })
  const run = runs.create('花费 run')
  runs.appendEvent(run.id, 'spend', { stage: 'video', estCny: 0.35 })
  runs.appendEvent(run.id, 'spend', { stage: 'video', estCny: 'bad' })
  runs.appendEvent(run.id, 'spend', { stage: 'image' })
  const tools = buildChannelsTools({ vault, runs, env: { DSH_HOME: mkdtempSync(join(tmpdir(), 'vgen-ch-h-')) } as NodeJS.ProcessEnv })
  const r = await tools.channels.execute({ action: 'spend' })
  assert.equal(r.ok, true)
  const v = (r as { value: { runs: Array<{ entries: number; estCny: number }> } }).value
  assert.equal(v.runs[0]?.entries, 3)
  assert.equal(v.runs[0]?.estCny, 0.35)
})

test('非法 action → bad-request', async () => {
  const vault = seedVault()
  const runs = RunStore.open({ rootDir: mkdtempSync(join(tmpdir(), 'vgen-ch-r5-')) })
  const tools = buildChannelsTools({ vault, runs })
  const r = await tools.channels.execute({ action: 'nuke' as 'list' })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error.code, 'bad-request')
})
```

- [ ] **Step 3: routes.ts 扩展 + test/routes.test.ts 追加**

routes.ts：import 增 `collectArtifacts`（'./artifacts.ts'）与 `resolveModel`（'../model-catalog.ts'）、`isStage`（'../stages.ts'）。dispatch 增三个 case（`runs.list` 之后）：

```ts
case 'runs.get': {
  const rid = requireString(args['id'], 'id')
  const record = ctx.runs.get(rid)
  if (!record) throw new VaultError('not-found', `run 不存在: ${rid}`)
  let entries = 0
  let estCny = 0
  for (const e of record.events) {
    if (e.type !== 'spend') continue
    entries++
    const v = e.detail?.['estCny']
    if (typeof v === 'number' && Number.isFinite(v)) estCny += v
  }
  return { record, artifacts: collectArtifacts(ctx.runs, rid), spend: { entries, estCny: Number(estCny.toFixed(4)) } }
}
case 'channels.adoptModels': {
  const cid = requireString(args['id'], 'id')
  const ch = ctx.vault.getChannel(cid)
  if (!ch) throw new VaultError('not-found', `通道不存在: ${cid}`)
  const names = args['models']
  if (!Array.isArray(names) || names.length === 0 || names.length > 100) throw new VaultError('bad-request', 'models 须为 1..100 字符串数组')
  const merged = new Map(ch.models.map((m) => [m.model, m]))
  for (const n of names) {
    if (typeof n !== 'string' || !n) throw new VaultError('bad-request', `非法模型名: ${String(n)}`)
    const { entry } = resolveModel(n)
    merged.set(n, { model: n, kind: entry.kind })
  }
  return ctx.vault.updateChannel(cid, { models: [...merged.values()] })
}
```

`settings.update` case 内，budget 处理之后追加 gateDefaults 处理：

```ts
const gd = args['gateDefaults']
if (gd !== undefined) {
  if (typeof gd !== 'object' || gd === null || Array.isArray(gd)) throw new VaultError('bad-request', 'gateDefaults 须为对象 {段名: auto|ask|manual}')
  for (const [k, v] of Object.entries(gd as Record<string, unknown>)) {
    if (!isStage(k)) throw new VaultError('bad-request', `gateDefaults 键须为合法段名: ${k}`)
    if (v !== 'auto' && v !== 'ask' && v !== 'manual') throw new VaultError('bad-request', `gateDefaults[${k}] 须为 auto|ask|manual`)
    ctx.vault.setGateDefault(k, v)
  }
}
```

test/routes.test.ts 追加：

```ts
test('M4: runs.get 返回 record+artifacts+spend 聚合；未知 id → not-found 信封', () => {
  // ctx 构造沿用本文件既有 helper（vault/runs/probe stub）
  const run = ctx.runs.create('路由 run')
  ctx.runs.appendEvent(run.id, 'spend', { estCny: 0.5 })
  const env = handleApi(ctx, 'runs.get', { id: run.id }) as { ok: true; value: { record: { id: string }; spend: { estCny: number } } }
  assert.equal(env.ok, true)
  assert.equal(env.value.record.id, run.id)
  assert.equal(env.value.spend.estCny, 0.5)
  const miss = handleApi(ctx, 'runs.get', { id: 'run-nope' }) as { ok: false; error: { code: string } }
  assert.equal(miss.error.code, 'not-found')
})

test('M4: channels.adoptModels 用内置目录推断 kind 并合并去重', () => {
  const ch = ctx.vault.createChannel({ id: 'adopt-a', baseUrl: 'https://api.example.com', apiKey: 'sk-1234567890ab', models: [{ model: 'gpt-x', kind: 'image' }] })
  void ch
  const env = handleApi(ctx, 'channels.adoptModels', { id: 'adopt-a', models: ['happyhorse-1.1-i2v', 'gpt-x'] }) as { ok: true; value: { models: Array<{ model: string; kind: string }> } }
  assert.equal(env.ok, true)
  const kinds = Object.fromEntries(env.value.models.map((m) => [m.model, m.kind]))
  assert.equal(kinds['happyhorse-1.1-i2v'], 'video')
  assert.equal(kinds['gpt-x'], 'image')
  assert.equal(env.value.models.length, 2)
})

test('M4: channels.adoptModels 响应不含明文 key', () => {
  handleApi(ctx, 'channels.create', { id: 'adopt-b', baseUrl: 'https://api.example.com', apiKey: 'sk-secret-abcdef999' })
  const env = handleApi(ctx, 'channels.adoptModels', { id: 'adopt-b', models: ['wan2.5-i2v'] })
  assert.ok(!JSON.stringify(env).includes('sk-secret-abcdef999'))
})

test('M4: settings.update gateDefaults 校验段名与模式', () => {
  const bad = handleApi(ctx, 'settings.update', { gateDefaults: { teleport: 'auto' } }) as { ok: false; error: { code: string } }
  assert.equal(bad.error.code, 'bad-request')
  const bad2 = handleApi(ctx, 'settings.update', { gateDefaults: { video: 'slow' } }) as { ok: false; error: { code: string } }
  assert.equal(bad2.error.code, 'bad-request')
  const good = handleApi(ctx, 'settings.update', { gateDefaults: { video: 'ask' } }) as { ok: true; value: { gateDefaults: Record<string, string> } }
  assert.equal(good.value.gateDefaults['video'], 'ask')
})
```

- [ ] **Step 4: host/index.ts 注册 vgen_channels**

import `buildChannelsTools, channelsToolDefs`；apply() 构造 `const channelsTools = buildChannelsTools({ vault, runs })` 并加入注册循环。

- [ ] **Step 5: 全量校验 + 提交**

```bash
npm run typecheck && npm test 2>&1 | tail -3
git add src/tools/channels.ts src/host/artifacts.ts src/host/routes.ts src/host/index.ts test/channels.test.ts test/artifacts.test.ts test/routes.test.ts
git commit -m "feat(m4): vgen_channels 面板 + runs.get/adoptModels/gateDefaults API 面 + 产物清单"
```

---

### Task 7: host media 路由（产物预览流 + 穿越防线）+ runs/<id> GET

**Files:**
- Modify: `src/host/routes.ts`（resolveMediaPath 纯函数 + MEDIA_TYPES）
- Modify: `src/host/index.ts`（media prefix 路由 + runs 改 prefix）
- Test: `test/routes.test.ts`、`test/host-index.test.ts`（追加）

- [ ] **Step 1: 写失败测试（routes.test.ts 追加纯函数部分）**

```ts
test('M4: resolveMediaPath 合法路径解析到 run 目录内', () => {
  const p = resolveMediaPath('/runs-root', '/media/run-123-abc/clips/shot-001.mp4')
  assert.equal(p, join('/runs-root', 'run-123-abc', 'clips', 'shot-001.mp4'))
})

test('M4: resolveMediaPath 拒绝穿越/绝对路径/空段/非法 runId', () => {
  assert.equal(resolveMediaPath('/runs-root', '/media/run-1/../../etc/passwd'), null)
  assert.equal(resolveMediaPath('/runs-root', '/media/run-1/%2e%2e/x'), null) // 调用方已 decode，这里直接见 '..' 形态
  assert.equal(resolveMediaPath('/runs-root', '/media/run-1//x'), null)
  assert.equal(resolveMediaPath('/runs-root', '/media/run-1/./x'), null)
  assert.equal(resolveMediaPath('/runs-root', '/media/../vault.json'), null)
  assert.equal(resolveMediaPath('/runs-root', '/media/RUN-Upper/x.png'), null)
  assert.equal(resolveMediaPath('/runs-root', '/media/run-1'), null)
  assert.equal(resolveMediaPath('/runs-root', '/other/run-1/x.png'), null)
  assert.equal(resolveMediaPath('/runs-root', '/media/run-1/sub/../shot.png'), null)
})

test('M4: mediaContentType 映射 + 缺省 octet-stream', () => {
  assert.equal(mediaContentType('a.png'), 'image/png')
  assert.equal(mediaContentType('a.MP4'), 'video/mp4')
  assert.equal(mediaContentType('a.srt'), 'text/plain; charset=utf-8')
  assert.equal(mediaContentType('a.bin'), 'application/octet-stream')
})
```

（import 补 `resolveMediaPath, mediaContentType`；`join` 已有。）

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --test-reporter tap test/routes.test.ts 2>&1 | tail -3`
Expected: FAIL（导出不存在）

- [ ] **Step 3: routes.ts 实现**

```ts
import { resolve, sep } from 'node:path'

const MEDIA_RUNID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** '/media/<runId>/<rel...>' → run 目录内绝对路径；任何穿越/畸形 → null（调用方 404）。
 *  入参 urlPath 必须已 decodeURIComponent。防线三层：runId 白名单正则、rel 段级拒绝 '.'/'..'/空段、
 *  resolve 后前缀核验（endsWith 兜底不做——前缀 + sep 即充分）。 */
export function resolveMediaPath(runsRoot: string, urlPath: string): string | null {
  const m = /^\/media\/([^/?#]+)\/(.+)$/.exec(urlPath)
  if (!m) return null
  const runId = m[1]!
  const rel = m[2]!
  if (!MEDIA_RUNID_RE.test(runId)) return null
  const segs = rel.split('/')
  if (segs.some((s) => s === '' || s === '.' || s === '..')) return null
  const base = resolve(runsRoot, runId)
  const resolved = resolve(base, segs.join(sep))
  if (!resolved.startsWith(base + sep)) return null
  return resolved
}

const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.aiff': 'audio/aiff', '.wav': 'audio/wav',
  '.srt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8',
}

export function mediaContentType(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return MEDIA_TYPES[ext] ?? 'application/octet-stream'
}
```

- [ ] **Step 4: host/index.ts 接线路由**

1. 既有 exact `/runs` 路由改 prefix，handler 分流 list/detail：

```ts
ctx.effect(
  () =>
    web.register({
      kind: 'prefix',
      path: `/${PLUGIN_ID}/runs`,
      handler: (req, res) => {
        const pathname = (req.url ?? '').split('?')[0]
        if (pathname === `/${PLUGIN_ID}/runs` || pathname === `/${PLUGIN_ID}/runs/`) {
          json(res, 200, { ok: true, value: { runs: runs.list() } })
          return
        }
        const m = new RegExp(`^/${PLUGIN_ID}/runs/([^/?#]+)$`).exec(pathname)
        if (!m) { json(res, 404, { ok: false, error: { code: 'not-found', message: '未知路径' } } as const); return }
        if (!isLoopbackRequest(req.headers.host, req.socket.remoteAddress)) {
          json(res, 403, { ok: false, error: { code: 'forbidden', message: '仅限本机回环访问' } } as const)
          return
        }
        const envelope = handleApi({ vault, runs, probe: probeChannel }, 'runs.get', { id: decodeURIComponent(m[1]!) })
        json(res, envelope.ok ? 200 : errorStatus(envelope), envelope)
      },
    }),
  `${PLUGIN_ID}: runs routes`,
)
```

2. 新增 media 路由（import 增 `resolveMediaPath, mediaContentType` 与 `createReadStream, existsSync, statSync` from 'node:fs'、`basename` from 'node:path'）：

```ts
ctx.effect(
  () =>
    web.register({
      kind: 'prefix',
      path: `/${PLUGIN_ID}/media`,
      handler: (req, res) => {
        if (!isLoopbackRequest(req.headers.host, req.socket.remoteAddress)) {
          json(res, 403, { ok: false, error: { code: 'forbidden', message: '仅限本机回环访问' } })
          return
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          json(res, 405, { ok: false, error: { code: 'method-not-allowed', message: '仅 GET/HEAD' } })
          return
        }
        let pathname: string
        try {
          pathname = decodeURIComponent((req.url ?? '').split('?')[0]).slice(PLUGIN_ID.length + 1) // 剥 '/dsh-video-generator'
        } catch {
          json(res, 400, { ok: false, error: { code: 'bad-url', message: 'URL 解码失败' } })
          return
        }
        const file = resolveMediaPath(runs.rootDir, pathname)
        if (!file || !existsSync(file) || !statSync(file).isFile()) {
          json(res, 404, { ok: false, error: { code: 'not-found', message: '产物不存在' } })
          return
        }
        const stat = statSync(file)
        res.statusCode = 200
        res.setHeader('content-type', mediaContentType(basename(file)))
        res.setHeader('content-length', String(stat.size))
        res.setHeader('cache-control', 'no-store')
        if (req.method === 'HEAD') { res.end(); return }
        const stream = createReadStream(file)
        stream.on('error', () => { res.destroy() })
        stream.pipe(res)
      },
    }),
  `${PLUGIN_ID}: media route`,
)
```

3. 规格 §7.2 便捷路由补全（GET /channels、POST /settings——与 /api 面同数据的顶层入口，均带 loopback 围栏）：

```ts
ctx.effect(
  () =>
    web.register({
      kind: 'exact',
      path: `/${PLUGIN_ID}/channels`,
      handler: (req, res) => {
        if (!isLoopbackRequest(req.headers.host, req.socket.remoteAddress)) {
          json(res, 403, { ok: false, error: { code: 'forbidden', message: '仅限本机回环访问' } })
          return
        }
        const envelope = handleApi({ vault, runs, probe: probeChannel }, 'channels.list', {})
        json(res, envelope.ok ? 200 : errorStatus(envelope), envelope)
      },
    }),
  `${PLUGIN_ID}: channels route`,
)

ctx.effect(
  () =>
    web.register({
      kind: 'exact',
      path: `/${PLUGIN_ID}/settings`,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req.headers.host, req.socket.remoteAddress)) {
          json(res, 403, { ok: false, error: { code: 'forbidden', message: '仅限本机回环访问' } })
          return
        }
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: { code: 'method-not-allowed', message: '仅 POST' } })
          return
        }
        let body: Record<string, unknown> = {}
        try {
          body = await readJsonBody(req)
        } catch (err) {
          if (err instanceof BodyTooLargeError) json(res, 413, { ok: false, error: { code: 'too-large', message: '请求体超过 1MB' } })
          else json(res, 400, { ok: false, error: { code: 'bad-json', message: '请求体非法 JSON' } })
          return
        }
        const envelope = await handleApi({ vault, runs, probe: probeChannel }, 'settings.update', body)
        json(res, envelope.ok ? 200 : errorStatus(envelope), envelope)
      },
    }),
  `${PLUGIN_ID}: settings route`,
)
```

4. `test/host-index.test.ts`：既有对 runs 路由 kind/path 的断言同步改（exact→prefix）；追加 media 路由端到端用例——用既有 fake web.register 捕获 handler，构造 stub req（`{ method:'GET', url:'/dsh-video-generator/media/<runId>/assets/a.png', headers:{ host:'127.0.0.1:1' }, socket:{ remoteAddress:'127.0.0.1' } }`）与 Writable 收集 res（`import { Writable } from 'node:stream'`，stub 需含 setHeader/statusCode/end/destroy），断言 200 + content-type image/png + 字节一致；穿越 URL 断言 404；`headers.host: 'evil.com'` 断言 403；GET /channels 断言 200 且响应串不含明文 key（vault 先种一个通道）。

- [ ] **Step 5: 全量校验 + 提交**

```bash
npm run typecheck && npm test 2>&1 | tail -3
git add src/host/routes.ts src/host/index.ts test/routes.test.ts test/host-index.test.ts
git commit -m "feat(m4): media 产物预览路由（穿越三层防线 + loopback 围栏）+ runs/<id> 详情 GET"
```

---

### Task 8: 画幅质量修复（竖版参考图 + crop 归一化）+ 非交互确认收紧

**Files:**
- Modify: `src/pipeline/machine.ts`（image size 透传 + 400 降级）
- Modify: `src/finalcut/render-ffmpeg.ts`（pad→crop）
- Modify: `scripts/demo-drama.ts`、`scripts/demo-single-shot.ts`（VGEN_AUTO_CONFIRM）
- Test: `test/machine.test.ts`、`test/render-ffmpeg.test.ts`（修改既有断言 + 追加）

- [ ] **Step 1: render-ffmpeg 测试改断言（先行，红）**

`grep -n "pad=\|decrease" test/render-ffmpeg.test.ts` 定位既有断言，改为：

```ts
assert.ok(vf.includes('force_original_aspect_ratio=increase'), '归一化须用 increase（覆盖式缩放）')
assert.ok(vf.includes(`crop=${width}:${height}`), '超出部分中心裁切（消黑边）')
assert.ok(!vf.includes('pad='), 'M4 回归：不得再引入 pad（9:16 画布黑边根因）')
```

- [ ] **Step 2: 实现 render-ffmpeg.ts 修改**

归一化 `-vf` 串（第 55 行附近）：

```ts
'-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},format=yuv420p`,
```

文件头注释同步：`归一化（scale 覆盖 + crop 中心裁切/fps）`。

- [ ] **Step 3: machine.ts size 透传（先加测试再实现）**

test/machine.test.ts 追加（复用该文件既有 fake provider/ctx 装置；fake provider 的 submit 需能记录 spec——若既有 fake 未记录，扩一个 `submitSpecs: Array<Record<string, unknown>>`）：

```ts
test('M4: shot-assets 提交带竖版 size；400 时降级重提（size-fallback 事件）', async () => {
  // fake provider: 第一次 submit（带 size）抛 RelayError(400)，记录两次 spec
  // 断言：submitSpecs[0].size === '1024x1536'，submitSpecs[1].size === undefined，
  //       事件流含 { type: 'size-fallback' }，段最终 done
})

test('M4: master-asset 角色卡横版 size / 场景图竖版 size', async () => {
  // 断言 char 任务 spec.size === '1536x1024'，scene 任务 spec.size === '1024x1536'
})
```

machine.ts 实现：

```ts
import { RelayError } from '../providers/relay-http.ts'

/** 9:16 画布用竖版参考图（2:3 为中转普遍支持的最接近竖档，渲染端 crop 归一化消黑边）。 */
const IMAGE_SIZE_PORTRAIT = '1024x1536'
/** 角色三视图卡：横向并排三视图，横版构图。 */
const IMAGE_SIZE_LANDSCAPE = '1536x1024'

/** size 透传 + 服务端 400 单次降级（部分上游不认 size 参数；429/5xx 走外层 retryTransient）。 */
async function submitImageWithSize(
  p: Provider, stage: StageId, prompt: string, size: string | undefined, onFallback: () => void,
): Promise<string> {
  if (!size) return (await p.submit(stage, { prompt })).jobId
  try {
    return (await p.submit(stage, { prompt, size })).jobId
  } catch (err) {
    if (err instanceof RelayError && err.status === 400) {
      onFallback()
      return (await p.submit(stage, { prompt })).jobId
    }
    throw err
  }
}
```

两处调用点替换：master-asset jobs 数组每项加 `size`（char → IMAGE_SIZE_LANDSCAPE，scene → IMAGE_SIZE_PORTRAIT）；shot-assets 用 IMAGE_SIZE_PORTRAIT。pump worker 内：

```ts
// 原：const { jobId: url } = await retryTransient(() => p.submit(st, { prompt: job.prompt }))
const url = await retryTransient(() =>
  submitImageWithSize(p, st, job.prompt, job.size, () => runs.appendEvent(runId, 'size-fallback', { stage: st, size: job.size })),
)
```

（shot-assets 段同理，prompt 变量名按现场 `merged.positive`。）

- [ ] **Step 4: demo 确认收紧**

`scripts/demo-drama.ts` / `scripts/demo-single-shot.ts`：`grep -n "isTTY\|confirm" scripts/demo-drama.ts scripts/demo-single-shot.ts` 定位现有非 TTY 自动确认逻辑，替换为：

```ts
const AUTO_CONFIRM = process.env['VGEN_AUTO_CONFIRM'] === '1'
// 非交互且未显式 opt-in → 拒绝并给出指引（修 M3b 遗留：非 TTY 一律自动确认过于激进）
if (!process.stdin.isTTY && !AUTO_CONFIRM) {
  console.error('[demo] 非交互终端须显式 VGEN_AUTO_CONFIRM=1 才放行成本确认（预估花费见价目表）')
  process.exit(2)
}
```

TTY 交互式 readline 确认路径保留；AUTO_CONFIRM=1 时直接放行。

- [ ] **Step 5: 全量校验 + 提交**

```bash
npm run typecheck && npm test 2>&1 | tail -3
git add src/pipeline/machine.ts src/finalcut/render-ffmpeg.ts scripts/demo-drama.ts scripts/demo-single-shot.ts test/machine.test.ts test/render-ffmpeg.test.ts
git commit -m "feat(m4): 竖版参考图 size 透传（400 降级）+ crop 归一化消黑边 + demo 确认 VGEN_AUTO_CONFIRM 显式 opt-in"
```

---

### Task 9: 设置页客户端 bundle（视频工坊 / 通道管理 双 tab）

**Files:**
- Create: `lib/client.js`（手写自注册 bundle，**不经 tsc**）
- Create: `src/client/index.ts`（类型参考，构建排除）
- Modify: `package.json`（dsh.client / exports / files）
- Modify: `tsconfig.json`（exclude）
- Test: `test/client-bundle.test.ts`

**参考实现（必读）：** `/Users/libing/.kcoder/profiles/web/node_modules/dsh-super-ppts/lib/client.js`（654 行，同宿主契约的完整工作样例：`window.__ModuleLoader__.load` 自注册、`exports.apply/inject`、locale 双语、slots.inject('settings.section')、CSS 注入、导航图标 mask 替换、makeStatefulComponent 容器模式）。我们的 bundle 与其结构同构，差异 = 双 tab + 本插件 API 面。

- [ ] **Step 1: package.json / tsconfig 修改**

package.json：

```json
"exports": {
  ".": { "default": "./lib/host/index.js" },
  "./client": { "default": "./lib/client.js" },
  "./package.json": "./package.json"
},
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-slots"],
    "platform": "web"
  }
},
"files": ["lib", "presets", "cordis.patch.yml", "README.md"]
```

tsconfig.json 增：`"exclude": ["src/client"]`（tsconfig.all.json 经 extends 继承该 exclude，include 覆盖不影响）。

- [ ] **Step 2: 写 bundle 加载契约测试（先红）**

```ts
// test/client-bundle.test.ts
/** lib/client.js 是手写 bundle（不经 tsc）：本测试守住加载契约——
 *  __ModuleLoader__ 自注册、exports.apply/inject 形态、settings.section 注册参数、locale 字典。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface CapturedSpec { id: string; factory: (require: (m: string) => unknown) => Record<string, unknown> }

function loadBundle(): { mod: Record<string, unknown>; captured: CapturedSpec } {
  const code = readFileSync(join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8')
  let captured: CapturedSpec | null = null
  const stubWindow = { __ModuleLoader__: { load(spec: CapturedSpec) { captured = spec } } }
  Reflect.set(globalThis, 'window', stubWindow)
  try {
    new Function(code)()
  } finally {
    Reflect.deleteProperty(globalThis, 'window')
  }
  assert.ok(captured, 'bundle 未经 __ModuleLoader__.load 自注册')
  const reactStub = {
    createElement: () => ({}),
    useState: (v: unknown) => [v, () => {}],
    useEffect: () => {},
    useCallback: (f: unknown) => f,
    useRef: () => ({ current: null }),
  }
  const mod = captured!.factory((m: string) => {
    if (m === 'react') return reactStub
    throw new Error(`unexpected require: ${m}`)
  })
  return { mod, captured: captured! }
}

test('bundle 自注册 id = dsh-video-generator，exports.apply/inject 契约', () => {
  const { mod, captured } = loadBundle()
  assert.equal(captured.id, 'dsh-video-generator')
  assert.equal(typeof mod['apply'], 'function')
  assert.deepEqual(mod['inject'], ['slots', 'locale'])
})

test('apply：注册 locale 字典（videoGen zh/en 均含 nav）+ settings.section（id/order）', () => {
  const { mod } = loadBundle()
  let ns = ''
  let dicts: { zh: Record<string, string>; en: Record<string, string> } | null = null
  const registered: Array<Record<string, unknown>> = []
  const ctx = {
    slots: {
      inject: (_type: string, loader: () => unknown) => { loader(); return () => {} },
      register: (opts: Record<string, unknown>) => { registered.push(opts); return () => {} },
    },
    locale: {
      register: (n: string, d: { zh: Record<string, string>; en: Record<string, string> }) => { ns = n; dicts = d; return () => {} },
      bind: () => (key: string) => key,
    },
    effect: (fn: () => () => void) => { fn(); return () => {} },
  }
  ;(mod['apply'] as (c: unknown) => void)(ctx)
  assert.equal(ns, 'videoGen')
  assert.ok(dicts && dicts.zh['nav'] && dicts.en['nav'])
  assert.equal(registered.length, 1)
  assert.equal(registered[0]!['name'], 'settings.section')
  assert.equal(registered[0]!['id'], 'video-generator')
  assert.equal(typeof registered[0]!['label'], 'function')
})

test('apply：无 document 环境（node）不炸——样式/导航图标注入全部守卫', () => {
  const { mod } = loadBundle()
  const ctx = {
    slots: { inject: () => () => {}, register: () => () => {} },
    locale: { register: () => () => {}, bind: () => (k: string) => k },
    effect: (fn: () => () => void) => { fn(); return () => {} },
  }
  assert.doesNotThrow(() => (mod['apply'] as (c: unknown) => void)(ctx))
})
```

Run: `node --test --test-reporter tap test/client-bundle.test.ts 2>&1 | tail -3`
Expected: FAIL（lib/client.js 不存在 → readFileSync ENOENT）

- [ ] **Step 3: 手写 lib/client.js**

结构规格（照 super-ppts 样例逐段同构实现；下面给出全部非样板代码，createElement 视图树按样例模式展开）：

**骨架与常量（完整代码）：**

```js
/**
 * DSH Web GUI Client Extension for dsh-video-generator.
 *
 * BUILD NOTE: HAND-MAINTAINED（不由 tsc 生成）。必须经
 * `window.__ModuleLoader__.load({ id, factory })` 自注册、`exports.apply`
 * 暴露扩展并 `return module.exports`。类型参考见 src/client/index.ts。
 *
 * 设置页「视频工坊」双 tab：
 * - 工坊：run 列表 → 详情（阶段徽章/产物预览/评审与 gate/花费），3s 轮询仅在
 *   本 tab 可见（document.visibilityState === 'visible'）时运转；
 * - 通道管理：通道 CRUD（脱敏回显）/默认/启用/测试探测/枚举模型一键导入/
 *   预算阈值/gate 缺省。
 * 数据面 = /dsh-video-generator/api/<method>（POST JSON，{ok,value}/{ok,error}）。
 */
window.__ModuleLoader__.load({
	id: "dsh-video-generator",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");

		var NS = "videoGen";
		var API = "/dsh-video-generator/api";
		var MEDIA = "/dsh-video-generator/media";
		var STAGES = ["story", "script", "storyboard", "master-asset", "shot-assets", "video", "final-cut"];
		var MEDIA_STAGES = ["master-asset", "shot-assets", "video", "final-cut"];

		/* api()/fill() 与 super-ppts 样例逐字同构（fetch POST + 信封解包），仅 API 常量不同 */

		/* ── locale：zh/en 双字典（键集完整一致，见下方键清单）── */
		/* ── CSS：vg- 前缀，卡片/徽章/表格/预览网格/tab 条，样例 sp- 规则同构移植 ── */
		/* ── 导航图标：NAV_MARKER = "data-dsh-video-generator-settings-nav"，
		      Lucide clapperboard 字形 data-uri mask，registerSettingsNavIcon 与样例同构 ── */
```

**locale 键清单（zh 值如下；en 逐键对应翻译）：**
`nav/title: "视频工坊"`、`tabStudio: "工坊"`、`tabChannels: "通道管理"`、`intro: "短视频/AI 短剧/漫剧生成管线：run 进度与产物预览、模型通道三要素自配置（官方/中转皆可）。"`、`runs: "生成任务"`、`runsEmpty: "还没有 run。在对话里让 Agent 走 vgen_story → vgen_script → vgen_storyboard → vgen_generate 三段交接即可开工。"`、`refresh: "刷新"`、`detail: "详情"`、`back: "返回列表"`、`stageTable: "阶段状态"`、`gate: "gate"`、`reviews: "评审"`、`reviewNone: "未评审"`、`reviewPassed: "通过"`、`reviewRetries: "重拍 {n} 次"`、`artifacts: "产物"`、`assetsGroup: "角色/场景"`、`shotsGroup: "分镜参考图"`、`clipsGroup: "镜头片段"`、`reviewGroup: "评审帧"`、`finalGroup: "成片"`、`spend: "预估花费 ¥{n}（{c} 笔）"`、`statusRunning: "进行中"`、`statusDone: "完成"`、`statusFailed: "失败"`、`statePending: "待执行"`、`stateRunning: "执行中"`、`stateDone: "完成"`、`stateFailed: "失败"`、`channels: "模型通道"`、`channelsIntro: "三要素 = Base URL / API Key / Model。Base URL 填站点根（如 https://api.example.com），支持 OpenAI 兼容官方端点与中转站；Key 只存本机 vault（0600），任何界面/响应仅回显脱敏串。"`、`chEmpty: "还没有通道：先添加一个。"`、`addChannel: "添加通道"`、`chId: "通道 ID"`、`chIdPlaceholder: "小写字母/数字/短横线，如 relay-main"`、`chLabel: "名称"`、`chBaseUrl: "Base URL（站点根）"`、`chApiKey: "API Key"`、`chCreate: "添加"`、`defaultBadge: "默认"`、`setDefault: "设为默认"`、`enable: "启用"`、`test: "测试通道"`、`testing: "探测中…"`、`testOk: "探测成功：枚举到 {n} 个模型"`、`testFail: "探测失败：{err}"`、`adopt: "导入枚举模型"`、`adopted: "已导入 {n} 个模型（kind 按内置目录推断）"`、`deleteCh: "删除"`、`deleteConfirm: "确定删除通道「{name}」？此操作不可撤销。"`、`budget: "预算与 gate"`、`budgetHint: "单笔估价超过阈值将要求会话内确认；unknown 价一律确认。gate 缺省作用于新 run（run 内可被 vgen_generate gates 参数覆盖）。"`、`threshold: "确认阈值（CNY）"`、`gateDefaults: "gate 缺省（媒体段）"`、`save: "保存"`、`saved: "已保存"`、`loading: "加载中…"`、`watermarkNote: "提示：happyhorse 等免费档视频模型可能带平台水印，介意请在通道管理中改用付费模型。"`

**导航图标 SVG（Lucide clapperboard，data-uri，完整值）：**

```js
var NAV_ICON_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z'/%3E%3Cpath d='m6.2 5.3 3.1 3.9'/%3E%3Cpath d='m12.4 3.4 3.1 4'/%3E%3Cpath d='M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'/%3E%3C/svg%3E";
```

**状态容器（完整数据流逻辑；视图树按样例模式展开）：**

```js
function makeStatefulComponent(t) {
	function Stateful() {
		var tabState = React.useState("studio");
		var tab = tabState[0], setTab = tabState[1];
		// 工坊：runs 列表 + 选中详情
		var runsState = React.useState(null);        // { runs: [...] }
		var detailState = React.useState(null);      // { record, artifacts, spend } | null
		var selectedState = React.useState(null);    // runId | null
		// 通道：列表 + 设置 + 探测结果 + 表单草稿
		var chansState = React.useState(null);       // { channels, defaultChannelId, budget, gateDefaults }
		var probeState = React.useState({});         // { [id]: { busy, ok, message } }
		var formState = React.useState({ id: "", label: "", baseUrl: "", apiKey: "" });
		var budgetDraftState = React.useState({ threshold: 1, gates: {} });
		// 公共
		var msgState = React.useState({ ok: "", err: "" });
		var busyState = React.useState(false);

		var flash = function (ok, err) { setMsg({ ok: ok || "", err: err || "" }); };

		var refreshStudio = React.useCallback(function () {
			var listP = api("runs.list").then(function (v) { setRunsData(v); });
			if (selectedState[0]) {
				return Promise.all([listP, api("runs.get", { id: selectedState[0] }).then(setDetailData)]);
			}
			return listP;
		}, [selectedState[0]]);

		var refreshChannels = React.useCallback(function () {
			return Promise.all([
				api("channels.list").then(setChansData),
				api("settings.get").then(function (s) {
					setBudgetDraft({ threshold: s.budget ? s.budget.confirmThresholdCny : 1, gates: s.gateDefaults || {} });
				}),
			]);
		}, []);

		// 3s 轮询：仅工坊 tab + 页面可见时运转（规格 §7.3）
		React.useEffect(function () {
			if (tab !== "studio") return function () {};
			var timer = null;
			var tick = function () {
				if (document.visibilityState === "visible") {
					refreshStudio().catch(function () {});
				}
			};
			timer = setInterval(tick, 3000);
			return function () { if (timer) clearInterval(timer); };
		}, [tab, refreshStudio]);

		React.useEffect(function () {
			var alive = true;
			var p = tab === "studio" ? refreshStudio() : refreshChannels();
			p.catch(function (e) { if (alive) flash("", String(e.message || e)); });
			return function () { alive = false; };
		}, [tab]);

		/* 操作编排（run(promise, okText) 模式与样例同构：busy → flash → refresh）：
		   - onSelectRun(id) / onBack()
		   - onCreateChannel()：api("channels.create", form) → 成功后表单清空（提交即清空，密码框不留值）
		   - onToggleEnabled(id, enabled) / onSetDefault(id) / onDeleteChannel(row)（window.confirm）
		   - onTestChannel(id)：setProbe busy → api("channels.test", {id}) →
		       value.probe.ok ? testOk{n=models} + 存下 probe.models : testFail{err=value.probe.error}
		   - onAdoptModels(id)：api("channels.adoptModels", { id, models: probeState[id].models })
		   - onSaveBudget()：api("settings.update", { confirmThresholdCny, gateDefaults })
		   所有 api 名与 host routes.ts dispatch 一一对应（runs.list/runs.get/channels.*/settings.*）。 */

		/* 视图：
		   root = h2 标题 + tab 条（两个 button，active 类）+ msg 横幅 + (tab === "studio" ? StudioView : ChannelsView)
		   StudioView：
		     列表态 = runs 行（title、短 id、状态徽章、7 段 chips、updatedAt、[详情]按钮）
		     详情态 = [返回列表] + 阶段表（段名/状态/gate/评审徽章）+ 产物预览网格 + spend 行
		       预览 URL = MEDIA + "/" + runId + "/" + artifact.rel
		       图片组（assets/shots/review）→ <img loading="lazy"> 缩略 120px
		       clips/final.mp4 → <video controls preload="none"> 240px
		       final.srt → <a href download>
		   ChannelsView：
		     通道行（label、id、baseUrl、apiKeyMasked、启用 checkbox、默认徽章/[设为默认]、
		       [测试通道]→行内探测结果（ok 绿/err 红 + 模型数 + 前 5 个模型名 + [导入枚举模型]按钮）、[删除]）
		     添加通道卡片（id/label/baseUrl/apiKey type=password autoComplete=off；水印提示行）
		     预算与 gate 卡片（阈值 number input + 4 个媒体段 gate select（auto/ask/manual）+ 保存） */

		return React.createElement(...);
	}
	return Stateful;
}
```

**入口（完整代码，与样例同构，仅常量不同）：**

```js
		var inject = ["slots", "locale"];

		function apply(ctx) {
			ensureStyles();
			if (ctx.locale && typeof ctx.locale.register === "function") {
				ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, "dsh-video-generator: section dictionaries");
			}
			var t = ctx.locale && typeof ctx.locale.bind === "function"
				? ctx.locale.bind(NS)
				: function (key, params) { return fill(zh[key] || en[key] || key, params); };
			if (typeof ctx.effect === "function") {
				ctx.effect(function () { return registerSettingsNavIcon(function () { return t("nav"); }); }, "dsh-video-generator: settings navigation icon");
			}
			if (!ctx.slots || typeof ctx.slots.inject !== "function") return;
			var Stateful = makeStatefulComponent(t);
			try {
				ctx.slots.inject("settings.section", function () {
					return ctx.slots.register({
						name: "settings.section",
						id: "video-generator",
						order: 21,
						label: function () { return t("nav"); },
						locale: NS,
					}, Stateful);
				});
			} catch (error) {
				console.error("[dsh-video-generator] settings.section 注册失败（设置页菜单项不可用，其余功能不受影响）:", error);
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
```

CSS 规则集：把样例 `sp-` 全套规则改前缀 `vg-` 移植，另加：`.vg-tabs{display:flex;gap:8px;margin:8px 0 4px}`、`.vg-tab{...同 .sp-btn，active 态 .vg-tab-active 用 primary 边框/文字}`、`.vg-stage-chips{display:flex;gap:4px;flex-wrap:wrap}`、`.vg-chip{border-radius:999px;padding:1px 8px;font-size:11px}` + 四态色（pending 灰/running 蓝/done 绿/failed 红，用样例徽章色板）、`.vg-preview-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}`、`.vg-preview-grid img{width:100%;border-radius:6px}`、`.vg-preview-grid video{width:100%;border-radius:6px;background:#000}`、`.vg-probe{font-size:12px;margin-top:6px}`（ok 绿/err 红两态复用 msg 色）。导航图标 mask 两条规则与样例同构（换 NAV_MARKER 常量）。

- [ ] **Step 4: src/client/index.ts 类型参考（与 bundle 同构声明，构建排除）**

照 super-ppts `src/client/index.ts` 的文档注释模式写：BUILD NOTE（手写产物警示 + 裸 ESM 不注册症状原文）、功能面清单（双 tab/API 面/导航图标）、APPLY NOTE（inject 双声明：exports.inject + package.json dsh.client.inject）、`export interface VgenClientContext`（slots/locale/effect 同构）、`export const inject = ['slots', 'locale']`、`export const NAV_MARKER = 'data-dsh-video-generator-settings-nav'`、`export function registerSettingsNavIcon(label: () => string): () => void`（DOM 守卫实现同构）、`export function apply(ctx: VgenClientContext): void`（locale.register + slots.inject('settings.section', ...) id 'video-generator' order 21）。

- [ ] **Step 5: 跑测试确认通过 + 全量**

Run: `node --test --test-reporter tap test/client-bundle.test.ts 2>&1 | tail -3 && npm run typecheck && npm test 2>&1 | tail -3`
Expected: bundle 3 tests PASS；typecheck 绿（src/client 已排除）；全量绿

- [ ] **Step 6: 提交**

```bash
git add lib/client.js src/client/index.ts package.json tsconfig.json test/client-bundle.test.ts
git commit -m "feat(m4): 设置页双 tab 客户端 bundle（视频工坊 run/产物预览 + 通道管理三要素/探测/导入/预算 gate）"
```

---

### Task 10: 题材包预设（漫剧导演 + 疗愈绘本题材包）+ guidance/README 收口

**Files:**
- Create: `presets/preset.yml`、`presets/agent.cordis.yml`
- Modify: `src/host/index.ts`（ensurePresetInstalled + vgenGuidance 全文更新）
- Modify: `README.md`
- Test: `test/host-index.test.ts`（追加预设安装断言）

- [ ] **Step 1: presets/preset.yml（完整内容）**

```yaml
name: 漫剧导演
description: 短视频/AI 短剧/漫剧制作 Agent 预设：三段交接（故事→剧本→分镜）驱动 dsh-video-generator 管线，资产一致性 + 逐镜图生视频 + 配音成片（mp4+SRT），带评审重拍闭环与成本护栏；内置「疗愈绘本」题材包（风格词汇/角色原型/节奏模板/负面词）。
order: 6
```

- [ ] **Step 2: presets/agent.cordis.yml（完整内容）**

```yaml
# ─────────────────────────────────────────────────────────────────────────────
# dsh-video-generator Agent Preset（漫剧导演）
#
# 工作流全部走 vgen_* 工具（能力细节以系统通告为准，不在此复制）；
# persona 只做流程纪律 + 题材包（疗愈绘本）+ 成本/gate 纪律。
# ─────────────────────────────────────────────────────────────────────────────

- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: >-
      You are an expert Comic-Drama Director Agent powered by the {{model}} model.
      Your working directory is {{cwd}}.
      你是漫剧/短剧导演：从一句话创意到成片（竖屏 9:16 mp4 + SRT），
      全程用 dsh-video-generator 插件的 vgen_* 工具驱动，产物落 run 目录持久化。

      ## 标准工作流（七段，按序推进）

      1. 需求确认：题材/时长/画风/语言。用户没说清就问一次（附推荐）。
      2. vgen_story：故事 JSON（title/logline/style/characters/chapters）。
      3. vgen_script：剧本 JSON（scenes/dialog，引用完整性会被校验）。
      4. vgen_storyboard：分镜数组（每镜 line/prompt/characterIds/camera/durationSec/voiceHint），
         工具自动注入四层提示词。
      5. vgen_generate target=assets：角色三视图/场景主图/逐镜参考图。
      6. vgen_generate target=video：逐镜图生视频。
      7. vgen_generate target=final：配音（云端 TTS 优先，say/SAPI 兜底）+ 成片渲染。

      每步之后用 vgen_status 核对状态再继续；出错按错误信封 code 处置
      （confirm-required → 向用户转述成本后 confirm:true 重调；
      gate-approval → 请用户批准后 gateApprovals 重调；
      manual-gate → 收用户文件走 vgen_provide）。

      ## 质量闭环（成片前必做）

      对关键镜头（至少首镜 + 角色特写镜）走 vgen_review：
      不带 score 抽三帧 → 用读图工具逐帧看（构图/角色一致性/肢体畸变/文字水印）→
      带 score 1-5 重调。≤2 会自动追加负面词重拍（每镜至多 2 次，重拍要 confirm）。
      重拍仍 ≤2 → 改分镜 prompt（换景别/简化动作）后 rerunStage=video，或接受并告知用户。

      ## 成本纪律

      - 一切生成花费走 confirm 语义：收到 confirm-required 必须先向用户转述
        「几次调用 × 单价估价」再确认，绝不代替用户拍板。
      - vgen_channels action=spend 可随时对账；action=health 可体检通道。
      - happyhorse 等免费档模型带平台水印：用户介意时提醒换付费模型。

      ## 题材包：疗愈绘本（默认题材，用户指定其他题材时按同结构现编）

      - 风格词汇（进 story.style）：疗愈绘本风，柔和水彩质感，暖色低饱和，
        圆润角色轮廓，细腻光影，纸张肌理，儿童绘本插画。
      - 角色原型：小动物主角（拟人化，服饰简洁鲜明特征件：围巾/帽子/背带裤），
        配角 1-2 个，appearance 写全（物种/毛色/服饰/特征件/体型比例）。
      - 节奏模板：3-5 章 × 每章 1-2 镜 = 总 4-8 镜；每镜 3-5 秒；
        单线情感弧（相遇→小挫折→暖意收尾），无暴力惊吓元素。
      - 台词/旁白：voiceHint 写温和旁白句（≤30 字/镜），口吻像睡前故事；
        line 与 voiceHint 可同句。
      - 追加负面词（进 vgen_review negativeHint 或分镜 camera 备注）：
        尖锐线条、冷色滤镜、恐怖元素、复杂机械结构、密集文字。
      - 运镜基调：缓慢推近/轻摇为主，禁快速甩镜（与 i2v 运动提示词协同）。

- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    sections:
      - 产物路径：run 目录（vgen_status 返回）下 assets/shots/clips/review/final.mp4/final.srt；交付时给用户绝对路径。
      - 通道未配置时（工具报"未配置生成通道"）：引导用户打开 Web 设置页「视频工坊」→「通道管理」tab 填三要素，或经对话让用户提供后走 API。
      - 断点续跑：run.json 即事实源；失败段修复后 vgen_generate 同 target 重调即可，已完成段不重花钱；需要重做某段用 rerunStage。
```

（agent.cordis.yml 的插件行结构以 super-ppts `presets/agent.cordis.yml` 实际文件为准——实现前 `sed -n '60,120p'` 查看其 agent-instructions 段与文件尾部是否有额外插件行/配置节，保持同构。）

- [ ] **Step 3: host/index.ts 预设安装 + 测试**

test/host-index.test.ts 追加（apply 调用沿用该文件既有 fake ctx 装置；HOME 重定向隔离）：

```ts
test('M4: apply 安装预设到 ~/.dsh 与 ~/.kcoder 的 .agent-presets（幂等）', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'vgen-home-'))
  const prev = process.env['HOME']
  process.env['HOME'] = home
  try {
    // 调用既有装置构造的 apply(fakeCtx)
    applyDut()
    for (const base of ['.dsh', '.kcoder']) {
      const p = join(home, base, '.agent-presets', 'dsh-video-generator', 'preset.yml')
      assert.ok(existsSync(p), `缺 ${base} 预设`)
    }
  } finally {
    if (prev === undefined) delete process.env['HOME']
    else process.env['HOME'] = prev
  }
})
```

host/index.ts 实现（import 增 `copyFileSync, existsSync, mkdirSync` from 'node:fs'、`homedir` from 'node:os'、`resolve, join` from 'node:path'、`fileURLToPath` from 'node:url'）：

```ts
/** 包根：lib/host/index.js（构建产物）与 src/host/index.ts（测试直跑）上溯两级均为包根。 */
function packageRoot(): string {
  return fileURLToPath(new URL('../../', import.meta.url))
}

/** 预设安装（super-ppts 模式，幂等）：写 ~/.dsh 与 ~/.kcoder 双候选目录
 *  （宿主品牌 home 分叉期的双保险），任一失败静默——预设缺失不阻断插件加载。 */
function ensurePresetInstalled(): void {
  try {
    const src = resolve(packageRoot(), 'presets')
    if (!existsSync(src)) return
    for (const base of ['.dsh', '.kcoder']) {
      try {
        const dest = join(homedir(), base, '.agent-presets', 'dsh-video-generator')
        mkdirSync(dest, { recursive: true })
        for (const f of ['preset.yml', 'agent.cordis.yml']) {
          const p = join(src, f)
          if (existsSync(p)) copyFileSync(p, join(dest, f))
        }
      } catch {
        // 单目录失败不影响另一目录
      }
    }
  } catch {
    // 预设安装失败不阻断插件加载
  }
}
```

apply() 首行调用 `ensurePresetInstalled()`。

vgenGuidance 全文替换为（含 M4 新工具与纪律）：

```ts
export const vgenGuidance = `本机已安装 dsh-video-generator 插件（短视频/短剧/漫剧生成管线，竖屏 9:16 成片 mp4+SRT）。三段交接工作流：会话模型自己产出结构化 JSON 并依次调用 vgen_story → vgen_script → vgen_storyboard，之后接 vgen_generate 推进非 LLM 段。
1) vgen_story 提交故事 JSON 开新 run：{ title, logline, style, characters: [{ id（^[a-z0-9_-]+$，≤48）, name, appearance }], chapters: [...] }；
2) vgen_script 提交剧本 JSON：scenes: [{ id, name, description, characters: [id] }]、dialog: [{ sceneId, characterId, line }]，引用必须存在；
3) vgen_storyboard 提交分镜数组：每镜 { index（从 1 连续）, line, prompt, characterIds, sceneId?, camera?, durationSec 2..10, voiceHint? }，工具自动注入四层提示词；
4) vgen_generate { runId, target: 'assets'|'video'|'final', confirm?, concurrency?, gates?, gateApprovals?, rerunStage? }：assets 出角色三视图/场景主图/逐镜参考图，video 逐镜图生视频，final 配音并渲染成片。首次不带 confirm；返回 confirm-required（error.code）→ 向用户转述成本后 confirm:true 重调；gate-approval → 用户批准后 gateApprovals:["段名"] 重调；manual-gate → 收用户文件走 vgen_provide；重做某段 → rerunStage（媒体段重置 pending）；
5) vgen_status { runId }：进度 + gates + reviews + 最近事件；
6) vgen_review { runId, shot, score?, negativeHint?, confirm? } 质量闭环：不带 score → 返回成片 25/50/75% 三帧路径（用读图工具逐帧查看后评分）；带 score 1-5 → ≥3 记通过；≤2 自动追加负面词重拍（每镜 ≤2 次，重拍花费同 confirm 语义），重拍后返回新帧继续评；
7) vgen_provide { runId, stage, files: [{ path, shot?, name? }] }：manual gate 产物注入（master-asset 文件名 char-*/scene-*；shot-assets/video 逐镜 shot 号，video 须全镜覆盖且时长≥0.5s；final-cut 首文件 .mp4 注入后 run 直接 done）；
8) vgen_channels { action: 'list'|'health'|'spend' }：通道面板（脱敏列表/探测健康+估价/累计消耗）。
用户通道在 Web 设置页「视频工坊」管理（三要素自配，官方/中转皆可）。注意：happyhorse 等免费档视频模型可能带平台水印，介意请提醒用户换付费模型。错误信封 { ok: false, error: { code, message } }；未知 runId = not-found。`
```

- [ ] **Step 4: README.md 更新（M4 段）**

追加/更新：工具表 8 个（vgen_provide 一行 + 偏离说明）、设置页双 tab 使用说明、VGEN_AUTO_CONFIRM/VGEN_TTS_*/VGEN_FFMPEG/VGEN_POLL_DELAY_MS 环境变量表、画幅策略（竖版参考图 + crop 消黑边）、已知限制三条（手动 shot 图无 URL 不能自动 i2v / kling 契约钉住挂起 / Windows SAPI 未真机验证）、水印提示。

- [ ] **Step 5: 全量校验 + 提交**

```bash
npm run typecheck && npm test 2>&1 | tail -3
git add presets src/host/index.ts test/host-index.test.ts README.md
git commit -m "feat(m4): 漫剧导演预设（疗愈绘本题材包）+ guidance 收口（8 工具/confirm/gate 纪律/水印提示）"
```

---

### Task 11: 出口验证——零 key mock 全链路 demo + 真机 demo + 隔离 profile GUI 验收

**Files:**
- Rewrite: `scripts/demo-mock.ts`
- Modify: `scripts/demo-drama.ts`（评审抽帧步骤）
- 无 src 改动（发现问题回对应 Task 修）

- [ ] **Step 1: 重写 scripts/demo-mock.ts（零 key 全链路，完整代码）**

```ts
/** 零 key 全链路 mock demo（M4 出口标准）：三段交接 → 资产 → 视频 → 成片 → 评审重拍闭环。
 *  mock provider 出 mock:// URL，本地 fetchImpl 供流（1px PNG / lavfi 占位片）；成片走真 ffmpeg。
 *  依赖：VGEN_FFMPEG 必填（须含 drawtext 滤镜——homebrew ffmpeg 8.1 无，用 bilibili 版）。 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultStore } from '../src/store/vault.ts'
import { RunStore } from '../src/store/runs.ts'
import { buildHandoffTools } from '../src/tools/handoff.ts'
import { buildGenerateTools } from '../src/tools/generate.ts'
import { buildReviewTools } from '../src/tools/review.ts'
import { createMockProvider } from '../src/providers/mock.ts'

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

async function main(): Promise<void> {
  const ffmpeg = process.env['VGEN_FFMPEG']
  if (!ffmpeg || !existsSync(ffmpeg)) {
    console.error('[demo:mock] 需要 VGEN_FFMPEG 指向含 drawtext 的 ffmpeg（如 bilibili 客户端自带版）')
    process.exit(2)
  }
  const filters = execFileSync(ffmpeg, ['-hide_banner', '-filters'], { encoding: 'utf8' })
  if (!filters.includes('drawtext')) {
    console.error('[demo:mock] 该 ffmpeg 缺 drawtext 滤镜，成片字幕会失败：换 VGEN_FFMPEG')
    process.exit(2)
  }

  // 全新隔离 HOME（vault/runs/spend 全落 tmp）
  const home = mkdtempSync(join(tmpdir(), 'vgen-demo-mock-'))
  const env = { ...process.env, DSH_HOME: home, VGEN_FFMPEG: ffmpeg, VGEN_POLL_DELAY_MS: '10', VGEN_TTS_MODEL: '' } as NodeJS.ProcessEnv
  const vault = VaultStore.open({ env })
  const runs = RunStore.open({ env })

  // lavfi 占位片（3s 竖版带音轨，充当 mock 视频产物）
  const lavfi = join(home, 'placeholder.mp4')
  execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=540x960:rate=24:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', lavfi])
  const clipBytes = readFileSync(lavfi)

  // mock:// URL 供流：video 段给占位片字节，图像段给 1px PNG
  const fetchImpl = (async (url: string) => {
    const bytes = String(url).includes('/video.png') ? clipBytes : PNG_1PX
    return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
  }) as unknown as typeof fetch

  const mockProvider = createMockProvider()
  const channel = () => ({ id: 'mock', baseUrl: 'https://mock.invalid', apiKey: 'mock-key-000000' })
  const handoff = buildHandoffTools({ vault, runs })
  const gen = buildGenerateTools({
    vault, runs, channel, env,
    providersOverride: { forModel: () => mockProvider },
    fetchImpl, pricing: null, confirmer: async () => true,
  })
  const review = buildReviewTools({
    vault, runs, channel, env,
    providersOverride: { forModel: () => mockProvider },
    fetchImpl, pricing: null, confirmer: async () => true,
  })

  const ok = (r: { ok: boolean; error?: { code: string; message: string } }, step: string): void => {
    if (!r.ok) throw new Error(`${step} 失败: ${r.error?.code} ${r.error?.message}`)
  }

  // 三段交接（疗愈绘本题材包迷你版：2 镜）
  const storyR = await handoff.story.execute({ story: {
    title: '小鲸鱼的月亮船', logline: '小鲸鱼帮月亮找回掉进海里的星星。',
    style: '疗愈绘本风，柔和水彩质感，暖色低饱和',
    characters: [{ id: 'jingyu', name: '小鲸鱼', appearance: '圆滚滚的蓝色小鲸鱼，戴黄色小圆眼镜' }],
    chapters: ['星星掉进海里', '小鲸鱼送回星星'],
  } })
  ok(storyR, 'story')
  const runId = (storyR as { ok: true; value: { runId: string } }).value.runId

  ok(await handoff.script.execute({ runId, script: {
    title: '小鲸鱼的月亮船', logline: '小鲸鱼帮月亮找回掉进海里的星星。',
    style: '疗愈绘本风，柔和水彩质感，暖色低饱和',
    characters: [{ id: 'jingyu', name: '小鲸鱼', appearance: '圆滚滚的蓝色小鲸鱼，戴黄色小圆眼镜' }],
    chapters: ['星星掉进海里', '小鲸鱼送回星星'],
    scenes: [{ id: 's1', name: '夜海', description: '深蓝夜海，月光铺成银路', characters: ['jingyu'] }],
    dialog: [{ sceneId: 's1', characterId: 'jingyu', line: '别怕，我送你回家。' }],
  } }), 'script')
  ok(await handoff.storyboard.execute({ runId, shots: [
    { index: 1, line: '星星掉进了海里', prompt: '深蓝夜海上一颗发光的小星星溅起水花，远景', characterIds: [], sceneId: 's1', camera: '缓慢推近', durationSec: 3, voiceHint: '一颗星星，悄悄掉进了海里。' },
    { index: 2, line: '小鲸鱼送星星回家', prompt: '小鲸鱼用头顶着发光的星星跃出海面，月亮在天上微笑', characterIds: ['jingyu'], sceneId: 's1', camera: '轻摇跟随', durationSec: 3, voiceHint: '小鲸鱼说，别怕，我送你回家。' },
  ] }), 'storyboard')

  // 生成到成片
  const genR = await gen.generate.execute({ runId, target: 'final', confirm: true })
  ok(genR, 'generate')
  const finalPath = join(runs.rootDir, runId, 'final.mp4')
  if (!existsSync(finalPath)) throw new Error('final.mp4 未产出')

  // 评审闭环：抽帧 → 打 2 分触发重拍（mock 零成本）→ 再抽帧 → 打 4 分通过
  const framesR = await review.review.execute({ runId, shot: 1 })
  ok(framesR, 'review:frames')
  const frames = (framesR as { ok: true; value: { frames: string[] } }).value.frames
  if (frames.length !== 3 || !frames.every((f) => existsSync(f))) throw new Error('抽帧未产出 3 帧')
  const reshootR = await review.review.execute({ runId, shot: 1, score: 2, negativeHint: '画面过暗' })
  ok(reshootR, 'review:reshoot')
  if ((reshootR as { ok: true; value: { action: string } }).value.action !== 'reshoot') throw new Error('未触发重拍')
  const passR = await review.review.execute({ runId, shot: 1, score: 4 })
  ok(passR, 'review:pass')

  const rec = runs.get(runId)!
  if (rec.reviews?.['shot-1']?.passed !== true || rec.reviews['shot-1'].retries !== 1) throw new Error('评审档案未落 run.json')
  for (const st of ['story', 'script', 'storyboard', 'master-asset', 'shot-assets', 'video', 'final-cut']) {
    if (rec.stages[st] !== 'done') throw new Error(`段未 done: ${st}`)
  }

  console.log(`[demo:mock] OK 零 key 全链路 run=${runId}`)
  console.log(`  成片: ${finalPath}`)
  console.log(`  评审: shot-1 scores=${JSON.stringify(rec.reviews['shot-1'].scores)} retries=1 passed=true`)
  console.log(`  HOME: ${home}（tmp 隔离，可随时删除）`)
}

main().catch((err: unknown) => {
  console.error('[demo:mock] FAILED', err)
  process.exit(1)
})
```

**实现注意**：`ok()` 辅助在 `!r.ok` 时 throw，故 ok(...) 之后对返回值做 `as { ok: true; value: ... }` 窄化是安全的。其余照抄。

- [ ] **Step 2: 跑 mock demo**

```bash
VGEN_FFMPEG="/Users/libing/Library/Application Support/bilibili/ffmpeg/ffmpeg" npm run demo:mock
```

Expected: `[demo:mock] OK 零 key 全链路 run=...` + 成片/评审/HOME 三行；退出码 0。
（mac 上 voiceHint 走 say 真合成；Linux 无 say → tts-skip 静音成片，同样通过。）

- [ ] **Step 3: demo-drama.ts 追加评审抽帧步骤（真机、零额外花费）**

在成片输出后追加：调 vgen_review 阶段A（shot 1）→ 打印 3 帧路径 + 提示「会话中让 Agent 读图评分触发重拍闭环（重拍花费需 confirm）」。不自动带 score（避免脚本内产生付费重拍）。同时确认 Step 4（Task 8）的 VGEN_AUTO_CONFIRM 收紧已生效：

```bash
node scripts/demo-drama.ts   # 无 TTY 无 VGEN_AUTO_CONFIRM → 预期 exit 2 + 指引
```

- [ ] **Step 4: 真机 demo（花费 ≈ 一次三镜 run，与 M3b 同量级）**

```bash
export VGEN_BASE_URL="https://api.vectorengine.cn"
export VGEN_API_KEY="<会话内既有 key>"
export VGEN_FFMPEG="/Users/libing/Library/Application Support/bilibili/ffmpeg/ffmpeg"
export VGEN_AUTO_CONFIRM=1
export VGEN_TTS_MODEL="gpt-4o-mini-tts"
export VGEN_TTS_VOICE="alloy"
export VGEN_TTS_INSTRUCTIONS="温柔的中文女声旁白，讲绘本故事的感觉，语速平缓自然"
node scripts/demo-drama.ts
```

验收清单（逐项核对）：
- [ ] 七段全 done，final.mp4 + final.srt 产出
- [ ] **画幅**：抽两帧看无黑边（crop 归一化生效；参考图为竖版 1024x1536）
- [ ] **声音**：三段语音全有声（云端 TTS mp3），音量正常
- [ ] **字幕**：CJK 字幕烧录正常
- [ ] 评审抽帧：shot-1 三帧产出可看
- [ ] run.json：reviews/gates 字段形态正确，spend 事件含估价

- [ ] **Step 5: 隔离 profile 真机 boot + GUI 验收（鲸影规则 10）**

```bash
npm run build
export VGEN_LAB=/tmp/vgen-m4-lab && rm -rf "$VGEN_LAB" && mkdir -p "$VGEN_LAB"
DSH_HOME=$VGEN_LAB dsh plugin --profile vgen-lab add "$(pwd)"
# 后台起 web（managed background job），从日志拿端口：
DSH_HOME=$VGEN_LAB dsh --profile vgen-lab web
```

curl round-trip（端口按启动日志替换）：

```bash
curl -s http://127.0.0.1:<port>/dsh-video-generator/health
curl -s http://127.0.0.1:<port>/dsh-video-generator/runs
curl -s -X POST http://127.0.0.1:<port>/dsh-video-generator/api/channels.list -H 'content-type: application/json' -d '{}'
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:<port>/dsh-video-generator/media/run-x/../../vault.json"  # 预期 404
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: evil.com' http://127.0.0.1:<port>/dsh-video-generator/api/runs.list -X POST -d '{}'  # 预期 403
```

Playwright GUI 验收（browser_navigate 到 GUI → 打开设置）：
- [ ] 设置导航出现「视频工坊」项（clapperboard 图标，非通用齿轮）
- [ ] 工坊 tab：run 列表渲染（真机 demo 的 run 可见）→ 点详情：阶段徽章/产物预览（图可见、视频可播）/花费行
- [ ] 通道 tab：添加通道表单 → 填（id: relay-test, baseUrl: https://api.vectorengine.cn, apiKey: 真 key）→ 添加成功且列表只回显脱敏串
- [ ] 「测试通道」→ 探测成功显示模型数；「导入枚举模型」→ models 列表更新
- [ ] 设为默认 / 启用开关 / 预算阈值保存 / gate 缺省保存 → 刷新后仍在
- [ ] 截图存档（工坊 + 通道两 tab）

清理：

```bash
DSH_HOME=$VGEN_LAB dsh plugin --profile vgen-lab remove dsh-video-generator
# kill 后台 web job；rm -rf /tmp/vgen-m4-lab
```

- [ ] **Step 6: 全量回归 + 合并**

```bash
npm run typecheck && npm test 2>&1 | tail -3
git add scripts/demo-mock.ts scripts/demo-drama.ts
git commit -m "feat(m4): 零 key 全链路 mock demo（含评审重拍闭环）+ 真机 demo 评审抽帧步骤"
git checkout main && git merge feat/m4-completion --no-ff -m "merge: M4 收官——vgen_review 评审重拍/设置页双 tab/gate manual 接线/漫剧导演题材包，mock+真机双 demo 达标"
```

---

## 验收对照（规格 §9 M4 出口标准）

| 出口项 | 落点 |
|---|---|
| vgen_review 评审重拍 | Task 2/3/4（frames + shot-clip + 两阶段工具，重拍 ≤2 记录进 run.json） |
| 2 tab 设置页 | Task 6/7/9（API 面 + media 路由 + 手写 bundle；3s 轮询仅可见时） |
| gate manual | Task 5（vgen_provide 四段注入 + gates 持久化 + gate-approval/manual-gate 信封 + rerunStage） |
| 1 个题材包 | Task 10（漫剧导演预设 · 疗愈绘本题材包，~/.dsh 与 ~/.kcoder 双目录安装） |
| 无 key demo（mock） | Task 11 Step 1-2（全链路 + 评审重拍闭环，lavfi 占位片 + mock URL 本地供流） |
| 真机 demo | Task 11 Step 4-5（三镜出片画幅/声音/字幕验收 + 隔离 profile GUI 验收 + curl 围栏 round-trip） |
| 附带质量项 | Task 8（竖版参考图 + crop 消黑边；VGEN_AUTO_CONFIRM 收紧）；vgen_channels/水印提示（Task 6/10） |

## 风险与预案

1. **中转不认 size 参数**：submitImageWithSize 400 单次降级 + size-fallback 事件（Task 8）；真机 demo 若见降级事件仍出片即达标，画幅由 crop 保底（只是参考图非竖版时裁切损失变大）。
2. **client bundle 宿主契约漂移**：以 super-ppts lib/client.js（同机同宿主在装插件）为对照样例；bundle 加载契约有 stub 测试兜底（Task 9 Step 2），GUI 端行为在隔离 profile Playwright 验收（Task 11 Step 5）——失败只降级设置页菜单项，不影响 host 功能（apply try/catch）。
3. **隔离 profile 起 web 端口不确定**：从启动日志抓 URL；playwright 用该 URL。dsh plugin add 本地路径旗形若变，先 `dsh plugin --help` 对照（M1 已验证过此路径）。
4. **真机 demo 花费**：与 M3b 同量级（3 镜图 + 3 镜视频 + TTS）；评审重拍不在真机脚本内自动触发（避免翻倍），重拍链路由 mock demo 全量覆盖。
5. **preset 目录品牌分叉（.dsh vs .kcoder）**：双写幂等安装（Task 10）；GUI 未显示预设时检查宿主实际读取目录（`grep -rn "agent-presets" <runtime>/node_modules/@deepseek-ai/dsh-agent-presets/lib/index.js` 的 home 解析）。
