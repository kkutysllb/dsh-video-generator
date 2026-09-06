# dsh-video-generator 设计规格（v1）

> 日期：2026-09-06 · 状态：已与需求方逐节确认
> 参考底稿：[鲸影 dsh-video-studio 源码分析](../../dsh-video-studio-analysis.md)（下称"鲸影"）

## 1. 定位

DSH 原生视频生成插件：支持**短视频 / AI 短剧 / AI 漫剧**生成。MVP 以**漫剧/短剧管线为主线**（短视频是其单镜子集）。模型通道采用**官方 API + 中转代理双轨**，首发通道为用户已持有的 OpenAI 兼容中转 [向量引擎 api.vectorengine.ai](https://api.vectorengine.ai/v1)（new-api 风格聚合站：500+ 模型、按量计费、含 Drawing/Task 异步能力）。

与鲸影的本质差异：**鲸影"七段"里 LLM 三段是事件占位，我们做成真实现**——由 DSH 会话模型承担 LLM 三段（已确认，鲸影式），插件负责结构化校验与落盘，流水线从"从外部 Script 开始"升级为"从 brief 开始全七段贯通"。

## 2. 已确认的范围决策

| 决策点 | 结论 |
|---|---|
| MVP 内容主线 | 漫剧/短剧管线（一致性角色 + 多镜叙事 + 成片），短视频为单镜子集 |
| 模型通道现状 | 仅向量引擎中转 key；官方 API 适配器留插槽二期 |
| LLM 三段策略 | DSH 会话模型直做（插件零 LLM 调用），结构化交接 |
| 通道抽象 | 方案 A：鲸影式六方法薄抽象 + 中转优先 + 数据驱动模型目录 |
| 成片 | MVP 仅 ffmpeg 直出 mp4 + SRT；剪映草稿导出二期 |
| 视频生成路径 | 图生视频为主（一致性刚需），纯文生视频作无资产降级路径 |
| 节点画布 | 不进 MVP（规避 435KB xyflow bundle 与双状态源教训），二期 |

## 3. 总体架构

TypeScript + tsup 双包（host ESM `lib/host/index.mjs` / client `lib/client/index.js`，react 由宿主注入）；cordis 风格 `apply(ctx)` 接入 DSH：`ctx.inject(['tools'])` 注册工具、`ctx.inject(['webServer'])` 注册路由，每条路由经 `effect()` 管生命周期；构建标记破客户端 IndexedDB 缓存——插件规范姿势继承鲸影已验证实现。

```
src/
├── provider.ts          # 六方法 Provider 接口 + assertProvider + route()
├── providers/
│   ├── relay-openai.ts  # OpenAI 兼容中转适配器族（images / video-task 两种 profile）
│   ├── mock.ts          # 零 key 全链路自检
│   └── (二期) dashscope.ts / doubao.ts / kling.ts
├── relay-catalog.ts     # 中转模型目录：modelId → {kind, capabilities, pricing, endpointProfile}
├── schema/              # story / script / storyboard JSON Schema 与校验器
├── pipeline/            # 真七段导演流水线（run 状态机 + 断点恢复）
├── prompts/             # 四层提示词合并 + character-sheet 等模板 + 负面清单
├── finalcut/            # timeline 中性模型（微秒）+ ffmpeg 渲染 + SRT
├── store/               # vault（凭证）+ runs（持久化）+ 记账
├── host/                # vgen_* 工具 + HTTP 路由
└── client/              # 设置页 2 tab
```

## 4. 通道层

### 4.1 接口（继承鲸影）

`capabilities / quote(stage,spec) / submit(stage,spec)→{jobId} / status(jobId) / fetch(jobId)→{outputs} / health()`，能力位含 textToVideo/imageToVideo/image/tts、maxDurationSec、resolutions、qualityTier 等；`assertProvider` 运行时校验必备成员；`route()` 按能力过滤 + qualityTier 排序。

### 4.2 relay-openai 适配器族

- 一个基座 + 两种 endpoint profile：`images`（`POST /v1/images/generations`）与 `video-task`（异步任务提交 + 轮询；确切端点/字段由 M0 探测定稿，候选 `/v1/videos`、`/v1/video/generations` 或站点自定义）
- **模型目录数据驱动**：`relay-catalog.ts` 中每行 `modelId → {kind: image|video|tts, capabilities, pricing, endpointProfile}`；新增中转模型 = 加一行目录
- 认证：单一 `Authorization: Bearer <key>`；Base URL 可配（默认 `https://api.vectorengine.ai/v1`）
- 工程红线：所有 fetch 带超时 + AbortController；429/5xx 指数退避冷却（基期 30s、封顶 15min）

### 4.3 M0 探测里程碑（一切适配器代码的前置）

`scripts/probe-relay.ts` 用用户 key：① `GET /v1/models` 枚举可用模型；② 小额实跑 1 次图像生成；③ 小额实跑 1 次视频任务，确认端点格式、任务对象结构、轮询语义与计费；④ 将结论固化进 `relay-catalog.ts` 与本文档附录。**探测未定稿前不写视频适配器。**

### 4.4 成本护栏（鲸影 ¥7 教训）

每次 submit 前 `quote()` 按目录价目估算；预估 > 阈值（默认 ¥1，vault 可配）→ 经 DSH ask 通道请求用户确认；每次消耗记账到 run（provider/model/耗时/成本），`vgen_channels` 可查累计。中转站不提供价目时按保守缺省价估算并标注 `pricing: 'unknown'`（默认走确认）。

### 4.5 池调度（MVP 简化）

单中转账号，不做多账号轮换；保留退避冷却 + 用量记账接口。AccountPool 完整形态（多账号/LRU/降级）二期。

## 5. 七段流水线

| 段 | 执行者 | 机制 |
|---|---|---|
| 1 story | 会话模型 | `vgen_story`：提交结构化故事 JSON → schema 校验 → 落盘 `runs/<runId>/story.json` |
| 2 script | 会话模型 | `vgen_script`：故事→剧本（场次/角色/对白）→ 校验落盘 |
| 3 storyboard | 会话模型+插件 | `vgen_storyboard`：剧本→分镜数组（景别/运镜/时长/角色/场景/台词/voiceHint）→ 插件注入四层提示词 |
| 4 master-asset | 中转图像模型 | 角色三视图卡 + 场景主图；一致性 token 与负面清单注入（搬鲸影 character-sheet 模板精华：版式/度量/三重一致性锁） |
| 5 shot-assets | 中转图像模型 | 逐镜参考图变体，自动注入主图作参考（漫剧一致性标准做法） |
| 6 video | 中转视频模型 | 逐镜**图生视频**（带参考图），并发可配（默认 2）；无资产时降级文生视频 |
| 7 final-cut | 本地 | TTS（`voiceFile` 外挂优先 / macOS say / Win SAPI）→ timeline → ffmpeg 归一化+concat+drawtext 字幕 → mp4 + SRT |

### 5.1 异步 run 模型

视频生成 5-10 分钟，**工具提交后立即返回 runId**，绝不同步长轮询占死连接（修鲸影 /generate 120s 问题）。产物落 `runs/<runId>/`（story/script/storyboard.json、assets/、clips/、final.mp4、run.json 状态 + 事件流）。会话模型以 `vgen_status <runId>` 推进。**run 可恢复**：按 run.json 中各段完成状态续跑，已完成段不重花钱。

### 5.2 gate

每段 `auto / ask / manual` 三态**真实现**（修鲸影摆设 gate）：ask 经 DSH 审批通道；manual = 用户在会话中提供该段产物文件/JSON，插件校验后接管管线。gate 状态存于 run.json，可切换后重跑该段。

### 5.3 质量评审（MVP）

`vgen_review <runId> <shot>`：ffmpeg 按 25/50/75% 抽 3 帧返回会话模型评分（1-5 clamp，非法兜底不重拍）→ ≤2 自动追加负面词重拍（≤2 次）；评分与重拍次数记录进 run.json。评分簿完整自优化闭环（增益词历史表现选路）二期。

## 6. 存储与安全

- **vault**：`$DSH_HOME/.dsh-video-generator/vault.json`（跟随 DSH_HOME，兜底 `~/.dsh-video-generator/`），目录 0700 / 文件 0600，tmp+rename 原子写；存中转 key、预算阈值、通道开关；**全出口 `maskCredential`**（前 3 + •••• + 后 3）且测试断言响应不含明文；入口校验：Base URL 强制 https、key 长度上限、provider 枚举白名单
- **runs 持久化**：run.json 即事实源（修鲸影内存 runs 重启即丢）；保留最近 50 个 run，超限清理最旧（媒体文件随目录删除）
- **工程红线**：轮询超时=失败（不记成功）；任何 token 缓存带过期刷新；零硬编码个人路径；凭证任何路由不回显；TS strict，禁 `any` 泛滥

## 7. 工具面与 UI

### 7.1 工具（7 个，前缀 `vgen_`）

| 工具 | 职责 |
|---|---|
| `vgen_story` | 提交结构化故事 JSON → 校验 → **开新 run** 并落盘 `story.json`，返回 runId |
| `vgen_script` | `{runId, script}`：故事→剧本交接 → 校验 + 落盘 `script.json` |
| `vgen_storyboard` | `{runId, shots}`：分镜交接 → 校验 + 注入四层提示词 + 落盘 `storyboard.json` |
| `vgen_generate` | `{runId, target: 'assets'\|'video'\|'final'}`：从首个未完成段**顺序执行至 target 段**（含 target），逐段落盘后返回 |
| `vgen_status` | run 进度 / 各段状态 / 断点恢复指引 |
| `vgen_review` | 抽帧评分 + 触发重拍 |
| `vgen_channels` | 通道健康 / 中转余额（health 可得时）/ 价目 / 累计消耗 |

均带 output.schema + output.render（对齐 DSH 工具契约）。

### 7.2 HTTP 路由

`GET /health`、`GET /runs`、`GET /runs/:id`、`GET /channels`、`POST /settings`（预算阈值/gate 默认值）。

### 7.3 设置页（MVP 2 tab）

- 「视频工坊」：run 列表 + 阶段进度徽章 + 产物预览（图/视频）+ 成本显示；3s 轮询仅在工作台可见时启动
- 「通道与账号」：中转 key 管理（password 输入、提交即清空、列表只显示脱敏串）、预算阈值、模型目录浏览
- client 零重型依赖：不引 @xyflow/react；继续使用 jsx-runtime shim 思路保持 `external: react` + 零外部运行时

## 8. 测试与验证

- **mock provider 零 key 全链路**为硬门槛：ffmpeg lavfi 占位片 + 假任务状态机；CI = `npm run typecheck && node --test`
- 单测火力点：三个 JSON schema 校验、catalog 能力路由、成本护栏阈值边界、退避冷却、timeline/ffmpeg 命令构造（纯函数直测）、vault 脱敏断言（响应字符串不含明文）
- **真机验证阶梯**：M0 探测（枚举 + 1 图 + 1 视频小额）→ M2 单镜真机出片 → M3 三镜一致性漫剧真机（人眼 + 会话评审双验）
- 鲸影规则继承：host 路由/工具变更必须最小隔离 profile（独立 $DSH_HOME）真机 boot + curl round-trip

## 9. 里程碑

| 阶段 | 内容 | 出口标准 |
|---|---|---|
| M0（0.5 天） | probe-relay 探测 + relay-catalog 定稿 | 视频任务端点格式实测定案，写入文档附录 |
| M1（1-2 天） | 插件骨架：接入 DSH + provider 接口 + mock + vault + runs | `/health` 在线；mock 全链路绿 |
| M2（2-3 天） | relay images + video 适配器 + 成本护栏 + 记账 | 单镜图生视频真机出片（预算内） |
| M3（3-5 天） | 三段交接工具 + 资产一致性 + 多镜并发 + final-cut | 三镜漫剧端到端真机（含 SRT 字幕） |
| M4（2-3 天） | vgen_review 评审重拍 + 2 tab + gate manual + 1 个题材包 | 无 key demo（mock）+ 真机 demo 双达标 |

## 10. 二期池

官方 API 适配器（百炼 DashScope / 豆包 ARK / 可灵）· AccountPool 完整形态（多账号轮换/降级）· 剪映草稿导出（timeline 双通道第二通道）· 节点画布工作台 · 评分簿完整自优化闭环 · 中转 TTS 通道 · 短视频单镜直出快捷工具 · 口型同步段。

## 附录 A：继承 vs 修正清单（对鲸影）

**继承**：六方法 Provider 接口与 capabilities 路由、assertProvider 运行时校验、vault 分层（凭证/状态）与原子写、全出口脱敏、mock 全链路策略、timeline 中性模型、`$DSH_HOME` 跟随、最小 profile 真机 boot 验证法、构建标记破缓存、jsx-runtime shim。

**修正**：LLM 三段真实现（结构化校验落盘）；gate 真实现；runs 持久化 + 断点恢复；异步 run 模型替代同步长轮询；轮询超时记失败；token 缓存过期刷新；成本护栏（quote + 确认阈值）；fetch 全带超时/中止；零硬编码路径；MVP 不上重型前端依赖。

## 附录 B：M0 探测记录（待填）

> M0 执行后填写：可用图像/视频模型清单、视频任务端点与请求/响应结构、轮询语义、计费实测、catalog 定稿表。
