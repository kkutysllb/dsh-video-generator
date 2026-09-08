/**
 * DSH Web GUI Client Extension for dsh-video-generator.
 *
 * BUILD NOTE: dsh 的 client 模块加载器要求特定 bundle 形态。本文件是
 * HAND-MAINTAINED（不由 tsc 生成）：必须经
 * `window.__ModuleLoader__.load({ id, factory })` 自注册、经 `exports.apply`
 * 暴露扩展并 `return module.exports`；裸 ESM `export` 不会注册，触发：
 *   "bundle .../client.js loaded without registering \"dsh-video-generator\" via __ModuleLoader__.load"
 * 类型参考（与产出物手工保持同构）见 src/client/index.ts。
 *
 * 设置页「视频工坊」双 tab：
 * - 工坊：run 列表 → 详情（阶段徽章/gate/评审档案/产物预览/花费），3s 轮询仅在
 *   本 tab 可见（document.visibilityState === 'visible'）时运转；
 * - 通道管理：通道 CRUD（apiKey 脱敏回显）/默认/启用/测试探测/枚举模型一键导入/
 *   预算阈值/gate 缺省。
 * 数据面走 /dsh-video-generator/api/<method>（POST JSON，{ok,value}/{ok,error} 信封），
 * 与 host 侧 routes.ts 一一对应（runs.list / runs.get / channels 系列 / settings 系列）；
 * 双语文案走 ctx.locale（命名空间 videoGen）。
 *
 * inject 声明（exports.inject）是 cordis 服务名；package.json →
 * dsh.client.inject 声明对应 runtime 包，两处缺一即抛
 * "cannot get property ... without inject"。
 */
window.__ModuleLoader__.load({
	id: "dsh-video-generator",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");

		var NS = "videoGen";
		var API = "/dsh-video-generator/api";
		var MEDIA = "/dsh-video-generator/media";
		var STAGES = ["story", "script", "storyboard", "master-asset", "shot-assets", "video", "final-cut"];
		var MEDIA_STAGES = ["master-asset", "shot-assets", "video", "final-cut"];

		/* ── 双语文案（zh / en，键集完整一致）────────────────── */

		var zh = {
			nav: "视频工坊",
			title: "视频工坊",
			tabStudio: "工坊",
			tabChannels: "通道管理",
			intro: "短视频/AI 短剧/漫剧生成管线：run 进度与产物预览、模型通道三要素自配置（官方/中转皆可）。",
			runs: "生成任务",
			runsEmpty: "还没有 run。在对话里让 Agent 走 vgen_story → vgen_script → vgen_storyboard → vgen_generate 三段交接即可开工。",
			refresh: "刷新",
			detail: "详情",
			back: "返回列表",
			stageTable: "阶段状态",
			gate: "gate",
			reviews: "评审",
			reviewNone: "未评审",
			reviewPassed: "通过",
			reviewRetries: "重拍 {n} 次",
			artifacts: "产物",
			assetsGroup: "角色/场景",
			shotsGroup: "分镜参考图",
			clipsGroup: "镜头片段",
			reviewGroup: "评审帧",
			finalGroup: "成片",
			spend: "预估花费 ¥{n}（{c} 笔）",
			statusRunning: "进行中",
			statusDone: "完成",
			statusFailed: "失败",
			statePending: "待执行",
			stateRunning: "执行中",
			stateDone: "完成",
			stateFailed: "失败",
			channels: "模型通道",
			channelsIntro: "三要素 = Base URL / API Key / Model。Base URL 填站点根（如 https://api.example.com），支持 OpenAI 兼容官方端点与中转站；Key 只存本机 vault（0600），任何界面/响应仅回显脱敏串。",
			chEmpty: "还没有通道：先添加一个。",
			addChannel: "添加通道",
			chId: "通道 ID",
			chIdPlaceholder: "小写字母/数字/短横线，如 relay-main",
			chLabel: "名称",
			chBaseUrl: "Base URL（站点根）",
			chApiKey: "API Key",
			chCreate: "添加",
			defaultBadge: "默认",
			setDefault: "设为默认",
			enable: "启用",
			test: "测试通道",
			testing: "探测中…",
			testOk: "探测成功：枚举到 {n} 个模型",
			testFail: "探测失败：{err}",
			adopt: "导入枚举模型",
			adopted: "已导入 {n} 个模型（kind 按内置目录推断）",
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
			deleteCh: "删除",
			deleteConfirm: "确定删除通道「{name}」？此操作不可撤销。",
			budget: "预算与 gate",
			budgetHint: "单笔估价超过阈值将要求会话内确认；unknown 价一律确认。gate 缺省作用于新 run（run 内可被 vgen_generate gates 参数覆盖）。",
			threshold: "确认阈值（CNY）",
			gateDefaults: "gate 缺省（媒体段）",
			save: "保存",
			saved: "已保存",
			loading: "加载中…",
			watermarkNote: "提示：happyhorse 等免费档视频模型可能带平台水印，介意请在通道管理中改用付费模型。",
		};

		var en = {
			nav: "Video Studio",
			title: "Video Studio",
			tabStudio: "Studio",
			tabChannels: "Channels",
			intro: "Short-video / AI drama / comic-drama pipeline: run progress with artifact previews, plus self-configured model channels (official or relay).",
			runs: "Runs",
			runsEmpty: "No runs yet. Ask the Agent in chat to walk the vgen_story → vgen_script → vgen_storyboard → vgen_generate handoffs to get started.",
			refresh: "Refresh",
			detail: "Details",
			back: "Back to list",
			stageTable: "Stage status",
			gate: "gate",
			reviews: "Review",
			reviewNone: "Not reviewed",
			reviewPassed: "Passed",
			reviewRetries: "{n} retakes",
			artifacts: "Artifacts",
			assetsGroup: "Characters / Scenes",
			shotsGroup: "Storyboard refs",
			clipsGroup: "Shot clips",
			reviewGroup: "Review frames",
			finalGroup: "Final cut",
			spend: "Estimated spend ¥{n} ({c} entries)",
			statusRunning: "Running",
			statusDone: "Done",
			statusFailed: "Failed",
			statePending: "Pending",
			stateRunning: "Running",
			stateDone: "Done",
			stateFailed: "Failed",
			channels: "Model channels",
			channelsIntro: "The trio = Base URL / API Key / Model. Base URL takes the site root (e.g. https://api.example.com); both OpenAI-compatible official endpoints and relays work. Keys are stored only in the local vault (0600); every UI/response shows a masked string only.",
			chEmpty: "No channels yet: add one first.",
			addChannel: "Add channel",
			chId: "Channel ID",
			chIdPlaceholder: "lowercase letters/digits/dashes, e.g. relay-main",
			chLabel: "Name",
			chBaseUrl: "Base URL (site root)",
			chApiKey: "API Key",
			chCreate: "Add",
			defaultBadge: "default",
			setDefault: "Set default",
			enable: "Enabled",
			test: "Test channel",
			testing: "Probing…",
			testOk: "Probe OK: {n} models enumerated",
			testFail: "Probe failed: {err}",
			adopt: "Import enumerated models",
			adopted: "Imported {n} models (kind inferred from built-in catalog)",
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
			deleteCh: "Delete",
			deleteConfirm: "Delete channel \"{name}\"? This cannot be undone.",
			budget: "Budget & gates",
			budgetHint: "Single-call estimates above the threshold require in-session confirmation; unknown prices always confirm. Gate defaults apply to new runs (overridable per run via the vgen_generate gates parameter).",
			threshold: "Confirm threshold (CNY)",
			gateDefaults: "Gate defaults (media stages)",
			save: "Save",
			saved: "Saved",
			loading: "Loading…",
			watermarkNote: "Note: free-tier video models such as happyhorse may carry a platform watermark; switch to a paid model here if you mind.",
		};

		/** 极简插值："重拍 {n} 次" → fill(tpl, { n: x }) */
		function fill(template, params) {
			return String(template).replace(/\{(\w+)\}/g, function (m, key) {
				return params && Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : m;
			});
		}

		/* ── host API（POST JSON，{ok,value}/{ok,error} 信封）── */

		function api(method, body) {
			return fetch(API + "/" + method, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body || {}),
			}).then(function (response) {
				return response.text().then(function (text) {
					var data;
					try { data = text ? JSON.parse(text) : {}; }
					catch (e) { throw new Error("bad JSON (" + response.status + ")"); }
					if (data && data.ok) return data.value;
					throw new Error(String((data && data.error && data.error.message) || ("HTTP " + response.status)));
				});
			});
		}

		/* ── 样式（一次性注入，vg- 前缀避免冲突）──────────────── */

		// 设置页导航字形：Lucide「clapperboard」（场记板），经 currentColor
		// mask 跟随导航 hover/active 配色，维持壳层 16px 图标节奏。
		var NAV_MARKER = "data-dsh-video-generator-settings-nav";
		var NAV_ICON_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z'/%3E%3Cpath d='m6.2 5.3 3.1 3.9'/%3E%3Cpath d='m12.4 3.4 3.1 4'/%3E%3Cpath d='M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'/%3E%3C/svg%3E";

		var CSS = [
			".vg-root{display:flex;flex-direction:column;gap:20px;max-width:760px;color:inherit;font-size:13px;line-height:1.5;}",
			".vg-intro{opacity:.72;margin:0;}",
			".vg-card{border:1px solid var(--sl-color-neutral-300,#333);border-radius:10px;padding:14px 16px;}",
			".vg-card h3{margin:0 0 4px;font-size:14px;}",
			".vg-hint{opacity:.6;margin:0 0 10px;font-size:12px;}",
			".vg-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}",
			// 列表行（run 行 / 通道行共用）：分隔线 + 名称/元信息排版（样例 sp-tpl* 同构移植）
			".vg-tpl{padding:10px 0;border-top:1px solid var(--sl-color-neutral-300,#2a2a2a);}",
			".vg-tpl:first-of-type{border-top:none;}",
			".vg-tpl-name{font-weight:600;}",
			".vg-tpl-desc{opacity:.7;font-size:12px;margin-top:2px;}",
			".vg-tpl-meta{opacity:.5;font-size:11px;display:flex;gap:12px;flex-wrap:wrap;}",
			".vg-badge{background:#2f6f4f;color:#fff;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:600;}",
			".vg-badge-running{background:#3b5fd9;}",
			".vg-badge-failed{background:#e5484d;}",
			".vg-actions{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;}",
			".vg-btn{border:1px solid var(--sl-color-neutral-400,#555);background:transparent;color:inherit;border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer;}",
			".vg-btn:hover{border-color:var(--sl-color-primary-500,#7aa2f7);color:var(--sl-color-primary-500,#7aa2f7);}",
			".vg-btn[disabled]{opacity:.45;cursor:not-allowed;}",
			".vg-btn-primary{background:var(--sl-color-primary-600,#3b5fd9);border-color:var(--sl-color-primary-600,#3b5fd9);color:#fff;}",
			".vg-btn-primary:hover{color:#fff;}",
			".vg-btn-danger:hover{border-color:#e5484d;color:#e5484d;}",
			".vg-field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px;}",
			".vg-field label{font-size:12px;opacity:.75;}",
			".vg-input,.vg-select,.vg-textarea{border:1px solid var(--sl-color-neutral-400,#555);border-radius:6px;background:transparent;color:inherit;padding:5px 8px;font-size:13px;}",
			".vg-textarea{resize:vertical;min-height:56px;font-family:inherit;}",
			".vg-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;}",
			".vg-msg{border-radius:6px;padding:6px 10px;font-size:12px;}",
			".vg-msg-ok{background:rgba(63,167,106,.15);color:#3fa76a;}",
			".vg-msg-err{background:rgba(229,72,77,.15);color:#e5484d;}",
			// 双 tab 条 + 阶段 chips（四态色复用徽章色板）
			".vg-tabs{display:flex;gap:8px;margin:8px 0 4px;}",
			".vg-tab{border:1px solid var(--sl-color-neutral-400,#555);background:transparent;color:inherit;border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer;}",
			".vg-tab-active{border-color:var(--sl-color-primary-500,#7aa2f7);color:var(--sl-color-primary-500,#7aa2f7);font-weight:600;}",
			".vg-stage-chips{display:flex;gap:4px;flex-wrap:wrap;}",
			".vg-chip{border-radius:999px;padding:1px 8px;font-size:11px;}",
			".vg-chip-pending{background:var(--sl-color-neutral-300,#555);color:inherit;opacity:.75;}",
			".vg-chip-running{background:#3b5fd9;color:#fff;}",
			".vg-chip-done{background:#2f6f4f;color:#fff;}",
			".vg-chip-failed{background:#e5484d;color:#fff;}",
			// 产物预览网格：图片缩略 / 视频内联播放
			".vg-preview-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;}",
			".vg-preview-grid img{width:100%;border-radius:6px;}",
			".vg-preview-grid video{width:100%;border-radius:6px;background:#000;}",
			".vg-probe{font-size:12px;margin-top:6px;}",
			".vg-probe-ok{color:#3fa76a;}",
			".vg-probe-err{color:#e5484d;}",
			// 模型勾选面板（PickerPanel）：紧贴探测成功行下方，搜索 + 筛选 + 行 checkbox + kind 选择器 + 保存按钮
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
			"@media (max-width:640px){.vg-grid{grid-template-columns:1fr;}}",
			// 设置页导航图标替换：DSH 0.1.x 的 settings.section 契约只投影
			// id/order/label，壳层对外部分区一律渲染通用齿轮。这里只对本插件
			// 被标记的行生效：隐藏齿轮 SVG，用 ::before mask 画场记板字形。
			"[" + NAV_MARKER + "] > svg:first-child{display:none;}",
			"[" + NAV_MARKER + "]::before{content:'';flex:none;width:16px;height:16px;background:currentColor;"
				+ "-webkit-mask:url(\"" + NAV_ICON_SVG + "\") center / contain no-repeat;"
				+ "mask:url(\"" + NAV_ICON_SVG + "\") center / contain no-repeat;}",
		].join("\n");

		function ensureStyles() {
			if (typeof document === "undefined") return;
			if (document.getElementById("dsh-video-generator-styles")) return;
			var style = document.createElement("style");
			style.id = "dsh-video-generator-styles";
			style.textContent = CSS;
			document.head.appendChild(style);
		}

		/* ── 设置页导航图标：给本插件的导航行打标记 ────────────
		 * 宿主 0.1.x 不支持分区级 icon，挂载后按本地化文案「视频工坊」
		 * 找到自己的导航按钮并打 NAV_MARKER，配合 CSS 把齿轮换成场记板字形。
		 * MutationObserver 跟随语言切换/弹窗重开；disposer 清除全部标记，
		 * HMR 与插件停用时无残留。环境缺 DOM/Observer 时返回空 disposer。 */
		function registerSettingsNavIcon(label) {
			if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
				return function () {};
			}
			var disposed = false;
			function sync() {
				if (disposed) return;
				var current = "";
				try { current = String(label() || "").trim(); } catch (e) { current = ""; }
				var buttons = document.querySelectorAll('[role="dialog"] nav button');
				for (var i = 0; i < buttons.length; i++) {
					var button = buttons[i];
					var text = (button.textContent || "").trim();
					if (current.length > 0 && text === current) button.setAttribute(NAV_MARKER, "");
					else button.removeAttribute(NAV_MARKER);
				}
			}
			sync();
			var observer = new MutationObserver(sync);
			observer.observe(document.body, { childList: true, subtree: true, characterData: true });
			return function () {
				disposed = true;
				observer.disconnect();
				var marked = document.querySelectorAll("[" + NAV_MARKER + "]");
				for (var i = 0; i < marked.length; i++) marked[i].removeAttribute(NAV_MARKER);
			};
		}

		/* ── 工具 ───────────────────────────────────────────── */

		function formatDate(iso) {
			try { return new Date(iso).toLocaleString(); } catch (e) { return String(iso || ""); }
		}

		/** run-<毫秒>-<hex> → 剥前缀后前 8 位短 id（毫秒时间戳前缀，展示去重足够） */
		function shortId(id) {
			return String(id || "").replace(/^run-/, "").slice(0, 8);
		}

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

		var STATE_KEY = { pending: "statePending", running: "stateRunning", done: "stateDone", failed: "stateFailed" };
		var STATUS_KEY = { running: "statusRunning", done: "statusDone", failed: "statusFailed" };

		function Btn(props, text) {
			var className = "vg-btn" + (props.primary ? " vg-btn-primary" : "") + (props.danger ? " vg-btn-danger" : "");
			return React.createElement("button", {
				className: className,
				disabled: !!props.disabled,
				onClick: props.onClick,
			}, text);
		}

		/* ── 工坊视图：run 列表 / 详情 ──────────────────────── */

		function StageChips(props) {
			var t = props.t;
			var stages = props.record.stages || {};
			return React.createElement("div", { className: "vg-stage-chips" },
				STAGES.map(function (stage) {
					return React.createElement("span", {
						key: stage,
						className: "vg-chip vg-chip-" + (stages[stage] || "pending"),
						title: stage,
					}, stage);
				})
			);
		}

		function StudioView(props) {
			var t = props.t;
			// 详情态
			if (props.selected) {
				var detail = props.detail;
				if (!detail) {
					return React.createElement("div", { className: "vg-card" }, t("loading"));
				}
				var record = detail.record || {};
				var artifacts = detail.artifacts || {};
				var spend = detail.spend || { entries: 0, estCny: 0 };
				var reviews = record.reviews || {};
				var reviewKeys = Object.keys(reviews).sort();
				var mediaUrl = function (rel) { return MEDIA + "/" + record.id + "/" + rel; };

				var stageRows = STAGES.map(function (stage) {
					var state = (record.stages || {})[stage] || "pending";
					var cells = [
						React.createElement("td", { key: "name", style: { padding: "3px 8px" } }, stage),
						React.createElement("td", { key: "state", style: { padding: "3px 8px" } },
							React.createElement("span", { className: "vg-chip vg-chip-" + state }, t(STATE_KEY[state] || "statePending"))),
						React.createElement("td", { key: "gate", style: { padding: "3px 8px" } },
							String((record.gates && record.gates[stage]) || "auto")),
					];
					if (stage === "shot-assets") {
						cells.push(React.createElement("td", { key: "review", style: { padding: "3px 8px" } },
							reviewKeys.length === 0
								? React.createElement("span", { className: "vg-hint" }, t("reviewNone"))
								: reviewKeys.map(function (key) {
									var entry = reviews[key] || {};
									return React.createElement("span", {
										key: key,
										className: "vg-chip " + (entry.passed ? "vg-chip-done" : "vg-chip-failed"),
										style: { marginRight: 4 },
									}, key + ": " + (entry.passed ? t("reviewPassed") : t("reviewRetries", { n: entry.retries || 0 })));
								})
						));
					}
					return React.createElement("tr", { key: stage }, cells);
				});

				var previewGroups = [];
				var pushImages = function (key, label, files) {
					if (!files || files.length === 0) return;
					previewGroups.push(React.createElement("div", { key: key },
						React.createElement("h4", { style: { margin: "8px 0 4px", fontSize: 12 } }, label),
						React.createElement("div", { className: "vg-preview-grid" },
							files.map(function (file) {
								return React.createElement("img", {
									key: file.rel, src: mediaUrl(file.rel), alt: file.name,
									loading: "lazy", title: file.name,
								});
							})
						),
					));
				};
				pushImages("assets", t("assetsGroup"), artifacts.assets);
				pushImages("shots", t("shotsGroup"), artifacts.shots);
				pushImages("review", t("reviewGroup"), artifacts.review);
				var videos = (artifacts.clips || []).slice();
				if (artifacts.final && artifacts.final.mp4) videos.push(artifacts.final.mp4);
				if (videos.length > 0) {
					previewGroups.push(React.createElement("div", { key: "clips" },
						React.createElement("h4", { style: { margin: "8px 0 4px", fontSize: 12 } }, t("clipsGroup")),
						React.createElement("div", { className: "vg-preview-grid" },
							videos.map(function (file) {
								return React.createElement("video", {
									key: file.rel, src: mediaUrl(file.rel),
									controls: true, preload: "none", title: file.name,
								});
							})
						),
					));
				}
				if (artifacts.final && artifacts.final.srt) {
					previewGroups.push(React.createElement("div", { key: "final" },
						React.createElement("h4", { style: { margin: "8px 0 4px", fontSize: 12 } }, t("finalGroup")),
						React.createElement("a", { href: mediaUrl(artifacts.final.srt.rel), download: artifacts.final.srt.name },
							artifacts.final.srt.name),
					));
				}

				return React.createElement("div", null,
					React.createElement("div", { className: "vg-row" },
						Btn({ onClick: props.onBack }, t("back")),
						React.createElement("span", { className: "vg-tpl-meta" }, "#" + shortId(record.id)),
						React.createElement("span", {
							className: "vg-badge" + (record.status === "running" ? " vg-badge-running" : record.status === "failed" ? " vg-badge-failed" : ""),
						}, t(STATUS_KEY[record.status] || "statusRunning")),
					),
					React.createElement("div", { className: "vg-card", style: { marginTop: 8 } },
						React.createElement("h3", null, t("stageTable")),
						React.createElement("table", { style: { borderCollapse: "collapse", fontSize: 12 } },
							React.createElement("thead", null,
								React.createElement("tr", null,
									React.createElement("th", { style: { padding: "3px 8px", textAlign: "left" } }, t("stageTable")),
									React.createElement("th", { style: { padding: "3px 8px", textAlign: "left" } }, ""),
									React.createElement("th", { style: { padding: "3px 8px", textAlign: "left" } }, t("gate")),
									React.createElement("th", { style: { padding: "3px 8px", textAlign: "left" } }, t("reviews")),
								)
							),
							React.createElement("tbody", null, stageRows),
						),
					),
					React.createElement("div", { className: "vg-card", style: { marginTop: 8 } },
						React.createElement("div", { className: "vg-row", style: { marginBottom: 6 } },
							React.createElement("h3", { style: { margin: 0 } }, t("artifacts")),
							React.createElement("div", { style: { flex: 1 } }),
							React.createElement("span", { className: "vg-tpl-meta" },
								fill(t("spend"), { n: spend.estCny, c: spend.entries })),
						),
						previewGroups.length > 0 ? previewGroups : null,
					),
				);
			}
			// 列表态
			var runs = (props.runs && props.runs.runs) || [];
			if (runs.length === 0) {
				return React.createElement("p", { className: "vg-hint" }, t("runsEmpty"));
			}
			return React.createElement("div", null, runs.map(function (record) {
				return React.createElement("div", { key: record.id, className: "vg-card", style: { marginBottom: 8 } },
					React.createElement("div", { className: "vg-row" },
						React.createElement("span", { className: "vg-tpl-name" }, record.title || "untitled"),
						React.createElement("span", { className: "vg-tpl-meta" }, "#" + shortId(record.id)),
						React.createElement("span", {
							className: "vg-badge" + (record.status === "running" ? " vg-badge-running" : record.status === "failed" ? " vg-badge-failed" : ""),
						}, t(STATUS_KEY[record.status] || "statusRunning")),
						React.createElement("div", { style: { flex: 1 } }),
						Btn({ onClick: function () { props.onSelectRun(record.id); } }, t("detail")),
					),
					React.createElement("div", { className: "vg-row", style: { marginTop: 6 } },
						React.createElement(StageChips, { t: t, record: record }),
						React.createElement("div", { style: { flex: 1 } }),
						React.createElement("span", { className: "vg-tpl-meta" }, formatDate(record.updatedAt)),
					),
				);
			}));
		}

		/* ── 通道管理视图：通道行 / 添加通道 / 预算与 gate ──── */

		/**
		 * 模型勾选面板（PickerPanel）：紧贴 ChannelRow 探测成功行下方。
		 * 数据形态：picker = { rows: [{model, kind, isConfigured, isNew}], checked: Set<model>, search, kindFilter, busy }
		 * 交互：搜索 / 按 kind 筛选 / 行内 checkbox / 行内 kind 选择器 / 全选反选 / 保存选中。
		 * 所有变更走 onChange（合并回 probe[id].picker）；保存走 onSave（ChannelRow → ChannelsView → Stateful）。
		 */
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

		function ChannelRow(props) {
			var t = props.t;
			var ch = props.ch;
			var isDefault = ch.id === props.defaultChannelId;
			var probe = props.probe || {};
			var children = [
				React.createElement("div", { key: "head", className: "vg-row" },
					React.createElement("span", { className: "vg-tpl-name" }, ch.label || ch.id),
					React.createElement("span", { className: "vg-tpl-meta" }, ch.id),
					isDefault ? React.createElement("span", { className: "vg-badge" }, t("defaultBadge")) : null,
					React.createElement("div", { style: { flex: 1 } }),
					React.createElement("label", { className: "vg-row", style: { gap: 4, fontSize: 12 } },
						React.createElement("input", {
							type: "checkbox", checked: !!ch.enabled,
							onChange: function (e) { props.onToggleEnabled(ch.id, e.target.checked); },
						}),
						t("enable"),
					),
				),
				React.createElement("div", { key: "meta", className: "vg-tpl-meta" },
					React.createElement("span", null, ch.baseUrl),
					React.createElement("span", null, ch.apiKeyMasked),
					React.createElement("span", null, String((ch.models || []).length) + " models"),
				),
				React.createElement("div", { key: "acts", className: "vg-actions" },
					!isDefault ? Btn({ disabled: props.busy, onClick: function () { props.onSetDefault(ch.id); } }, t("setDefault")) : null,
					Btn({ disabled: props.busy || !!probe.busy, onClick: function () { props.onTestChannel(ch.id); } },
						probe.busy ? t("testing") : t("test")),
					Btn({ danger: true, disabled: props.busy, onClick: function () { props.onDeleteChannel(ch); } }, t("deleteCh")),
				),
			];
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
			return React.createElement("div", { className: "vg-tpl", style: { padding: "10px 0", borderTop: "1px solid var(--sl-color-neutral-300,#2a2a2a)" } }, children);
		}

		function ChannelsView(props) {
			var t = props.t;
			var data = props.chans || { channels: [], defaultChannelId: null };
			var channels = data.channels || [];
			var budgetDraft = props.budgetDraft;
			var form = props.form;
			var gateValue = function (stage) { return (budgetDraft.gates || {})[stage] || "auto"; };
			var setGate = function (stage, value) {
				var gates = Object.assign({}, budgetDraft.gates);
				gates[stage] = value;
				props.setBudgetDraft({ threshold: budgetDraft.threshold, gates: gates });
			};
			return React.createElement("div", null,
				React.createElement("div", { className: "vg-card" },
					React.createElement("div", { className: "vg-row", style: { marginBottom: 6 } },
						React.createElement("h3", { style: { margin: 0 } }, t("channels")),
					),
					React.createElement("p", { className: "vg-hint" }, t("channelsIntro")),
					channels.length === 0
						? React.createElement("p", { className: "vg-hint" }, t("chEmpty"))
						: channels.map(function (ch) {
							return React.createElement(ChannelRow, {
								key: ch.id, t: t, ch: ch, busy: props.busy,
								defaultChannelId: data.defaultChannelId,
								probe: props.probe[ch.id],
								onToggleEnabled: props.onToggleEnabled,
								onSetDefault: props.onSetDefault,
								onTestChannel: props.onTestChannel,
								onPickerChange: props.onPickerChange,
								onPickerSave: props.onPickerSave,
								onDeleteChannel: props.onDeleteChannel,
							});
						}),
				),
				React.createElement("form", {
					className: "vg-card",
					onSubmit: function (e) { e.preventDefault(); props.onCreateChannel(); },
				},
					React.createElement("h3", null, t("addChannel")),
					React.createElement("div", { className: "vg-grid" },
						React.createElement("div", { className: "vg-field" },
							React.createElement("label", null, t("chId")),
							React.createElement("input", {
								className: "vg-input", placeholder: t("chIdPlaceholder"),
								value: form.id,
								onChange: function (e) { props.setForm({ id: e.target.value, label: form.label, baseUrl: form.baseUrl, apiKey: form.apiKey }); },
							}),
						),
						React.createElement("div", { className: "vg-field" },
							React.createElement("label", null, t("chLabel")),
							React.createElement("input", {
								className: "vg-input",
								value: form.label,
								onChange: function (e) { props.setForm({ id: form.id, label: e.target.value, baseUrl: form.baseUrl, apiKey: form.apiKey }); },
							}),
						),
						React.createElement("div", { className: "vg-field" },
							React.createElement("label", null, t("chBaseUrl")),
							React.createElement("input", {
								className: "vg-input", type: "url", placeholder: "https://api.example.com",
								value: form.baseUrl,
								onChange: function (e) { props.setForm({ id: form.id, label: form.label, baseUrl: e.target.value, apiKey: form.apiKey }); },
							}),
						),
						React.createElement("div", { className: "vg-field" },
							React.createElement("label", null, t("chApiKey")),
							React.createElement("input", {
								className: "vg-input", type: "password", autoComplete: "off",
								value: form.apiKey,
								onChange: function (e) { props.setForm({ id: form.id, label: form.label, baseUrl: form.baseUrl, apiKey: e.target.value }); },
							}),
						),
					),
					React.createElement("div", { className: "vg-actions" },
						Btn({ primary: true, disabled: props.busy, onClick: props.onCreateChannel }, t("chCreate")),
					),
					React.createElement("p", { className: "vg-hint", style: { marginTop: 8, marginBottom: 0 } }, t("watermarkNote")),
				),
				React.createElement("form", {
					className: "vg-card",
					onSubmit: function (e) { e.preventDefault(); props.onSaveBudget(); },
				},
					React.createElement("h3", null, t("budget")),
					React.createElement("p", { className: "vg-hint" }, t("budgetHint")),
					React.createElement("div", { className: "vg-field" },
						React.createElement("label", null, t("threshold")),
						React.createElement("input", {
							className: "vg-input", type: "number", min: 0, step: "0.01",
							value: budgetDraft.threshold,
							onChange: function (e) {
								props.setBudgetDraft({ threshold: e.target.value === "" ? "" : Number(e.target.value), gates: budgetDraft.gates }); // 留空=""，保存时跳过该项，不落 Number("")=0
							},
						}),
					),
					React.createElement("div", { className: "vg-field" },
						React.createElement("label", null, t("gateDefaults")),
						React.createElement("div", { className: "vg-grid" },
							MEDIA_STAGES.map(function (stage) {
								return React.createElement("div", { key: stage, className: "vg-row", style: { gap: 6 } },
									React.createElement("span", { style: { fontSize: 12, opacity: 0.75 } }, stage),
									React.createElement("select", {
										className: "vg-select", value: gateValue(stage),
										onChange: function (e) { setGate(stage, e.target.value); },
									},
										React.createElement("option", { value: "auto" }, "auto"),
										React.createElement("option", { value: "ask" }, "ask"),
										React.createElement("option", { value: "manual" }, "manual"),
									),
								);
							}),
						),
					),
					React.createElement("div", { className: "vg-actions" },
						Btn({ primary: true, disabled: props.busy, onClick: props.onSaveBudget }, t("save")),
					),
				),
			);
		}

		/* ── 设置页主组件（无状态渲染 + 有状态容器）────────── */

		function SectionView(props) {
			var t = props.t;
			return React.createElement("div", { className: "vg-root" },
				React.createElement("div", { className: "vg-row" },
					React.createElement("h2", { style: { margin: 0, fontSize: 16 } }, t("title")),
					React.createElement("div", { style: { flex: 1 } }),
					Btn({ disabled: props.busy, onClick: props.onRefresh }, t("refresh")),
				),
				React.createElement("p", { className: "vg-intro" }, t("intro")),
				React.createElement("div", { className: "vg-tabs" },
					React.createElement("button", {
						className: "vg-tab" + (props.tab === "studio" ? " vg-tab-active" : ""),
						onClick: function () { props.onTab("studio"); },
					}, t("tabStudio")),
					React.createElement("button", {
						className: "vg-tab" + (props.tab === "channels" ? " vg-tab-active" : ""),
						onClick: function () { props.onTab("channels"); },
					}, t("tabChannels")),
				),
				props.message ? React.createElement("div", { className: "vg-msg vg-msg-ok" }, props.message) : null,
				props.error ? React.createElement("div", { className: "vg-msg vg-msg-err" }, props.error) : null,
				props.tab === "studio"
					? React.createElement(StudioView, {
						t: t,
						runs: props.runs, detail: props.detail,
						selected: props.selected,
						onSelectRun: props.onSelectRun, onBack: props.onBack,
					})
					: React.createElement(ChannelsView, {
						t: t, busy: props.busy,
						chans: props.chans, probe: props.probe,
						form: props.form, setForm: props.setForm,
						budgetDraft: props.budgetDraft, setBudgetDraft: props.setBudgetDraft,
						onCreateChannel: props.onCreateChannel,
						onToggleEnabled: props.onToggleEnabled,
						onSetDefault: props.onSetDefault,
						onTestChannel: props.onTestChannel,
						onPickerChange: props.onPickerChange,
						onPickerSave: props.onPickerSave,
						onDeleteChannel: props.onDeleteChannel,
						onSaveBudget: props.onSaveBudget,
					}),
			);
		}

		/**
		 * 有状态容器：双 tab 数据获取、操作编排、本地表单草稿。
		 * 所有 host 交互走 api()；操作成功后统一 refresh()，失败落红横幅。
		 */
		function makeStatefulComponent(t) {
			function Stateful() {
				var tabState = React.useState("studio");
				var tab = tabState[0], setTab = tabState[1];
				// 工坊：runs 列表 + 选中详情
				var runsState = React.useState(null);
				var runs = runsState[0], setRunsData = runsState[1];
				var detailState = React.useState(null);
				var detail = detailState[0], setDetailData = detailState[1];
				var selectedState = React.useState(null);
				var selected = selectedState[0], setSelected = selectedState[1];
				// 通道：列表 + 设置 + 探测结果 + 表单草稿
				var chansState = React.useState(null);
				var chans = chansState[0], setChansData = chansState[1];
				var probeState = React.useState({});
				var probe = probeState[0], setProbe = probeState[1];
				var formState = React.useState({ id: "", label: "", baseUrl: "", apiKey: "" });
				var form = formState[0], setForm = formState[1];
				var budgetDraftState = React.useState({ threshold: 1, gates: {} });
				var budgetDraft = budgetDraftState[0], setBudgetDraft = budgetDraftState[1];
				// 公共
				var msgState = React.useState({ ok: "", err: "" });
				var msg = msgState[0], setMsg = msgState[1];
				var busyState = React.useState(false);
				var busy = busyState[0], setBusy = busyState[1];

				var flash = function (ok, err) { setMsg({ ok: ok || "", err: err || "" }); };

				var refreshStudio = React.useCallback(function () {
					var listP = api("runs.list").then(function (v) { setRunsData(v); });
					if (selectedState[0]) {
						return Promise.all([listP, api("runs.get", { id: selectedState[0] }).then(setDetailData)]);
					}
					return listP;
				}, [selectedState[0]]);

				var refreshChannels = React.useCallback(function () {
					return Promise.all([
						api("channels.list").then(setChansData),
						api("settings.get").then(function (s) {
							setBudgetDraft({
								threshold: s.budget && typeof s.budget.confirmThresholdCny === "number" ? s.budget.confirmThresholdCny : 1,
								gates: s.gateDefaults || {},
							});
						}),
					]);
				}, []);

				// 3s 轮询：仅工坊 tab + 页面可见时运转
				React.useEffect(function () {
					if (tab !== "studio") return function () {};
					var timer = null;
					var tick = function () {
						if (typeof document !== "undefined" && document.visibilityState === "visible") {
							refreshStudio().catch(function () {});
						}
					};
					timer = setInterval(tick, 3000);
					return function () { if (timer) clearInterval(timer); };
				}, [tab, refreshStudio]);

				// tab 切换时首拉
				React.useEffect(function () {
					var alive = true;
					var p = tab === "studio" ? refreshStudio() : refreshChannels();
					p.catch(function (e) { if (alive) flash("", String(e.message || e)); });
					return function () { alive = false; };
				}, [tab]);

				/* 操作编排（run 模式与样例同构：busy → flash → refresh） */
				var run = function (promise, okText) {
					setBusy(true);
					return promise.then(function () { flash(okText || t("saved")); })
						.catch(function (e) { flash("", String(e.message || e)); })
						.then(function () {
							return tab === "studio" ? refreshStudio() : refreshChannels();
						})
						.then(function () { setBusy(false); })
						.catch(function () { setBusy(false); });
				};

				var onSelectRun = function (id) { setSelected(id); };
				var onBack = function () { setSelected(null); setDetailData(null); };

				var setProbeEntry = function (id, entry) {
					var next = Object.assign({}, probeState[0]);
					next[id] = Object.assign({}, next[id], entry);
					setProbe(next);
				};

				var onCreateChannel = function () {
					setBusy(true);
					api("channels.create", {
						id: form.id.trim(),
						label: form.label.trim(),
						baseUrl: form.baseUrl.trim(),
						apiKey: form.apiKey,
					}).then(function () {
						flash(t("saved"));
						setForm({ id: "", label: "", baseUrl: "", apiKey: "" }); // 提交即清空，密码框不留值
					}).catch(function (e) { flash("", String(e.message || e)); })
						.then(function () { return refreshChannels(); })
						.then(function () { setBusy(false); })
						.catch(function () { setBusy(false); });
				};

				var onToggleEnabled = function (id, enabled) {
					run(api("channels.update", { id: id, patch: { enabled: enabled } }));
				};

				var onSetDefault = function (id) {
					run(api("channels.setDefault", { id: id }));
				};

				var onDeleteChannel = function (ch) {
					var text = fill(t("deleteConfirm"), { name: ch.label || ch.id });
					if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(text)) return;
					run(api("channels.delete", { id: ch.id }));
				};

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

				var onSaveBudget = function () {
					// 阈值留空 = 不更新该项（host 对 undefined 跳过），避免 Number("")→0 静默改写
					var patch = { gateDefaults: budgetDraft.gates };
					if (budgetDraft.threshold !== "" && Number.isFinite(Number(budgetDraft.threshold))) {
						patch.confirmThresholdCny = Number(budgetDraft.threshold);
					}
					run(api("settings.update", patch));
				};

				return React.createElement(SectionView, {
					t: t,
					tab: tab, onTab: setTab,
					runs: runs, detail: detail, selected: selected,
					onSelectRun: onSelectRun, onBack: onBack,
					chans: chans, probe: probe,
					form: form, setForm: setForm,
					budgetDraft: budgetDraft, setBudgetDraft: setBudgetDraft,
					busy: busy,
					message: msg.ok, error: msg.err,
					onRefresh: function () { run(tab === "studio" ? refreshStudio() : refreshChannels()); },
					onCreateChannel: onCreateChannel,
					onToggleEnabled: onToggleEnabled,
					onSetDefault: onSetDefault,
					onTestChannel: onTestChannel,
					onPickerChange: onPickerChange,
					onPickerSave: onPickerSave,
					onDeleteChannel: onDeleteChannel,
					onSaveBudget: onSaveBudget,
				});
			}
			return Stateful;
		}

		/* ── 入口：注册 locale 字典 + settings.section ──────── */

		var inject = ["slots", "locale"];

		function apply(ctx) {
			ensureStyles();
			if (ctx.locale && typeof ctx.locale.register === "function") {
				ctx.effect(function () {
					return ctx.locale.register(NS, { zh: zh, en: en });
				}, "dsh-video-generator: section dictionaries");
			}

			var t = ctx.locale && typeof ctx.locale.bind === "function"
				? ctx.locale.bind(NS)
				: function (key, params) { return fill(zh[key] || en[key] || key, params); };

			// 设置页导航图标：宿主壳层对外部分区只给通用齿轮，标记本插件行
			// 后由 CSS 换成场记板字形。防御式：无 effect 服务时跳过，不影响其余功能。
			if (typeof ctx.effect === "function") {
				ctx.effect(function () {
					return registerSettingsNavIcon(function () { return t("nav"); });
				}, "dsh-video-generator: settings navigation icon");
			}

			if (!ctx.slots || typeof ctx.slots.inject !== "function") return;
			var Stateful = makeStatefulComponent(t);
			// 防御：设置页注册失败只降级（console 诊断），绝不炸掉插件加载/boot。
			try {
				ctx.slots.inject("settings.section", function () {
					return ctx.slots.register({
						name: "settings.section",
						id: "video-generator",
						order: 21,
						label: function () { return t("nav"); },
						locale: NS,
					}, Stateful);
				});
			} catch (error) {
				console.error("[dsh-video-generator] settings.section 注册失败（设置页菜单项不可用，其余功能不受影响）:", error);
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
