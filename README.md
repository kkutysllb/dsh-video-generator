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

插件的「漫剧导演」预设也随之落到 `<DSH_HOME>/.agent-presets/dsh-video-generator/`，
与安装目标同一 home 语义。

装好后切换 Agent 预设「**漫剧导演**」即可开始（插件加载时自动安装预设；也可不切预设，
直接在对话里说需求，能力通告会引导路由）。

Switch to the **Comic-Drama Director** agent preset after install (auto-installed on
plugin load) — or just state your request; the capability announcement routes it.

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

## 工作流（三段交接）

会话模型自己产出结构化 JSON 并依次调用 `vgen_story → vgen_script → vgen_storyboard`（每步之后用 `vgen_status` 核对状态），之后接 `vgen_generate` 推进非 LLM 段（assets → video → final）。出错按错误信封 `error.code` 处置：`confirm-required` 转述成本后 `confirm:true` 重调；`gate-approval` 用户批准后 `gateApprovals` 重调；`manual-gate` 收用户文件走 `vgen_provide`。

## 工具面（M4，8 个）

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

> 偏离说明：规格 §7.1 工具表为 7 个。manual gate 的产物注入需要独立入口，故增设 `vgen_provide`（塞进 `vgen_generate` 会污染其语义）。

## 设置页（Web 设置 →「视频工坊」，双 tab）

- **工坊**：run 列表与进度、阶段状态/gate/评审结果、产物预览（角色/场景主图、分镜参考图、镜头片段、评审帧、成片）、预估花费。
- **通道管理**：Base URL / API Key 与 `models[]` 自配置，模型项带 `kind`（`image` / `video` / `tts`），官方/中转皆可；支持测试通道（探测枚举模型）、一键导入、模型逐行移除、保存空列表、默认通道切换、单笔确认阈值（CNY）与 gate 缺省。API Key 只存本机 vault（0600），任何界面/响应仅回显脱敏串。

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

## Agent 预设（漫剧导演，含疗愈绘本题材包）

插件加载时自动把 `presets/`（`preset.yml` + `agent.cordis.yml`）幂等安装到 `<DSH_HOME>/.agent-presets/dsh-video-generator/`——跟随宿主 harness home（`DSH_HOME` 优先，未设回退 `~/.dsh`；KCoder 等品牌部署由其启动器注入自己的 home，如 `~/.kcoder`），安装失败静默、不阻断插件加载。宿主预设列表中可直接选用「漫剧导演」：三段交接流程纪律、评审重拍闭环、成本/gate 护栏与「疗愈绘本」题材包（风格词汇/角色原型/节奏模板/负面词）。

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

