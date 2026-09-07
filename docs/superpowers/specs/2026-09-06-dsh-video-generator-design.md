# dsh-video-generator 设计规格（v1.1）

> 日期：2026-09-06 · 状态：已与需求方逐节确认 · v1.1 修订：通道层改为用户自配通用通道（不绑定站点），对齐 dsh-super-ppts 设置页自配置模式
> 参考底稿：[鲸影 dsh-video-studio 源码分析](../../dsh-video-studio-analysis.md)（下称"鲸影"）

## 1. 定位

DSH 原生视频生成插件：支持**短视频 / AI 短剧 / AI 漫剧**生成。MVP 以**漫剧/短剧管线为主线**（短视频是其单镜子集）。

**模型通道不绑定任何站点**：用户在设置页自配「模型三要素」（Base URL / API Key / Model）即可接入官方 OpenAI 兼容端点或任意中转站（new-api/one-api 风格聚合站、自建网关均可），UI 模式对齐 dsh-super-ppts 的设置页自配置。首发适配器形态为**通用 OpenAI 兼容通道**；官方原生协议（DashScope 原生视频、豆包 ARK 原生任务、可灵 JWT 等）以专属适配器形态二期接入。作者手头的 [向量引擎 api.vectorengine.ai](https://api.vectorengine.ai/v1) 仅作为**首个实测通道实例**（M0 用），不进任何硬编码。

与鲸影的本质差异：**鲸影"七段"里 LLM 三段是事件占位，我们做成真实现**——由 DSH 会话模型承担 LLM 三段（已确认，鲸影式），插件负责结构化校验与落盘，流水线从"从外部 Script 开始"升级为"从 brief 开始全七段贯通"。

## 2. 已确认的范围决策

| 决策点 | 结论 |
|---|---|
| MVP 内容主线 | 漫剧/短剧管线（一致性角色 + 多镜叙事 + 成片），短视频为单镜子集 |
| 模型通道 | 通用自配通道（三要素）：官方兼容端点与任意中转均可；向量引擎仅为作者首个实测实例 |
| 通道管理 UI | 对齐 dsh-super-ppts 模式：`settings.section` 导航 + `/api/<method>` 操作面 + 信任围栏 + 全出口脱敏 |
| LLM 三段策略 | DSH 会话模型直做（插件零 LLM 调用），结构化交接 |
| 通道抽象 | 方案 A：鲸影式六方法薄抽象 + 通用 OpenAI 兼容适配器 + 两层模型目录 |
| 成片 | MVP 仅 ffmpeg 直出 mp4 + SRT；剪映草稿导出二期 |
| 视频生成路径 | 图生视频为主（一致性刚需），纯文生视频作无资产降级路径 |
| 节点画布 | 不进 MVP（规避 435KB xyflow bundle 与双状态源教训），二期 |

## 3. 总体架构

TypeScript + tsup 双包（host ESM `lib/host/index.mjs` / client `lib/client/index.js`，react 由宿主注入）；cordis 风格 `apply(ctx)` 接入 DSH：`ctx.inject(['tools'])` 注册工具、`ctx.inject(['webServer'])` 注册路由，每条路由经 `effect()` 管生命周期；构建标记破客户端 IndexedDB 缓存——插件规范姿势继承鲸影已验证实现。对 Agent 的能力通告常量对齐 super-ppts `SUPER_PPTS_GUIDANCE` 模式。

```
src/
├── provider.ts          # 六方法 Provider 接口 + assertProvider + route()
├── providers/
│   ├── openai-compat.ts # 通用 OpenAI 兼容适配器（三要素参数化；images / video-task 两种 profile）
│   ├── mock.ts          # 零 key 全链路自检
│   └── (二期) dashscope.ts / doubao.ts / kling.ts（官方原生协议专属适配器）
├── model-catalog.ts     # 模型目录：内置常见模型缺省 + 用户自定义覆盖（存 vault）
├── probe.ts             # 通道探测模块（产品能力：设置页"测试通道"后端）
├── schema/              # story / script / storyboard JSON Schema 与校验器
├── pipeline/            # 真七段导演流水线（run 状态机 + 断点恢复）
├── prompts/             # 四层提示词合并 + character-sheet 等模板 + 负面清单
├── finalcut/            # timeline 中性模型（微秒）+ ffmpeg 渲染 + SRT
├── store/               # vault（多通道三要素/偏好）+ runs（持久化）+ 记账
├── host/                # vgen_* 工具 + HTTP 路由（含 /api 操作面）
└── client/              # 设置页 tab（视频工坊 / 通道管理）
```

## 4. 通道层

### 4.1 接口（继承鲸影）

`capabilities / quote(stage,spec) / submit(stage,spec)→{jobId} / status(jobId) / fetch(jobId)→{outputs} / health()`，能力位含 textToVideo/imageToVideo/image/tts、maxDurationSec、resolutions、qualityTier 等；`assertProvider` 运行时校验必备成员；`route()` 按能力过滤 + qualityTier 排序。

### 4.2 openai-compat 通用适配器

- **三要素参数化，零站点硬编码**：`{baseUrl, apiKey, models[]}` 全部来自 vault 中用户配置；适配器不感知任何具体站点
- 一个基座 + 两种 endpoint profile：`images`（`POST {baseUrl}/images/generations`）与 `video-task`（异步任务提交 + 轮询；端点风格记入该通道配置，候选 `/videos`、`/video/generations` 或站点自定义路径，允许用户在高级设置覆盖）
- **模型目录两层**：内置目录（`model-catalog.ts`：按模型名模式推断常见模型的 kind/capabilities/缺省价目，如 seedance/kling/wan/seedream/flux/mj-proxy 系列）+ 用户自定义覆盖（设置页按通道×模型增删能力/价目/端点风格）。查表顺序：**用户覆盖 > 内置缺省 > unknown**
- 认证：单一 `Authorization: Bearer <key>`；多通道并存，run 级选择通道（用户显式指定，或按 capabilities + qualityTier 自动路由）
- 工程红线：所有 fetch 带超时 + AbortController；429/5xx 指数退避冷却（基期 30s、封顶 15min）

### 4.3 通道探测（产品能力 + 开发前置）

`probe.ts` 通用探测模块（不是一次性脚本）：① `GET {baseUrl}/models` 枚举可用模型；② 连通性/鉴权校验；③ 按模型小额实跑验证端点风格与响应结构，结论写入该通道配置。双用途：

- **开发前置**：M0 用作者手头的向量引擎通道完成首次实测，为内置目录提供缺省值
- **产品功能**：设置页「测试通道」按钮 ↔ `POST /dsh-video-generator/api/channels.test`——任何用户添加新通道即可一键验证，不依赖内置知识

### 4.4 成本护栏（鲸影 ¥7 教训）

每次 submit 前 `quote()` 按三层查价（用户自定义价目 > 内置目录 > unknown）；预估 > 阈值（默认 ¥1，设置可改）→ 经 DSH ask 通道请求用户确认；**unknown 价一律走确认**；每次消耗记账到 run（通道/模型/耗时/成本），`vgen_channels` 可查累计。

### 4.5 池调度（MVP 简化）

MVP 单通道单 key，不做多账号轮换；保留退避冷却 + 用量记账接口。AccountPool 完整形态（多账号/LRU/降级）二期。

## 5. 七段流水线

| 段 | 执行者 | 机制 |
|---|---|---|
| 1 story | 会话模型 | `vgen_story`：提交结构化故事 JSON → schema 校验 → 落盘 `runs/<runId>/story.json` |
| 2 script | 会话模型 | `vgen_script`：故事→剧本（场次/角色/对白）→ 校验落盘 |
| 3 storyboard | 会话模型+插件 | `vgen_storyboard`：剧本→分镜数组（景别/运镜/时长/角色/场景/台词/voiceHint）→ 插件注入四层提示词 |
| 4 master-asset | 通道图像模型 | 角色三视图卡 + 场景主图；一致性 token 与负面清单注入（搬鲸影 character-sheet 模板精华：版式/度量/三重一致性锁） |
| 5 shot-assets | 通道图像模型 | 逐镜参考图变体，自动注入主图作参考（漫剧一致性标准做法） |
| 6 video | 通道视频模型 | 逐镜**图生视频**（带参考图），并发可配（默认 2）；无资产时降级文生视频 |
| 7 final-cut | 本地 | TTS（`voiceFile` 外挂优先 / macOS say / Win SAPI）→ timeline → ffmpeg 归一化+concat+drawtext 字幕 → mp4 + SRT |

### 5.1 异步 run 模型

视频生成 5-10 分钟，**工具提交后立即返回 runId**，绝不同步长轮询占死连接（修鲸影 /generate 120s 问题）。产物落 `runs/<runId>/`（story/script/storyboard.json、assets/、clips/、final.mp4、run.json 状态 + 事件流）。会话模型以 `vgen_status <runId>` 推进。**run 可恢复**：按 run.json 中各段完成状态续跑，已完成段不重花钱。

### 5.2 gate

每段 `auto / ask / manual` 三态**真实现**（修鲸影摆设 gate）：ask 经 DSH 审批通道；manual = 用户在会话中提供该段产物文件/JSON，插件校验后接管管线。gate 状态存于 run.json，可切换后重跑该段。

### 5.3 质量评审（MVP）

`vgen_review <runId> <shot>`：ffmpeg 按 25/50/75% 抽 3 帧返回会话模型评分（1-5 clamp，非法兜底不重拍）→ ≤2 自动追加负面词重拍（≤2 次）；评分与重拍次数记录进 run.json。评分簿完整自优化闭环（增益词历史表现选路）二期。

## 6. 存储与安全

- **vault**：`$DSH_HOME/.dsh-video-generator/vault.json`（跟随 DSH_HOME，兜底 `~/.dsh-video-generator/`），目录 0700 / 文件 0600，tmp+rename 原子写；存**多通道配置列表**（每通道 `{id, label, kind, baseUrl, apiKey, models[], overrides, enabled}`）、默认通道、预算阈值、gate 默认值；**全出口 `maskCredential`**（前 3 + •••• + 后 3）且测试断言响应不含明文；入口校验：Base URL 强制 https、key 长度上限、通道 id 白名单正则
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
| `vgen_channels` | 通道健康 / 余额（health 可得时）/ 价目 / 累计消耗 |

均带 output.schema + output.render（对齐 DSH 工具契约）。

### 7.2 HTTP 路由

`GET /health`、`GET /runs`、`GET /runs/:id`、`GET /channels`、`POST /settings`，另设 `POST /dsh-video-generator/api/<method>` JSON 操作面（`channels.create/update/delete/test`、`settings.*`）——对齐 dsh-super-ppts 路由模式：响应信封 `{ok,value}/{ok,error:{code,message}}` + loopback/trustedHosts 信任围栏（DNS-rebind 防御）。

### 7.3 设置页（MVP 2 tab，`settings.section` 导航对齐 super-ppts）

- 「视频工坊」：run 列表 + 阶段进度徽章 + 产物预览（图/视频）+ 成本显示；3s 轮询仅在工作台可见时启动
- 「通道管理」：通道列表（label + 脱敏 key + 启用开关 + 默认标记）、三要素表单（password 输入、提交即清空、列表只显示脱敏串）、**「测试通道」按钮**（调探测模块，展示枚举模型/端点风格/鉴权结果）、模型能力与价目自定义覆盖、预算阈值
- client 零重型依赖：不引 @xyflow/react；继续 jsx-runtime shim 思路保持 `external: react` + 零外部运行时

## 8. 测试与验证

- **mock provider 零 key 全链路**为硬门槛：ffmpeg lavfi 占位片 + 假任务状态机；CI = `npm run typecheck && node --test`
- 单测火力点：三个 JSON schema 校验、模型目录两层查表路由、成本护栏阈值边界、退避冷却、timeline/ffmpeg 命令构造（纯函数直测）、vault 脱敏断言（响应字符串不含明文）
- **真机验证阶梯**：M0 首通道实测（枚举 + 1 图 + 1 视频小额）→ M2 单镜真机出片 → M3 三镜一致性漫剧真机（人眼 + 会话评审双验）
- 鲸影规则继承：host 路由/工具变更必须最小隔离 profile（独立 $DSH_HOME）真机 boot + curl round-trip

## 9. 里程碑

| 阶段 | 内容 | 出口标准 |
|---|---|---|
| M0（0.5-1 天） | 通道探测模块 probe.ts + 内置模型目录初版 | 以向量引擎通道完成首次实测：端点风格/响应结构定案，写入附录 B |
| M1（1-2 天） | 插件骨架：接入 DSH + provider 接口 + mock + vault（含通道 CRUD + /api 操作面）+ runs | `/health` 在线；通道增删改测全通；mock 全链路绿 |
| M2（2-3 天） | openai-compat images/video 适配器 + 成本护栏 + 记账 | 单镜图生视频真机出片（预算内） |
| M3（3-5 天） | 三段交接工具 + 资产一致性 + 多镜并发 + final-cut | 三镜漫剧端到端真机（含 SRT 字幕） |
| M4（2-3 天） | vgen_review 评审重拍 + 2 tab + gate manual + 1 个题材包 | 无 key demo（mock）+ 真机 demo 双达标 |

## 10. 二期池

官方原生协议适配器（百炼 DashScope / 豆包 ARK / 可灵 JWT）· AccountPool 完整形态（多账号轮换/降级）· 剪映草稿导出（timeline 双通道第二通道）· 节点画布工作台 · 评分簿完整自优化闭环 · TTS 通道（中转/云）· 短视频单镜直出快捷工具 · 口型同步段。

## 附录 A：继承 vs 修正清单（对鲸影）

**继承**：六方法 Provider 接口与 capabilities 路由、assertProvider 运行时校验、vault 分层（凭证/状态）与原子写、全出口脱敏、mock 全链路策略、timeline 中性模型、`$DSH_HOME` 跟随、最小 profile 真机 boot 验证法、构建标记破缓存、jsx-runtime shim。

**修正**：LLM 三段真实现（结构化校验落盘）；gate 真实现；runs 持久化 + 断点恢复；异步 run 模型替代同步长轮询；轮询超时记失败；token 缓存过期刷新；成本护栏（三层查价 + 确认阈值）；fetch 全带超时/中止；零硬编码路径与零站点硬编码；MVP 不上重型前端依赖。

## 附录 B：首通道（向量引擎）实测记录（M0 产出，2026-09-06）

> 此附录是内置目录初版的数据来源；通道本身在产品中完全由用户自配，不依赖本附录。

### B.1 网络可达性

| 域名 | 结果 |
|---|---|
| `api.vectorengine.ai` | DNS 正常（103.214.168.106），但 **TCP 直连超时**（作者网络环境；DNS 解析存疑时建议用户换 `.cn`） |
| `api.vectorengine.cn` | **可达**（未鉴权 `/v1/models` 返回 401，符合预期） |

结论：作者实例自配用 `.cn`；插件不绑定域名，M0 后所有探测与开发基于 `.cn`。

### B.2 模型清单（`GET /v1/models` → 200，共 536 个）

- **视频**：kling 系（kling-3.0-turbo / kling-video / kling-omni-video / kling-motion-control / kling-video-extend）、MiniMax-Hailuo-02 / 2.3、万相 wan2.5-i2v-preview / wan2.6-i2v / wan2.6-i2v-flash、vidu 系（viduq1/q2/q3 及 pro/turbo/mix 变体）、pixverse-video、grok-imagine-video-1.5、happyhorse-1.x t2v/i2v
- **图像**：doubao-seedream 3.0 / 4.0 / 4.5 / 5.0 / 5.0-pro、gpt-image-1 / 1.5 / 2、qwen-image 系（max/plus/edit）、wan2.7-image(-pro)、z-image-turbo、grok-imagine-image、pixverse-image-template
- **TTS**：gpt-4o-mini-tts、qwen-tts、MiniMax-Voice-Clone / Voice-Design 等
- **不在列**：seedance、sora、flux、midjourney proxy、即梦——漫剧主图替代方案为 seedream 5.0-pro / qwen-image-max

### B.3 图像契约（已钉死，2026-09-07 实测）

`POST {base}/v1/images/generations`，`Authorization: Bearer`：
- 请求：`{model, prompt, n:1, size:"1024x1024"}`（seedream 可能忽略 size，实测返回 `size:"2k"`）
- 响应 200：OpenAI 兼容信封 `{created, model, data:[{url, size}], usage:{generated_images, output_tokens, total_tokens}}`
- **交付为签名 URL**（volces TOS，有效期 7 天）→ **适配器必须及时下载落盘**，不得只存 URL
- 实测模型 `doubao-seedream-4-0-250828`（价目见 B.5：0.2/次档）

### B.4 视频契约（已钉死，端到端真实出片）

**中转站是多协议原生透传网关**——各家族走各家原生协议，选错路径时 400 报错会自报专属路径：

| 家族 | 路径 | 协议 | 状态 |
|---|---|---|---|
| wan / happyhorse | `/alibailian/api/v1/services/aigc/video-generation/video-synthesis` | DashScope 原生异步 | **✅ 端到端钉死** |
| kling | `/kling-compat/v1/videos/*`（如 `/text2video`） | Kling 原生 | 路径确认；当时无可用渠道，成功信封待补（M2 带重试钉） |
| vidu | `/ent/...` | VIDU 原生 | 路径确认，M3+ |
| pixverse | `/openapi/...` | PixVerse 原生 | 路径确认，M3+ |
| grok 等通用 | `/v1/videos` | 通用路由（grok 被接受，429 上游饱和） | 成功信封待补（M2 带重试钉） |

**DashScope 原生异步全生命周期（实测 94 秒出片）**：
- 提交：`POST {base}/alibailian/api/v1/services/aigc/video-generation/video-synthesis`，头 `X-DashScope-Async: enable`，体 `{model:"happyhorse-1.1-t2v", input:{prompt}, parameters:{duration:5}}` → 200 `{"output":{"task_id":"task_...","task_status":"PENDING"},"request_id":"..."}`
- 轮询：`GET {base}/alibailian/api/v1/tasks/{task_id}` → `output.task_status: PENDING → RUNNING → SUCCEEDED`；SUCCEEDED 时 `output.video_url`（阿里 OSS 签名直链，带 Expires → 须及时下载）+ `usage:{duration:5, video_count:1, ratio:"16:9", SR:1080}`
- 成片核验：h264 1920×1080 24fps + aac，5.16s，4.8MB
- **M2 复用结论**：鲸影式 DashScope 工厂（video-synthesis + `X-DashScope-Async` + `tasks/{id}` 轮询）只需换 base 前缀（`/alibailian`）与 Bearer 鉴权即可直用

### B.5 价目数据（`GET {base}/api/pricing` 公开可读）

- 信封 `{data:[{model_name, model_type, quota_type, model_ratio, model_price, ...}]}`；`quota_type=1` 按次（`model_price`），`quota_type=0` 按量（`model_ratio` × tokens）
- 关键档位（`model_price` 原始值，**计价单位口径待 M2 用余额差值钉死**）：seedream 3.0/4.0/4.5/5.0 = 0.10/0.20/0.25/0.22；z-image-turbo = 0.10；qwen-image-max = 0.5；kling-video = 0.017；happyhorse-1.1-t2v = 0.013；pixverse-video = 0.014；grok-imagine-video = 0.01；**wan2.6-i2v = 1.0（贵，避用）**
- 成本护栏升级：`quote()` 优先拉 `/api/pricing` 做真实估价，替代 unknown→确认

### B.6 内置目录定稿依据

- tts 组提至最前（`vidu-tts` 不能被 `vidu` 家族词抢走）；video 组新增 `i2v`/`t2v`/`pixverse`/`happyhorse`；image 组新增 `t2i`/`wanx`
- **`wan2` 宽前缀从 video 组移除**（`wan2.7-image` 是图像模型）；万相系靠产出物词根区分：`i2v`/`t2v` → video，`image`/`t2i` → image
- 回归用例：`test/model-catalog.test.ts`「M0 实测家族归档」14 项断言

### B.7 安全备注

- key 仅存 vault / 环境变量；本次 M0 在对话中出现过明文 key，**已建议作者在中转站后台重置**
- `probe.ok` 只证明 `/models` 可达且返回清单；部分中转不校验该端点的 token，不能等同生成端点鉴权证明（M2 真实任务测试补此结论）
