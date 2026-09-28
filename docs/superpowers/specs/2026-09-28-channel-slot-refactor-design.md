# 通道设置重构设计规格：用途槽（Use-Slot）+ 通用音乐适配器

> 日期：2026-09-28 · 状态：已与需求方逐节确认（6 槽位 / 通用音乐适配器 / 音乐模板预填 / MV 先曲后镜 / 单槽单模型）
> 前置：[设计规格 v1.1](2026-09-06-dsh-video-generator-design.md)（七段流水线、通道层）、[漫剧工坊设计规格](2026-09-17-drama-workbench-design.md)（工作台、Proposal 闭环）
> 触发：本轮全量代码审计结论（通道层"枚举导入 + 多模型取第一项"范式被否决；音乐能力完全缺失）

---

## 0. 背景与目标

### 0.1 为什么要重构

现通道层是「通道 × 模型池」范式：配一个中转站 → 探测 `/v1/models` → 勾选导入一堆模型 → 运行时按 `kind` 取**列表第一项**（[model-selection.ts](../../../src/model-selection.ts) `selectConfiguredModel`）。审计暴露的后果：

- 用户面对几百个模型名，配置成本与实际只用 2–3 个模型的事实严重错配；
- "多模型"语义只实现了"取第一个"，既无路由也无兜底（`route()` 是死代码，零生产调用）；
- 协议族靠**模型名猜**（[registry.ts](../../../src/registry.ts) `videoProtocolFamily`），与"零站点硬编码"初衷相悖；
- 音乐能力（BGM/MV）完全缺失——而漫剧工坊的成片形态离不开配乐。

### 0.2 目标

1. 配置范式改为**用途槽**：每个"用途"槽位显式绑定**恰好一个**模型，用户自己指定模型名并可用一次真实调用验证。
2. 新增**音乐**通道类（BGM / MV 整曲），采用**通用适配器**（声明式端点映射），代码零 provider 绑定。
3. 支持 **MV 对点**（段落/节拍网格）与 **先曲后镜**编排；BGM **默认开启**。
4. 配置结构可迁移（vault v1 → v2），一次性迁移 + 备份可回滚。

### 0.3 非目标（明确不做）

- 不做模型枚举导入、候选列表排序、自动可用性轮询、失败换模型重试——**任何"多候选"语义都不再进入代码**。
- 不做多账号池（AccountPool，仍属二期池）。
- 不内置任何 provider 专属音乐模板（模板按**协议形态**命名，不按家命名）。

---

## 1. 已确认决策（六条）

| # | 决策 | 说明 |
|---|---|---|
| D1 | **6 个用途槽**，每槽恰好一个模型 | 槽位粒度是"用途"，不是"模型大类" |
| D2 | `image.master` 与 `image.shot` **允许指向同一模型** | 默认同步填写，用户可拆开 |
| D3 | 音乐用**通用适配器**，不绑定任何 provider | 声明式请求/响应映射；代码中零 provider 分支 |
| D4 | 音乐槽**支持可选模板预填** | 模板是**数据**（表单初始值），可编辑/另存/删除，不含凭证与逻辑 |
| D5 | MV **先曲后镜** | `mode: 'mv'` 时先生成歌曲与时间网格，再约束 storyboard 每镜时长 |
| D6 | BGM **默认开启** | 未绑定时不阻断出片（留 warn），绑定后自动垫底 + ducking |

---

## 2. 数据模型（vault v2）

### 2.1 两层结构

```ts
type SlotId = 'image.master' | 'image.shot' | 'video' | 'tts' | 'music.bgm' | 'music.song'

type ProtocolFamily =
  | 'openai-images'      // POST {base}/v1/images/generations
  | 'openai-tts'         // POST {base}/v1/audio/speech
  | 'dashscope-video'    // DashScope 原生异步透传（wan/happyhorse 系）
  | 'kling-video'        // kling-compat 原生
  | 'openai-video'       // 通用异步任务（/v1/videos 系）
  | 'generic-music'      // 声明式映射（本规格 §4）

/** 凭证层：一个 baseUrl + 一把 key。故意不含模型清单。 */
interface Channel {
  id: string; label: string; enabled: boolean
  baseUrl: string; apiKey: string
  protocols: ProtocolFamily[]   // 「测试」实测得出（可手动覆盖）
  verifiedAt?: string; verifyNote?: string
  createdAt: string
}

/** 用途层：每个槽恰好一条绑定。故意不支持数组。 */
interface SlotBinding {
  slot: SlotId
  channelId: string
  model: string
  protocol: ProtocolFamily
  capabilities: SlotCapabilities      // 用户声明；「测试」可回写实测结论
  music?: GenericMusicMapping         // 仅 music.* 槽
  verifiedAt?: string; verifyNote?: string
}

interface VaultData {
  version: 2
  channels: Channel[]
  slots: Partial<Record<SlotId, SlotBinding>>
  musicTemplates: MusicTemplate[]     // 内置（source=builtin，只读）+ 用户另存（source=user）
  budget: { confirmThresholdCny: number }
  gateDefaults: Record<string, GateMode>
}
```

**结构性保证**：`slots` 是 `SlotId → 单条绑定` 的映射，**物理上无法表达第二候选**。这条是本规格最重要的设计约束——"不再支持多模型轮询查找可用性"由此从约定升级为类型约束。

`defaultChannelId` 取消：默认通道概念被"每槽各自选通道"取代。

### 2.2 六个槽位

| 槽位 | 类 | 必需 | 能力位（用户声明） | 消费点 |
|---|---|---|---|---|
| `image.master` | image | ✅ | `sizeParam`（是否可传 size） | 第 4 段：角色三视图卡 + 场景主图 |
| `image.shot` | image | ✅ | `referenceImage`（吃 master 图作参考） | 第 5 段：逐镜参考图 |
| `video` | video | ✅ | `imageToVideo`、`textToVideo`、`maxDurationSec` | 第 6 段 + 评审重拍 |
| `tts` | tts | 可选 | `voice`、`instructions` | 第 7 段（缺省回退 `say`/SAPI） |
| `music.bgm` | music | ✅（默认开） | `instrumental`、`durationControl`、`loopable` | 新 `music` 段 + final-cut 垫底 |
| `music.song` | music | 可选 | `vocals`、`lyricsInput`、`referenceAudio`、`returnsSections` | MV 模式（先曲后镜） |

说明：

- **`video.t2v` 不再单列**：文生视频是 `video` 槽上的能力位。勾了就允许"无参考图降级"，没勾且无参考图 → 直接失败，**不尝试替代模型**。
- `image.shot` 未绑定时回落 `image.master`（仅此一处回落，且是**同槽族内的显式缺省**，非候选轮询）。
- `music.bgm` 与 `music.song` 分槽的理由：能力位与消费方式不同（BGM 要循环补长 + ducking；song 要段落网格 + 歌词字幕），但**允许填同一个模型**。

### 2.3 选型语义（替换旧语义）

| 旧 | 新 |
|---|---|
| `selectConfiguredModel(channel, kind)` 取 `models[]` 第一个 | `requireSlotBinding(slots, slotId)` 取唯一绑定 |
| 多模型 → 取第一项 | 不存在多模型 |
| `route()` 能力路由（死代码） | 删除 |
| 失败后无兜底 | 失败即失败（`model-unavailable` / 上游错误原样透出） |

未绑定槽被消费时返回 `model-unavailable`，消息须含**槽位名**与指引（"请在设置页「用途槽」绑定"），且**在消费确认之前抛出**——不得产生 `confirm-required` 与 `spend` 事件（沿用 v1.0.4 语义）。

---

## 3. 协议族与适配器边界

- **协议在绑定级声明**（不在通道级，也不靠模型名猜）：同一中转站常同时提供多族协议（附录 B.4 实测：同一 baseUrl 下 `/v1/images/…`、`/alibailian/…`、`/kling-compat/…` 三套契约）。
- 适配器与协议族一一对应，构造入参只含 `{ baseUrl, apiKey, model, capabilities, music? }`；**代码里不得出现以 provider 名称为条件的任何分支**（可用静态断言守护，见 §11 验收 4）。
- `protocols` 字段语义：该通道**实测支持**的协议族集合，由通道「测试」写入，用户可手动覆盖。

---

## 4. 音乐：通用适配器（generic-music）

### 4.1 声明式映射

```ts
interface GenericMusicMapping {
  endpoint: { path: string; method?: 'POST' }      // 相对通道 baseUrl

  // 必填 4 项（保证普通用户可用）
  request:  { promptField: string }                // 提示词字段名，如 'prompt'
  response: { audioPath: string }                  // 音频取值路径，如 'data.audio_url' 或 'data[0].url'
  mode: 'sync' | 'async'

  // 可选：按需展开
  request?: {
    lyricsField?: string; instrumentalField?: string
    durationField?: string; referenceAudioField?: string
    extra?: Record<string, unknown>                // 静态附加字段
  }
  response?: {
    // async 专用
    statusPath?: string; doneValues?: string[]; failedValues?: string[]; pollIntervalMs?: number
    // 音频形态
    audioIsBase64?: boolean; urlIsSigned?: boolean
    durationPath?: string
    // MV 对点：API 若返回段落/时间戳则填此处（多数家不返回 → 走 §6.4 本地分析）
    sectionsPath?: string; sectionsStartField?: string; sectionsEndField?: string; sectionsLabelField?: string
  }
}
```

- 路径语法：点号 + 可选 `[n]` 下标（最小实现，不引入 JSONPath 依赖）。
- 同步：POST → 直接取音频（URL 或 base64）→ 落盘。
- 异步：POST → 取任务 id → 按 `statusPath` 轮询至 `doneValues` → 取音频；轮询超时**记失败**（沿用 [poll.ts](../../../src/poll.ts) 语义）。
- 签名 URL 须**立即下载落盘**（与附录 B.3 图像契约同款教训）。

### 4.2 模板预填（D4）

```ts
interface MusicTemplate {
  id: string
  label: string                  // 按**协议形态**命名，如「同步 · 直返音频 URL」「异步 · 任务轮询 · base64」
  source: 'builtin' | 'user'
  fields: Omit<GenericMusicMapping, never>    // 与槽位映射同形
  note?: string
}
```

约束（写进测试）：

1. 内置模板是**数据文件**，不是代码分支；不含 `baseUrl`/`apiKey`/模型名；
2. 模板仅作设置页表单**初始值**；套用后用户仍须点「测试」验证；
3. 用户可「另存为模板」（`source: 'user'`）、可删除 user 模板，内置模板不可删；
4. 模板按协议形态命名，**不按 provider 命名**（避免变相绑定）。

---

## 5. 设置页信息架构（三区）

| 区 | 内容 | 关键交互 |
|---|---|---|
| **1 通道** | 增删改 / 启用 / 测试 | 「测试」= 连通性 + 鉴权 + **实测协议族**；**不导入模型** |
| **2 用途槽** | 6 行，每行：槽位名 + 用途一句话 + `[通道▾]` + `[模型]` + 能力勾选 + `[测试]` | 模型名**手填**；`[测试]` = 一次**真实小额调用**，结论写 `verifiedAt/verifyNote`；music 槽多一个「套用模板 ▾」 |
| **3 预算与 Gate** | 确认阈值（本次顺带修复其不生效）、gate 缺省、音乐按首计价项 | — |

交互红线：

- 无"探测 → 全选 → 一键导入"，无"未勾选保留"中间态，无默认通道概念（每槽各自选通道）；
- 未绑定槽在页面上直接显示"该能力不可用"，并在工单/事件里警示，不静默降级；
- 保存即生效。

各槽「测试」的最小真实调用：图像 1 张最小尺寸 / 视频最短时长 1 条 / TTS 1 句 / 音乐最短时长 1 首。此即原规格 §4.3③「按模型小额实跑验证」的落地形态。

---

## 6. 流水线与成片变化

### 6.1 段与模式

- `STAGES` 增 `music`（[stages.ts](../../../src/stages.ts)）：位于 `video` 之后、`final-cut` 之前。
- `vgen_generate` 的 `target` 增 `'music'`。
- `run.json` 增 `mode: 'drama' | 'mv'`（缺省 `drama`）。

| 模式 | 编排 |
|---|---|
| `drama`（默认） | story → script → storyboard → master-asset → shot-assets → video → **music(bgm)** → final-cut |
| `mv` | story → script(+lyrics) → **music(song)** → **score 网格** → storyboard(受时长约束) → master-asset → shot-assets → video → final-cut |

### 6.2 歌词由会话模型产出（保持插件零 LLM 调用）

- 不新增第四个交接工具：`vgen_script` 增**可选** `lyrics` 字段，形状校验（沿用 14 个段落标签：`[Intro]/[Verse]/[Chorus]/…`）。
- 落盘 `runs/<id>/lyrics.json`；`music.song` 槽以 `request.lyricsField` 注入。
- 未提供歌词而以 song 槽生成 → `bad-request`，指引先补歌词（不代写）。

### 6.3 BGM 默认策略（D6）

| 项 | 默认值 |
|---|---|
| 触发 | 绑定 `music.bgm` 即默认生成；未绑定则跳过并留 `warn` 事件，**不阻断出片** |
| 时长 | `aloop` 循环补长 / `atrim` 裁切到成片总时长 |
| 混音 | 轨音量 0.18–0.25；人声起时用 **`sidechaincompress`** 压低（本机 ffmpeg 已实测具备）；首尾 0.5s `afade` |
| 失败 | 音乐段 failed 但允许 `final-cut` 继续（记 `warn`），成片仍出 |

### 6.4 MV 对点：时间网格来源三级

`music/score.json` 形状：

```json
{
  "kind": "bgm|song",
  "file": "music/bgm.mp3",
  "durationSec": 92.4,
  "grid": {
    "source": "api|local-analysis|estimate",
    "bpm": 96, "offsetSec": 0.35,
    "sections": [{ "label": "Intro", "startSec": 0, "endSec": 8.2 }],
    "beats": [0.35, 0.97, 1.59]
  },
  "lyrics": [{ "section": "Chorus", "startSec": 42.1, "endSec": 55.0, "lines": ["..."] }],
  "model": "...", "channelId": "...", "spentCny": 0.8
}
```

| 级 | 来源 | 触发条件 |
|---|---|---|
| ① | 适配器 `sectionsPath` 命中 | API 返回段落/时间戳 |
| ② | **本地音频分析** | ①不可用时：`ffmpeg -f s16le -ac 1 -ar 22050 -` 抽 PCM（已实测：2s → 88200 字节精确）→ Node 内算 RMS 包络 → 峰值拾取得 onset/段落边界 → 自相关估 BPM → 把歌词段落标签映射到网格 |
| ③ | 按歌词段落均分 | 兜底（精度不足，仅救急） |

- 网格来源必须写入 `grid.source`，UI 与工单如实展示（不假装是 API 给的）。
- 允许用户手工覆盖 `grid`（写入 run 目录后重跑后续段）。
- 本地分析**不得引入新依赖**（`package.json` dependencies 保持为空）。

### 6.5 MV 的时长契约

`mode=mv` 时 storyboard 阶段接收网格约束：每镜 `durationSec` 之和与歌曲时长偏差 ≤ ±2%（超出则告警并给出建议值）；对不齐时优先 `atrim`/变速微调，不重跑视频。

---

## 7. 迁移（vault v1 → v2）

| v1 | v2 |
|---|---|
| `channels[].models[]` 中第一个 `kind=image` | `image.master` + `image.shot`（同源，用户可拆） |
| 第一个 `kind=video` | `video`（能力位按模型名粗判：含 `t2v` 则勾 `textToVideo`，否则 `imageToVideo`） |
| 第一个 `kind=tts` | `tts` |
| `models[]` 其余条目、`endpointProfile` | **丢弃**（备份保留） |
| `defaultChannelId` | 迁移为各槽的 `channelId` |
| `budget` / `gateDefaults` | 原样保留 |
| — | `music.*` 留空（音乐为新增能力，不猜） |

执行方式：读到 `version === 1` → 写 `vault.json.v1.bak-<ISO ts>`（0600）→ 生成 v2 → 原子替换。迁移幂等（重复运行不产生新备份、不改变结果）。**不做长期双读**：旧版插件读 v2 文件须明确报错而非静默错配。

---

## 8. 删除清单（本次一并移除）

| 对象 | 位置 |
|---|---|
| 模型池 `models[]`、`endpointProfile` | [vault.ts](../../../src/store/vault.ts) |
| `channels.adoptModels`、`channels.setDefault`、models patch | [routes.ts](../../../src/host/routes.ts)、[client](../../../lib/client.js) |
| PickerPanel / `assemblePickerRowsPublic` / `inferKindByName`（约 300 行，含双份实现） | [lib/client.js](../../../lib/client.js)、[picker/assemble.ts](../../../src/picker/assemble.ts) |
| `route()` 能力路由（死代码）与 `model-catalog` 的两层查表 | [provider.ts](../../../src/provider.ts)、[model-catalog.ts](../../../src/model-catalog.ts) |
| `selectConfiguredModel` / `modelUnavailableFrom(kind)` 语义 | [model-selection.ts](../../../src/model-selection.ts) |
| 15 个死词典键、`refreshStudio` 悬空引用 | [lib/client.js](../../../lib/client.js) |

保留：`probe.ts` 的 `/models` 探测**仅作通道自检**（连通性/鉴权），不再作为导入源。

---

## 9. 顺带修复（与本次改动同文件，成本近零）

1. **确认阈值不生效**：生产 `confirmer` 未读 `budget.confirmThresholdCny`（[generate.ts](../../../src/tools/generate.ts) 恒要求 `confirm:true`）。改为 `confirmSpend(est, threshold, …)` 语义。
2. **累计记账恒 0**：`SpendLedger.record()` 无生产调用方 → `vgen_channels spend` 的全局 totals 永远为 0。改为每次 submit 落一条。
3. **run 保留策略未接线**：`RunStore.prune(keep=50)` 无调用方 → 在 run 创建时调用。

---

## 10. 验收标准

**配置结构**

1. 6 个用途槽可在设置页可视化配置；数据结构层**无法**表达第二候选（类型级断言）。
2. 未绑定槽被消费 → `model-unavailable`，消息含槽位名与指引，且**无 `confirm-required`、无 `spend` 事件**。
3. 每槽「测试」执行一次真实小额调用并写 `verifiedAt/verifyNote`；失败透出上游原始错误。
4. 源码与内置模板数据中**不存在以 provider 名称为条件的分支**（静态断言）。
5. 模板可套用/另存/删除；内置模板不含 `baseUrl`/`apiKey`/模型名。

**迁移与兼容**

6. v1 vault 迁移后 6 槽按规则填充；备份文件存在（0600）；迁移幂等；备份可完整回滚。
7. 破坏性变更写入 release note 与 README 迁移说明；主版本 bump。

**音乐与成片**

8. 绑定 `music.bgm` 后成片自动带 BGM 轨；filter 链含 `sidechaincompress`；首尾有 `afade`。
9. 未绑定 `music.bgm` 时出片**不被阻断**，run 事件留 `warn`。
10. `mode=mv`：storyboard 每镜时长之和与歌曲时长偏差 ≤ ±2%；`score.json` 的 `grid.source` 如实记录来源。
11. 本地分析兜底可用：给定任意音频产出非空 `bpm/offsetSec/sections`；`package.json` 的 dependencies 仍为空。

**回归**

12. `npm run typecheck` + `npm test` 全绿；新增用例覆盖 §10 的 1–11 可测项。
13. bundle 契约哨兵断言 picker 旧符号（`assemblePickerRowsPublic`/`inferKindByName`）**不再出现**（防回流）。
14. 阈值修复后：估价 ≤ 阈值不触发确认；`vgen_channels spend` 的 totals > 0。

---

## 11. 测试策略

- **纯函数单测**：v2 形状守卫与单绑定约束、迁移（含幂等/损坏/越界）、槽位解析与 `model-unavailable` 语义、声明式映射解析（sync/async、URL/base64、可选 sections、路径语法）、阈值判定（`confirmSpend` 边界）。
- **适配器契约测试**：六族协议构造函数 + 未知协议 `bad-request`；`generic-music` 的轮询超时=失败、落盘 0600。
- **音频分析单测**：给定构造的 PCM（正弦 + 静音 + 两种频率段）断言包络/onset/BPM 在容差内。
- **静态断言**：源码与模板数据无 provider 条件分支；dependencies 为空。
- **bundle 契约**：新设置页关键串存在 + 旧 picker 符号不存在。
- **真机阶梯**：M0 式——对真实音乐端点钉一次契约（同步与异步各一），结论写入附录而非硬编码。

---

## 12. 分期

| 期 | 内容 | 出口 |
|---|---|---|
| **P0** | vault v2 + 6 槽 + 设置页三区 + 迁移 + §9 三项顺带修复 | 验收 1–7、12–14 |
| **P1** | `music` 段 + `generic-music` 适配器 + BGM 混音（循环/ducking/afade）+ 歌词走 `vgen_script` + 成本护栏 | 验收 8、9 |
| **P2** | MV 对点（API sections → 本地 PCM 分析 → 均分兜底）+ `mode=mv` 先曲后镜 | 验收 10、11 |
| **P3** | 死面清理收尾、README/release 迁移说明、发版 | — |

---

## 13. 风险与开放问题

| 风险/问题 | 处置 |
|---|---|
| 破坏性配置变更影响存量用户 | 一次性迁移 + 备份 + 明确回滚步骤；主版本 bump |
| 声明式映射表单门槛偏高 | 最小必填 4 项 + 模板预填 + 「测试」即时反馈 |
| 本地节拍/段落分析精度不足 | `grid.source` 如实标注 + 允许人工覆盖 + 偏差阈值告警 |
| 音乐生成耗时长（30s–数分钟）触碰 600s 工具超时 | P1 单独评估：音乐段独立工具或超时延长；同时处理工具 `exec.signal` 未转发问题（审计 B1） |
| 2.0.2 工作树尚未提交/发布 | P0 的 Task 0 先收口 2.0.2（提交 + tag + 镜像同步），避免与本次重构混在同一工作树 |
| 上游音乐端点契约未知 | 按 M0 方式真机钉一次，结论写附录；不写入代码 |
