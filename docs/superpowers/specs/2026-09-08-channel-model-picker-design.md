# 通道管理：模型勾选面板（v1.0.2）

**状态**：设计稿（待用户最终复核后启动实现）
**作者**：dsh-video-generator 控制器
**日期**：2026-09-08

## 1. 背景

「通道管理」tab 当前工作流是「测试通道 → 导入枚举模型」两步骤，**用户无法选择性导入**：

1. 用户配三要素后，通道行的「测试通道」按钮探测 `/v1/models`；
2. 探测成功后只显示「枚举到 N 个模型」+前 5 个名字，再点「导入枚举模型」即**全量灌入** `models[]`；
3. 没有勾选界面，已配置的模型可能因后续探测导入被盲覆盖（已有保护：`resolveModel` 在 `unknown` 时不覆盖），但用户完全无法感知每个 model 的归属 kind（image/video/tts）。

用户诉求：探测后弹出**模型勾选面板**，用户**勾选 + 校正 kind** 后保存。已配置项未勾选则保留。

## 2. 设计目标

- **选择可见**：探测后展示完整枚举清单，每行可勾选
- **kind 可改**：内置目录推断仅为默认值，每行可改 image/video/tts
- **保存安全**：未勾选的已配置项保留；不会盲覆盖
- **大体量可用**：500+ 模型的中转站也要能管理

## 3. UX 流程（已与用户确认）

1. 用户在通道行点「测试通道」→ 探测 `/v1/models`
2. 探测成功（probe.ok === true）→ 在通道行下方**就地展开**「模型清单」面板（替换现有「前 5 名字 + 导入按钮」预览）
3. 面板顶部一行过滤栏：
   - 名称搜索框（按子串匹配）
   - kind 筛选（all / image / video / tts，按内置目录推断的 kind 分组）
4. 模型行（每行三元素）：`[checkbox] 模型名（等宽） [kind select: image/video/tts] [标签：已配置/新]`
   - 「已配置」= 当前通道 `models[]` 已含此 model（带 ✓），默认勾选
   - 「新」= 探测新出现的，默认勾选
5. 面板底部：「全选」/「取消全选」/「保存选中」三个按钮
6. 「保存选中」→ 调用 `channels.update { id, patch: { models: [{model, kind}] } }`，提交的 `models[]` 为：
   - 用户勾选且 kind 已选的全部项（合并去重，按选中顺序排序）
   - 未勾选的已配置项保留在通道配置里（前端从 `chans.list` 中已配置项 union 到提交列表）

## 4. 数据契约

### 4.1 后端：复用既有 API，零新增

- `channels.list` 返回 `channels[i].models[]`，含 `{model, kind, endpointProfile?, pricingCny?, qualityTier?}` —— 已脱敏
- `channels.test` 返回 `{probe: {ok, models: string[], status, error?}}` —— **不新增字段**
- `channels.update { id, patch: { models: [{model, kind}] } }` —— 验证逻辑（`validateModels`）保持不变

**决定**：面板前端组装「已配置 + 新枚举」并去重，靠内置目录 `resolveModel` 推断每个 model 的 kind（用户可改）。

### 4.2 前端组装逻辑

```ts
// 输入：ch（MaskedChannel，从 chans.list 拿）+ probeResult.models[]
// 输出：面板行数组 [{model, kind, isConfigured, isNew}]

function assembleRows(ch: MaskedChannel, enumerated: string[]) {
  const existing = new Map(ch.models.map((m) => [m.model, m.kind]))
  const seen = new Set<string>()
  const rows = []
  // 1. 已配置项（按 channels.list 顺序）
  for (const [model, kind] of existing) {
    if (seen.has(model)) continue
    rows.push({ model, kind, isConfigured: true, isNew: false })
    seen.add(model)
  }
  // 2. 新枚举项（按探测顺序，保留内置目录推断）
  for (const model of enumerated) {
    if (seen.has(model)) continue
    rows.push({ model, kind: resolveModel(model).entry.kind, isConfigured: false, isNew: true })
    seen.add(model)
  }
  return rows
}
```

提交时：勾选 + 已配置未勾选 union，但实际选则仅勾选 + 用户改过 kind 的项（不在面板修改的已配置项保持原 kind，避免破坏既有用法）。

## 5. 状态机

```
ChannelRow {
  probe: { busy, ok, message, models? }
  picker: { rows, search, kindFilter, checked: Set<model> }
}
```

- 探测开始 → probe.busy=true，清空 picker（防误用上次结果）
- 探测失败 → 不开 picker，保留旧「枚举失败」提示
- 探测成功 → 初始化 picker（rows + 默认 checked = 所有），展开面板
- 用户改 kind → 仅更新本地 rows[i].kind，不联动其它
- 用户点保存 → 取 checked ∩ rows，组装成 `[{model, kind}]` 提交

## 6. 错误处理

- 探测失败（probe.ok === false）→ 现有「探测失败：{err}」提示保留，**不展开面板**
- 探测成功但 models 为空（不可能，probe 已保 no-models）→ 探测层已返回 error='no-models'，同失败处理
- 保存失败（apiKey 失效、bad-request）→ 红横幅，picker 状态保留（用户可调整后重试）

## 7. 兼容性

- 既有 `channels.adoptModels` API（一次性全量灌入）保留以兼容老版 cli/agent 调用
- 客户端 `import 枚举模型` 按钮删除（被新流程替代）
- 客户端 `测试通道` 按钮保留，探测行为不变

## 8. 测试矩阵

| 测试 | 期望 |
|---|---|
| 探测成功展开面板：默认勾选所有行 | rows 全部 checked；既有 kind 保留 |
| 用户取消一项勾选 → 保存 | channels.update 不含该项；channels.list 仍含该项 |
| 用户改某项 kind → 保存 | channels.update 含新 kind |
| 探测失败 → 不开面板 | probe.message 显示但不展开 |
| 500 模型 + 名称搜索「wan」 | 过滤生效，kind 筛选同步过滤 |
| 保存中途网络失败 → 红横幅 + picker 保留 | 用户可调整重试 |

## 9. 文件改动

| 文件 | 改动 |
|---|---|
| `lib/client.js` | 替换 ChannelRow 的 probe 预览区为 PickerPanel；扩展 `ChannelsView` 状态；新增 locale 键 `pickerFilterKind`、`pickerSearch`、`pickerSave`、`pickerSelectAll`、`pickerDeselectAll`、`pickerLabelConfigured`、`pickerLabelNew`、`pickerEmpty`；新增 CSS（`.vg-pick-*`） |
| `src/client/index.ts` | 同步增删函数签名（reference only） |
| `test/client-bundle.test.ts` | 新增面板契约测试：apply 不炸、locale 键齐；面板逻辑独立单元测试 |
| `release/v1.0.2.md` | 新增发版说明（UI 增强，无破坏性） |
| `release/README.md` | 版本索引加 1.0.2 行 |
| `package.json` | bump version 1.0.1 → 1.0.2 |
| `src/host/routes.ts` | `PLUGIN_VERSION` 同步 1.0.2 |

## 10. 不在范围内

- 多通道批量配置
- 模型定价预估面板（已有 channels.health 提供，但不在此 UI 改造内）
- 一键「全部置为 video/image」等批量操作

## 11. 风险

- 客户端 lib/client.js 是手写非构建产物（`.gitignore` 例外）；改动需手工测试 bundle 加载契约（client-bundle.test.ts 守护）
- `picker` 状态每个 channel 独立 → 当前 probe 状态是 `{[channelId]: probe}` 形态，需同步扩展为 `{[channelId]: { probe, picker }}`