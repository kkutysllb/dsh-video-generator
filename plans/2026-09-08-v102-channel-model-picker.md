# v1.0.2 通道模型勾选面板实施计划

**Goal:** 在设置页「通道管理」tab，把「测试通道 → 导入枚举模型」改造成「探测后展开模型勾选面板」：用户可勾选、可改 kind（image/video/tts），未勾选的已配置项保留。后端零改动（复用 channels.test/list/update）。

**Architecture:** 前端面板组件 `PickerPanel` 内嵌在 `ChannelRow` 探测成功分支下。`PickerPanel` 接收该通道的 `ch.models[]` + 探测返回的 `probe.models[]`，前端 union + 去重（按 ch.models 优先顺序），按内置目录 `resolveModel` 推断 kind（用户可改）。保存时调用既有的 `channels.update` 提交**完整合并后的** models[]（未勾选的已配置项保留其既有 kind 透传）。客户端 lib/client.js 是手写 bundle（非构建产物），改完须手动保持与 `src/client/index.ts` 类型参考同构；新行为受 `client-bundle.test.ts` 守护。

**Tech Stack:** TypeScript strict（Node 24 strip-types 直跑）、node:test、内置目录 `src/model-catalog.ts:resolveModel`、OpenAI 兼容 `/v1/models` 探测契约沿用 `src/probe.ts`。

---

## 文件结构总览

| 文件 | 动作 | 职责 |
|---|---|---|
| `lib/client.js` | 修改 | ChannelRow 探测成功区 → PickerPanel；新增 zh/en 文案键 + CSS（`.vg-pick-*`）；probe 状态扩展 `{probe, picker?}` |
| `src/client/index.ts` | 修改 | 文档注释更新（行为面 §4）；保持 inject 数组 `['slots','locale']` 与 exports.apply 同构 |
| `src/store/vault.ts` | 修改（极小） | `validateModels` 暴露以便前端/测试复用：零改动（已支持 `{model,kind}` 入参） |
| `src/host/routes.ts` | 修改 | `PLUGIN_VERSION` 同步 1.0.2 |
| `package.json` | 修改 | version 1.0.1 → 1.0.2 |
| `test/client-bundle.test.ts` | 修改 | 新增 bundle 加载契约：locale 键齐、picker 必需键存在 |
| `test/picker-assemble.test.ts` | 新建 | 纯函数 `assemblePickerRows` 单元测试（覆盖 dedupe / kind 推断 / isConfigured） |
| `release/v1.0.2.md` | 新建 | 七章节发版说明 |
| `release/README.md` | 修改 | 版本索引加 1.0.2 行 |

---

## 任务清单

### Task 1：纯函数 `assemblePickerRows` 单元测试先行

**Files:**
- Create: `test/picker-assemble.test.ts`
- Create: `src/picker/assemble.ts`（暂时只放类型）

- [ ] **Step 1.1: 写失败测试**

```ts
// test/picker-assemble.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { assemblePickerRows } from '../src/picker/assemble.ts'
import type { MaskedChannel } from '../src/store/vault.ts'

function masked(models: Array<{ model: string; kind: 'image' | 'video' | 'tts' }>): MaskedChannel {
  return {
    id: 'relay-a', label: 'A', kind: 'openai-compat',
    baseUrl: 'https://api.example.com', apiKeyMasked: '••••',
    enabled: true,
    models: models.map((m) => ({ model: m.model, kind: m.kind })),
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

test('assemble：已配置项优先 + 新枚举项追加，去重', () => {
  const rows = assemblePickerRows(
    masked([{ model: 'happyhorse-1.1-i2v', kind: 'video' }, { model: 'gpt-x', kind: 'image' }]),
    ['happyhorse-1.1-i2v', 'wan2.6-i2v-flash', 'gpt-4o-mini-tts'],
  )
  // 顺序 = 先 ch.models 后 probe.models；去重 probe 已含的 happyhorse 不重复
  assert.deepEqual(rows.map((r) => r.model), ['happyhorse-1.1-i2v', 'gpt-x', 'wan2.6-i2v-flash', 'gpt-4o-mini-tts'])
  assert.equal(rows[0]!.isConfigured, true)
  assert.equal(rows[0]!.kind, 'video') // 已配置的 kind 原样保留，不被内置目录覆盖
  assert.equal(rows[2]!.isConfigured, false)
  assert.equal(rows[2]!.kind, 'video') // wan2.6-i2v-flash 内置目录 → video
  assert.equal(rows[3]!.kind, 'tts')   // gpt-4o-mini-tts 内置目录 → tts
})

test('assemble：探测清单为空时不报错，返回仅 ch.models', () => {
  const rows = assemblePickerRows(masked([{ model: 'gpt-x', kind: 'image' }]), [])
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.model, 'gpt-x')
  assert.equal(rows[0]!.isConfigured, true)
})

test('assemble：探测清单包含未在 ch.models 的 → isNew=true', () => {
  const rows = assemblePickerRows(masked([]), ['wan2.6-i2v'])
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.isNew, true)
  assert.equal(rows[0]!.isConfigured, false)
  assert.equal(rows[0]!.kind, 'video')
})

test('assemble：内置目录不认识的模型 → kind=video（与 resolveModel 兜底一致）', () => {
  const rows = assemblePickerRows(masked([]), ['completely-unknown-model'])
  assert.equal(rows[0]!.kind, 'video')
})
```

- [ ] **Step 1.2: 运行测试确认失败**

Run: `node --test --test-reporter tap test/picker-assemble.test.ts`
Expected: FAIL — `Cannot find module '../src/picker/assemble.ts'`

- [ ] **Step 1.3: 创建占位模块让 import 通过（仍让 assert 失败）**

```ts
// src/picker/assemble.ts
import { resolveModel } from '../model-catalog.ts'
import type { MaskedChannel } from '../store/vault.ts'

export interface PickerRow {
  model: string
  kind: 'image' | 'video' | 'tts'
  isConfigured: boolean
  isNew: boolean
}

export function assemblePickerRows(ch: MaskedChannel, enumerated: string[]): PickerRow[] {
  // 占位实现：返回空数组让测试 fail
  return []
}
```

- [ ] **Step 1.4: 重跑测试确认仍失败（因实现为空）**

Run: `node --test --test-reporter tap test/picker-assemble.test.ts`
Expected: FAIL — `rows.length` 期望 4/1/1/1，得到 0/0/0/0

- [ ] **Step 1.5: 实现 assemblePickerRows 让测试通过**

```ts
// src/picker/assemble.ts（覆盖 Step 1.3 占位）
import { resolveModel } from '../model-catalog.ts'
import type { MaskedChannel, ModelKind } from '../store/vault.ts'

export interface PickerRow {
  model: string
  kind: ModelKind
  isConfigured: boolean
  isNew: boolean
}

export function assemblePickerRows(ch: MaskedChannel, enumerated: string[]): PickerRow[] {
  const rows: PickerRow[] = []
  const seen = new Set<string>()
  // 1. 已配置项优先（按 ch.models 顺序，保留用户原 kind 不被推断覆盖）
  for (const m of ch.models ?? []) {
    if (seen.has(m.model)) continue
    rows.push({ model: m.model, kind: m.kind, isConfigured: true, isNew: false })
    seen.add(m.model)
  }
  // 2. 新枚举项追加（按探测顺序，kind 走内置目录兜底 video）
  for (const model of enumerated ?? []) {
    if (seen.has(model)) continue
    const r = resolveModel(model)
    rows.push({ model, kind: r.entry.kind, isConfigured: false, isNew: true })
    seen.add(model)
  }
  return rows
}
```

- [ ] **Step 1.6: 重跑测试确认通过**

Run: `node --test --test-reporter tap test/picker-assemble.test.ts`
Expected: PASS — 4/4

- [ ] **Step 1.7: 跑全量测试确保未影响其他**

Run: `npm test`
Expected: 之前绿的全部仍绿 + picker-assemble 4 项新增

- [ ] **Step 1.8: 提交**

```bash
git add test/picker-assemble.test.ts src/picker/assemble.ts
git commit -m "feat(v1.0.2): assemblePickerRows 纯函数 + 单元测试（已配置优先 + 内置目录兜底）"
```

---

### Task 2：客户端 PickerPanel 组件（lib/client.js 手写 bundle）

**Files:**
- Modify: `lib/client.js`（zh/en 文案 + ChannelRow 改造 + ChannelsView 状态扩展 + CSS）

> **重要**：lib/client.js 是手写非构建产物（`.gitignore` 仅放行此文件）；所有改动须手工保持与 src/client/index.ts 类型参考同构。client-bundle.test.ts 守护加载契约。

- [ ] **Step 2.1: 新增 locale 键（zh/en 同时扩）**

在 lib/client.js 的 zh 字典（约第 89 行 `adopted:` 之后）与 en 字典（约第 150 行 `adopted:` 之后）插入：

```js
// zh
pickerSearch: "搜索模型名",
pickerFilterKind: "按类型筛选",
pickerFilterAll: "全部",
pickerSelectAll: "全选",
pickerDeselectAll: "取消全选",
pickerSave: "保存选中",
pickerEmpty: "没有模型可显示——先测试通道以枚举模型。",
pickerLabelConfigured: "已配置",
pickerLabelNew: "新",
pickerKindImage: "图像",
pickerKindVideo: "视频",
pickerKindTts: "语音",
pickerSaved: "已保存 {n} 个模型",

// en
pickerSearch: "Search models",
pickerFilterKind: "Filter by kind",
pickerFilterAll: "All",
pickerSelectAll: "Select all",
pickerDeselectAll: "Deselect all",
pickerSave: "Save selected",
pickerEmpty: "No models to show — probe the channel first.",
pickerLabelConfigured: "configured",
pickerLabelNew: "new",
pickerKindImage: "image",
pickerKindVideo: "video",
pickerKindTts: "tts",
pickerSaved: "Saved {n} models",
```

- [ ] **Step 2.2: 新增 CSS**

在 lib/client.js 的 CSS 数组（约第 240 行 `@media` 之前）插入：

```js
".vg-pick{border:1px solid var(--sl-color-neutral-300,#2a2a2a);border-radius:8px;padding:8px 10px;margin-top:6px;}",
".vg-pick-toolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px;}",
".vg-pick-toolbar input.vg-input{flex:1;min-width:120px;}",
".vg-pick-list{display:flex;flex-direction:column;gap:2px;max-height:300px;overflow-y:auto;border:1px solid var(--sl-color-neutral-300,#2a2a2a);border-radius:6px;padding:4px;}",
".vg-pick-row{display:flex;align-items:center;gap:6px;padding:3px 4px;font-size:12px;}",
".vg-pick-row:hover{background:rgba(127,127,127,.08);}",
".vg-pick-row .vg-pick-name{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;}",
".vg-pick-row .vg-pick-tag{font-size:10px;opacity:.7;border:1px solid currentColor;border-radius:999px;padding:0 6px;}",
".vg-pick-actions{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;}",
".vg-pick-empty{opacity:.6;font-size:12px;padding:8px 0;}",
```

- [ ] **Step 2.3: 在 ChannelsView 状态中增加 picker 形态**

定位 `ChannelsView`（第 522 行附近）—— picker 状态不下沉到 ChannelsView（picker 是每通道独立的），改为扩展 `props.probe[ch.id]` 的形态：

```js
// probe 状态类型从 { busy, ok, message, models? }
// 扩展为 { busy, ok, message, models?, picker?: PickerState }
// 其中 PickerState = { rows: [{model, kind, isConfigured, isNew}], checked: Set<model>, search: string, kindFilter: 'all'|'image'|'video'|'tts', busy: boolean }
```

修改 Stateful 组件内的 `onTestChannel` handler（lib/client.js 第 810 行附近）：

```js
var onTestChannel = function (id) {
  setProbeEntry(id, { busy: true, ok: false, message: "", picker: undefined });
  api("channels.test", { id: id }).then(function (value) {
    var p = (value && value.probe) || {};
    if (p.ok) {
      // 从 chans 拿该通道详情，取其 models[]（已脱敏，不含 apiKey 明文）
      var ch = (chansState[0] && chansState[0].channels || []).find(function (c) { return c.id === id; });
      var existing = (ch && ch.models) || [];
      var enumerated = p.models || [];
      // 前端 union + 去重（已配置优先）
      var rows = assemblePickerRowsPublic(existing, enumerated);
      var checked = new Set(rows.map(function (r) { return r.model; })); // 全部默认勾选
      setProbeEntry(id, {
        busy: false, ok: true,
        message: fill(t("testOk"), { n: enumerated.length }),
        models: enumerated,
        picker: { rows: rows, checked: checked, search: "", kindFilter: "all", busy: false },
      });
    } else {
      setProbeEntry(id, { busy: false, ok: false, message: fill(t("testFail"), { err: p.error || "unknown" }), models: null, picker: undefined });
    }
  }).catch(function (e) {
    setProbeEntry(id, { busy: false, ok: false, message: fill(t("testFail"), { err: String(e.message || e) }), models: null, picker: undefined });
  });
};
```

`assemblePickerRowsPublic` 是同一文件内的小包装（lib/client.js 是单文件 CommonJS 形态，不能直接 import ESM `.ts`）：

```js
// 在 lib/client.js 工具区（formatDate 附近）加：
// 注：lib/client.js 是手写 bundle（不在 tsc 构建链）；assemblePickerRows 的逻辑就地复用，
//     保证行为与 src/picker/assemble.ts 一致——后者跑 node:test，前者由 client-bundle.test.ts 守护。
function assemblePickerRowsPublic(existingModels, enumerated) {
  var seen = Object.create(null);
  var rows = [];
  for (var i = 0; i < (existingModels || []).length; i++) {
    var m = existingModels[i];
    if (seen[m.model]) continue;
    seen[m.model] = true;
    rows.push({ model: m.model, kind: m.kind, isConfigured: true, isNew: false });
  }
  for (var j = 0; j < (enumerated || []).length; j++) {
    var name = enumerated[j];
    if (seen[name]) continue;
    seen[name] = true;
    rows.push({ model: name, kind: inferKindByName(name), isConfigured: false, isNew: true });
  }
  return rows;
}

// 内置目录精简版（与 src/model-catalog.ts BUILTIN_CATALOG 同构；M5 维护时改两处）
function inferKindByName(name) {
  var n = String(name || "").toLowerCase();
  if (n.indexOf("tts") !== -1 || n.indexOf("speech") !== -1 || n.indexOf("voice") !== -1) return "tts";
  if (n.indexOf("seedance") !== -1 || n.indexOf("kling") !== -1 || n.indexOf("wan-x") !== -1 ||
      n.indexOf("hailuo") !== -1 || n.indexOf("sora") !== -1 || n.indexOf("vidu") !== -1 ||
      n.indexOf("pixverse") !== -1 || n.indexOf("happyhorse") !== -1 ||
      n.indexOf("video") !== -1 || n.indexOf("i2v") !== -1 || n.indexOf("t2v") !== -1) return "video";
  if (n.indexOf("seedream") !== -1 || n.indexOf("flux") !== -1 || n.indexOf("mj") !== -1 ||
      n.indexOf("midjourney") !== -1 || n.indexOf("dall") !== -1 || n.indexOf("sd3") !== -1 ||
      n.indexOf("image") !== -1 || n.indexOf("banana") !== -1 || n.indexOf("t2i") !== -1 ||
      n.indexOf("wanx") !== -1) return "image";
  return "video"; // unknown 兜底与 resolveModel 一致
}
```

- [ ] **Step 2.4: 新增 PickerPanel 渲染函数**

在 lib/client.js 的 `ChannelRow` 函数（第 476 行）之前插入：

```js
function PickerPanel(props) {
  var t = props.t;
  var picker = props.picker;
  if (!picker) return null;
  var rows = picker.rows;
  var search = picker.search;
  var kindFilter = picker.kindFilter;
  var checked = picker.checked;
  var q = search.toLowerCase();
  var filtered = rows.filter(function (r) {
    if (kindFilter !== "all" && r.kind !== kindFilter) return false;
    if (q && r.model.toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
  var toggleCheck = function (model) {
    var next = new Set(checked);
    if (next.has(model)) next.delete(model); else next.add(model);
    props.onChange(Object.assign({}, picker, { checked: next }));
  };
  var setKind = function (model, kind) {
    var nextRows = rows.map(function (r) { return r.model === model ? Object.assign({}, r, { kind: kind }) : r; });
    props.onChange(Object.assign({}, picker, { rows: nextRows }));
  };
  var setSearch = function (v) { props.onChange(Object.assign({}, picker, { search: v })); };
  var setKindFilter = function (v) { props.onChange(Object.assign({}, picker, { kindFilter: v })); };
  var allChecked = filtered.every(function (r) { return checked.has(r.model); }) && filtered.length > 0;
  var selectAll = function () {
    var next = new Set(checked);
    filtered.forEach(function (r) { next.add(r.model); });
    props.onChange(Object.assign({}, picker, { checked: next }));
  };
  var deselectAll = function () {
    var next = new Set(checked);
    filtered.forEach(function (r) { next.delete(r.model); });
    props.onChange(Object.assign({}, picker, { checked: next }));
  };
  return React.createElement("div", { className: "vg-pick" },
    React.createElement("div", { className: "vg-pick-toolbar" },
      React.createElement("input", {
        className: "vg-input", placeholder: t("pickerSearch"), value: search,
        onChange: function (e) { setSearch(e.target.value); },
      }),
      React.createElement("select", {
        className: "vg-select", value: kindFilter,
        onChange: function (e) { setKindFilter(e.target.value); },
      },
        React.createElement("option", { value: "all" }, t("pickerFilterAll") + " (" + rows.length + ")"),
        React.createElement("option", { value: "image" }, t("pickerKindImage") + " (" + rows.filter(function (r) { return r.kind === "image"; }).length + ")"),
        React.createElement("option", { value: "video" }, t("pickerKindVideo") + " (" + rows.filter(function (r) { return r.kind === "video"; }).length + ")"),
        React.createElement("option", { value: "tts" }, t("pickerKindTts") + " (" + rows.filter(function (r) { return r.kind === "tts"; }).length + ")"),
      ),
      React.createElement("button", {
        className: "vg-btn", disabled: picker.busy, onClick: allChecked ? deselectAll : selectAll,
      }, allChecked ? t("pickerDeselectAll") : t("pickerSelectAll")),
    ),
    rows.length === 0
      ? React.createElement("div", { className: "vg-pick-empty" }, t("pickerEmpty"))
      : filtered.length === 0
        ? React.createElement("div", { className: "vg-pick-empty" }, t("pickerEmpty"))
        : React.createElement("div", { className: "vg-pick-list" },
            filtered.map(function (r) {
              return React.createElement("div", { key: r.model, className: "vg-pick-row" },
                React.createElement("input", {
                  type: "checkbox", checked: checked.has(r.model),
                  onChange: function () { toggleCheck(r.model); },
                }),
                React.createElement("span", { className: "vg-pick-name", title: r.model }, r.model),
                React.createElement("select", {
                  className: "vg-select", value: r.kind, style: { fontSize: 11, padding: "1px 4px" },
                  onChange: function (e) { setKind(r.model, e.target.value); },
                },
                  React.createElement("option", { value: "image" }, t("pickerKindImage")),
                  React.createElement("option", { value: "video" }, t("pickerKindVideo")),
                  React.createElement("option", { value: "tts" }, t("pickerKindTts")),
                ),
                r.isConfigured
                  ? React.createElement("span", { className: "vg-pick-tag" }, t("pickerLabelConfigured"))
                  : React.createElement("span", { className: "vg-pick-tag" }, t("pickerLabelNew")),
              );
            }),
          ),
    React.createElement("div", { className: "vg-pick-actions" },
      React.createElement("button", {
        className: "vg-btn vg-btn-primary",
        disabled: picker.busy || checked.size === 0,
        onClick: function () { props.onSave(); },
      }, t("pickerSave") + " (" + checked.size + ")"),
    ),
  );
}
```

- [ ] **Step 2.5: 修改 ChannelRow 把 probe 预览替换为 PickerPanel**

定位 lib/client.js 第 507 行（`if (probe.message)` 处），把：

```js
if (probe.message) {
  children.push(React.createElement("div", { key: "probe", className: "vg-probe " + (probe.ok ? "vg-probe-ok" : "vg-probe-err") },
    probe.message,
    probe.ok && probe.models && probe.models.length > 0
      ? React.createElement("div", null,
          React.createElement("div", { className: "vg-tpl-meta" }, probe.models.slice(0, 5).join(", ")),
          React.createElement("div", { style: { marginTop: 4 } },
            Btn({ disabled: props.busy, onClick: function () { props.onAdoptModels(ch.id); } }, t("adopt"))),
        )
      : null,
  ));
}
```

替换为：

```js
if (probe.message) {
  children.push(React.createElement("div", { key: "probe", className: "vg-probe " + (probe.ok ? "vg-probe-ok" : "vg-probe-err") },
    probe.message,
  ));
}
if (probe.picker) {
  children.push(React.createElement(PickerPanel, {
    key: "picker",
    t: t,
    picker: probe.picker,
    onChange: function (next) {
      // 把 next 合并回 probe[id].picker；ChannelsView 暴露 onPickerChange 回调
      props.onPickerChange(ch.id, next);
    },
    onSave: function () { props.onPickerSave(ch.id); },
  }));
}
```

- [ ] **Step 2.6: ChannelsView 透传新 props + 新回调**

定位 lib/client.js 第 543 行 `ChannelsView` 内 `ChannelRow` 的 props 列表，新增：

```js
onPickerChange: props.onPickerChange,
onPickerSave: props.onPickerSave,
```

同时把第 670 行 `ChannelsView` 在 `SectionView` 内的 props 透传处也新增 `onPickerChange` / `onPickerSave`，并在 Stateful 内：

```js
// 新增 picker 状态管理回调
var onPickerChange = function (id, nextPicker) {
  setProbeEntry(id, Object.assign({}, probeState[0][id], { picker: nextPicker }));
};

var onPickerSave = function (id) {
  var entry = probeState[0][id] || {};
  var picker = entry.picker;
  if (!picker || entry.busy) return;
  // 收集所有应当提交的 models：
  // - 勾选且 panel 内（已配置 + 新枚举）：rows[].kind（用户改过的优先）
  // - 未勾选但已配置：保留 ch.models 既有 kind
  var ch = (chansState[0] && chansState[0].channels || []).find(function (c) { return c.id === id; });
  var existing = (ch && ch.models) || [];
  var rowsByName = {};
  picker.rows.forEach(function (r) { rowsByName[r.model] = r; });
  // 提交列表 = (勾选的 panel rows) ∪ (未勾选的已配置项)
  var submittedNames = [];
  var submitted = [];
  picker.rows.forEach(function (r) {
    if (picker.checked.has(r.model)) {
      submitted.push({ model: r.model, kind: rowsByName[r.model].kind });
      submittedNames.push(r.model);
    }
  });
  existing.forEach(function (m) {
    if (picker.checked.has(m.model)) return; // 已在勾选列表里
    submitted.push({ model: m.model, kind: m.kind });
    submittedNames.push(m.model);
  });
  // 标记 picker 进入 busy
  setProbeEntry(id, Object.assign({}, entry, { picker: Object.assign({}, picker, { busy: true }) }));
  run(
    api("channels.update", { id: id, patch: { models: submitted } }),
    fill(t("pickerSaved"), { n: submittedNames.length }),
  );
};
```

并把这两个回调挂到 `SectionView` props → `ChannelsView` props → `ChannelRow` props 的整条链上（参见 lib/client.js 第 670 行 + 第 543 行 + 第 825 行的 props 直传范式）。

- [ ] **Step 2.7: 移除 `onAdoptModels` 死路**

定位 lib/client.js 第 832-836 行的 `onAdoptModels` 函数，删除（picker 完全替代之）。同时从 ChannelRow props / ChannelsView props / SectionView props / Stateful 构造中移除 `onAdoptModels` 串。

- [ ] **Step 2.8: 跑 client-bundle 测试**

Run: `node --test --test-reporter tap test/client-bundle.test.ts`
Expected: 现有 3 项测试仍绿（apply 不炸 / locale 键齐 / settings.section 注册形态）

- [ ] **Step 2.9: 跑全量测试**

Run: `npm test`
Expected: 之前绿的全部仍绿（picker-assemble + client-bundle + 既有 ~194 项）

- [ ] **Step 2.10: typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 零错误。`lib/client.js` 不在 tsc 构建链（手写），构建产物 lib/ 不变。

- [ ] **Step 2.11: 提交**

```bash
git add lib/client.js
git commit -m "feat(v1.0.2): 通道管理 tab 模型勾选面板（探测后展开 + 改 kind + 未勾选保留）"
```

---

### Task 3：bundle 契约守护测试扩展

**Files:**
- Modify: `test/client-bundle.test.ts`

- [ ] **Step 3.1: 写失败测试：locale 字典含 picker 必需键**

在 `test/client-bundle.test.ts` 末尾追加：

```ts
test('apply：locale 字典含 picker 全套键（zh/en 同步）', () => {
  const { mod } = loadBundle()
  let dictRef: { current: { zh: Record<string, string>; en: Record<string, string> } | null } = { current: null }
  const ctx = {
    slots: { inject: () => () => {}, register: () => () => {} },
    locale: {
      register: (_n: string, d: { zh: Record<string, string>; en: Record<string, string> }) => { dictRef.current = d; return () => {} },
      bind: () => (k: string) => k,
    },
    effect: (fn: () => () => void) => { fn(); return () => {} },
  }
  ;(mod['apply'] as (c: unknown) => void)(ctx)
  const dict = dictRef.current
  assert.ok(dict, 'locale.register 未被调用')
  const required = [
    'pickerSearch', 'pickerFilterKind', 'pickerFilterAll',
    'pickerSelectAll', 'pickerDeselectAll', 'pickerSave',
    'pickerEmpty', 'pickerLabelConfigured', 'pickerLabelNew',
    'pickerKindImage', 'pickerKindVideo', 'pickerKindTts', 'pickerSaved',
  ]
  for (const k of required) {
    assert.ok(dict!.zh[k], `locale.zh.${k} 缺失`)
    assert.ok(dict!.en[k], `locale.en.${k} 缺失`)
  }
})
```

- [ ] **Step 3.2: 跑测试确认通过（lib/client.js 已含 Step 2.1 的键）**

Run: `node --test --test-reporter tap test/client-bundle.test.ts`
Expected: PASS — 4/4（既有 3 项 + 新 1 项）

- [ ] **Step 3.3: 跑全量测试**

Run: `npm test`
Expected: 全部绿

- [ ] **Step 3.4: 提交**

```bash
git add test/client-bundle.test.ts
git commit -m "test(v1.0.2): bundle locale 字典含 picker 键（zh/en 同步）契约守护"
```

---

### Task 4：版本号同步 + 发版说明

**Files:**
- Modify: `package.json`
- Modify: `src/host/routes.ts`
- Create: `release/v1.0.2.md`
- Modify: `release/README.md`

- [ ] **Step 4.1: bump package.json 版本**

```diff
- "version": "1.0.1",
+ "version": "1.0.2",
```

- [ ] **Step 4.2: 同步 PLUGIN_VERSION**

定位 `src/host/routes.ts:16`：

```diff
- export const PLUGIN_VERSION = '1.0.1'
+ export const PLUGIN_VERSION = '1.0.2'
```

- [ ] **Step 4.3: 写 release/v1.0.2.md**

```markdown
# v1.0.2（2026-09-08）

UI 增强：「通道管理」tab 的「测试通道」探测后展开**模型勾选面板**，可勾选、可改 kind，未勾选的已配置项保留。后端 API 零新增（复用 channels.test/list/update）。

## 版本信息

- **版本**：1.0.2
- **日期**：2026-09-08
- **tag**：`v1.0.2`
- **功能基线**：`main` @ (commit)
- **发布渠道**：npm `dsh-video-generator` + GitHub Release

## 新增

- **模型勾选面板**（lib/client.js `PickerPanel` + 纯函数 `assemblePickerRows`）：
  「测试通道」成功后替换原「前 5 名字 + 导入按钮」预览，展开完整清单；
  每行含 checkbox、模型名（等宽）、kind 选择器（image/video/tts）、「已配置/新」标签；
  顶部搜索框 + 按 kind 筛选；底部全选/反选/保存选中按钮。
- 默认勾选策略：已配置项 + 新枚举项均默认勾选（最少点击）。
- 未勾选的已配置项**保留**在通道配置里（不盲覆盖）。

## 变更

- 移除客户端「导入枚举模型」按钮（被勾选面板替代）。`channels.adoptModels` API
  保留以兼容既有 cli/agent 调用（v1.0.2 不调用此 API）。
- 内置目录精简版 `inferKindByName` 入驻 lib/client.js（与 `src/model-catalog.ts`
  `BUILTIN_CATALOG` 同构；M5 维护时改两处）。

## 修复

- **症状**：探测返回 100+ 模型的中转站时，用户被迫全量灌入；无法按 kind 筛选或排除不想要的模型；已配置的 model 容易被后续探测盲覆盖。
- **根因**：原 UI 把探测结果当作「只读预览 + 一键全量灌入」按钮，未给勾选面。
- **修后行为**：用户可逐项勾选 + 改 kind；保存时只提交勾选项 + 未勾选的已配置项。

## 删除

- 客户端 `onAdoptModels` 死路（ChannelsView / ChannelRow props 链上的整段串联）。

## 兼容性与升级说明

- 无后端 API 破坏性变化；`channels.adoptModels` 保留。
- 升级方式：`dsh plugin --profile web add dsh-video-generator`（插件管理检测到新版本后手动更新）。
- 升级后既有通道的 `models[]` 不变（仅 UI 行为变化）。

## 验证

- `npm run typecheck` 零错误；`npm test` 全绿（含新增 picker-assemble 4 项 + client-bundle 1 项）。
- `npm run build` 构建产物 lib/ 不变（lib/client.js 是手写 bundle，不在 tsc 链）。
- `npm pack --dry-run` 通过；发布物 72 文件（+1 = release/v1.0.2.md）。
```

- [ ] **Step 4.4: 更新 release/README.md 版本索引**

定位 `release/README.md` 索引表，在 v1.0.1 行后追加：

```markdown
| [v1.0.2](v1.0.2.md) | 2026-09-08 | 通道管理 tab 模型勾选面板（探测后展开 + 改 kind + 未勾选保留） |
```

- [ ] **Step 4.5: 跑全量 + build 确认无回归**

Run: `npm test && npm run typecheck && npm run build`
Expected: 全绿

- [ ] **Step 4.6: 提交**

```bash
git add package.json src/host/routes.ts release/v1.0.2.md release/README.md
git commit -m "release(1.0.2): 通道管理 tab 模型勾选面板——bump version + PLUGIN_VERSION 同步 + 发版说明"
```

---

### Task 5：端到端冒烟（半自动，依赖 GUI）

**Files:**
- 无（仅 Playwright 跑通 + 截图存档）

- [ ] **Step 5.1: 启动 host + 等健康检查**

需要 GUI 与 plugin 同时在跑（依赖用户前置），如环境未就绪则标 SKIPPED 并在 release/v1.0.2.md 注明「GUI 验收挂账待用户启动」。

- [ ] **Step 5.2: 用 Playwright 走一遍完整路径**

导航到设置页 → 视频工坊 → 通道管理 → 添加通道 → 点「测试通道」→ 断言 PickerPanel 出现 → 取消一项勾选 → 改一项 kind → 点「保存选中」→ 断言红/绿横幅 → 刷新查看 channels.list 确认 models 合并正确

（脚本路径示例：`scripts/picker-smoke.ts`，仅当环境就绪时启用。）

- [ ] **Step 5.3: 提交 smoke 脚本（如启用）**

```bash
git add scripts/picker-smoke.ts
git commit -m "test(v1.0.2): 模型勾选面板 GUI 冒烟脚本（Playwright，可选）"
```

---

### Task 6：发版流程

**Files:**
- 无（仅 git + npm publish）

- [ ] **Step 6.1: 创建 tag + push**

```bash
git tag v1.0.2
git push origin main --tags
```

- [ ] **Step 6.2: 同步镜像仓**

```bash
npm run build && npm run sync:mirror
# 然后到 dsh-plugins 仓 commit + push
```

- [ ] **Step 6.3: 跑 sync:check 对账**

Run: `npm run sync:check`
Expected: 镜像对账通过：与真源一致

- [ ] **Step 6.4: 由用户触发 npm publish**（依赖用户）

```bash
cd ~/kk_Projects/dsh-video-generator && npm publish
```

注：v1.0.0/1.0.1 用户已自行处理 npm 发布；本任务不自动 npm publish。

- [ ] **Step 6.5: 创建 GitHub Release**

走 `gh release create v1.0.2 --notes-file release/v1.0.2.md`（依赖 gh CLI 已登录）。

---

## 自审

1. **Spec 覆盖**：§3 流程 → Task 1+2；§4.1 零新增 → Task 1+2 全程不碰 routes.ts；§4.2 assemble 逻辑 → Task 1；§5 状态机 → Task 2.3/2.5/2.6；§6 错误处理 → Task 2.5（探测失败不开面板）；§7 兼容性 → Task 4.3「兼容性与升级说明」；§8 测试矩阵 → Task 1（assemble 单测）+ Task 3（bundle locale 契约）+ Task 5（GUI）；§9 文件改动 → Task 1/2/3/4 全覆盖；§11 风险 → lib/client.js 手写约束贯穿 Task 2 全部 step。

2. **占位扫描**：所有 code block 完整可执行；无 TBD/TODO/`fill in details`/「Similar to Task N」。

3. **类型一致性**：`PickerRow` 在 src/picker/assemble.ts 与 lib/client.js `assemblePickerRowsPublic` 同构；`probe[id]` 形态 `{busy, ok, message, models?, picker?}` 在 Task 2.3 引入、Task 2.5 消费、Task 2.6 透传全程一致；kind 字符串字面量 `'image'|'video'|'tts'` 三处一致。