# 漫剧工坊（Novel → Drama Workbench）设计规格

日期：2026-09-17
状态：已评审方向（总体架构经用户确认），本文为第一版实现规格
前置讨论：DSH 0.1.5+ 侧边栏菜单与独立主面板（参考 dsh-kylin-automation）；DSH 不再支持插件预设 Agent 模式

---

## 0. 背景与目标

### 0.1 驱动因素

1. **宿主变化**：DSH 不再支持"插件预设 Agent"作为主流程入口。当前插件的 `presets/agent.cordis.yml`（漫剧导演预设）不能作为功能依赖。
2. **宿主能力**：DSH 现支持在 workspace 侧边栏"新会话/工作区"之间注册菜单项，并提供独立主面板（`sidebar.panellist` + `main` keyed slot），dsh-kylin-automation 已验证该模式。
3. **产品扩展**：用户要求增加剧情/小说创作能力（参考 AI-Novel-Writer 的产品思想，不做其格式/代码兼容），形成"小说/剧情 → 漫剧改编 → 成片"的一体化创作链。

### 0.2 目标

- 把插件从"视频生成器 + 设置页"升级为**独立创作工作台**：项目制小说/剧情创作，下游接现有七段视频管线。
- 全流程不依赖插件预设：普通 Agent Session 负责推理与生成，页面负责状态、审核、执行与交付。
- 小说内容、版本与审核记录持久化在 **workspace 本地项目文件**中，可 Git 管理、可跨会话恢复。

### 0.3 非目标（首版明确不做）

- 不兼容 AI-Novel-Writer 的 `.ai-novel/` / `.vela` 格式，不导入其代码。
- 不做多集剧集管理、公共角色资产库、批量章节生成。
- 不做多人协作、在线发布、云同步。
- 不做专业级富文本编辑器（Markdown/结构化表单足够）。
- 不做完整离线能力（页面依赖 DSH Host 进程）。

### 0.4 已确认的范围决策

| 决策点 | 结论 |
|---|---|
| 首版核心对象 | 项目（CreativeProject）+ 创作任务 + 视频 Run（方案三） |
| 创作链优先级 | 小说工作台优先，漫剧改编为下游出口 |
| 视频交付粒度 | 单集制作任务（一条 9:16 短片一个 Run） |
| Agent 交互模式 | 任务向导 + 自动创建普通会话（页面发结构化任务指令） |
| 项目存储 | workspace 本地项目文件（`.dsh-drama/`） |
| 外部格式兼容 | 只借鉴产品思想，不做格式兼容 |

---

## 1. 产品对象模型

```text
Workspace
  └── CreativeProject（创作项目，权威容器）
        ├── premise      灵感与前提
        ├── architecture 故事架构
        ├── worldbuilding 世界观
        ├── characters   角色库
        ├── outline      剧情大纲（全书/整季）
        ├── chapters[]   章节（蓝图/草稿/审稿/定稿）
        ├── creativeTasks[]  创作任务（Agent 工作单元）
        ├── proposals[]      待审核提案
        └── adaptations[]    漫剧改编任务
              └── runId → VideoRun（现有七段管线）
```

三条铁律：

1. **Agent Session 是执行上下文，不是权威数据源。** 会话可关可换，workspace 项目文件在，项目状态就在。
2. **AI 建议 ≠ 正式内容。** Agent 的一切内容产出先落 Proposal，用户在页面审核（可编辑）并显式"应用"后才写入权威文件。
3. **视频 Run 是下游执行单元。** 改编任务把章节/场景映射为 vgen_* 管线输入，Run 状态与产物仍由 RunStore 持有。

---

## 2. 信息架构与页面设计

### 2.1 侧边栏入口

沿用官方槽位（同 dsh-kylin-automation 模式，无 DOM hack）：

- `sidebar.panellist` 注册图标行（场记板字形，id `drama-workbench`，order 110，紧邻"新任务"与工作区列表之间）；
- `main` keyed slot 注册独立主面板；
- `ctx.layout.selectPanel(null)` 返回会话；`ctx.sessions.open(id)` 跳转关联会话。

导航名：「漫剧工坊」。现有 `settings.section` 入口保留但瘦身（见 §8）。

### 2.2 面板两级结构

```text
一级：项目列表（含新建向导入口）
二级：项目工作台（左侧阶段导航 + 中间工作区 + 右侧 Agent/Proposal 面板）
```

### 2.3 项目列表页

```text
┌──────────────────────────────────────────────────┐
│ 漫剧工坊                    [刷新] [+ 新建项目]   │
│ [工作区筛选▾] [状态筛选▾] [搜索___________]       │
├──────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────┐   │
│ │ 《快递签收的三次握手》  漫剧改稿 · 科普      │   │
│ │ 进度：第 3/10 章 · 草稿中                   │   │
│ │ 待审核 2 · 最近任务：写第3章正文（运行中）  │   │
│ │ 最近成片：无      更新于 3 分钟前 [打开]    │   │
│ └────────────────────────────────────────────┘   │
│ …                                                │
│ 空态：还没有项目——新建一个，从一句话灵感开始。   │
└──────────────────────────────────────────────────┘
```

卡片元素：标题、类型、章节进度、状态徽章（写作中/待审核/改编中/已完成）、待审核数、最近任务与状态、最近成片、更新时间、打开按钮。

### 2.4 新建项目向导（单步表单 + 确认页）

字段（*为必填）：

- 项目名称*、类型*（小说/短篇剧情/科普漫剧脚本…）、语言*、目标读者
- 一句话梗概*、主题、基调
- 预计章节数（默认 10）、每章目标字数（默认 2000）
- 创作策略：平衡 / 流畅写作 / 一致性优先 / 深度规划（只影响 Agent 工作顺序，不绑定模型）

提交即：Host 在当前 workspace 创建 `.dsh-drama/projects/<projectId>/project.json` 并写入 premise；页面提示"项目已创建，可开始生成故事架构"。不自动启动任何 Agent 任务（用户显式触发每一步）。

### 2.5 项目工作台（三栏）

```text
┌────────────────────────────────────────────────────────────┐
│ 《标题》 状态徽章  第3/10章   [打开会话] [返回列表]          │
├───────────────┬────────────────────────────┬───────────────┤
│ 阶段导航      │ 当前阶段工作区              │ Agent 面板    │
│ ────────      │ （编辑器/预览，随阶段切换） │ ─────────     │
│ 项目概览      │                             │ 当前任务      │
│ 灵感与前提    │                             │ 最近事件      │
│ 故事架构      │                             │ 待审核提案 n  │
│ 世界观        │                             │  成本/风险提示│
│ 角色          │                             │ [打开会话]    │
│ 剧情大纲      │                             │ [暂停/继续]   │
│ 章节 3/10     │                             │               │
│ 审稿与修订    │                             │               │
│ 漫剧改编      │                             │               │
│ 视频任务      │                             │               │
└───────────────┴────────────────────────────┴───────────────┘
```

Agent 面板常驻可折叠，包含：当前任务说明、当前 Session（可点击 `sessions.open` 跳转）、最近事件时间线（来自项目 tasks 事件 + run 事件）、待审核 Proposal 摘要与入口、成本确认/gate 状态、继续/暂停操作。这是取消预设 Agent 后用户感知"Agent 在干嘛"的唯一固定入口，不可缺省。

### 2.6 各阶段工作区

#### 灵感与前提

结构化表单（同 2.4 字段，可后续修改，改动走本地草稿 + 显式保存；保存直接生效——premise 属用户手写资产，不走 Proposal；Agent 改写 premise 才走 Proposal）。

#### 故事架构

只读卡片视图 + 「AI 生成/改写」按钮。字段：主冲突、主角目标、主要阻力、代价、起点、中段转折、高潮、结局、主题、主线、支线、伏笔与回收点。有 Proposal 待审时，卡片顶部横幅提示"有 1 个待审核的故事架构建议 [查看对比]"。

#### 世界观

分类分组编辑（规则/地理/组织/时代/能力体系/其他），条目式增删改。用户手改直接保存；AI 生成走 Proposal。每条目可标注"供正文引用"。

#### 角色

- 列表：头像占位、姓名、身份、当前状态、出场章节、有无视觉资产。
- 详情：基本信息/外貌/性格/欲望/恐惧/背景/关系/重要事件/漫剧视觉提示词（供 master-asset 用）/版本历史。
- 新建/编辑手改直接保存；「AI 补全角色」走 Proposal（整库替换提案，diff 视图逐角色高亮）。

#### 剧情大纲

章节轨道列表（主线/支线着色），每章行：编号、标题、章节目标、主要事件、出场角色、场景、情绪、线索推进、结尾钩子、状态（未规划/已规划/已写作/已审稿/已定稿）。支持行内编辑；「AI 生成全书大纲」走 Proposal（整表 diff 预览）。

#### 章节工作台（单章）

```text
[蓝图] [草稿] [审稿] [定稿]  四个子视图切换
```

- **蓝图**：本章目标、冲突、场景、出场角色（从角色库选择）、关键事件、需承接的上一章事实（自动带出上一章定稿新增事实）、本章新增事实、结尾钩子。手改直接保存。
- **草稿**：Markdown 编辑器 + 正文统计。生成时 Host 组装**有限上下文**（本章蓝图 + 出场角色摘要 + 相关世界观条目 + 上一章相邻定稿段落 + 定稿连续性事实 + 用户本次要求），**绝不携带整本书**。候选稿可另存，不自动成为草稿。
- **审稿**：审稿报告（结构化问题列表：连续性/动机/伏笔/目标完成，逐项附正文证据，状态"已完成/未完成/待核实"）；"待核实"不算通过；由作者选择哪些问题进入修稿。
- **修订**：选中的审稿问题 + 修订要求 → Agent 出修订 Proposal → diff 视图 → 应用为草稿新版本。
- **定稿**：把当前草稿标记为定稿（用户显式操作），定稿内容进入后续章节的连续性上下文与漫剧改编输入。

#### 漫剧改编

- 入口：选定章（或章内场景范围）→ 「创建改编任务」。
- 表单：目标时长/镜头数档位、画幅固定 9:16、改编侧重点（忠实改编/紧凑浓缩）、旁白语言。
- 流程：Host 组装改编输入（章节定稿/草稿 + 角色视觉提示词 + 世界观相关条目）→ 建 CreativeTask → 页面自动创建/复用普通会话并发送结构化指令 → Agent 依次调用 `vgen_story → vgen_script → vgen_storyboard` → 页面展示七段进度 → 后续 vgen_generate 段照旧（confirm/gate/评审闭环不变）。
- 改编任务把 `story/script/storyboard` 三段产物**镜像**存入项目 `adaptations/<id>/`（script.json、storyboard.json、run-link.json），供追溯与二次编辑；权威执行状态仍在 RunStore。

#### 视频任务（Run 详情）

复用现有工作台详情能力，挂到改编任务下：七段阶段轨道（状态/gate/评审档案）、产物预览分组（角色/场景主图、分镜参考图、镜头片段、评审帧、成片 mp4/SRT）、花费汇总、重跑段（rerunStage 语义）、评审抽帧评分操作。历史 Run（升级前创建、无项目归属）在"视频任务"顶层列表可见，可手动关联到某项目（可选操作）。

### 2.7 Proposal 审核交互（全阶段共用）

提案卡片（右侧面板与对应阶段工作区双入口）：

```text
┌ 待审核 · 故事架构 · 来自任务「生成故事架构」10:42 ┐
│ 基于：premise v3、characters v2（摘要）           │
│ 摘要：补全中段转折，新增支线"误件配送"…           │
│ [查看 diff] [编辑建议]  [拒绝]  [应用]            │
└───────────────────────────────────────────────────┘
```

- **diff 视图**：结构化字段级对比（JSON 资产）或段落级对比（Markdown 草稿）。
- **编辑建议**：本地表单编辑，属于未保存草稿，刷新不恢复（同 AI-Novel-Writer 的本地编辑表单思想）；不改 Proposal 本体，提交时以编辑后内容整体替换。
- **应用**：Host 校验 `baseRevision`（内容 SHA-256），冲突则拒绝并提示"项目内容已变化，请刷新后基于最新版本重新审阅"；成功则原子替换目标文件并返回新版本号。
- **拒绝/重新生成**：记录决策留痕，可携带用户备注重新发起任务。

### 2.8 空态/异常态清单（页面级）

| 场景 | 表现 |
|---|---|
| 无通道配置 | 新建向导允许创建项目；任何"AI 生成"按钮置灰并提示前往设置页配置通道 |
| 会话不可用/创建失败 | 任务发出失败横幅 + [重试发送]；已发指令不重复发 |
| Proposal 过期（baseRevision 失配） | 应用按钮禁用 + 冲突说明 + [重新生成/基于最新重审] |
| 宿主重启 | 页面打开时全量重读项目/任务/Proposal/run；运行中任务标"会话已中断，可继续" |
| run 段失败 | 阶段红标 + 失败原因 + [重跑该段] |
| 项目目录被外部改动 | 读到无法解析的文件时备份损坏文件（对齐现有 RunStore 语义）并按缺失处理，页面警示 |

---

## 3. 数据模型与文件存储

### 3.1 目录结构（workspace 内）

```text
.dsh-drama/
  projects/
    <projectId>/
      project.json            # 清单：id、标题、类型、语言、策略、章节计划、createdAt/updatedAt、schemaVersion
      story/
        premise.json          # 前提（用户权威）
        architecture.json     # 故事架构
        worldbuilding.json    # 世界观条目数组
        outline.json          # 全书大纲（章级行数组）
      characters/
        characters.json       # 角色数组（稳定 id）
      chapters/
        0001/
          blueprint.json
          draft.md            # 当前草稿
          candidates/         # 候选稿（非权威）
          review.json         # 最近审稿报告
          final.md            # 定稿（存在即视为已定稿）
      tasks/
        <taskId>.json         # 创作任务：kind、status、输入资产版本、sessionId、事件、错误
      proposals/
        <proposalId>.json     # 提案：assetRef、baseRevision、replacement、status、来源任务/会话
      adaptations/
        <adaptationId>/
          source.json         # 来源章节/场景、改编参数
          script.json         # 镜像
          storyboard.json     # 镜像
          run-link.json       # { runId, createdAt, status }
      exports/                # 导出产物（Markdown 打包等，后续版本）
```

约定：

- 所有 JSON 两个空格缩进、LF、UTF-8；资产文件存在即权威，缺失视为空资产（`revision = absent`）。
- **版本 = 该文件规范化 UTF-8 字节的 SHA-256**。读接口返回 `revision`；写（应用 Proposal）必须携带读到的 `revision` 作乐观并发检查，失配返回 `STALE_REVISION`，不落盘。
- 写入一律 tmp + rename 原子替换；目录 0700、文件 0600。
- 形状守卫：读取时逐字段校验，损坏文件备份为 `<name>.broken-<ts>` 后按缺失处理（复用现有 RunStore/VaultStore 模式）。
- `schemaVersion` 写入 project.json；未来迁移走显式迁移函数，不做隐式兼容。

### 3.2 视频 Run 存储不变

`RunStore`（`~/.dsh-video-generator/runs/` 或 `$DSH_HOME` 下）保持现状：run.json 事实源 + 产物目录。项目侧仅保存 `run-link.json` 引用。首版不迁移媒体文件。

---

## 4. Host / Client 模块边界

### 4.1 Host 新增

```text
src/store/project.ts    # ProjectStore：项目 CRUD、资产读写（revision 语义）、章节、adaptations
src/store/proposal.ts   # ProposalStore：提案 CRUD、apply/reject（revision 校验 + 原子替换）
src/host/project-routes.ts  # /dsh-video-generator/drama RPC 面（见 §5）
src/tools/drama.ts      # drama_read / drama_propose 工具（Agent 用，见 §6）
```

现有 `routes.ts` 的 `handleApi` 扩展 `drama.*` 方法族；`host/index.ts` 注册新前缀路由 `/dsh-video-generator/drama`（POST JSON，{ok,value}/{ok,error} 信封，loopback 围栏不变）。

**workspace 解析**：Host 通过 workspace registry（同 automation 插件的宿主契约）把浏览器提交的不透明 `workspaceId` 解析为规范目录；**浏览器与 Agent 都不提交本地路径**；未知 id / 越界路径一律拒绝并返回稳定错误码（不带本地路径细节）。

### 4.2 Client 重构

现有 `lib/client.js` 为手写 bundle（非 tsc 产物），继续手工维护但拆分内部结构：

```text
（lib/client.js 内部模块化，保持单文件 bundle 形态）
  ProjectList / ProjectWizard        # 一级页
  WorkbenchShell                     # 三栏壳 + 阶段导航
  editors/*                          # premise/architecture/world/characters/outline/chapter
  ProposalPanel                      # 提案审核（diff/编辑/应用/拒绝）
  AgentPanel                         # 任务/事件/会话跳转
  AdaptationView / RunDetailView     # 改编与 Run 详情（复用现有 StudioView 资产）
  dramaRuntime                       # RPC 状态源（useSyncExternalStore + 可见性门控轮询）
```

- `settings.section` 保留为「通道与预算」配置页（删去 run 列表/作品库）。
- 会话桥：`ctx.sessions.create()/open()` + `ctx.layout.selectPanel(null)`（现有 sendToChat 机制泛化为"任务指令发送"）。
- 轮询：3s、`document.visibilityState === 'visible'` 门控、恢复可见立即刷新（同 automation 模式）。

---

## 5. RPC 面（/dsh-video-generator/drama）

统一信封 `{ok, value} / {ok, error:{code,message}}`；错误码沿用现有风格并新增：

`not-found / bad-request / conflict / stale-revision / workspace-unknown / project-exists / proposal-stale / internal`

| 方法 | 载荷 | 返回 |
|---|---|---|
| `drama.workspace.resolve` | `{}` | 当前 workspace（id、title、cwd）+ 已注册 workspace 列表 |
| `drama.project.list` | `{workspaceId?}` | 项目摘要数组（跨 workspace 时按注册表解析） |
| `drama.project.create` | `{workspaceId, premise…}` | `{projectId}`（已存在同名活动项目 → project-exists） |
| `drama.project.get` | `{workspaceId, projectId}` | 全量项目（资产 + revision + 章节 + 任务 + 提案摘要 + adaptations） |
| `drama.asset.update` | `{workspaceId, projectId, assetRef, baseRevision, replacement}` | 新 revision（用户手改直接保存；stale-revision 拒绝） |
| `drama.proposal.list` | `{workspaceId, projectId, status?}` | 提案数组 |
| `drama.proposal.apply` | `{workspaceId, projectId, proposalId, replacement?}` | `{revision}`（replacement 为用户编辑后的最终内容；缺省用提案原文） |
| `drama.proposal.reject` | `{workspaceId, projectId, proposalId, note?}` | `{}` |
| `drama.task.create` | `{workspaceId, projectId, kind, params?, userRequest?}` | `{taskId, instruction}`（instruction 由 Host 按 §6.3 模板组装） |
| `drama.task.update` | `{workspaceId, projectId, taskId, patch}` | task（状态/事件/错误由 Host 与工具回报共同维护） |
| `drama.adaptation.create` | `{workspaceId, projectId, chapterId, params}` | `{adaptationId, runId, taskId}` |

`instruction` 由 **Host 按 kind 模板（见 §6.3）在服务端组装**：页面只提交 kind/params/用户要求，上下文裁剪（本章蓝图 + 出场角色摘要 + 相关世界观条目 + 上一章相邻定稿）在 Host 完成——「有限上下文」由此成为可单测断言的 Host 纯函数（对应验收 10）。Host 组装后把指令文本随任务记录持久化，会话发送桥（M3 客户端）原样转发；Host 不在发送层再解析其语义。

---

## 6. Agent 协作模型（无预设）

### 6.1 工具面

新增两个 Agent 工具（与 vgen_* 并列注册；能力通告更新）：

| 工具 | 语义 |
|---|---|
| `drama_read` | `{workspaceId, projectId, assetRef}` → 权威资产内容 + revision。**有界读取**：资产级返回，单次最多一个资产；内容超过 512KiB 截断并报告截断。 |
| `drama_propose` | `{workspaceId, projectId, assetRef, baseRevision, replacement, summary, sessionId?}` → 落提案（pending），**绝不直接写权威文件**。baseRevision 失配 → `stale-revision`，Agent 须重读后再提案。 |

纪律写进工具描述与能力通告：先 `drama_read` 取最新 revision → 产出建议 → `drama_propose` 一次性提交完整替换内容 → 在收到"用户已应用"前不得声称已保存。视频段继续用 vgen_*（story/script/storyboard/generate/review/provide/channels）。

### 6.2 会话发送桥

页面"生成/改写"按钮 → `drama.task.create`（Host 记任务）→ 复用现有 sessions 桥创建或复用普通会话 → 把 `instruction` 发入会话。会话归属项目（task.sessionId）；右侧 Agent 面板可随时 `sessions.open` 跳转。旧会话关闭/换预设均不影响项目数据。

### 6.3 任务指令模板（Host 组装，kind 驱动）

```text
[漫剧工坊任务]
任务类型：generate-chapter-draft
项目：<projectId>（workspace <workspaceId>）
输入：chapter:0004/blueprint@<rev>、characters@<rev>、worldbuilding@<rev>（节选）、上一章定稿末段
要求：<用户本次要求>
产出：调用 drama_read 核对上述资产 → 调用 drama_propose 提交 chapters/0004/draft.md 的完整替换稿
禁止：直接修改权威文件；未经 drama_read 就提案；一次提案多个资产
```

### 6.4 与现有 vgen_* 管线的关系

改编任务中 Agent 仍走三段交接；`vgen_story` 的 story 输入由 Agent 依据章节定稿构造，脚本/分镜同理。UI 侧不新增第四种交接工具，避免语义重复。

---

## 7. Proposal 机制细则

- 提案文件含：`proposalId、projectId、taskId、assetRef、baseRevision、replacement、summary、kind、status(pending|applied|rejected|stale)、createdBy(session)、createdAt、decidedAt`。
- pending 提案上限 20/项目，超出拒绝新提案（Agent 收到明确错误）。
- 应用时的 revision 检查以**目标资产当前 revision** 为准（不信任提案里的 baseRevision 本身；它只用于判定提案是否已过期：当前 revision ≠ baseRevision → 置 stale，需重新生成或"基于最新重审"）。
- 用户编辑：`apply` 请求可携带编辑后 replacement；Host 对其做与提案同样的形状/限额校验。
- 全程留痕：提案文件本身记录决策（applied/rejected + 时间 + 备注），不删除，供版本历史追溯。

---

## 8. 设置页收敛

保留（原通道管理全部能力不变）：通道 CRUD、探测/导入模型、默认通道、预算阈值、gate 缺省。新增：环境与诊断（ffmpeg/drawtext 检测、TTS 能力、产物根目录、插件版本）。移除：run 列表、作品库（迁往工作台）。设置页导航名统一改为「漫剧工坊」（与侧边栏主入口同名；语言键沿用现有 `nav`，中英文案随词典更新）。

---

## 9. 预设退役

- `ensurePresetInstalled()` 及 `presets/` 安装逻辑从主流程移除（能力通告 systemPrompt section 保留并改写为工作台 + 工具导向，不再引导切换预设）。
- `presets/` 文件与 README 相应章节删除或标注废弃；版本号 bump 主版本（1.x → 2.0.0），release note 列破坏性变更。

---

## 10. 验收标准

**框架接入**

1. 插件加载后，侧边栏"新任务"与工作区列表之间出现「漫剧工坊」图标行；点击进入独立主面板；`← 返回会话` 可回到会话视图。
2. 宿主 ≤0.1.4（无 slot）时软降级：仅设置页入口，console 警告，不崩载。
3. 移除/损坏 `presets/` 不影响插件加载与主流程任何功能。

**项目与存储**

4. 新建项目后，当前 workspace 出现 `.dsh-drama/projects/<id>/project.json`（含全部必填 premise 字段）；刷新页面项目仍在。
5. 同 workspace 重复创建同名活动项目返回 `project-exists`。
6. 手改任意资产文件后未刷新的旧 revision 提交保存 → `stale-revision`，文件未被改动。

**Proposal 闭环**

7. Agent `drama_propose` 后，页面右侧面板与对应阶段同时出现待审卡片；Agent 无法通过任何工具直接改动权威文件（测试钉死：propose 后文件 revision 不变）。
8. 应用提案写入目标文件且内容与（可能经用户编辑的）replacement 完全一致，返回新 revision；拒绝的提案状态留痕。
9. 提案 baseRevision 过期时应用被拒并置 stale；"重新生成"产出基于最新 revision 的新提案。

**章节创作**

10. 生成第 N 章草稿时，Host 组装的上下文仅含蓝图 + 出场角色摘要 + 相关世界观条目 + 上一章相邻定稿 + 连续性事实 + 用户要求（单测对指令文本断言，不含其他章节正文）。
11. 候选稿不自动覆盖草稿；定稿是显式操作，定稿后进入连续性上下文。

**漫剧改编**

12. 从章节创建改编任务后，run-link.json 记录 runId；视频任务详情展示七段进度/gate/评审/花费；confirm-required / gate-approval / manual-gate 三个错误码的页面处置路径全部可用（确认后继续、放行后重调、引导 vgen_provide）。

**会话桥**

13. 任务指令经普通会话送达；会话关闭后项目数据完整，重新打开页面可继续（新建会话重发任务）。

**设置页**

14. 设置页不再出现 run 列表/作品库；通道管理与预算功能与现状等价（现有测试全部保留通过）。

**非功能**

15. 轮询仅页面可见时发生；隐藏标签页零请求。宿主重启后页面恢复一致状态。全部现有 `npm test` 用例 + 新增 store/routes/tools 用例通过；`npm run typecheck` 通过。

---

## 11. 测试策略

- **Host 单测**：ProjectStore（CRUD/revision/损坏备份/workspace 越界拒绝）、ProposalStore（apply/reject/stale/限额/留痕）、drama routes（信封/错误码/loopback）、drama tools（read 有界性/propose 不落盘/stale 语义）、指令组装（上下文范围断言）。
- **Client bundle 测试**：沿用 client-bundle.test.ts 守护模式，断言新模块存在性与关键字符串（PANEL_ID、RPC 方法名、语言键）。
- **快照/真机**：mock 通道全链路改编 demo（demo 脚本扩展）；0.1.5 宿主真机 boot + 侧边栏冒烟。

---

## 12. 里程碑

| 里程碑 | 内容 | 出口 |
|---|---|---|
| M1 数据与通道 | ProjectStore/ProposalStore + drama RPC + drama_read/drama_propose + 能力通告改写 | 单测全绿，工具可独立调用 |
| M2 工作台骨架 | 侧边栏入口 + 项目列表/向导 + 三栏壳 + premise/architecture 编辑 + Proposal 面板 | 验收 1/4/5/6/7/8 |
| M3 创作链完整 | 世界观/角色/大纲/章节四视图 + 审稿修订 + 定稿 + 任务/会话桥 | 验收 9–11/13 |
| M4 漫剧改编 | 改编任务 + Run 详情 + confirm/gate/manual 处置 + 历史Run关联 | 验收 12 |
| M5 收尾 | 设置页收敛 + 预设退役 + README/release/迁移说明 + 2.0.0 发版 | 验收 3/14/15 |

---

## 13. 风险与开放问题

| 风险/问题 | 处置 |
|---|---|
| 会话发送桥在部分宿主版本不可用 | 软降级：复制指令到剪贴板并引导粘贴（复用现有 sendToChat 兜底） |
| 大纲/角色整库 Proposal 的 diff 噪音 | 字段级 diff 渲染 + 逐条目高亮；必要时拆分为按角色提案（M3 评估） |
| 手写资产与 AI 提案的并发编辑冲突 | 统一 revision 语义覆盖两者；冲突 UI 走 stale 流程 |
| workspace registry 契约与宿主版本耦合 | 对照 automation 插件实现；缺失时绑定当前会话 workspace 并提示 |
| 章节正文很长导致 RPC 载荷大 | 分页/截断读取；Markdown 编辑器按需拉取；载荷上限对齐宿主 RPC 通道约束（约 4MB，同 automation 通道） |
