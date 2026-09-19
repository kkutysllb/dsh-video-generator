# dsh-video-generator

DSH 原生视频生成插件：短视频/AI 短剧/漫剧管线，竖屏 9:16 成片（mp4 + SRT）。用户自配 OpenAI 兼容通道（官方/中转皆可），零运行时依赖（Node ≥24，成片链路依赖本机 ffmpeg）。

**DSH native video-generation plugin**: short-video / AI drama / comic-drama pipelines with 9:16 portrait output (mp4 + SRT). Bring your own OpenAI-compatible channel (official or relay). Zero runtime deps (Node ≥24; the final-cut stage needs local ffmpeg).

## 安装 / Install

```bash
# npm registry（推荐：版本可被插件管理检测，用户手动更新）
# npm registry (recommended: version detection with manual updates)
dsh plugin --profile web add dsh-video-generator

# GitHub 直装 / install straight from GitHub
dsh plugin --profile web add github:kkutysllb/dsh-video-generator

# 或从 dsh-plugins 真源仓 / or from the dsh-plugins monorepo
# （pnpm 的 github: 说明符只认仓库根为包边界，子目录插件先 clone 后按路径安装）
git clone git@github.com:kkutysllb/dsh-plugins.git
dsh plugin --profile web add ./dsh-plugins/dsh-video-generator
```

**装到哪个 harness home 由启动器决定**：`dsh plugin add` 的落点是启动器解析的
`<DSH_HOME>/profiles/<profile>`——`DSH_HOME` 优先，未设时 stock CLI 缺省 `~/.dsh`。
KCoder 桌面端的 profile 在 `~/.kcoder/profiles/web`，给桌面端装插件请带前缀
（装完重启/重载桌面端生效）：

```bash
# KCoder 桌面端 / KCoder desktop
DSH_HOME=~/.kcoder dsh plugin --profile web add dsh-video-generator
```

装好后打开侧边栏「**漫剧工坊**」即可开始：项目制创作（小说/剧情 → 漫剧改编 → 成片），
也可以直接在对话里说需求，能力通告会引导路由。

Open the **Drama Workbench** in the sidebar after install: project-based creation
(novel/drama → comic-drama adaptation → final cut). Or just state your request in
chat; the capability announcement routes it.

环境要求 / Requirements：

- Node ≥ 24；ffmpeg 须含 `drawtext` 滤镜（Homebrew 精简构建常见缺失——可用
  `VGEN_FFMPEG` 指向完整构建，如 bilibili 客户端自带版）。
  Node ≥ 24; ffmpeg must include the `drawtext` filter (set `VGEN_FFMPEG` if your
  build lacks it).
- 生成通道：任一 OpenAI 兼容端点或中转站（设置页「通道管理」填写 Base URL、API Key 和 `models[]` 即可）。
  Any OpenAI-compatible endpoint or relay; configure Base URL, API Key, and `models[]` in the settings page.

每个版本的变更说明（新增 / 变更 / 修复 / 删除 / 兼容性）见 [`release/`](release/)；
`package.json` 的 `version` 是插件管理检测新版本的信号，更新由用户手动触发。

Per-version changes live under [`release/`](release/); the `package.json` version
drives update detection.

## QiLin（麒麟）双通道适配（v2.0.1 起）

manifest 同时声明 `qilin` 与 `dsh` 两个通道的 `bundle.patch` / `client`：
QiLin（dsh 0.1.6-alpha.2 合并后）的插件管理器只认原生键
`qilin.bundle.patch`（缺失会报「没有声明组合包」），DSH 宿主仍读
`dsh.*`；两通道指向同一份 `cordis.patch.yml` 与 client 交付物，
行为完全一致。

## 麒麟（QiLin）引擎安装

```bash
# npm registry（推荐：版本可被插件管理检测，用户手动更新）
qilin plugin --profile qilin add dsh-video-generator

# GitHub 直装 / install straight from GitHub
qilin plugin --profile qilin add github:kkutysllb/dsh-video-generator
```

装完在 QiLin 设置 → 插件里可见、可启停；漫剧工坊侧边栏页面与视频
管线工具随之生效。

### 注意事项（QiLin）

- **必须经 `qilin plugin add` 装进 profile**：包会落到 profile 私有的
  `~/.qilin/profiles/<name>/node_modules`——裸包名原生解析的第一跳。
  **不要**手工把包目录放进共享的 `~/.qilin/profiles/node_modules`：
  dsh alpha.2 合并后的 runtime+enforce 解析把该目录划为安装保留区，
  放那里的 bundle 层包激活时直接 `failed to import`。
- **引擎版本**：运行需要带 dsh 兼容层的 QiLin 3.0.0+；插件**管理**
  （设置页展示/启停）要求 3.0.2+（alpha.2 合并后只认
  `qilin.bundle.patch` 原生键）。
- **运行时解析**：dsh alpha.2 起依赖解析默认运行时模式（PR #4471），
  插件运行期导入由 profile 安装图经进程内 generation 解析；引擎包按
  框架契约声明于 peerDependencies，由宿主安装副本统一解析。
- **需要 ffmpeg**（macOS 配音另需 `say`，Windows 用 powershell；可经
  `VGEN_FFMPEG` 覆盖路径）。
- **运行数据**（runs/vault）按宿主 home 解析
  （`QILIN_HOME → DSH_HOME → ~/.dsh`）。

## 漫剧工坊（2.0 新增）

侧边栏「漫剧工坊」是独立主面板：项目制小说/剧情创作工作台。项目数据持久化在 workspace
的 `.dsh-drama/projects/<projectId>/`（JSON/Markdown + 版本号），可 Git 管理、跨会话恢复。

- **创作链**：灵感与前提 → 故事架构 → 世界观 → 角色 → 剧情大纲 → 章节工作台（蓝图/草稿/审稿/定稿）→ 漫剧改编。
- **提案闭环**：Agent 的一切内容产出先落 Proposal（`drama_propose`，绝不直写权威文件），用户在页面查看 diff、可编辑后显式「应用」（乐观并发：版本失配即拒绝并提示刷新）。
- **任务指令**：页面「AI 生成」按钮由 Host 组装**有限上下文**的任务指令（本章蓝图 + 出场角色摘要 + 相关世界观 + 上一章定稿末段，绝不携带整本书），经剪贴板桥送入普通会话执行。
- **漫剧改编**：选定章节一键创建改编任务，Agent 走 vgen_story → vgen_script → vgen_storyboard（三段产物镜像回项目 + run-link 记录），后续 vgen_generate 照旧（confirm/gate/评审闭环不变）。

## 工作流（三段交接）

会话模型自己产出结构化 JSON 并依次调用 `vgen_story → vgen_script → vgen_storyboard`（每步之后用 `vgen_status` 核对状态），之后接 `vgen_generate` 推进非 LLM 段（assets → video → final）。漫剧改编任务中 `vgen_story` 需携带 `workspaceId/projectId/adaptationId`（工具自动镜像产物回项目）。出错按错误信封 `error.code` 处置：`confirm-required` 转述成本后 `confirm:true` 重调；`gate-approval` 用户批准后 `gateApprovals` 重调；`manual-gate` 收用户文件走 `vgen_provide`。

## 工具面（2.0，10 个）

| 工具 | 职责 |
|---|---|
| `vgen_story` | 提交故事 JSON 开新 run（title/logline/style/characters/chapters） |
| `vgen_script` | 提交剧本 JSON（scenes/dialog，引用完整性校验） |
| `vgen_storyboard` | 提交分镜数组，自动注入四层提示词（风格/运镜/角色锚/参考图） |
| `vgen_generate` | 推进 `assets`/`video`/`final` 段；`confirm`/`gates`/`gateApprovals`/`rerunStage` |
| `vgen_status` | 进度 + gates + reviews + 最近事件 |
| `vgen_review` | 质量闭环：不带 `score` 抽成片 25/50/75% 三帧；带 `score` 1-5 评分，≤2 自动追加负面词重拍（每镜 ≤2 次，重拍花费同 confirm 语义） |
| `vgen_provide` | manual gate 产物注入：master-asset（char-*/scene-*）/ shot-assets / video（全镜覆盖、时长 ≥0.5s）/ final-cut（.mp4 注入即 done） |
| `vgen_channels` | 通道面板：`list` 脱敏列表 / `health` 探测健康+估价 / `spend` 累计消耗 |
| `drama_read` | 读漫剧工坊项目的一个权威资产（内容 + revision；512KiB 截断）。提案前必读 |
| `drama_propose` | 提交内容提案（pending，绝不直写权威文件）；baseRevision 失配 → `stale-revision` 须重读 |

> 偏离说明：规格 §7.1 工具表为 7 个。manual gate 的产物注入需要独立入口，故增设 `vgen_provide`（塞进 `vgen_generate` 会污染其语义）。

## 设置页（Web 设置 →「漫剧工坊」）

- **通道管理**：Base URL / API Key 与 `models[]` 自配置，模型项带 `kind`（`image` / `video` / `tts`），官方/中转皆可；支持测试通道（探测枚举模型）、一键导入、模型逐行移除、保存空列表、默认通道切换、单笔确认阈值（CNY）与 gate 缺省。API Key 只存本机 vault（0600），任何界面/响应仅回显脱敏串。
- **环境与诊断**（2.0 新增）：ffmpeg/drawtext 检测、TTS 能力、产物根目录、插件版本。
- run 列表与产物预览已迁往漫剧工坊「视频任务」页（2.0 起设置页不再展示）。

## 环境变量

| 变量 | 作用 | 缺省 |
|---|---|---|
| `VGEN_AUTO_CONFIRM` | demo 脚本（`scripts/demo-*.ts`）非交互终端的成本确认放行，须显式 `=1` | 未设（交互逐笔询问，非交互拒绝） |
| `models[]` | 默认通道的模型清单；每项 `{ model, kind }`，各 `kind` 按列表第一项选择 | 未配置时返回 `model-unavailable` |
| `VGEN_TTS_VOICE` | 云端 TTS 音色（云端模型由默认通道首个 `kind=tts` 决定） | 未设（服务端缺省） |
| `VGEN_TTS_INSTRUCTIONS` | 云端 TTS 旁白语气指令 | 未设 |
| `VGEN_FFMPEG` | ffmpeg 可执行路径（须含 drawtext；Homebrew 精简构建常见缺失） | `ffmpeg`（PATH） |
| `VGEN_POLL_DELAY_MS` | i2v 轮询间隔覆盖（demo 提速用） | 1000 |
| `VGEN_ALLOW_INSECURE` | `=1` 允许 `http://` baseUrl（仅本地调试） | 未设（强制 https） |

## 画幅策略

9:16 竖屏成片：参考图统一按竖版生成（`1024x1536`——2:3 是中转普遍支持的最接近竖档），渲染端 `scale=force_original_aspect_ratio=increase` + 中心 `crop` 归一化消黑边（宽高须为偶数，否则 libx264 报 `width not divisible by 2`）。

## 已知限制

- 手动提供的 shot 参考图无公网 URL → video 段自动 i2v 不可用（`vgen_provide` 响应内警示；评审重拍拒绝并给出 `rerunStage` 指引）。
- kling 上游饱和，`pin-kling-contract.ts` 真机钉契约挂起；Windows SAPI 配音未真机验证（无 Windows 机器）。
- happyhorse 等免费档模型带平台水印 → 仅文档警示 + 设置页备注（二期做通道白名单/降档选项）。

**水印提示**：happyhorse 等免费档视频模型可能带平台水印，介意请在「通道管理」中改用付费模型。

## Agent 协作（无预设）

2.0 起不再依赖 Agent 预设（宿主已移除插件预设模式）：普通会话 + 能力通告即可工作。
漫剧工坊页面负责状态/审核/执行，会话 Agent 负责推理与产出；创作纪律（先 `drama_read`
取 revision → `drama_propose` 一次性提案 → 用户应用前不得声称已保存）写进工具描述与
能力通告。

## 开发

```bash
npm run typecheck   # tsc 全量类型检查
npm test            # node --test（Node 24 strip-types 直跑）
npm run demo:mock   # 零 key mock 全链路 demo
```

发布流程（bump 版本 → 写 release/vX.Y.Z.md → tag → push → npm publish）见
[`release/README.md`](release/README.md) 的发版约定与 checklist；`prepack` 会在
`npm publish` 前自动 build + typecheck + test。

## License

MIT

