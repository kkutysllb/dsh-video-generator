# dsh-video-generator

DSH 原生视频生成插件：短视频/AI 短剧/漫剧管线，竖屏 9:16 成片（mp4 + SRT）。用户自配 OpenAI 兼容通道（官方/中转皆可），零运行时依赖（Node ≥24，成片链路依赖本机 ffmpeg）。

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
- **通道管理**：三要素（Base URL / API Key / Model）自配置，官方/中转皆可；测试通道（探测枚举模型）、一键导入、默认通道切换、单笔确认阈值（CNY）与 gate 缺省。API Key 只存本机 vault（0600），任何界面/响应仅回显脱敏串。

## 环境变量

| 变量 | 作用 | 缺省 |
|---|---|---|
| `VGEN_AUTO_CONFIRM` | demo 脚本（`scripts/demo-*.ts`）非交互终端的成本确认放行，须显式 `=1` | 未设（交互逐笔询问，非交互拒绝） |
| `VGEN_TTS_MODEL` | 云端 TTS 模型名（走默认通道的 baseUrl/apiKey；设置即启用云配音） | 未设（回退本地 say/SAPI） |
| `VGEN_TTS_VOICE` | 云端 TTS 音色 | 未设（服务端缺省） |
| `VGEN_TTS_INSTRUCTIONS` | 云端 TTS 旁白语气指令 | 未设 |
| `VGEN_FFMPEG` | ffmpeg 可执行路径（须含 drawtext；Homebrew 精简构建常见缺失） | `ffmpeg`（PATH） |
| `VGEN_POLL_DELAY_MS` | i2v 轮询间隔覆盖（demo 提速用） | 1000 |
| `VGEN_VIDEO_MODEL` | video 段与评审重拍的视频模型覆盖（上游分组饱和时换档，如 `wan2.6-i2v-flash`） | 内置缺省（happyhorse-1.1-i2v） |
| `VGEN_ALLOW_INSECURE` | `=1` 允许 `http://` baseUrl（仅本地调试） | 未设（强制 https） |

## 画幅策略

9:16 竖屏成片：参考图统一按竖版生成（`1024x1536`——2:3 是中转普遍支持的最接近竖档），渲染端 `scale=force_original_aspect_ratio=increase` + 中心 `crop` 归一化消黑边（宽高须为偶数，否则 libx264 报 `width not divisible by 2`）。

## 已知限制

- 手动提供的 shot 参考图无公网 URL → video 段自动 i2v 不可用（`vgen_provide` 响应内警示；评审重拍拒绝并给出 `rerunStage` 指引）。
- kling 上游饱和，`pin-kling-contract.ts` 真机钉契约挂起；Windows SAPI 配音未真机验证（无 Windows 机器）。
- happyhorse 等免费档模型带平台水印 → 仅文档警示 + 设置页备注（二期做通道白名单/降档选项）。

**水印提示**：happyhorse 等免费档视频模型可能带平台水印，介意请在「通道管理」中改用付费模型。

## Agent 预设（漫剧导演，含疗愈绘本题材包）

插件加载时自动把 `presets/`（`preset.yml` + `agent.cordis.yml`）幂等安装到 `~/.dsh/.agent-presets/dsh-video-generator/` 与 `~/.kcoder/.agent-presets/dsh-video-generator/`（双候选目录任一失败静默，不阻断插件加载），宿主预设列表中可直接选用「漫剧导演」：三段交接流程纪律、评审重拍闭环、成本/gate 护栏与「疗愈绘本」题材包（风格词汇/角色原型/节奏模板/负面词）。

## 开发

```bash
npm run typecheck   # tsc 全量类型检查
npm test            # node --test（Node 24 strip-types 直跑）
npm run demo:mock   # 零 key mock 全链路 demo
```
