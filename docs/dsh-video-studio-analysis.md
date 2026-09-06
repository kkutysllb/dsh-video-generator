# 鲸影 dsh-video-studio 深度分析报告

> 分析对象：https://github.com/hackerFish/dsh-video-studio（main @ 36198b8，2026-09-04）
> 方法：GitHub API 全量文件树 + 4 路并行源码实读（host/director、providers/quota、prompts/finalcut、client/docs），README/架构文档/复盘文档对照。
> 用途：为本项目 dsh-video-generator 的方案讨论提供输入。

## 0. 一句话总评

一个 3 周冲刺出来的 DSH 原生视频/漫剧插件：**模块抽象和工程方法论是真功夫（A 级），但"七段流水线"有近半是事件占位、免费额度路线已被现实证伪、逆向协议天然脆弱（B 级交付物）**。最值钱的是它的 Provider 薄抽象、账号池调度、评分簿闭环细节和 11 条复盘规则，而不是它宣称的功能面。

## 1. 项目基本盘

| 项 | 值 |
|---|---|
| 包名/版本 | `@hackerfish/dsh-video-studio` v0.2.0，MIT |
| 体量 | src 40 模块 ≈ 4,400 行 TS；测试 30 文件 / 123 用例（node --test 全绿）；client bundle 435KB |
| 历史 | 2026-08-16 建仓，145+ commits（其中 106 个集中在前 2 天），最后提交 2026-09-04 |
| 作者 | hackerFish（张昌宇），生态：dsh-lab / awesome-dsh-skills / awesome-dsh-presets |
| 现状 | star=4；作者自评"工程 A 级 / 分发 D 级"；最新提交把方法论库迁往新项目 `ai-drama`，本仓库大概率已过活跃期 |
| 语言 | GitHub 标 JavaScript（因 lib/ 产物入库），实际全 TypeScript + tsup 双包 |

## 2. 架构与插件接入

**DSH 原生插件规范姿势**（值得照抄）：
- cordis 风格入口：`export const name` + `export function apply(ctx)`；`ctx.inject(['tools'])` 注册模型工具、`ctx.inject(['webServer'])` 注册路由；每条路由用 `effect()` 挂生命周期，卸载即注销。
- 11 条 exact 路由：`/health`、`/runs`、`/accounts`(GET/POST/DELETE)、`/prompt-optimize`、`/storyboard`、`/generate`、`/comfyui`(+`/nodes`、`/queue`、`/import`、`/run`)。
- 双包构建：host → ESM node22 `lib/host/index.mjs`；client → CJS/browser `lib/client/index.js`，`external: react/react-dom`（宿主注入），`noExternal: @xyflow/react`（435KB 主因），esbuild alias 把 `react/jsx-runtime` 指向自写 shim 实现零外部依赖 JSX。
- `WHALE_BUILD` 构建标记：产物哈希变化 → 宿主 rev 变化 → 强制浏览器丢 IndexedDB 旧模块。插件客户端缓存问题被它用一个常量解决了。
- 模块分层干净：`provider(接口) / providers(11 适配器) / quota(池) / accounts(vault) / prompts / quality / finalcut / voice / memory / director / host / client / selfaudit / content(presets)`。

## 3. 七段流水线：宣传与代码的差距（核心发现）

README 宣称七段（story → script → storyboard → master-asset → shot-assets → video → final-cut），代码实况：

| 段 | 实现度 |
|---|---|
| story / script | **纯事件占位**（各 emit 一条事件，无 LLM 写故事/拆剧实现，Script 由外部传入） |
| storyboard | 真实现：四层合层 mergePromptLayers + scorebook 选增益 |
| master-asset | **仅打点**，无 MJ 主图生成 |
| shot-assets | 真实现：并发泵（默认 2）+ submitWithFallback 失败换号重提（tried Set 防环）；mock 用 ffmpeg lavfi 出蓝底片 |
| video | 真实现：轮询（10min 上限）、下载落盘记 sourceUrl、ffmpeg 截时长 |
| final-cut | 真实现：TTS 配音 → addClip/addAudio/addSubtitle → 剪映/ffmpeg 双通道渲染；口型同步段在循环内（audio2video base64，失败回退原片不致命） |

即**七段 ≈ 四段半**。"LLM 前三段"本质是设计叙事：把会话模型当大脑，插件自己不做 LLM 调用（这符合 DSH 原生理念，但流水线代码里并没有承接 story/script 的真实逻辑）。

**gate 机制近乎摆设**：`'manual'` 与 auto 等价无特殊处理；管线检查 `ok('stills')` 但 STAGES 里没有 stills 这个 id → 恒 auto；返回值 gates 用默认表而非实际传入。失败重拍倒是真的：`reviewShot` 规则层（存在/时长≥0.5s/抽 3 帧）+ 注入式 LLM Reviewer，score≤2 且未超 maxRetries(2) 则追加负面词重提，score≥4 晋升模板。

## 4. 供应商矩阵：11 个适配器

**接口**（`src/provider.ts`）：6 方法 + 可选 `ensureCredits?`——`capabilities/quote/submit/status/fetch/health`，能力位含 textToVideo/imageToVideo/firstLastFrame/lipSync/tts/image、maxDurationSec、resolutions、qualityTier、freeQuota、dailyQuota；`assertProvider` 运行时校验；`route()` 能力过滤 + tier 排序。

| 适配器 | 通道 | 实测状态 |
|---|---|---|
| jimeng 即梦 | 网页逆向（sessionid，draft_content 组件树构造，SystemBusy 3s×3 重试） | 协议通，但免费文生视频队列 16 次探针全 SystemBusy（0 点也满）→ 免费路线已改道 |
| tongyi-wanx | 网页逆向（cookie+x-xsrf-token+x-wan-uid） | ✅ 真图验证 |
| dashscope-wan | 官方 DashScope 工厂薄壳（wan2.2-t2v-plus） | ✅ 真机出片 1080p 5s，但 ¥0.70/s 按量计费（作者交了 ¥7 学费） |
| doubao | 官方 ARK（Seedance 异步任务 + Seedream OpenAI 兼容生图） | 待 key |
| doubao-web | 网页 SSE 逆向（msToken/a_bogus 风控参数，自述会轮换需重抓） | 抓包回放成功；六方法是空壳，误入标准管线会静默丢结果 |
| kling / kling-dashscope / kling-lipsync | 官方 API（手写 HS256 JWT / DashScope 工厂 / lip-sync 双模式） | 待 key（lipsync 有 8 单测） |
| comfyui | 本地 `/prompt→/history→/view` | 协议 mock 级验证，待真 GPU |
| sessionid-http | 通用"sessionId 当 Bearer"模板 | UNVERIFIED |
| mock | 内存假任务 + ffmpeg 蓝底片 | ✅ 零 key 全链路 |

**实况**：真正 live 跑通视频的只有付费的 DashScope 一条路；"多供应商免费额度"的商业卖点被现实打得只剩万相免费文生图。逆向通道全部标注了脆弱性（draft 结构、风控参数轮换），这个诚实度值得肯定。

## 5. 额度池与账号调度（`quota/`）

- `AccountPool`：ISO dayKey 跨日清零 → 过滤 disabled/冷却/超额 → LRU 轮换（lastUsedAt 升序，平局 tier 降序）→ 语义化 PickReason（no-quota/cooldown/none）。
- 退避：`delay = min(60s × 2^(n-1), 30min)`，成功清零。
- `PooledProviders`：按 accountId 缓存"烤入凭证"的 Provider 实例；**submit 成功才 charge**；失败 recordFailure 后 rethrow，换号重提由上层 `submitWithFallback` 循环完成（本层不自动重试）。
- 运行时接线：模块级单例 runtimeVault/runtimePool，UI 增删账号 → invalidatePool 重建 → persistPool 落盘"重启不断账"。

## 6. 凭证与安全

- vault：`~/.whale/whale.json`（跟随 `$DSH_HOME`），目录 0700/文件 0600 双保险，tmp+rename 原子写；accounts（明文凭证）与 poolState（用量健康）分层，合并加载"列表为底座、状态为覆盖层"；全出口 `maskCredential`（前3+••••+后3）；入口白名单/长度/正则校验；`destroy()` 紧急清盘。
- **缺口**：`/comfyui` 路由把完整 credential 原样回显（含 JSON 凭证）；明文 JSON 落盘本质脆弱；`whale_generate_video` 轮询超时分支竟调 recordSuccess（超时算成功，污染健康度）；comfyui/import 硬编码作者个人路径 `D:/CY/comfyUI/opc/workflows`。

## 7. 提示词工程与自优化闭环

- **四层 = `PromptLayers{dna, shotTemplate, manual, injections}`**：前三层 trim 后中文逗号顺序拼接（顺序即权重），injections 独立为 negative。实现就是字符串拼接，胜在分层语义清晰。
- **模板库 v2**：`sections()` 区块拼接器；character-sheet 三视图模板 12 区块（版式硬编码"左正脸+右三视图"、度量锚定"角色高度=画面 80%"、三重一致性锁 booster）；两级负面清单（三宗罪：视图融合/面板间特征漂移/风景背景污染）。
- **optimizer 是确定性规则版**（非 LLM）：草稿 → 按 boosters 或 scorebook 推荐追加 → 补风格/画幅/负面。
- **评分簿（最精细的一处）**：`WARM_THRESHOLD=3` 冷启动返回默认增益；热数据按 avg≥3 降序取前 4，低分默认项**不补位**（防淘汰增益回流）；每次写入即落盘。
- **风格基因**：`weight *= score/3` 乘性演化 + promote/retry 标记 + feedback 审计 cap 500。缺陷：权重无下界无衰减（趋零不可恢复）、与 style-dna 重复实现、`source` 死参数。
- 关键认知：**插件自身零模型调用，"智能"全靠注入**——Reviewer 回调、风格 DNA 文本都来自 DSH 会话模型。这是 DSH 原生设计的正确姿势。

## 8. 成片链路

- `timeline.ts`：中性数据模型（全微秒，Canvas/Clips/Subtitles/Audio），**只支持线性首尾相接**（startUs 由前序累加，无多轨/间隙/变速）。
- 通道 A 剪映草稿：materials+tracks JSON，`validateDraft` 校验 id 唯一/引用完整/timerange 合法；社区逆向+保守字段集，兼容性存疑。
- 通道 B ffmpeg：三级定位链（DSH_FFMPEG → @ffmpeg-installer → PATH）；两阶段（逐 clip 归一化 scale+pad+fps+yuv420p → concat + drawtext 字幕链 + atrim/adelay/amix）；转义只覆盖 5 字符（逗号等滤镜元字符漏了）。
- TTS：macOS `say`/Win PowerShell SAPI（纯函数生成脚本便于单测），durationMs 恒 null，`voiceFile` 支持外挂真人/云 TTS。

## 9. 前端 UI 与工作台

- 3 个 tab 挂 `settings.plugins.tab` 插槽（`settings.section` 只收 {id,order,label} 的坑写进了注释）+ `tool.call.toolview` 让会话消息内嵌画布。
- 工作台 = @xyflow/react v12：6 节点流水线、节点级运行回显、`whale-workflow` JSON 导入导出、**ComfyUI workflow 兼容转换**（按 class_type 识别）、侧栏 checkpoint/队列轮询。愿景（WORKSPACE-VISION）是"DSH 内的 ComfyUI 级节点工作区"，验收标准"拖节点出图出片不比 ComfyUI 差"。
- 状态管理全是本地 useState，3s/5s 双轮询、flow 与 /runs 双状态源，长会话有一致性隐患；云引擎卡状态写死"✅ 真机出片"（非 health 数据）。

## 10. 工程化与方法论（隐性价值最高）

- 123 单测全绿；依赖全注入（fetchImpl/nowFn/reviewer/ask/onEvent）→ mock provider 零 key 跑通全链路。
- `whale_self_audit` → 自动生成 AUDIT-REPORT.md，"每天 diff 这份报告就是进度日志"；供应商矩阵单一事实源 `selfaudit/matrix.ts`，与 account-providers 交叉校验防漂移。
- 11 条复盘规则（RETROSPECTIVE）是真金：成功路径也要脱敏、写盘跟随 $DSH_HOME、host 变更必须最小 profile 真机 boot + curl round-trip（单测测不出运行时装载问题）、列表底座+状态覆盖层合并、Node 24 strip-only 不支持构造器参数属性。
- 工具面：README 说 7 个 whale_* 工具，tools.ts 实际注册 **9 个**（+whale_studio、whale_comfyui_character）；GitHub 仓库描述写"六段"README 写"七段"——文档漂移多处。

## 11. 值得借鉴的亮点（按迁移价值排序）

1. **六方法 Provider 薄抽象 + capabilities 声明式路由**：新增供应商≈一个文件，流水线零改动；`assertProvider` 运行时校验兜底。
2. **AccountPool 调度语义**：submit 成功才计费、指数退避、语义化 PickReason、vault/poolState 分层、"失败换号由上层循环、池只管冷却"的职责划分。
3. **评分簿防退化细节**：冷启动默认值、WARM_THRESHOLD、低分项不回流。
4. **timeline 中性模型 → 剪映/ffmpeg 双通道**：一次剪辑决策两种导出。
5. **mock 全链路 + 自审计 + 复盘规则**这套工程方法论，比任何单个功能都值钱。
6. 零依赖 JSX shim、WHALE_BUILD 破缓存、effect 生命周期挂路由等 DSH 插件实操技巧。

## 12. 问题清单（bug 级，可直接避坑）

1. kling JWT 缓存 `cachedToken ??=` 永不刷新 → 进程跑超 30min 全 401，且被 recordFailure 误伤账号健康度。
2. `whale_generate_video` 轮询超时分支调 recordSuccess（超时=成功）。
3. gate：`ok('stills')` 与 STAGES id 不匹配恒 auto；manual 无语义；返回 gates 失真。
4. `/comfyui` 路由明文回显完整凭证。
5. 硬编码 `D:/CY/comfyUI/opc/workflows` 个人路径。
6. `appliedBoosters = shots[0] ? [] : []` 恒空死代码；runs 纯内存无持久化（宣称持久化）；TTS durationMs 恒 null；drawtext 转义不全。
7. 架构级：/generate 120s、/comfyui/run 180s 同步长轮询占死 HTTP 连接，无取消无并发保护。

## 13. 战略层观察

- "质量优先省钱第二"的卖点被现实修正：**免费额度路线（sessionid 逆向）在 2026-09 的实际可用面 ≈ 万相免费文生图**，视频免费路全堵（即梦 SystemBusy、可灵网页反爬一次性令牌、万相视频按量计费）。这个项目的探针证据帮后来者省了试错成本：**免费逆向路不可依赖，官方 API/本地 ComfyUI 才是主干**。
- 单人 3 周 4400 行 + 123 测试，产出效率极高（AI 辅助开发痕迹明显），但分发失败（star=4）——作者自己归因"漏斗断在分发"。功能面宣传（七段/七工具）与代码实况的差距说明：AI 时代写代码快，**让宣称与实现保持一致反而是瓶颈**。
- 作者已把重心移去 `ai-drama`（方法论库迁移），本仓库进入维护态。

## 14. 对本项目 dsh-video-generator 的讨论引子

本地仓库还是空的（first commit）。要讨论的第一个分叉：

1. **定位**：我们也做 DSH 插件（同赛道竞品/互补）？还是独立 CLI/服务？鲸影的可迁移资产（Provider 抽象、池调度、timeline 双通道）无论哪种形态都能复用。
2. **生成路线**：免费逆向（不可依赖）vs 官方 API（花钱）vs 本地 ComfyUI（要 GPU）vs HTML 动画"伪视频"（本机已装 dsh-animations/dsh-super-ppts 动效技能线，零额度成本出"可录屏成片"的动态内容）——后两条是鲸影没覆盖/没做深的。
3. **流水线真伪**：鲸影的 story/script 占位是因为插件拿不到 LLM；如果我们的方案里 LLM 段能真做（DSH 会话模型显式落盘 story/script），七段可以做成真七段。
4. **范围控制**：鲸影 3 周铺 11 适配器 → 7 个待 key 没跑过。我们是否先砍到 1-2 个真实验证过的通道 + mock，把 gate/持久化/成本护栏这些它没做扎实的做扎实？
