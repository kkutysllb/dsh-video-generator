# 规格 × 实现状态对照表（2026-10-04 全量审计归档）

> 审计方式：三份现行规格逐条对照代码（file:line 级证据），分四档：✅ 符合 / ⚠️ 偏差 / ❌ 缺失 / 🔎 需真机。
> 审计基线：v2.1.0（`302dbd3`）；审计后已落地两轮修复（`588c16e` 规格对齐、`9d6c669` 工坊风格对齐、本轮梯队一修复），下表为**修复后**状态。
> 用途：防止规格差异长期挂账；后续变更只需增量维护本表。状态列可随拍板更新。

## 总览

| 规格 | 条目数 | ✅ 符合 | ⚠️ 有意偏差（已声明） | ⚠️ 无意偏差（已接受/低风险） | ❌ 缺失（待拍板） | 🔎 需真机 |
|---|---|---|---|---|---|---|
| v1.1 核心管线 | 14 大项 | 11 | — | 3 | 0 | 4 |
| v2.0 漫剧工坊 | 16 大项 | 16 | 6（小项） | 2（小项） | 0 | 0 |
| v2.1.0 通道槽 | 17 大项 | 12 | 3 | 5 | 1（预算区音乐计价项） | 2 |

---

## v1.1 核心规格（2026-09-06）

| 条款 | 状态 | 说明 |
|---|---|---|
| §3 构建标记破 IndexedDB 缓存 | ⚠️ 有意放弃 | 宿主从磁盘加载手写 bundle，机制失义；规格条款作废 |
| §4.1 六方法 Provider + assertProvider | ✅ | `provider.ts`；route() 已按 v2.1.0 §8 删除（防回流哨兵在 test/lib-hygiene） |
| §4.2 fetch 超时 + AbortController | ✅ | relay-http 统一 signalWithTimeout；429/5xx 指数退避（基期 5s/封顶 30s，与规格 30s/15min 不同——**接受现参数**，测试钉死） |
| §4.3 探测（枚举/鉴权/小额实跑） | ✅ | probe.ts + slot-probe.ts（含 fetchImpl 注入离线单测） |
| §4.4 成本护栏（unknown 确认/阈值/记账） | ✅ | confirmSpend + /api/pricing + spend.jsonl + run 内 spend 事件含 channel/model/estCny/jobId（耗时字段未记，**接受**） |
| §5 七段流水线 | ✅ | 段 5 一致性为提示词级（`referenceImage` 能力位未消费为图像输入——**低风险接受**，需要图像编辑类端点） |
| §5.1 异步 run + 断点续跑 | ✅ | 各段非 done 才执行；music 段支持 jobId 续查不重复计费；shot-urls/clips 事件流恢复 |
| §5.2 gate 三态 | ✅ | ask 以 gate-approval 信封 + gateApprovals 重调实现（未接宿主审批 API——**语义等价接受**） |
| §5.3 评审闭环 | ✅ | clamp/非法兜底/≤2 重拍/评分入库 |
| §6 存储安全红线 | ✅ | 0700/0600、脱敏、https、id 白名单、prune(50)、TS strict 零 any |
| §7.1 工具 output.schema | ⚠️ 形式符合 | 全部工具带 output.schema+render，但 schema 为 `{type:'object'}` 空壳——**接受**（DSH 契约只要求字段在位） |
| §7.2 HTTP 路由 + 围栏 | ✅ | DNS-rebind 防御 + 三层路径穿越防御 |
| §7.3 设置页 | ✅ | 已按 v2.0 §8 收敛为单 section（诊断/通道/槽/预算） |
| §8 测试 | ⚠️ | 324 用例全绿；**CI 已补**（GitHub Actions）；demo:mock 已入 CI |
| 🔎 真机挂账 | — | kling 契约钉板、openai-video 通用族、Windows SAPI、退避参数真机压测 |

## v2.0 漫剧工坊规格（2026-09-17）

| 条款 | 状态 | 说明 |
|---|---|---|
| §1 对象模型三铁律 / §3 存储 / §5 RPC / §6.1 工具 / §7 Proposal 细则 / §8 设置收敛 / §9 预设退役 | ✅ | 全部符合（含 512KiB 截断、20 提案上限、SHA-256 乐观并发、.broken 备份） |
| §2.1 侧边栏入口 | ✅ | order 110；会话跳转按 0.1.7 契约走 uiWorkspace.openSession（**有意偏差**，双世代兼容） |
| §2.3 项目卡片 | ✅ | 2026-10-04 补「最近成片」（latestRun 汇总）；时间为绝对时间非相对时间（接受） |
| §2.5 Agent 面板 | ✅ | 2026-10-04 补「成本/风险提示」（runStatus/runSpend 汇总）；「[暂停/继续]」拍板不做 |
| §2.6 阶段工作区 | ✅ | 已补：diff 逐条目高亮、角色头像/视觉资产标记、蓝图上一章事实自动带出（指令 grounding + 表单预填双通道）。不做（拍板）：角色版本历史、主线支线着色。「审稿与修订」并入章节子视图（规格 §2.5/§2.6 自相矛盾，取 §2.6） |
| §2.7 Proposal 交互 | ✅ | 2026-10-04 补「重新生成」入口（diff 视图 + stale 卡片，按 assetRef 推导同 kind 任务）；拒绝备注 Host 支持 UI 无输入（接受） |
| §2.8 异常态 | ✅ | 2026-10-04 补「[重试发送]」与「会话已中断可重发」；损坏文件页面警示未做（接受，store 层按缺失处理） |
| §6.2 会话桥 | ✅ | 预填草稿（有意偏差，v2.0.0 声明）+ 剪贴板兜底 |
| 🔎 | — | 无 |

## v2.1.0 通道槽规格（2026-09-28）

| 条款 | 状态 | 说明 |
|---|---|---|
| §2 数据模型 / §2.3 选型语义 | ✅ | 单绑定类型级约束、model-unavailable 确认前抛出零花费 |
| §3 协议绑定级声明 / 零 provider 分支 | ✅ | dashscope 模型名猜测已移除；静态断言扩面至 providers+pipeline 全量（剥注释扫描） |
| §4.1 通用映射 | ✅ | 形状与规格错位（statusPath 在 endpoint、新增 jobIdPath/statusValuePath）——**功能超集，规格文档以 README 速查为准**；durationPath 预留未消费（已声明） |
| §4.2 模板四约束 | ✅ | 2026-10-04 补删除 UI；内置模板纯数据有测试钉死 |
| §5 设置页三区 | ⚠️ | 「音乐按首计价项」未做（待拍板⑩）；通道「测试」未实测协议族（接受——协议族实测即槽位「测试」的职责） |
| §6.1 段与模式 | ✅ | target/rerunStage/能力通告均已含 music；MV 编排实际形态（storyboard 先行占位→music→重新提交 storyboard）已在 README 声明为既定流程 |
| §6.2 歌词 | ✅ | 2026-10-04 补 14 标签白名单 + 无歌词 bad-request（确认之前抛出零花费） |
| §6.3 BGM 默认策略 | ✅ | stream_loop 等效 aloop；音量 0.22；ducking/afade 有滤镜链断言 |
| §6.4 MV 对点三级网格 | ✅ | api > 本地 PCM 分析 > 均分，grid.source 如实；手工覆盖 = 改 score.json + 重推（README 已文档化） |
| §6.5 MV 时长契约 | ⚠️ 有意偏差 | 只裁不撑（README 声明）；撑帧延长/变速微调不做 |
| §7 迁移 | ✅ | 只认默认通道 models[]（有意收窄，release 声明）；幂等 + 备份 0600 |
| §8 删除清单 | ✅ | route()/picker/models[] 全部删净；lib 孤儿残留已清 + 哨兵防回流 |
| §9 三项顺带修复 | ✅ | confirmSpend / ledger.record / prune(50) 全部接线 |
| §13 音乐超时与取消 | ✅ | 2026-10-04：music 段 jobId 断点续跑（超时/中止不重复计费）+ pollUntil 全链 abort 感知（music/video 轮询即停）；轮询上限 480s 给工具窗口留头寸 |
| 🔎 真机挂账 | — | 真实音乐端点 sync/async 各钉一次契约 |

---

## 待拍板清单（❌ 缺失项 → 2026-10-04 需求方拍板后的处置）

| # | 项 | 处置 | 说明 |
|---|---|---|---|
| ① | 项目卡片「最近成片」 | ✅ 已做（同日） | list 汇总 latestRun（最近改编 run 代理），卡片展示 run 短 id + 状态 |
| ② | Agent 面板「成本/风险提示」 | ✅ 已做（同日） | get 的 adaptations 附 runStatus/runSpend（spend 事件汇总），面板显示花费 + 失败风险 chip |
| ③ | Agent 面板「[暂停/继续]」 | ❌ 不做 | 任务无 paused 态；宿主停用已有 run-interrupted 语义，重复建设 |
| ④ | 角色版本历史 | ❌ 不做 | Proposal 留痕已覆盖追溯诉求，文件级版本历史属锦上添花 |
| ⑤ | 角色/大纲 diff 逐条目高亮 | ✅ 已做（同日） | flattenRows 递归展开（数组按索引、对象逐字段），有单测钉死 |
| ⑥ | 大纲主线/支线着色 | ❌ 不做 | OutlineRow 无该字段，属数据模型变更，收益低 |
| ⑦ | 角色列表头像/视觉资产标记 | ✅ 已做（同日） | 字母头像 + hasVisualAsset 角标，详情表单可编辑 |
| ⑧ | 蓝图「上一章定稿事实自动带出」 | ✅ 已做（同日） | 双通道：generate-chapter-blueprint 指令携带上一章末段+连续性事实+承接指引（inputRefs 含上一章 final/blueprint）；页面打开蓝图表单时上一章 blueprint.newFacts 自动预填 factsFromPrev（字段为空才预填，保存才落盘） |
| ⑨ | 宿主重启「会话已中断，可继续」提示 | ✅ 已做（同日） | 运行中任务显示提示 + [重发指令]（指令随任务持久化，仅重发不重建任务） |
| ⑩ | 预算区「音乐按首计价项」 | ❌ 不做 | /api/pricing 通用按次路径已覆盖按首计价模型，专项 UI 冗余 |

## 挂账真机项（有环境时各半天）

kling 成功信封（`scripts/pin-kling-contract.ts` 已备）· openai-video `/v1/videos` 通用族 · 真实音乐端点 sync/async 契约 · Windows SAPI · 退避参数真机压测。

## 已接受的无意偏差备忘（不再当缺陷追踪）

工具 output.schema 空壳 · 段 5 一致性提示词级 · ask gate 走信封而非宿主审批 API · 记账缺耗时 · 退避参数 5s/30s · 拒绝备注无 UI · 卡片绝对时间 · music-skip 事件命名 · durationPath 预留 · vault 未知版本静默 sanitize（测试钉死的韧性决策）。
