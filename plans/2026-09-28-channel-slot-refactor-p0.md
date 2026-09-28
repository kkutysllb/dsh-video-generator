# 通道设置重构 P0 实施计划：vault v2 + 六用途槽

**Goal:** 把通道层从「通道 × 模型池（枚举导入 → 按 kind 取第一项）」重构为「用途槽：每槽恰好一个模型，用户自选并真实验证」，并把配置结构一次性迁移到 vault v2。设计依据 [2026-09-28 通道设置重构设计规格](../docs/superpowers/specs/2026-09-28-channel-slot-refactor-design.md)（下称"规格"）。

**Architecture:** 存储层 `VaultStore` 升级 v2（`channels` 去 `models[]`、新增 `slots` 单条绑定映射、`musicTemplates`）；选型层从 `selectConfiguredModel(channel, kind)` 改为 `requireSlotBinding(slots, slotId)`；适配器工厂从"按模型名猜协议"改为"按绑定声明的 protocol 构造"；RPC 面删 `channels.adoptModels/setDefault`、增 `slots.*` 与 `musicTemplates.*`；客户端设置页从"双 tab（工坊/通道管理 + picker）"改为"三区（通道 / 用途槽 / 预算与 gate）"并整段删除 picker。**本计划不实现音乐生成链路**（`music` 段、BGM 混音、MV 先曲后镜归 P1/P2），只落地音乐槽的**配置与映射结构**。

**Tech Stack:** TypeScript strict（`erasableSyntaxOnly`，Node 24 strip-types 直跑测试）、node:test、零运行时依赖、React（宿主注入，客户端 bundle 手写自注册）、ffmpeg（仅 P0 的音频分析留接口，不接线）。

---

## 对规格的显式取舍（记录在案）

1. **`model-catalog.ts` 整体退役**：它服务的是"按模型名推断 kind"的枚举导入范式。删除后，M0 附录 B.6 的"家族归档"回归用例（14 项断言）一并退役；"模型名 → 形态"启发式**只在迁移函数内保留一次**（用于给 `video` 槽勾 `textToVideo`）。
2. **`probe.ts` 保留但降级**：`/models` 探测只用于通道自检（连通性/鉴权），不再作为导入源；其返回的模型名**仅在槽位「测试」结果里展示一次**，不落库为清单。
3. **一次性迁移，不做双读**：旧版插件读 v2 明确报错（不静默错配）；备份文件支持人工回滚。
4. **`music` 段不在 P0**：P0 只保证"音乐槽能配置、能测试、能被解析"，`vgen_generate` 的 `target` 仍为 `assets|video|final`，`STAGES` 不变。

## 已知限制（写进 README，不在本计划内修）

- 工具 `exec.signal` 未转发（审计 B1）与 `vgen_generate` 单调用同步推进（B2）：归 P1（与音乐段耗时问题一并处理）。
- 页面侧 gate/confirm/rerunStage/评审评分入口缺失（审计 B3）：归 P3 或单独立项。
- 历史 Run 手动关联项目、`exports/` 打包：仍不做。

---

## 文件结构总览

**新增**

```
src/store/slots.ts             # SlotId/SlotBinding/SlotCapabilities 类型 + 解析与校验纯函数
src/store/migrate-vault.ts     # v1 → v2 迁移（含备份/幂等/启发式）
src/providers/protocols.ts     # ProtocolFamily → 适配器工厂映射（含未知协议校验）
src/providers/music-templates.ts  # 内置模板数据（按协议形态命名，无 provider 名/无凭证）
src/providers/generic-music.ts    # 声明式音乐适配器（映射解析 + sync/async 序列）
test/slots.test.ts
test/migrate-vault.test.ts
test/protocols.test.ts
test/music-mapping.test.ts
test/generic-music.test.ts
```

**修改**

```
src/store/vault.ts             # VaultData v2、Channel 去 models[]、slots/musicTemplates CRUD、形状守卫
src/model-selection.ts         # selectConfiguredModel → requireSlotBinding（+ model-unavailable 文案）
src/registry.ts                # providerForModel → providerForSlot（协议驱动）
src/host/routes.ts             # channels.* 瘦身；新增 slots.*/musicTemplates.*；settings.get 带槽位摘要
src/host/index.ts              # 无路由增删（沿用 /api 面），仅 PLUGIN_VERSION
src/tools/channels.ts          # action=list 输出槽位视图（health/spend 保留）
src/tools/generate.ts          # 取模型改走槽位
src/pipeline/machine.ts        # selectStageModel → requireSlotBinding
src/tools/review.ts            # 重拍取 video 槽
src/client/index.ts            # 类型参考同构（当前已漂移）
lib/client.js                  # 设置页三区重写；删除 PickerPanel/assemblePickerRowsPublic/inferKindByName/死键
package.json / README.md / release/*   # 版本与迁移说明
```

**删除**

```
src/model-catalog.ts           # 枚举导入范式的基础设施
src/picker/assemble.ts         # 双份实现（运行代码在 bundle 内，从未被引用）
test/model-catalog.test.ts
test/model-selection.test.ts   # 由 test/slots.test.ts 取代
test/picker-assemble.test.ts
```

---

## 执行约定

- 分支 `feat/channel-slot-refactor`；**Task 0 先把 2.0.2 工作树收口并发布**，避免两批改动混在同一工作树（当前工作树有 7 改 3 新增未提交）。
- 每个 Task 末尾 `npm run typecheck && npm test` 全绿后提交；ffmpeg 相关验证统一 `VGEN_FFMPEG=<含 drawtext 的完整构建>`。
- 客户端 `lib/client.js` 是**手写 bundle（非构建产物）**：改完须手动保持与 `src/client/index.ts` 同构，并由 `test/client-bundle.test.ts` 守护。
- 破坏性变更 → P0 完成后版本 **3.0.0**（2.0.2 先独立发布）。

---

## 任务清单

### Task 0：基线收口（无重构代码）

**Files:** 无代码改动；`git`、`npm`、镜像仓操作。

**Steps**

1. 提交当前 2.0.2 工作树（README / lib/client.js / package.json / release/README.md / src/client/index.ts / src/host/routes.ts / test/client-bundle.test.ts + 3 个新增文件），打 tag `v2.0.2`。
2. `npm pack --dry-run` 核对文件数与体积；`npm run sync:mirror` 后 `npm run sync:check` 零差异（当前镜像停在 2.0.1，实测报 7 项差异）。
3. 按 `release/README.md` 发版 checklist 走 npm publish 与 GitHub Release（用户人工触发）。
4. 完成 `~/.kcoder-dev/profiles/web` dev 实例装机实测（升级计划 §三 唯一的未勾选项：设置页 / 左侧栏面板 / 指令预填 / 打开会话）。
5. 建分支 `feat/channel-slot-refactor`。

**出口**：2.0.2 已发布且镜像一致；本计划的重构改动不与 2.0.2 混杂。

---

### Task 1：vault v2 数据结构与形状守卫

**Files:** 改 `src/store/vault.ts`；新增 `src/store/slots.ts`、`test/slots.test.ts`；改 `test/vault.test.ts`。

**Steps**

1. `src/store/slots.ts`：定义 `SlotId`（6 值）、`SLOT_IDS` 常量、`SlotCapabilities`（按规格 §2.2 的每槽能力位）、`SLOT_META`（槽位名 / 用途一句话 / 所属 kind / 是否必需 / 消费者），供 Host 与客户端共用**同一份**槽位元数据（避免再出现双份实现）。
2. `vault.ts`：`VaultData.version: 2`；`Channel` 移除 `models`，新增 `protocols/verifiedAt/verifyNote`；新增 `slots: Partial<Record<SlotId, SlotBinding>>` 与 `musicTemplates: MusicTemplate[]`；删 `defaultChannelId`。
3. 形状守卫 `sanitize()` 重写：未知 `SlotId` 丢弃；`SlotBinding` 缺必填字段整条丢弃；`protocol` 不在白名单整条丢弃；`music` 仅允许出现在 music 槽；`musicTemplates` 只接受 `source: 'builtin'|'user'`。
4. CRUD：`setSlotBinding(slot, binding)` / `clearSlotBinding(slot)` / `getSlot(slot)` / `listSlots()`；`createChannel` 不再收 `models`；`updateChannel` 只允许 `label/baseUrl/enabled/apiKey`（**移除 models 通道**）。
5. 出口脱敏保持不变：`apiKey` 仅回显 `maskCredential`；`listChannels` 不再带 models。
6. 模板 CRUD：`saveMusicTemplate()`（user）/`deleteMusicTemplate()`（拒删 builtin）/`listMusicTemplates()`（builtin + user）。

**测试点（`test/slots.test.ts` + `test/vault.test.ts`）**

- 6 槽写入/读取/清除；再次 `setSlotBinding` 覆盖而非追加（**单绑定约束**）；
- 非法 SlotId / 缺字段 / 非法 protocol / music 映射出现在非 music 槽 → 守卫丢弃；
- 旧 `vault.json`（含 `models[]`）在 v2 形状下不崩，未知字段丢弃；
- 出口断言：任何响应字符串不含明文 key；模板不含凭证；
- `test/client-bundle.test.ts` 的既有 locale/契约用例保持绿。

**出口**：vault v2 可读写，单绑定约束由类型与测试双重保证。

---

### Task 2：v1 → v2 迁移

**Files:** 新增 `src/store/migrate-vault.ts`、`test/migrate-vault.test.ts`；改 `src/store/vault.ts`（`open()` 时触发迁移）。

**Steps**

1. 实现规格 §7 的映射表（含 `video` 槽能力位启发式：模型名含 `t2v|text2video` → 勾 `textToVideo`，否则 `imageToVideo`）。
2. 备份：写 `vault.json.v1.bak-<ISO ts>`（0600，同目录），再原子替换主文件。
3. 幂等：已是 v2 / 无文件 → 直接返回，不产生新备份、不改内容。
4. 回滚路径：文档化"用备份覆盖 + 装回旧版插件"的步骤。
5. 迁移事件写一行 console 日志（含备份文件名），便于用户排查。

**测试点**

- 典型 v1（1 通道：image+video+tts 各一）→ 6 槽按规则填充，`music.*` 为空；
- 多通道 + `defaultChannelId` → 各槽 channelId 正确；
- 只有 image 没有 video → `video` 槽为空（不猜模型）；
- 幂等：连续迁移两次，第二次无副作用；
- 备份内容与 v1 原文逐字节一致；v1 损坏（非法 JSON）→ 走既有 `.broken-<ts>` 路径不炸；
- 迁移后 `listSlots()` 覆盖率 = 可迁移槽位数。

**出口**：存量用户升级零手工操作，且有可回滚备份。

---

### Task 3：选型层与协议适配器工厂

**Files:** 改 `src/model-selection.ts`、`src/registry.ts`；新增 `src/providers/protocols.ts`、`test/protocols.test.ts`；改 `src/pipeline/machine.ts`、`src/tools/generate.ts`、`src/tools/review.ts`。

**Steps**

1. `model-selection.ts`：`requireSlotBinding(slots, slotId)` → 命中返回 `{ channelId, model, protocol, capabilities }`；未命中抛 `model-unavailable`，消息含**槽位名 + 指引**（"请在设置页「用途槽」绑定"）。`image.shot` 未绑定时回落 `image.master`（唯一回落）。
2. `providers/protocols.ts`：`providerForSlot(channel, binding, opts)`，switch 六族协议；未知协议 → `bad-request`；**不得出现模型名判断**。
3. `machine.ts`：`selectStageModel(deps, kind, injected)` → 按 `image.master` / `image.shot` / `video` 取绑定；删除 `injected`（测试注入改走 `providersOverride`，已在用）。
4. `generate.ts` / `review.ts`：取模型改走槽位；确认与 spend 仍在 `confirmer` 通过之后（保持"未绑定不产生确认与 spend"语义）。
5. 更新能力校验：`video` 槽勾了 `textToVideo` 才允许无参考图路径；未勾 → 明确报错文案（替换现有"缺少 shot 参考图 URL"的模糊措辞）。

**测试点（`test/protocols.test.ts` + 改 `test/tools-generate.test.ts`/`test/machine.test.ts`）**

- 六族协议各构造一次并断言 `id/capabilities`；
- 未知协议 → `bad-request`；源码静态断言：`registry/protocols` 中不出现 provider 名（`kling`/`dashscope` 仅作为协议族标识符出现，不作为模型名分支）；
- 未绑定槽消费 → `model-unavailable`，且**断言无 `confirm-required`、`run.json` 无 `spend` 事件**；
- `image.shot` 未绑定 → 回落到 `image.master`（有断言）；
- `video` 未勾 `textToVideo` 且无参考图 → 报错文案含"未启用文生视频降级"。

**出口**：选型链路单槽单模型，无任何多候选语义。

---

### Task 4：RPC 与工具面改造

**Files:** 改 `src/host/routes.ts`、`src/tools/channels.ts`；改 `test/routes.test.ts`、`test/channels.test.ts`、`test/host-index.test.ts`。

**Steps**

1. 删除：`channels.adoptModels`；`channels.setDefault`；`channels.create/update` 的 `models` 字段与校验。
2. 新增：`slots.list` / `slots.get` / `slots.set` / `slots.clear` / `slots.test`（`slots.test` = 一次真实小额调用，按 slot 的 kind 选最小代价参数；结论写 `verifiedAt/verifyNote`）。
3. 新增：`musicTemplates.list` / `musicTemplates.save` / `musicTemplates.delete`。
4. `settings.get` 返回值增 `slots` 摘要（供设置页首屏）；`settings.update` 不变（阈值/gate）。
5. `vgen_channels`：`action=list` 输出**槽位视图**（每槽：channelId/label/model/protocol/能力位/verifiedAt），不再输出 models 列表；`health`（通道探测 + 估价）与 `spend` 保留。
6. `host/index.ts`：路由清单不变（`/api` 面承载新方法），仅 `PLUGIN_VERSION` 待 Task 9 处理。

**测试点**

- `slots.set` 缺必填 → `bad-request`；非法 slot 名 → `bad-request`；未知 channelId → `not-found`；
- `slots.clear` 幂等；
- `slots.test` 走注入的假 provider，断言发生**恰好一次**提交调用且写入 `verifiedAt`；
- 被删方法：`channels.adoptModels` / `channels.setDefault` 调用返回 `bad-request: unknown-method`（回归哨兵，防客户端残留调用）；
- `test/host-index.test.ts` 的路由/工具注册断言同步更新。

**出口**：Host 面只承认"槽位"这一种配置形态。

---

### Task 5：`generic-music` 适配器与模板数据（P0 范围）

**Files:** 新增 `src/providers/generic-music.ts`、`src/providers/music-templates.ts`、`test/music-mapping.test.ts`、`test/generic-music.test.ts`。

**Steps**

1. 映射解析：点号 + `[n]` 下标的最小路径求值器；`GenericMusicMapping` 形状校验（必填 4 项）。
2. `createGenericMusicProvider(channel, binding, fetchImpl)`：`submit/status/fetch` 三方法（`sync` 模式把 submit 结果直接视为 done）；async 走既有 `pollUntil`（超时=失败）；`urlIsSigned` → 立即下载；`audioIsBase64` → 解码落盘 0600。
3. 内置模板数据：**按协议形态**命名（如「同步 · 直返音频 URL」「异步 · 任务轮询 · base64」），不含 baseUrl/apiKey/模型名/provider 名。
4. 静态断言：模板数据与 `generic-music.ts` 中不出现 provider 名称。
5. P0 **不接线**到 `machine`（`music` 段归 P1），但适配器与映射须可被 `slots.test` 调用。

**测试点**

- 路径求值：`data.audio_url` / `data[0].url` / 缺失路径 → 明确错误；
- sync：一次提交即得音频；async：轮询到 done → 取音频；轮询超时 → 失败且**不记成功**；
- base64 与 URL 两种音频形态落盘一致（0600）；
- 未知/缺字段映射 → `bad-request`，错误信息包含缺哪个字段；
- 模板套用后表单字段与模板一致（纯数据断言）。

**出口**：音乐配置与映射可用、可测，且零 provider 绑定。

---

### Task 6：客户端设置页三区重写

**Files:** 改 `lib/client.js`（主体）、`src/client/index.ts`（同构参考）、`test/client-bundle.test.ts`。

**Steps**

1. 删除：`PickerPanel`、`assemblePickerRowsPublic`、`inferKindByName`、models 相关 locale 键与样式；修 `refreshStudio` 悬空引用与 15 个死键。
2. 区 1「通道」：列表 + 增删改 + 启用 + 「测试」（展示连通性/鉴权/实测协议族，**不做模型导入**）。
3. 区 2「用途槽」：6 行表单（槽位名 + 用途 + 通道下拉 + 模型输入 + 能力勾选 + 测试）；music 槽多一个「套用模板 ▾」与「另存为模板」；未绑定槽显示"该能力不可用"。
4. 区 3「预算与 Gate」：沿用现有实现（阈值/gate 缺省），文案更新。
5. 导航名与页面标题保持「漫剧工坊」一致；不新增第三方依赖。

**测试点（`test/client-bundle.test.ts`）**

- bundle 自注册与 `exports.apply/inject` 契约不变；
- 关键串存在：`slots.list`/`slots.set`/`slots.test`/`musicTemplates.save`、6 个槽位 id；
- **旧符号不存在**：`assemblePickerRowsPublic`、`inferKindByName`、`channels.adoptModels`、`channels.setDefault`（`doesNotMatch` 哨兵，防回流）；
- 首帧渲染冒烟（node 环境无 document 不炸）；
- zh/en 词典键齐备（新增槽位/模板键双语同步）。

**出口**：设置页只有"通道 / 用途槽 / 预算与 gate"，无任何枚举导入路径。

---

### Task 7：顺带修复三项（同文件改动，成本近零）

**Files:** 改 `src/tools/generate.ts`、`src/spend.ts`、`src/store/runs.ts`；改 `test/spend.test.ts`、`test/tools-generate.test.ts`、`test/runs.test.ts`。

**Steps**

1. 阈值生效：生产 `confirmer` 改为 `confirmSpend(est, vault.getBudget().confirmThresholdCny, …)` 语义（估价未知 → 一律确认；≤阈值 → 放行；超阈值 → 确认）。
2. 记账接线：每次 `submit` 成功后 `SpendLedger.record({channel, model, kind, estCny, jobId})`；`SpendLedger.open` 改用 `harnessHome()` 口径（与 vault/runs 一致，兼 QiLin）。
3. run 保留：run 创建时调用 `RunStore.prune(50)`。

**测试点**

- `confirmSpend` 边界：`null` → 确认；`est == threshold` → 放行；`est > threshold` → 确认；
- 端到端：mock 全链路跑一遍后 `vgen_channels spend` 的 `totals.count > 0` 且 `estCny > 0`；
- `prune` 在 51 个 run 后保留 50，最旧目录被删。

**出口**：规格 §9 三项失效修复，且与本次重构同批验证。

---

### Task 8：文档、版本与迁移说明

**Files:** 改 `package.json`（version 3.0.0）、`src/host/routes.ts`（`PLUGIN_VERSION`）、`README.md`、`release/v3.0.0.md`（新增）、`release/README.md`（索引）。

**Steps**

1. README：通道配置章节整段改写为"用途槽"；环境变量表删 `models[]`（它本就不是环境变量）与 `VGEN_VIDEO_MODEL`/`VGEN_TTS_MODEL` 等已无消费方的条目；增「v2 → v3 迁移」小节（备份文件位置 + 回滚步骤）。
2. `release/v3.0.0.md`：按发版约定的 7 章节，破坏性变更单列（配置结构 + 设置页 IA + 删除 picker/adoptModels/默认通道）。
3. `release/README.md` 版本索引补一行（标注待发布）。
4. 同步 `src/client/index.ts` 的类型参考注释（含 nav 文案「漫剧工坊」）。

**出口**：文档与实现一致（消除本轮审计发现的文档漂移项）。

---

### Task 9：回归与真机冒烟

**Files:** 无新增代码；验证记录写回本计划"自审"节。

**Steps**

1. 全量 `npm run typecheck && npm test`；`npm run build` 后 `git status lib/` 只应有手写的 `lib/client.js`。
2. 最小隔离 profile（独立 `$DSH_HOME`）真机 boot + curl round-trip：`/health`、`channels.*`、`slots.*`、`musicTemplates.*`、伪造 Host 403。
3. GUI 冒烟：设置页三区渲染、槽位保存生效、测试按钮真实调用、未绑定槽的降级文案。
4. 迁移真机验证：用一份真实 v1 `vault.json`（含多通道多模型）升级，核对 6 槽与备份文件。
5. 记录残留问题到"自审"。

**出口**：验收标准 1–7、12–14 全部有证据。

---

## 验收

- [ ] Task 0：2.0.2 已发布、镜像 `sync:check` 零差异、dev 实例装机实测通过
- [ ] 验收 1：6 槽可配置，结构层无法表达第二候选
- [ ] 验收 2：未绑定槽 → `model-unavailable`，无 `confirm-required`、无 `spend`
- [ ] 验收 3：每槽「测试」真实小额调用并写 `verifiedAt/verifyNote`
- [ ] 验收 4：源码与模板数据无 provider 条件分支（静态断言）
- [ ] 验收 5：模板可套用/另存/删除，内置模板无凭证
- [ ] 验收 6：v1 迁移正确、备份存在、幂等、可回滚
- [ ] 验收 7：破坏性变更入 release note 与 README，版本 3.0.0
- [ ] 验收 12：`npm run typecheck` + `npm test` 全绿
- [ ] 验收 13：bundle 哨兵断言旧 picker 符号不存在
- [ ] 验收 14：阈值生效；`vgen_channels spend` totals > 0
- [ ] 验收 8–11（BGM/MV/本地分析）：**归 P1/P2**，本计划不宣称达成

## 自审

> 执行完成后填写：实际改动与计划的偏离、未完成项、残留风险、下一步（P1 音乐段）输入。
