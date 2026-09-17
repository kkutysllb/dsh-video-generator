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
			nav: "漫剧工坊",
			title: "漫剧工坊",
			tabChannels: "通道管理",
			workTitle: "视频工坊",
			workIntro: "描述题材，一键复制创作提示词并回到对话,粘贴回车即发；Agent 走故事→剧本→分镜→出片工作流。通道与预算在 设置 → 视频工坊 管理。",
			topicLabel: "题材",
			topicPlaceholder: "例如：把 TCP 三次握手做成一场「快递签收」的漫剧短剧",
			sendToChat: "复制创作提示词，回到对话",
			sentCopied: "提示词已复制并回到会话——粘贴(⌘V / Ctrl+V)后回车发送",
			sentClipboard: "已复制创作提示词，请粘贴到对话发送",
			sendNone: "无法自动填入，请手动把提示词粘贴到对话",
			topicRequired: "先写一句题材描述",
			worksTitle: "作品库",
			autoRefreshHint: "每 3 秒自动刷新",
			promptVgen: "帮我做一个竖屏短视频（9:16）：{topic}",
			intro: "生成通道与预算配置：视频/图像/TTS 模型三要素自配（官方/中转皆可）。创作请在侧边栏「漫剧工坊」进行。",
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
			pickerTitle: "模型清单",
			pickerCountUnit: " 个",
			pickerCheckedHintPrefix: "· 已勾选",
			pickerStatCheckedPrefix: "已选",
			pickerStatRemovedPrefix: "待移除",
			pickerRemove: "移除",
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
			diagTitle: "环境与诊断",
			diagFfmpeg: "ffmpeg",
			diagDrawtext: "drawtext 滤镜",
			diagTts: "TTS 能力",
			diagRunsRoot: "产物根目录",
			diagVersion: "插件版本",
			diagOk: "正常",
			diagMissing: "缺失",
			diagFfmpegMissing: "未找到（渲染成片不可用，可设 VGEN_FFMPEG）",
			diagTtsOk: "可用（{m}）",
			diagTtsMissing: "默认通道无 kind=tts 模型（旁白回退本地语音）",
		};

		var en = {
			nav: "Drama Workbench",
			title: "Drama Workbench",
			tabChannels: "Channels",
			workTitle: "Video Studio",
			workIntro: "Describe a topic and push the creation prompt straight into the current chat; the agent runs story → script → storyboard → render. Channels & budget live in Settings → Video Studio.",
			topicLabel: "Topic",
			topicPlaceholder: "e.g. a short animated drama that explains TCP 3-way handshake as a parcel delivery",
			sendToChat: "Copy prompt & back to chat",
			sentCopied: "Prompt copied and back in the chat — paste (⌘V / Ctrl+V) and press Enter to send",
			sentClipboard: "Prompt copied — paste it into the chat to send",
			sendNone: "Could not fill automatically; paste the prompt into the chat manually",
			topicRequired: "Write a one-line topic first",
			worksTitle: "Works",
			autoRefreshHint: "auto-refreshes every 3s",
			promptVgen: "Make a vertical short video (9:16): {topic}",
			intro: "Channels & budget: bring your own OpenAI-compatible endpoints (official or relay). For creation, use the Drama Workbench in the sidebar.",
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
			pickerTitle: "Models",
			pickerCountUnit: "",
			pickerCheckedHintPrefix: "· checked",
			pickerStatCheckedPrefix: "Selected",
			pickerStatRemovedPrefix: "Pending removal",
			pickerRemove: "Remove",
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
			diagTitle: "Environment & diagnostics",
			diagFfmpeg: "ffmpeg",
			diagDrawtext: "drawtext filter",
			diagTts: "TTS",
			diagRunsRoot: "Artifacts root",
			diagVersion: "Plugin version",
			diagOk: "ok",
			diagMissing: "missing",
			diagFfmpegMissing: "not found (final-cut unavailable; set VGEN_FFMPEG)",
			diagTtsOk: "available ({m})",
			diagTtsMissing: "no kind=tts model on the default channel (narration falls back to local voice)",
		};

		/** 极简插值："重拍 {n} 次" → fill(tpl, { n: x }) */
		function fill(template, params) {
			return String(template).replace(/\{(\w+)\}/g, function (m, key) {
				return params && Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : m;
			});
		}

		/* ── 漫剧工坊双语词典（M2-M4：项目列表/向导/三栏工作台/Proposal/改编）── */

		var dzh = {
			wbTitle: "漫剧工坊",
			wbIntro: "项目制创作工作台：小说/剧情 → 漫剧改编 → 成片。项目数据保存在当前工作区（.dsh-drama/），会话可关可换，项目状态不丢。",
			newProject: "新建项目",
			search: "搜索项目名",
			filterAll: "全部状态",
			wsPick: "工作区",
			registryMissing: "宿主未提供 workspace registry（宿主版本过旧？）：项目存储不可用，仅设置页可用。",
			emptyProjects: "还没有项目——新建一个，从一句话灵感开始。",
			open: "打开",
			statusWriting: "写作中",
			statusPendingReview: "待审核",
			statusAdapting: "改编中",
			statusDone: "已完成",
			chaptersProgress: "章节 {done}/{planned}",
			pendingN: "待审核 {n}",
			latestTask: "最近任务",
			taskNone: "无",
			emptyWizard: "向导",
			// 新建向导
			wizTitle: "新建项目",
			fTitle: "项目名称 *",
			fTitlePh: "例如：快递签收的三次握手",
			fCategory: "类型 *",
			fCategoryPh: "小说 / 短篇剧情 / 科普漫剧脚本…",
			fLanguage: "语言 *",
			fAudience: "目标读者",
			fLogline: "一句话梗概 *",
			fLoglinePh: "把 TCP 三次握手做成一场「快递签收」的闹剧",
			fTheme: "主题",
			fTone: "基调",
			fPlanned: "预计章节数",
			fWords: "每章目标字数",
			fStrategy: "创作策略",
			stratBalanced: "平衡",
			stratFluency: "流畅写作",
			stratConsistency: "一致性优先",
			stratDeep: "深度规划",
			create: "创建项目",
			created: "项目已创建，可开始生成故事架构。",
			// 工作台三栏
			backToList: "返回列表",
			backToChat: "返回会话",
			stageOverview: "项目概览",
			stagePremise: "灵感与前提",
			stageArch: "故事架构",
			stageWorld: "世界观",
			stageChars: "角色",
			stageOutline: "剧情大纲",
			stageChapter: "章节",
			stageAdapt: "漫剧改编",
			stageRuns: "视频任务",
			agentPanel: "Agent 面板",
			collapse: "收起",
			expand: "展开",
			currentTask: "当前任务",
			recentEvents: "最近事件",
			pendingProposals: "待审核提案",
			openSession: "打开会话",
			sessionNone: "任务尚未关联会话",
			channelWarn: "未配置生成通道：「AI 生成」按钮不可用。请到 设置 → 漫剧工坊 配置通道。",
			autoRefreshHint: "每 3 秒自动刷新（页面可见时）",
			// 阶段通用
			save: "保存",
			saved: "已保存",
			aiGenerate: "AI 生成",
			aiRewrite: "AI 改写",
			userRequestPh: "对 Agent 的本次要求（可空）",
			send: "生成",
			proposalBanner: "有 {n} 个待审核的「{asset}」建议",
			view: "查看",
			// Proposal 审核
			proposalCard: "待审核 · {kind}",
			proposalFrom: "来自 {by}",
			baseOn: "基于版本 {rev}",
			viewDiff: "查看 diff",
			editSuggestion: "编辑建议",
			doApply: "应用",
			doReject: "拒绝",
			doRegenerate: "重新生成",
			diffOld: "当前内容",
			diffNew: "提案内容（可在下方编辑后应用）",
			staleProposal: "提案已过期：项目内容已变化，请基于最新版本重新审阅或让 Agent 重新生成。",
			applyOk: "提案已应用（新版本 {rev}）",
			rejectOk: "提案已拒绝（留痕）",
			notePh: "拒绝原因（可选，留痕）",
			// 章节
			subBlueprint: "蓝图",
			subDraft: "草稿",
			subReview: "审稿",
			subFinal: "定稿",
			chapterN: "第 {n} 章",
			finalize: "把当前草稿标记为定稿",
			finalized: "已定稿：本章进入连续性上下文与改编输入",
			saveCandidate: "另存候选稿",
			candidateList: "候选稿 {n}",
			candidates: "候选稿（非权威）",
			aiDraft: "AI 写本章",
			aiReview: "AI 审稿",
			aiRevise: "AI 修订",
			wordCount: "{n} 字",
			problemList: "审稿问题",
			probContinuity: "连续性",
			probMotivation: "动机",
			probForeshadow: "伏笔",
			probGoal: "目标完成",
			probResolved: "已完成",
			probUnresolved: "未完成",
			probNeedsVerify: "待核实",
			reviseHint: "勾选要修订的问题",
			evidence: "证据",
			finalBadge: "已定稿",
			// 改编
			adaptCreate: "创建改编任务",
			adaptSource: "源章节",
			adaptDuration: "目标时长档位",
			adaptFidelity: "改编侧重点",
			faithful: "忠实改编",
			condensed: "紧凑浓缩",
			adaptNarration: "旁白语言",
			adaptations: "改编任务",
			adaptRun: "run",
			adaptHint: "创建后自动回会话发送改编指令：Agent 走 vgen_story → vgen_script → vgen_storyboard（产物镜像回项目）→ vgen_generate 出片。",
			// 概览
			ovPremise: "梗概",
			ovArch: "架构",
			ovWorld: "世界观",
			ovChars: "角色",
			ovOutline: "大纲",
			ovUntouched: "未生成",
			ovEntries: "{n} 条",
			ovRows: "{n} 章",
			ovLatest: "最近动态",
			// 指令发送
			instructCopied: "任务指令已复制并回到会话——粘贴(⌘V / Ctrl+V)后回车发送",
			instructNone: "指令复制失败：请到任务详情手动复制指令内容",
			taskCreated: "任务已创建",
			worldCited: "供正文引用",
			worldAdd: "添加条目",
			charAdd: "添加角色",
			delete: "删除",
			rowDelete: "移除",
			mustSave: "改动尚未保存",
		};

		var den = {
			wbTitle: "Drama Workbench",
			wbIntro: "Project-based creation workbench: novel/drama → comic-drama adaptation → final cut. Project data lives in the current workspace (.dsh-drama/); sessions may come and go, the project persists.",
			newProject: "New project",
			search: "Search projects",
			filterAll: "All statuses",
			wsPick: "Workspace",
			registryMissing: "Host does not provide the workspace registry (host too old?): project storage is unavailable; settings still work.",
			emptyProjects: "No projects yet — create one and start from a one-line premise.",
			open: "Open",
			statusWriting: "Writing",
			statusPendingReview: "Pending review",
			statusAdapting: "Adapting",
			statusDone: "Done",
			chaptersProgress: "Chapters {done}/{planned}",
			pendingN: "{n} pending",
			latestTask: "Latest task",
			taskNone: "none",
			emptyWizard: "Wizard",
			wizTitle: "Create project",
			fTitle: "Project title *",
			fTitlePh: "e.g. Three Handshakes to Sign for a Parcel",
			fCategory: "Type *",
			fCategoryPh: "novel / short drama / explainer comic script…",
			fLanguage: "Language *",
			fAudience: "Target readers",
			fLogline: "One-line premise *",
			fLoglinePh: "TCP three-way handshake as a parcel-delivery comedy",
			fTheme: "Theme",
			fTone: "Tone",
			fPlanned: "Planned chapters",
			fWords: "Words per chapter",
			fStrategy: "Strategy",
			stratBalanced: "Balanced",
			stratFluency: "Fluent writing",
			stratConsistency: "Consistency first",
			stratDeep: "Deep planning",
			create: "Create project",
			created: "Project created. You can generate the story architecture next.",
			backToList: "Back",
			backToChat: "Chat",
			stageOverview: "Overview",
			stagePremise: "Premise",
			stageArch: "Architecture",
			stageWorld: "World",
			stageChars: "Characters",
			stageOutline: "Outline",
			stageChapter: "Chapters",
			stageAdapt: "Adaptation",
			stageRuns: "Video runs",
			agentPanel: "Agent panel",
			collapse: "Collapse",
			expand: "Expand",
			currentTask: "Current task",
			recentEvents: "Recent events",
			pendingProposals: "Pending proposals",
			openSession: "Open session",
			sessionNone: "Task not linked to a session yet",
			channelWarn: "No generation channel configured: AI buttons are disabled. Configure one in Settings → Drama Workbench.",
			autoRefreshHint: "auto-refreshes every 3s (while visible)",
			save: "Save",
			saved: "Saved",
			aiGenerate: "AI generate",
			aiRewrite: "AI rewrite",
			userRequestPh: "Your request to the agent this time (optional)",
			send: "Generate",
			proposalBanner: "{n} pending suggestion(s) for \"{asset}\"",
			view: "View",
			proposalCard: "Pending · {kind}",
			proposalFrom: "from {by}",
			baseOn: "base revision {rev}",
			viewDiff: "View diff",
			editSuggestion: "Edit suggestion",
			doApply: "Apply",
			doReject: "Reject",
			doRegenerate: "Regenerate",
			diffOld: "Current content",
			diffNew: "Proposed content (editable below before applying)",
			staleProposal: "The proposal is stale: project content changed. Re-review on the latest version or ask the agent to regenerate.",
			applyOk: "Proposal applied (revision {rev})",
			rejectOk: "Proposal rejected (kept on record)",
			notePh: "Rejection note (optional, kept on record)",
			subBlueprint: "Blueprint",
			subDraft: "Draft",
			subReview: "Review",
			subFinal: "Final",
			chapterN: "Chapter {n}",
			finalize: "Mark current draft as final",
			finalized: "Finalized: this chapter now feeds continuity context and adaptations",
			saveCandidate: "Save as candidate",
			candidateList: "Candidates {n}",
			candidates: "Candidates (non-authoritative)",
			aiDraft: "AI write chapter",
			aiReview: "AI review",
			aiRevise: "AI revise",
			wordCount: "{n} chars",
			problemList: "Review problems",
			probContinuity: "Continuity",
			probMotivation: "Motivation",
			probForeshadow: "Foreshadow",
			probGoal: "Goal",
			probResolved: "resolved",
			probUnresolved: "unresolved",
			probNeedsVerify: "needs verify",
			reviseHint: "Pick the problems to revise",
			evidence: "Evidence",
			finalBadge: "final",
			adaptCreate: "Create adaptation task",
			adaptSource: "Source chapter",
			adaptDuration: "Target duration tier",
			adaptFidelity: "Adaptation focus",
			faithful: "Faithful",
			condensed: "Condensed",
			adaptNarration: "Narration language",
			adaptations: "Adaptations",
			adaptRun: "run",
			adaptHint: "After creation the instruction is sent to a session: the agent walks vgen_story → vgen_script → vgen_storyboard (mirrored into the project) → vgen_generate.",
			ovPremise: "Premise",
			ovArch: "Architecture",
			ovWorld: "World",
			ovChars: "Characters",
			ovOutline: "Outline",
			ovUntouched: "not generated",
			ovEntries: "{n} entries",
			ovRows: "{n} chapters",
			ovLatest: "Latest activity",
			instructCopied: "Instruction copied and back in the chat — paste (⌘V / Ctrl+V) and press Enter to send",
			instructNone: "Copy failed: open the task details and copy the instruction manually",
			taskCreated: "Task created",
			worldCited: "cited in body",
			worldAdd: "Add entry",
			charAdd: "Add character",
			delete: "Delete",
			rowDelete: "Remove",
			mustSave: "Unsaved changes",
		};

		for (var dzhKey in dzh) { zh[dzhKey] = dzh[dzhKey]; }
		for (var denKey in den) { en[denKey] = den[denKey]; }

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
			".vg-btn-danger:hover{border-color:#e5484d;color:#e5484d;}",
			// 主按钮渐变蓝 + 发光；次级 mini 按钮紧凑灰边（picker 面板专用）
			".vg-btn-primary{background:linear-gradient(180deg,#7aa2f7 0%,#5b82d7 100%);border:1px solid #7aa2f7;color:#0c0d10;font-weight:600;box-shadow:0 2px 8px rgba(122,162,247,.25);}",
			".vg-btn-primary:hover{color:#0c0d10;box-shadow:0 4px 14px rgba(122,162,247,.4);transform:translateY(-1px);}",
			".vg-btn-primary[disabled]{background:rgba(255,255,255,.025);border-color:var(--sl-color-neutral-300,#2a2a2a);color:rgba(255,255,255,.4);box-shadow:none;cursor:not-allowed;transform:none;}",
			".vg-btn-mini{border:1px solid rgba(255,255,255,.16);background:transparent;color:rgba(255,255,255,.55);border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;transition:all .15s;}",
			".vg-btn-mini:hover{border-color:#7aa2f7;color:#7aa2f7;}",
			".vg-btn-mini[disabled]{opacity:.4;cursor:not-allowed;}",
			".vg-field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px;}",
			".vg-field label{font-size:12px;opacity:.75;}",
			".vg-input,.vg-select,.vg-textarea{border:1px solid var(--sl-color-neutral-400,#555);border-radius:6px;background:transparent;color:inherit;padding:5px 8px;font-size:13px;}",
			".vg-textarea{resize:vertical;min-height:56px;font-family:inherit;}",
			// 工作台 hero:任务导向的新建区(区别于设置页的配置表单)
			".vg-work-hero{border:1px solid var(--dsw-alias-border-l,var(--sl-color-neutral-300,#333));border-left:3px solid var(--dsw-alias-interactive-bg-hover,var(--sl-color-primary-500,#4c6ef5));border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;}",
			".vg-work-hero h2{margin:0;font-size:15px;}",
			".vg-work-intro{opacity:.72;margin:0;font-size:12px;}",
			".vg-work-cta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}",
			".vg-work-sent{font-size:12px;color:var(--dsw-alias-interactive-bg-hover,var(--sl-color-primary-500,#4c6ef5));}",
			".vg-work-sec{margin-top:16px;}",
			".vg-work-sec>h3{margin:0 0 2px;font-size:13px;}",
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
			// 模型勾选面板（PickerPanel）：卡片化 + 顶渐变边 + 自定义 checkbox + 三色 chip + 选中行光带
			".vg-pick{margin-top:12px;background:linear-gradient(180deg,rgba(122,162,247,.04) 0%,transparent 60%);border:1px solid var(--sl-color-neutral-300,#2a2a2a);border-radius:12px;padding:14px 16px;box-shadow:0 2px 12px rgba(0,0,0,.32);position:relative;overflow:hidden;}",
			".vg-pick::before{content:'';position:absolute;top:0;left:16px;right:16px;height:1px;background:linear-gradient(90deg,transparent 0%,#7aa2f7 50%,transparent 100%);opacity:.5;}",
			".vg-pick-title{display:flex;align-items:center;gap:8px;font-size:11.5px;font-weight:600;letter-spacing:.04em;color:rgba(255,255,255,.55);text-transform:uppercase;margin-bottom:12px;}",
			".vg-pick-title-count{margin-left:auto;font-weight:400;text-transform:none;letter-spacing:0;opacity:.4;}",
			".vg-pick-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;}",
			".vg-pick-search{flex:1;min-width:160px;background:rgba(255,255,255,.025);border:1px solid var(--sl-color-neutral-300,#2a2a2a);color:inherit;border-radius:8px;padding:6px 10px 6px 30px;font-size:12px;transition:border-color .15s,background .15s;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-opacity='0.4' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E\");background-repeat:no-repeat;background-position:10px center;}",
			".vg-pick-search:focus{outline:none;border-color:#7aa2f7;background-color:rgba(255,255,255,.045);}",
			".vg-pick-search::placeholder{color:rgba(255,255,255,.4);}",
			".vg-pick-filter{display:flex;gap:2px;padding:2px;background:rgba(255,255,255,.025);border-radius:8px;border:1px solid var(--sl-color-neutral-300,#2a2a2a);}",
			".vg-pick-filter button{background:transparent;border:none;color:rgba(255,255,255,.55);font-size:11px;padding:4px 10px;border-radius:6px;cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:4px;}",
			".vg-pick-filter button:hover{color:rgba(255,255,255,.85);background:rgba(255,255,255,.045);}",
			".vg-pick-filter button.active{color:#7aa2f7;background:rgba(122,162,247,.16);}",
			".vg-pick-filter button .count{font-size:10px;opacity:.6;}",
			".vg-pick-list{display:flex;flex-direction:column;gap:1px;max-height:280px;overflow-y:auto;border:1px solid var(--sl-color-neutral-300,#2a2a2a);border-radius:8px;padding:3px;background:rgba(0,0,0,.18);}",
			".vg-pick-list::-webkit-scrollbar{width:6px;}",
			".vg-pick-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:3px;}",
			".vg-pick-row{display:flex;align-items:center;gap:10px;padding:6px 8px 6px 10px;font-size:12px;border-radius:6px;cursor:pointer;transition:background .12s;position:relative;}",
			".vg-pick-row:hover{background:rgba(255,255,255,.045);}",
			".vg-pick-row.checked{background:rgba(122,162,247,.10);}",
			".vg-pick-row.checked::before{content:'';position:absolute;left:-3px;top:50%;width:2px;height:60%;transform:translateY(-50%);background:#7aa2f7;border-radius:1px;}",
			".vg-pick-row.is-new:not(.checked){background:rgba(63,167,106,.05);}",
			".vg-pick-check{appearance:none;width:16px;height:16px;border:1.5px solid rgba(255,255,255,.16);border-radius:4px;background:transparent;cursor:pointer;position:relative;flex-shrink:0;transition:all .15s;margin:0;}",
			".vg-pick-check:hover{border-color:#7aa2f7;}",
			".vg-pick-check:checked{background:#7aa2f7;border-color:#7aa2f7;}",
			".vg-pick-check:checked::after{content:'';position:absolute;left:4px;top:1px;width:4px;height:8px;border:solid #0c0d10;border-width:0 2px 2px 0;transform:rotate(45deg);}",
			".vg-pick-name{flex:1;min-width:0;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
			".vg-pick-row.checked .vg-pick-name{color:#fff;font-weight:500;}",
			".vg-pick-kind{display:flex;gap:1px;padding:1px;background:rgba(0,0,0,.32);border-radius:5px;border:1px solid var(--sl-color-neutral-300,#2a2a2a);flex-shrink:0;}",
			".vg-pick-kind button{background:transparent;border:none;color:rgba(255,255,255,.4);font-size:10px;padding:2px 6px;border-radius:3px;cursor:pointer;transition:all .15s;letter-spacing:.02em;}",
			".vg-pick-kind button:hover{color:rgba(255,255,255,.65);}",
			".vg-pick-kind button[data-kind='image'].active{background:rgba(63,167,106,.14);color:#3fa76a;box-shadow:0 0 0 1px rgba(63,167,106,.35);}",
			".vg-pick-kind button[data-kind='video'].active{background:rgba(181,140,242,.14);color:#b58cf2;box-shadow:0 0 0 1px rgba(181,140,242,.35);}",
			".vg-pick-kind button[data-kind='tts'].active{background:rgba(240,179,94,.14);color:#f0b35e;box-shadow:0 0 0 1px rgba(240,179,94,.35);}",
			".vg-pick-tag{font-size:9.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:2px 6px;border-radius:4px;flex-shrink:0;min-width:44px;text-align:center;}",
			".vg-pick-tag.configured{background:rgba(122,162,247,.16);color:#7aa2f7;}",
			".vg-pick-tag.new{background:rgba(63,167,106,.14);color:#3fa76a;}",
			".vg-pick-actions{display:flex;gap:8px;margin-top:10px;align-items:center;justify-content:space-between;}",
			".vg-pick-stat{font-size:11.5px;color:rgba(255,255,255,.55);display:flex;gap:12px;align-items:center;}",
			".vg-pick-stat strong{color:rgba(255,255,255,.9);font-weight:600;}",
			".vg-pick-stat .sep{width:1px;height:12px;background:rgba(255,255,255,.16);}",
			".vg-pick-actions-right{display:flex;gap:6px;}",
			".vg-pick-empty{color:rgba(255,255,255,.4);font-size:12px;padding:24px;text-align:center;}",
			"@media (max-width:640px){.vg-grid{grid-template-columns:1fr;}}",
			// ── 漫剧工坊（wb-* 前缀）：项目卡片 / 三栏壳 / 阶段导航 / 提案卡 / diff ──
			".vg-wb-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}",
			".vg-wb-card{border:1px solid var(--sl-color-neutral-300,#333);border-radius:10px;padding:12px 14px;margin-bottom:10px;cursor:pointer;transition:border-color .12s,box-shadow .12s;}",
			".vg-wb-card:hover{border-color:var(--sl-color-primary-500,#7aa2f7);box-shadow:0 2px 10px rgba(122,162,247,.15);}",
			".vg-wb-title{font-weight:700;font-size:14px;}",
			".vg-wb-meta{opacity:.6;font-size:11px;display:flex;gap:10px;flex-wrap:wrap;margin-top:4px;}",
			".vg-badge-review{background:#b58cf2;color:#fff;}",
			".vg-badge-done{background:#2f6f4f;color:#fff;}",
			".vg-wb-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;}",
			".vg-wb-shell{display:flex;gap:12px;align-items:flex-start;min-height:360px;}",
			".vg-wb-nav{flex:0 0 132px;display:flex;flex-direction:column;gap:2px;border:1px solid var(--sl-color-neutral-300,#2a2a2a);border-radius:10px;padding:6px;}",
			".vg-wb-nav button{background:transparent;border:none;color:inherit;text-align:left;font-size:12.5px;padding:6px 8px;border-radius:6px;cursor:pointer;display:flex;justify-content:space-between;gap:6px;align-items:center;}",
			".vg-wb-nav button:hover{background:rgba(122,162,247,.08);}",
			".vg-wb-nav button.active{background:rgba(122,162,247,.16);color:var(--sl-color-primary-500,#7aa2f7);font-weight:600;}",
			".vg-wb-nav .cnt{font-size:10px;opacity:.65;}",
			".vg-wb-main{flex:1;min-width:0;}",
			".vg-wb-side{flex:0 0 240px;display:flex;flex-direction:column;gap:10px;}",
			".vg-wb-side h4{margin:0 0 6px;font-size:12px;opacity:.75;}",
			".vg-wb-side .vg-card{padding:10px 12px;}",
			"@media (max-width:900px){.vg-wb-side{flex:1 1 100%;}.vg-wb-nav{flex-basis:110px;}}",
			".vg-timeline{display:flex;flex-direction:column;gap:6px;font-size:11.5px;}",
			".vg-timeline .tl-row{display:flex;gap:8px;}",
			".vg-timeline .tl-at{opacity:.5;flex:none;font-family:ui-monospace,monospace;}",
			".vg-proposal{border:1px solid rgba(181,140,242,.5);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:rgba(181,140,242,.05);}",
			".vg-proposal .vg-proposal-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;}",
			".vg-diff{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;}",
			".vg-diff .pane{border:1px solid var(--sl-color-neutral-300,#2a2a2a);border-radius:8px;padding:8px;font-size:11.5px;max-height:280px;overflow:auto;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;}",
			".vg-diff .pane.del{background:rgba(229,72,77,.08);}",
			".vg-diff .pane.add{background:rgba(63,167,106,.08);}",
			".vg-diff h5{margin:0 0 4px;font-size:11px;opacity:.7;}",
			".vg-diff-row{display:flex;gap:8px;font-size:11.5px;padding:2px 0;border-bottom:1px dashed rgba(128,128,128,.18);}",
			".vg-diff-row .k{flex:0 0 110px;opacity:.65;overflow:hidden;text-overflow:ellipsis;}",
			".vg-diff-row .v{flex:1;min-width:0;white-space:pre-wrap;}",
			".vg-diff-row.changed .v.new{color:#3fa76a;}",
			".vg-diff-row.changed .v.old{color:#e5484d;text-decoration:line-through;opacity:.75;}",
			".vg-subtabs{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;}",
			".vg-banner{border:1px solid rgba(181,140,242,.55);background:rgba(181,140,242,.09);border-radius:8px;padding:6px 10px;font-size:12px;margin-bottom:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;}",
			".vg-banner.warn{border-color:rgba(240,179,94,.55);background:rgba(240,179,94,.09);}",
			".vg-kv{display:grid;grid-template-columns:88px 1fr;gap:4px 10px;font-size:12px;}",
			".vg-kv .k{opacity:.6;}",
			".vg-checkline{display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-top:1px dashed rgba(128,128,128,.2);font-size:12px;}",
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
			var removeRow = function (model) {
				var nextRows = rows.filter(function (r) { return r.model !== model; });
				var nextChecked = new Set(checked);
				nextChecked.delete(model);
				props.onChange(Object.assign({}, picker, { rows: nextRows, checked: nextChecked }));
			};
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
				React.createElement("div", { className: "vg-pick-title" },
					React.createElement("span", null, t("pickerTitle")),
					React.createElement("span", { className: "vg-pick-title-count" },
						String(rows.length) + t("pickerCountUnit") + " · " + t("pickerCheckedHintPrefix") + " ",
						React.createElement("strong", { style: { color: "rgba(255,255,255,.9)", fontWeight: 600 } }, String(checked.size))),
				),
				React.createElement("div", { className: "vg-pick-toolbar" },
					React.createElement("input", {
						className: "vg-pick-search", placeholder: t("pickerSearch"), value: search,
						onChange: function (e) { setSearch(e.target.value); },
					}),
					React.createElement("div", { className: "vg-pick-filter" },
						React.createElement("button", {
							className: kindFilter === "all" ? "active" : "",
							onClick: function () { setKindFilter("all"); },
						}, t("pickerFilterAll"), React.createElement("span", { className: "count" }, rows.length)),
						React.createElement("button", {
							className: kindFilter === "image" ? "active" : "",
							onClick: function () { setKindFilter("image"); },
						}, t("pickerKindImage"), React.createElement("span", { className: "count" }, rows.filter(function (r) { return r.kind === "image"; }).length)),
						React.createElement("button", {
							className: kindFilter === "video" ? "active" : "",
							onClick: function () { setKindFilter("video"); },
						}, t("pickerKindVideo"), React.createElement("span", { className: "count" }, rows.filter(function (r) { return r.kind === "video"; }).length)),
						React.createElement("button", {
							className: kindFilter === "tts" ? "active" : "",
							onClick: function () { setKindFilter("tts"); },
						}, t("pickerKindTts"), React.createElement("span", { className: "count" }, rows.filter(function (r) { return r.kind === "tts"; }).length)),
					),
				),
				rows.length === 0
					? React.createElement("div", { className: "vg-pick-empty" }, t("pickerEmpty"))
					: filtered.length === 0
						? React.createElement("div", { className: "vg-pick-empty" }, t("pickerEmpty"))
						: React.createElement("div", { className: "vg-pick-list" },
							filtered.map(function (r) {
								var isChecked = checked.has(r.model);
								var rowClasses = "vg-pick-row" + (isChecked ? " checked" : "") + (r.isNew && !isChecked ? " is-new" : "");
								return React.createElement("div", {
									key: r.model,
									className: rowClasses,
									onClick: function () { toggleCheck(r.model); },
								},
									React.createElement("input", {
										type: "checkbox", className: "vg-pick-check",
										checked: isChecked,
										onChange: function () { toggleCheck(r.model); },
										onClick: function (e) { e.stopPropagation(); },
									}),
									React.createElement("span", { className: "vg-pick-name", title: r.model }, r.model),
									React.createElement("div", { className: "vg-pick-kind", onClick: function (e) { e.stopPropagation(); } },
										React.createElement("button", {
											"data-kind": "image",
											className: r.kind === "image" ? "active" : "",
											onClick: function (e) { e.stopPropagation(); setKind(r.model, "image"); },
										}, t("pickerKindImage")),
										React.createElement("button", {
											"data-kind": "video",
											className: r.kind === "video" ? "active" : "",
											onClick: function (e) { e.stopPropagation(); setKind(r.model, "video"); },
										}, t("pickerKindVideo")),
										React.createElement("button", {
											"data-kind": "tts",
											className: r.kind === "tts" ? "active" : "",
											onClick: function (e) { e.stopPropagation(); setKind(r.model, "tts"); },
										}, t("pickerKindTts")),
									),
									React.createElement("button", { className: "vg-btn vg-btn-mini vg-btn-danger vg-pick-remove", title: t("pickerRemove"), "aria-label": t("pickerRemove"), onClick: function (e) { e.stopPropagation(); removeRow(r.model); } }, t("pickerRemove")),
								r.isConfigured
										? React.createElement("span", { className: "vg-pick-tag configured" }, t("pickerLabelConfigured"))
										: React.createElement("span", { className: "vg-pick-tag new" }, t("pickerLabelNew")),
								);
							}),
						),
				React.createElement("div", { className: "vg-pick-actions" },
					React.createElement("div", { className: "vg-pick-stat" },
						// 注：fill() 强制 String() 化参数，故直接拼字符串 + 嵌入 React 元素
						React.createElement("span", null,
							t("pickerStatCheckedPrefix"), " ",
							React.createElement("strong", null, String(checked.size)), " / ",
							String(rows.length)),
						React.createElement("span", { className: "sep" }),
						React.createElement("span", null,
							t("pickerStatRemovedPrefix"), " ",
							React.createElement("strong", null, String(rows.length - checked.size))),
					),
					React.createElement("div", { className: "vg-pick-actions-right" },
						React.createElement("button", {
							className: "vg-btn vg-btn-mini", disabled: picker.busy,
							onClick: function () {
								if (allChecked) deselectAll(); else selectAll();
							},
						}, allChecked ? t("pickerDeselectAll") : t("pickerSelectAll")),
						React.createElement("button", {
							className: "vg-btn vg-btn-primary",
							disabled: picker.busy,
							onClick: function () { props.onSave(); },
						}, t("pickerSave")),
					),
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
				props.message ? React.createElement("div", { className: "vg-msg vg-msg-ok" }, props.message) : null,
				props.error ? React.createElement("div", { className: "vg-msg vg-msg-err" }, props.error) : null,
				props.diags ? React.createElement("div", { className: "vg-card" },
					React.createElement("h3", null, t("diagTitle")),
					React.createElement("div", { className: "vg-kv" },
						React.createElement("span", { className: "k" }, t("diagVersion")),
						React.createElement("span", null, String(props.diags.version)),
						React.createElement("span", { className: "k" }, t("diagFfmpeg")),
						React.createElement("span", null,
							props.diags.ffmpeg && props.diags.ffmpeg.version
								? props.diags.ffmpeg.path + "（" + String(props.diags.ffmpeg.version).slice(0, 60) + "）"
								: t("diagFfmpegMissing"),
						),
						React.createElement("span", { className: "k" }, t("diagDrawtext")),
						React.createElement("span", { className: props.diags.ffmpeg && props.diags.ffmpeg.drawtext ? "vg-probe-ok" : "vg-probe-err" },
							props.diags.ffmpeg && props.diags.ffmpeg.drawtext ? t("diagOk") : t("diagMissing"),
						),
						React.createElement("span", { className: "k" }, t("diagTts")),
						React.createElement("span", null,
							props.diags.tts && props.diags.tts.available
								? fill(t("diagTtsOk"), { m: props.diags.tts.model })
								: t("diagTtsMissing"),
						),
						React.createElement("span", { className: "k" }, t("diagRunsRoot")),
						React.createElement("span", { style: { fontFamily: "ui-monospace,monospace", fontSize: 11 } }, String(props.diags.runsRoot)),
					),
				) : null,
				React.createElement(ChannelsView, {
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
				// 设置页只承担通道与预算管理;工坊 run 列表/详情在工作台主面板
				var tab = "channels";
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

				var diagsState = React.useState(null);
				var diags = diagsState[0], setDiags = diagsState[1];

				var refreshChannels = React.useCallback(function () {
					return Promise.all([
						api("channels.list").then(setChansData),
						api("diagnostics.get").then(setDiags).catch(function () {}),
						api("settings.get").then(function (s) {
							setBudgetDraft({
								threshold: s.budget && typeof s.budget.confirmThresholdCny === "number" ? s.budget.confirmThresholdCny : 1,
								gates: s.gateDefaults || {},
							});
						}),
					]);
				}, []);

				React.useEffect(function () {
					var alive = true;
					refreshChannels().catch(function (e) { if (alive) flash("", String(e.message || e)); });
					return function () { alive = false; };
				}, []);

				/* 操作编排（run 模式与样例同构：busy → flash → refresh） */
				var run = function (promise, okText) {
					setBusy(true);
					return promise.then(function () { flash(okText || t("saved")); })
						.catch(function (e) { flash("", String(e.message || e)); })
						.then(function () { return refreshChannels(); })
						.then(function () { setBusy(false); })
						.catch(function () { setBusy(false); });
				};

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
					// 保存即提交当前 picker 草稿中仍勾选的模型；空数组表示暂不选择模型。
					var submitted = picker.rows.filter(function (r) { return picker.checked.has(r.model); }).map(function (r) {
						return { model: r.model, kind: r.kind };
					});
					var submittedNames = submitted.map(function (m) { return m.model; });
					// 标记 picker 进入 busy；run() 不管理子级 busy，须自行重置
					setProbeEntry(id, Object.assign({}, entry, { picker: Object.assign({}, picker, { busy: true }) }));
					var resetPickerBusy = function () {
						var cur = probeState[0][id];
						if (!cur || !cur.picker) return;
						setProbeEntry(id, Object.assign({}, cur, { picker: Object.assign({}, cur.picker, { busy: false }) }));
					};
					setBusy(true);
					api("channels.update", { id: id, patch: { models: submitted } })
						.then(function () { flash(fill(t("pickerSaved"), { n: submittedNames.length })); })
						.catch(function (e) { flash("", String(e.message || e)); })
						.then(function () { return refreshChannels(); })
						.then(function () { setBusy(false); resetPickerBusy(); })
						.catch(function () { setBusy(false); resetPickerBusy(); });
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
					diags: diags,
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

		/* ── 漫剧工坊（Novel → Drama Workbench，规格 §2/§5/§6）──────────
		 * 一级：项目列表（含新建向导）；二级：三栏工作台（阶段导航 + 工作区 +
		 * Agent/Proposal 面板）。数据面走 /dsh-video-generator/drama/<method>，
		 * {ok,value}/{ok,error} 信封；3s 轮询仅页面可见时运转。AI 内容产出
		 * 一律走提案闭环：Agent → drama_propose → 用户在页面 diff/编辑/应用。 */

		var DRAMA = "/dsh-video-generator/drama";
		var PANEL_ID = "drama-workbench";

		function dramaApi(method, body) {
			return fetch(DRAMA + "/" + method, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body || {}),
			}).then(function (response) {
				return response.text().then(function (text) {
					var data;
					try { data = text ? JSON.parse(text) : {}; }
					catch (e) { throw new Error("bad JSON (" + response.status + ")"); }
					if (data && data.ok) return data.value;
					var err = new Error(String((data && data.error && data.error.message) || ("HTTP " + response.status)));
					err.code = (data && data.error && data.error.code) || "internal";
					throw err;
				});
			});
		}

		function h(type, props) {
			var kids = Array.prototype.slice.call(arguments, 2);
			return React.createElement.apply(React, [type, props || null].concat(kids));
		}

		var WB_STAGES = [
			["overview", "stageOverview"],
			["premise", "stagePremise"],
			["arch", "stageArch"],
			["world", "stageWorld"],
			["chars", "stageChars"],
			["outline", "stageOutline"],
			["chapter", "stageChapter"],
			["adapt", "stageAdapt"],
			["runs", "stageRuns"],
		];

		var D_STATUS_KEY = { writing: "statusWriting", "pending-review": "statusPendingReview", adapting: "statusAdapting", done: "statusDone" };

		function linesToArr(text) {
			return String(text || "").split("\n").map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
		}
		function arrToLines(arr) {
			return (arr || []).join("\n");
		}
		function csvToArr(text) {
			return String(text || "").split(/[,,、]/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
		}
		function shortRev(rev) {
			return String(rev || "").slice(0, 8);
		}

		function Field(label, control) {
			return h("div", { className: "vg-field" }, h("label", null, label), control);
		}

		function statusChip(t, status) {
			var cls = "vg-chip " + (status === "done" ? "vg-chip-done" : status === "pending-review" ? "vg-chip-running" : status === "adapting" ? "vg-chip-running" : "vg-chip-pending");
			return h("span", { className: cls }, t(D_STATUS_KEY[status] || "statusWriting"));
		}

		/** 组装全部漫剧工坊组件。deps: sendInstruction/openSession/backToConversation（apply 注入宿主桥）。 */
		function makeDramaComponents(t, deps) {

			/* ── 一级：项目列表 ── */

			function ProjectCard(props) {
				var p = props.project;
				var progress = fill(t("chaptersProgress"), { done: p.chaptersFinal || 0, planned: p.plannedChapters || 0 });
				return h("div", { className: "vg-wb-card", onClick: function () { props.onOpen(p); } },
					h("div", { className: "vg-row" },
						h("span", { className: "vg-wb-title" }, p.title || p.id),
						h("span", { className: "vg-tpl-meta" }, p.category || "", p.language ? " · " + p.language : ""),
						statusChip(t, p.status),
						(p.pendingProposals || 0) > 0 ? h("span", { className: "vg-badge vg-badge-review" }, fill(t("pendingN"), { n: p.pendingProposals })) : null,
						h("div", { style: { flex: 1 } }),
						h("button", {
							className: "vg-btn",
							onClick: function (e) { e.stopPropagation(); props.onOpen(p); },
						}, t("open")),
					),
					h("div", { className: "vg-wb-meta" },
						h("span", null, progress),
						h("span", null, t("latestTask") + ": " + (p.latestTask ? p.latestTask.kind + "（" + p.latestTask.status + "）" : t("taskNone"))),
						h("span", null, formatDate(p.updatedAt)),
					),
				);
			}

			function ProjectWizard(props) {
				var f = React.useState({ title: "", category: "", language: "中文", audience: "", logline: "", theme: "", tone: "", plannedChapters: 10, chapterWordTarget: 2000, strategy: "balanced" });
				var form = f[0], setForm = f[1];
				var step = React.useState(1);
				var cur = step[0], setStep = step[1];
				var busy = React.useState(false);
				var isBusy = busy[0], setBusy = busy[1];
				var err = React.useState("");
				var errMsg = err[0], setErr = err[1];
				var set = function (key) {
					return function (e) {
						var value = e && e.target ? e.target.value : e;
						var next = Object.assign({}, form);
						next[key] = value;
						setForm(next);
					};
				};
				var submit = function () {
					setBusy(true); setErr("");
					dramaApi("drama.project.create", { workspaceId: props.workspaceId, project: form })
						.then(function (v) { props.onCreated(v.projectId); })
						.catch(function (e) { setErr(String(e.message || e)); setBusy(false); });
				};
				var required = String(form.title || "").trim() !== "" && String(form.category || "").trim() !== "" && String(form.language || "").trim() !== "" && String(form.logline || "").trim() !== "";
				if (cur === 1) {
					return h("div", { className: "vg-card" },
						h("h3", null, t("wizTitle")),
						h("div", { className: "vg-grid" },
							Field(t("fTitle"), h("input", { className: "vg-input", placeholder: t("fTitlePh"), value: form.title, onChange: set("title") })),
							Field(t("fCategory"), h("input", { className: "vg-input", placeholder: t("fCategoryPh"), value: form.category, onChange: set("category") })),
							Field(t("fLanguage"), h("input", { className: "vg-input", value: form.language, onChange: set("language") })),
							Field(t("fAudience"), h("input", { className: "vg-input", value: form.audience, onChange: set("audience") })),
						),
						Field(t("fLogline"), h("textarea", { className: "vg-textarea", rows: 2, placeholder: t("fLoglinePh"), value: form.logline, onChange: set("logline") })),
						h("div", { className: "vg-grid" },
							Field(t("fTheme"), h("input", { className: "vg-input", value: form.theme, onChange: set("theme") })),
							Field(t("fTone"), h("input", { className: "vg-input", value: form.tone, onChange: set("tone") })),
							Field(t("fPlanned"), h("input", { className: "vg-input", type: "number", min: 1, max: 500, value: form.plannedChapters, onChange: function (e) { set("plannedChapters")({ target: { value: e.target.value === "" ? "" : Number(e.target.value) } }); } })),
							Field(t("fWords"), h("input", { className: "vg-input", type: "number", min: 100, max: 50000, step: 100, value: form.chapterWordTarget, onChange: function (e) { set("chapterWordTarget")({ target: { value: e.target.value === "" ? "" : Number(e.target.value) } }); } })),
						),
						Field(t("fStrategy"), h("select", { className: "vg-select", value: form.strategy, onChange: set("strategy") },
							h("option", { value: "balanced" }, t("stratBalanced")),
							h("option", { value: "fluency" }, t("stratFluency")),
							h("option", { value: "consistency" }, t("stratConsistency")),
							h("option", { value: "deep-planning" }, t("stratDeep")),
						)),
						errMsg ? h("div", { className: "vg-msg vg-msg-err" }, errMsg) : null,
						h("div", { className: "vg-actions" },
							h("button", { className: "vg-btn vg-btn-primary", disabled: !required || isBusy, onClick: function () { setStep(2); } }, t("create")),
							h("button", { className: "vg-btn", onClick: props.onCancel }, t("back")),
						),
					);
				}
				// 确认页
				return h("div", { className: "vg-card" },
					h("h3", null, t("wizTitle")),
					h("div", { className: "vg-kv" },
						h("span", { className: "k" }, t("fTitle")), h("span", null, form.title),
						h("span", { className: "k" }, t("fCategory")), h("span", null, form.category),
						h("span", { className: "k" }, t("fLogline")), h("span", null, form.logline),
						h("span", { className: "k" }, t("fPlanned")), h("span", null, String(form.plannedChapters) + " × " + String(form.chapterWordTarget) + " 字"),
					),
					h("p", { className: "vg-hint" }, t("created")),
					h("div", { className: "vg-actions" },
						h("button", { className: "vg-btn vg-btn-primary", disabled: isBusy, onClick: submit }, t("create")),
						h("button", { className: "vg-btn", disabled: isBusy, onClick: function () { setStep(1); } }, t("back")),
					),
				);
			}

			/* ── Proposal 审核：diff 视图 + 编辑建议 + 应用/拒绝 ── */

			function flattenRows(oldData, newData) {
				var rows = [];
				var o = oldData && typeof oldData === "object" && !Array.isArray(oldData) ? oldData : {};
				var n = newData && typeof newData === "object" && !Array.isArray(newData) ? newData : {};
				var keys = [];
				var seen = {};
				var k;
				for (k in o) { if (!seen[k]) { keys.push(k); seen[k] = 1; } }
				for (k in n) { if (!seen[k]) { keys.push(k); seen[k] = 1; } }
				for (var i = 0; i < keys.length; i++) {
					var key = keys[i];
					var ov = o[key] === undefined ? "" : JSON.stringify(o[key]);
					var nv = n[key] === undefined ? "" : JSON.stringify(n[key]);
					rows.push({ key: key, old: ov, new: nv, changed: ov !== nv });
				}
				return rows;
			}

			function ProposalDiff(props) {
				var p = props.proposal;
				var asset = React.useState(null);
				var oldData = asset[0], setOld = asset[1];
				var edit = React.useState(null);
				var edited = edit[0], setEdited = edit[1];
				var busy = React.useState(false);
				var isBusy = busy[0], setBusy = busy[1];
				var err = React.useState("");
				var errMsg = err[0], setErr = err[1];
				React.useEffect(function () {
					dramaApi("drama.asset.get", { workspaceId: props.workspaceId, projectId: props.projectId, assetRef: p.assetRef })
						.then(function (v) { setOld(v); })
						.catch(function () { setOld(null); });
				}, [p.proposalId, p.assetRef]);
				var text = edited !== null ? edited : p.kind.indexOf("chapter-") === 0 && (p.assetRef.indexOf("/draft") !== -1 || p.assetRef.indexOf("/final") !== -1)
					? String(p.replacement)
					: JSON.stringify(p.replacement, null, 2);
				var isMd = p.assetRef.indexOf("/draft") !== -1 || p.assetRef.indexOf("/final") !== -1;
				var applyIt = function () {
					setBusy(true); setErr("");
					var replacement;
					if (edited !== null) {
						if (isMd) {
							replacement = edited;
						} else {
							try { replacement = JSON.parse(edited); }
							catch (e) { setErr("JSON 解析失败：" + String(e.message || e)); setBusy(false); return; }
						}
					}
					dramaApi("drama.proposal.apply", { workspaceId: props.workspaceId, projectId: props.projectId, proposalId: p.proposalId, replacement: replacement })
						.then(function (v) { props.onApplied(fill(t("applyOk"), { rev: shortRev(v.revision) })); })
						.catch(function (e) { setErr(String(e.message || e)); setBusy(false); });
				};
				var rejectIt = function () {
					setBusy(true); setErr("");
					dramaApi("drama.proposal.reject", { workspaceId: props.workspaceId, projectId: props.projectId, proposalId: p.proposalId })
						.then(function () { props.onRejected(t("rejectOk")); })
						.catch(function (e) { setErr(String(e.message || e)); setBusy(false); });
				};
				var oldText = oldData === null ? "" : (isMd ? String(oldData && oldData.data || "") : JSON.stringify(oldData && oldData.data || {}, null, 2));
				var rows = isMd ? null : flattenRows(oldData && oldData.data || {}, p.replacement);
				return h("div", null,
					h("div", { className: "vg-row" },
						h("button", { className: "vg-btn", onClick: props.onBack }, t("back")),
						h("span", { className: "vg-tpl-name" }, fill(t("proposalCard"), { kind: p.kind })),
						h("span", { className: "vg-tpl-meta" }, fill(t("proposalFrom"), { by: p.createdBy || "agent" }), " · ", fill(t("baseOn"), { rev: shortRev(p.baseRevision) })),
						!p.fresh ? h("span", { className: "vg-badge vg-badge-failed" }, "!") : null,
					),
					h("p", { className: "vg-hint", style: { marginTop: 6 } }, p.summary),
					!p.fresh ? h("div", { className: "vg-banner warn" }, t("staleProposal")) : null,
					errMsg ? h("div", { className: "vg-msg vg-msg-err" }, errMsg) : null,
					isMd
						? h("div", { className: "vg-diff" },
							h("div", { className: "pane del" }, h("h5", null, t("diffOld")), oldText || "（空）"),
							h("div", { className: "pane add" }, h("h5", null, t("diffNew")), String(p.replacement)),
						)
						: h("div", { className: "vg-card", style: { marginTop: 8 } },
							rows.map(function (r) {
								return h("div", { key: r.key, className: "vg-diff-row" + (r.changed ? " changed" : "") },
									h("span", { className: "k" }, r.key),
									r.changed
										? h("span", { className: "v old" }, r.old === "" ? "（无）" : r.old)
										: h("span", { className: "v" }, r.old === "" ? "（无）" : r.old),
									r.changed ? h("span", { className: "v new" }, r.new === "" ? "（清空）" : r.new) : null,
								);
							}),
						),
					h("div", { className: "vg-card", style: { marginTop: 8 } },
						h("h3", { style: { fontSize: 13 } }, t("editSuggestion")),
						h("p", { className: "vg-hint" }, t("diffNew")),
						h("textarea", {
							className: "vg-textarea", rows: 8, style: { fontFamily: "ui-monospace,monospace", width: "100%" },
							value: text,
							onChange: function (e) { setEdited(e.target.value); },
						}),
						h("div", { className: "vg-actions", style: { marginTop: 8 } },
							h("button", { className: "vg-btn vg-btn-primary", disabled: isBusy || !p.fresh, onClick: applyIt }, t("doApply")),
							h("button", { className: "vg-btn vg-btn-danger", disabled: isBusy, onClick: rejectIt }, t("doReject")),
							edited !== null ? h("button", { className: "vg-btn", disabled: isBusy, onClick: function () { setEdited(null); } }, t("back")) : null,
						),
					),
				);
			}

			/* ── 右侧面板：Agent 状态 + 待审核提案摘要 ── */

			function AgentPanel(props) {
				var detail = props.detail;
				var tasks = detail.tasks || [];
				var latest = tasks[0];
				var pending = (detail.proposals || []).filter(function (p) { return p.status === "pending"; });
				var events = [];
				for (var i = 0; i < tasks.length && events.length < 8; i++) {
					var evs = tasks[i].events || [];
					for (var j = evs.length - 1; j >= 0 && events.length < 8; j--) {
						events.push({ at: evs[j].at, type: evs[j].type + (tasks[i].kind ? " · " + tasks[i].kind : "") });
					}
				}
				return h("div", { className: "vg-card" },
					h("h4", null, t("agentPanel")),
					h("div", { className: "vg-kv" },
						h("span", { className: "k" }, t("currentTask")),
						h("span", null, latest ? latest.kind : "—",
							latest ? h("span", { className: "vg-chip vg-chip-" + (latest.status === "done" ? "done" : latest.status === "failed" ? "failed" : "running"), style: { marginLeft: 6 } }, latest.status) : null),
					),
					latest && latest.sessionId
						? h("div", { className: "vg-actions" }, h("button", { className: "vg-btn vg-btn-mini", onClick: function () { props.onOpenSession(latest.sessionId); } }, t("openSession")))
						: h("p", { className: "vg-hint", style: { margin: "4px 0" } }, t("sessionNone")),
					h("h4", { style: { marginTop: 8 } }, t("pendingProposals") + " · " + pending.length),
					pending.slice(0, 3).map(function (p) {
						return h("div", { key: p.proposalId, className: "vg-checkline" },
							h("span", { style: { flex: 1, minWidth: 0 } }, p.kind + "：" + (p.summary || "").slice(0, 40)),
							h("button", { className: "vg-btn vg-btn-mini", onClick: function () { props.onReviewProposal(p.proposalId); } }, t("view")),
						);
					}),
					pending.length === 0 ? h("p", { className: "vg-hint" }, "—") : null,
					h("h4", { style: { marginTop: 8 } }, t("recentEvents")),
					h("div", { className: "vg-timeline" },
						events.map(function (e, idx) {
							return h("div", { key: idx, className: "tl-row" },
								h("span", { className: "tl-at" }, (e.at || "").replace("T", " ").slice(5, 16)),
								h("span", { style: { minWidth: 0 } }, e.type),
							);
						}),
					),
				);
			}

			/* ── 各阶段工作区 ── */

			function AiBar(props) {
				// 生成动作条：用户要求输入 + [AI 生成/改写]；无通道时置灰
				var req = React.useState("");
				var text = req[0], setText = req[1];
				return h("div", { className: "vg-row", style: { margin: "8px 0" } },
					h("input", {
						className: "vg-input", style: { flex: 1, minWidth: 160 }, placeholder: t("userRequestPh"),
						value: text, onChange: function (e) { setText(e.target.value); },
					}),
					h("button", {
						className: "vg-btn vg-btn-primary", disabled: props.busy || props.channelBlocked,
						title: props.channelBlocked ? t("channelWarn") : undefined,
						onClick: function () { props.onGo(text); setText(""); },
					}, props.label || t("aiGenerate")),
				);
			}

			function ProposalBanner(props) {
				var pending = props.proposals.filter(function (p) { return p.status === "pending" && (!props.assetRef || p.assetRef === props.assetRef); });
				if (pending.length === 0) return null;
				return h("div", { className: "vg-banner" },
					fill(t("proposalBanner"), { n: pending.length, asset: pending[0].kind }),
					h("button", { className: "vg-btn vg-btn-mini", onClick: function () { props.onReview(pending[0].proposalId); } }, t("viewDiff")),
				);
			}

			function PremiseStage(props) {
				var asset = props.detail.premise;
				var p = (asset && asset.data) || {};
				var st = React.useState(null);
				var form = st[0], setForm = st[1];
				React.useEffect(function () {
					setForm(function (cur) {
						if (cur) return cur;
						return {
							title: p.title || "", category: p.category || "", language: p.language || "", audience: p.audience || "",
							logline: p.logline || "", theme: p.theme || "", tone: p.tone || "",
							plannedChapters: p.plannedChapters || 10, chapterWordTarget: p.chapterWordTarget || 2000, strategy: p.strategy || "balanced",
						};
					});
				}, [asset && asset.revision]);
				if (!form) return h("p", { className: "vg-hint" }, t("loading"));
				var set = function (key, value) { var n = Object.assign({}, form); n[key] = value; setForm(n); };
				var dirty = JSON.stringify(form) !== JSON.stringify(p);
				var saveIt = function () {
					props.saveAsset("premise", asset.revision, form, function () { setForm(null); });
				};
				return h("div", { className: "vg-card" },
					dirty ? h("div", { className: "vg-banner warn" }, t("mustSave")) : null,
					h("div", { className: "vg-grid" },
						Field(t("fTitle"), h("input", { className: "vg-input", value: form.title, onChange: function (e) { set("title", e.target.value); } })),
						Field(t("fCategory"), h("input", { className: "vg-input", value: form.category, onChange: function (e) { set("category", e.target.value); } })),
						Field(t("fLanguage"), h("input", { className: "vg-input", value: form.language, onChange: function (e) { set("language", e.target.value); } })),
						Field(t("fAudience"), h("input", { className: "vg-input", value: form.audience, onChange: function (e) { set("audience", e.target.value); } })),
					),
					Field(t("fLogline"), h("textarea", { className: "vg-textarea", rows: 2, value: form.logline, onChange: function (e) { set("logline", e.target.value); } })),
					h("div", { className: "vg-grid" },
						Field(t("fTheme"), h("input", { className: "vg-input", value: form.theme, onChange: function (e) { set("theme", e.target.value); } })),
						Field(t("fTone"), h("input", { className: "vg-input", value: form.tone, onChange: function (e) { set("tone", e.target.value); } })),
						Field(t("fPlanned"), h("input", { className: "vg-input", type: "number", min: 1, value: form.plannedChapters, onChange: function (e) { set("plannedChapters", Number(e.target.value)); } })),
						Field(t("fWords"), h("input", { className: "vg-input", type: "number", min: 100, value: form.chapterWordTarget, onChange: function (e) { set("chapterWordTarget", Number(e.target.value)); } })),
					),
					h("div", { className: "vg-actions" },
						h("button", { className: "vg-btn vg-btn-primary", disabled: !dirty || props.busy, onClick: saveIt }, t("save")),
					),
				);
			}

			var ARCH_FIELDS = [
				["mainConflict", "主冲突"], ["protagonistGoal", "主角目标"], ["antagonistForce", "主要阻力"], ["cost", "代价"],
				["startingPoint", "起点"], ["midpointTurn", "中段转折"], ["climax", "高潮"], ["ending", "结局"], ["theme", "主题"], ["mainline", "主线"],
			];

			function ArchStage(props) {
				var asset = props.detail.architecture;
				var a = (asset && asset.data) || {};
				var has = asset && asset.revision !== "absent";
				return h("div", { className: "vg-card" },
					ProposalBanner({ proposals: props.detail.proposals || [], assetRef: "architecture", onReview: props.onReview }),
					has ? h("div", { className: "vg-kv" }, ARCH_FIELDS.map(function (f) {
						return [h("span", { className: "k", key: f[0] + "k" }, f[1]), h("span", { key: f[0] + "v" }, a[f[0]] || "—")];
					}),
						h("span", { className: "k" }, "支线"), h("span", null, (a.subplots || []).join("；") || "—"),
						h("span", { className: "k" }, "伏笔与回收"), h("span", null, (a.foreshadows || []).join("；") || "—"),
					) : h("p", { className: "vg-hint" }, t("ovUntouched")),
					h(AiBar, {
						busy: props.busy, channelBlocked: props.channelBlocked, label: has ? t("aiRewrite") : t("aiGenerate"),
						onGo: function (req) { props.sendTask("generate-architecture", {}, req); },
					}),
				);
			}

			var WORLD_CATS = [["rule", "规则"], ["geography", "地理"], ["organization", "组织"], ["era", "时代"], ["power", "能力体系"], ["misc", "其他"]];

			function WorldStage(props) {
				var asset = props.detail.worldbuilding;
				var st = React.useState(null);
				var entries = st[0], setEntries = st[1];
				React.useEffect(function () {
					setEntries(function (cur) {
						if (cur && cur.rev === (asset && asset.revision)) return cur;
						var list = (asset && asset.data && asset.data.entries) || [];
						return { rev: asset && asset.revision, list: list.map(function (e) { return Object.assign({}, e); }) };
					});
				}, [asset && asset.revision]);
				if (!entries) return h("p", { className: "vg-hint" }, t("loading"));
				var mutate = function (list) { setEntries({ rev: entries.rev, list: list }); };
				var saveIt = function () { props.saveAsset("worldbuilding", entries.rev, { entries: entries.list }, function () { setEntries(null); }); };
				var dirty = JSON.stringify(entries.list) !== JSON.stringify((asset && asset.data && asset.data.entries) || []);
				return h("div", { className: "vg-card" },
					ProposalBanner({ proposals: props.detail.proposals || [], assetRef: "worldbuilding", onReview: props.onReview }),
					dirty ? h("div", { className: "vg-banner warn" }, t("mustSave")) : null,
					entries.list.length === 0 ? h("p", { className: "vg-hint" }, t("ovUntouched")) : null,
					entries.list.map(function (e, i) {
						return h("div", { key: i, className: "vg-checkline", style: { flexDirection: "column", alignItems: "stretch" } },
							h("div", { className: "vg-row" },
								h("select", { className: "vg-select", value: e.category, onChange: function (ev) { var l = entries.list.slice(); l[i] = Object.assign({}, e, { category: ev.target.value }); mutate(l); } },
									WORLD_CATS.map(function (c) { return h("option", { key: c[0], value: c[0] }, c[1]); })),
								h("input", { className: "vg-input", style: { width: 140 }, value: e.title, placeholder: "标题", onChange: function (ev) { var l = entries.list.slice(); l[i] = Object.assign({}, e, { title: ev.target.value }); mutate(l); } }),
								h("label", { className: "vg-row", style: { gap: 4, fontSize: 11 } },
									h("input", { type: "checkbox", checked: !!e.citedInBody, onChange: function (ev) { var l = entries.list.slice(); l[i] = Object.assign({}, e, { citedInBody: ev.target.checked }); mutate(l); } }),
									t("worldCited"),
								),
								h("div", { style: { flex: 1 } }),
								h("button", { className: "vg-btn vg-btn-mini vg-btn-danger", onClick: function () { var l = entries.list.slice(); l.splice(i, 1); mutate(l); } }, t("rowDelete")),
							),
							h("textarea", { className: "vg-textarea", rows: 2, value: e.content, onChange: function (ev) { var l = entries.list.slice(); l[i] = Object.assign({}, e, { content: ev.target.value }); mutate(l); } }),
						);
					}),
					h("div", { className: "vg-actions" },
						h("button", { className: "vg-btn", onClick: function () { mutate(entries.list.concat([{ id: "w" + Date.now(), category: "misc", title: "", content: "", citedInBody: false }])); } }, t("worldAdd")),
						h("button", { className: "vg-btn vg-btn-primary", disabled: !dirty || props.busy, onClick: saveIt }, t("save")),
					),
					h(AiBar, { busy: props.busy, channelBlocked: props.channelBlocked, onGo: function (req) { props.sendTask("generate-worldbuilding", {}, req); } }),
				);
			}

			function CharsStage(props) {
				var asset = props.detail.characters;
				var st = React.useState(null);
				var chars = st[0], setChars = st[1];
				var sel = React.useState(0);
				var selected = sel[0], setSelected = sel[1];
				React.useEffect(function () {
					setChars(function (cur) {
						if (cur && cur.rev === (asset && asset.revision)) return cur;
						var list = (asset && asset.data && asset.data.characters) || [];
						return { rev: asset && asset.revision, list: list.map(function (c) { return Object.assign({}, c); }) };
					});
				}, [asset && asset.revision]);
				if (!chars) return h("p", { className: "vg-hint" }, t("loading"));
				var mutate = function (list) { setChars({ rev: chars.rev, list: list }); };
				var dirty = JSON.stringify(chars.list) !== JSON.stringify((asset && asset.data && asset.data.characters) || []);
				var cur = chars.list[selected] || null;
				var setField = function (key, value) {
					var l = chars.list.slice();
					l[selected] = Object.assign({}, cur); l[selected][key] = value;
					mutate(l);
				};
				var saveIt = function () { props.saveAsset("characters", chars.rev, { characters: chars.list }, function () { setChars(null); }); };
				return h("div", { className: "vg-card" },
					ProposalBanner({ proposals: props.detail.proposals || [], assetRef: "characters", onReview: props.onReview }),
					h("div", { className: "vg-row" },
						chars.list.map(function (c, i) {
							return h("button", { key: i, className: "vg-tab" + (i === selected ? " vg-tab-active" : ""), onClick: function () { setSelected(i); } }, c.name || c.id || String(i + 1));
						}),
						h("button", { className: "vg-btn vg-btn-mini", onClick: function () { var l = chars.list.slice(); l.push({ id: "c" + Date.now(), name: "", identity: "", status: "", appearanceChapters: [], hasVisualAsset: false, appearance: "", personality: "", desire: "", fear: "", background: "", relationships: [], keyEvents: [], visualPrompt: "" }); mutate(l); setSelected(l.length - 1); } }, t("charAdd")),
					),
					dirty ? h("div", { className: "vg-banner warn", style: { marginTop: 8 } }, t("mustSave")) : null,
					cur ? h("div", { style: { marginTop: 8 } },
						h("div", { className: "vg-grid" },
							Field("姓名", h("input", { className: "vg-input", value: cur.name, onChange: function (e) { setField("name", e.target.value); } })),
							Field("身份", h("input", { className: "vg-input", value: cur.identity, onChange: function (e) { setField("identity", e.target.value); } })),
							Field("当前状态", h("input", { className: "vg-input", value: cur.status, onChange: function (e) { setField("status", e.target.value); } })),
							Field("出场章节（逗号分隔）", h("input", { className: "vg-input", value: (cur.appearanceChapters || []).join(","), onChange: function (e) { setField("appearanceChapters", csvToArr(e.target.value).map(Number)); } })),
						),
						h("div", { className: "vg-grid" },
							Field("外貌", h("textarea", { className: "vg-textarea", rows: 2, value: cur.appearance, onChange: function (e) { setField("appearance", e.target.value); } })),
							Field("性格", h("textarea", { className: "vg-textarea", rows: 2, value: cur.personality, onChange: function (e) { setField("personality", e.target.value); } })),
							Field("欲望", h("textarea", { className: "vg-textarea", rows: 2, value: cur.desire, onChange: function (e) { setField("desire", e.target.value); } })),
							Field("恐惧", h("textarea", { className: "vg-textarea", rows: 2, value: cur.fear, onChange: function (e) { setField("fear", e.target.value); } })),
						),
						Field("背景", h("textarea", { className: "vg-textarea", rows: 2, value: cur.background, onChange: function (e) { setField("background", e.target.value); } })),
						Field("关系（每行一条）", h("textarea", { className: "vg-textarea", rows: 2, value: arrToLines(cur.relationships), onChange: function (e) { setField("relationships", linesToArr(e.target.value)); } })),
						Field("重要事件（每行一条）", h("textarea", { className: "vg-textarea", rows: 2, value: arrToLines(cur.keyEvents), onChange: function (e) { setField("keyEvents", linesToArr(e.target.value)); } })),
						Field("漫剧视觉提示词（master-asset 用）", h("textarea", { className: "vg-textarea", rows: 2, value: cur.visualPrompt, onChange: function (e) { setField("visualPrompt", e.target.value); } })),
						h("div", { className: "vg-actions" },
							h("button", { className: "vg-btn vg-btn-primary", disabled: !dirty || props.busy, onClick: saveIt }, t("save")),
							h("button", { className: "vg-btn vg-btn-danger", disabled: props.busy, onClick: function () { var l = chars.list.slice(); l.splice(selected, 1); mutate(l); setSelected(0); } }, t("delete")),
						),
					) : null,
					h(AiBar, { busy: props.busy, channelBlocked: props.channelBlocked, label: t("aiGenerate"), onGo: function (req) { props.sendTask("complete-characters", {}, req); } }),
				);
			}

			var OUTLINE_STATUS = [["none", "未规划"], ["planned", "已规划"], ["written", "已写作"], ["reviewed", "已审稿"], ["final", "已定稿"]];

			function OutlineStage(props) {
				var asset = props.detail.outline;
				var st = React.useState(null);
				var rows = st[0], setRows = st[1];
				React.useEffect(function () {
					setRows(function (cur) {
						if (cur && cur.rev === (asset && asset.revision)) return cur;
						var list = (asset && asset.data && asset.data.rows) || [];
						return { rev: asset && asset.revision, list: list.map(function (r) { return Object.assign({}, r); }) };
					});
				}, [asset && asset.revision]);
				if (!rows) return h("p", { className: "vg-hint" }, t("loading"));
				var mutate = function (list) { setRows({ rev: rows.rev, list: list }); };
				var setField = function (i, key, value) {
					var l = rows.list.slice();
					l[i] = Object.assign({}, l[i]); l[i][key] = value;
					mutate(l);
				};
				var dirty = JSON.stringify(rows.list) !== JSON.stringify((asset && asset.data && asset.data.rows) || []);
				return h("div", { className: "vg-card" },
					ProposalBanner({ proposals: props.detail.proposals || [], assetRef: "outline", onReview: props.onReview }),
					dirty ? h("div", { className: "vg-banner warn" }, t("mustSave")) : null,
					rows.list.length === 0 ? h("p", { className: "vg-hint" }, t("ovUntouched")) : null,
					rows.list.slice().sort(function (a, b) { return (a.chapter || 0) - (b.chapter || 0); }).map(function (r, i) {
						return h("div", { key: i, className: "vg-checkline", style: { flexDirection: "column", alignItems: "stretch" } },
							h("div", { className: "vg-row" },
								h("span", { className: "vg-badge", style: { background: (r.characters || []).length > 0 ? "#3b5fd9" : "#555" } }, "第 " + r.chapter + " 章"),
								h("input", { className: "vg-input", style: { width: 160 }, value: r.title, placeholder: "章节标题", onChange: function (e) { setField(i, "title", e.target.value); } }),
								h("select", { className: "vg-select", value: r.status, onChange: function (e) { setField(i, "status", e.target.value); } },
									OUTLINE_STATUS.map(function (s) { return h("option", { key: s[0], value: s[0] }, s[1]); })),
								h("div", { style: { flex: 1 } }),
								h("button", { className: "vg-btn vg-btn-mini vg-btn-danger", onClick: function () { var l = rows.list.slice(); l.splice(i, 1); mutate(l); } }, t("rowDelete")),
							),
							h("div", { className: "vg-grid" },
								h("input", { className: "vg-input", value: r.goal, placeholder: "章节目标", onChange: function (e) { setField(i, "goal", e.target.value); } }),
								h("input", { className: "vg-input", value: (r.characters || []).join(","), placeholder: "出场角色（逗号分隔）", onChange: function (e) { setField(i, "characters", csvToArr(e.target.value)); } }),
								h("input", { className: "vg-input", value: r.scenes, placeholder: "场景", onChange: function (e) { setField(i, "scenes", e.target.value); } }),
								h("input", { className: "vg-input", value: r.mood, placeholder: "情绪", onChange: function (e) { setField(i, "mood", e.target.value); } }),
							),
							h("div", { className: "vg-row" },
								h("input", { className: "vg-input", style: { flex: 1 }, value: r.mainEvents, placeholder: "主要事件", onChange: function (e) { setField(i, "mainEvents", e.target.value); } }),
								h("input", { className: "vg-input", style: { flex: 1 }, value: r.clueProgress, placeholder: "线索推进", onChange: function (e) { setField(i, "clueProgress", e.target.value); } }),
								h("input", { className: "vg-input", style: { flex: 1 }, value: r.endingHook, placeholder: "结尾钩子", onChange: function (e) { setField(i, "endingHook", e.target.value); } }),
							),
						);
					}),
					h("div", { className: "vg-actions" },
						h("button", { className: "vg-btn", onClick: function () { mutate(rows.list.concat([{ chapter: rows.list.length + 1, title: "", goal: "", mainEvents: "", characters: [], scenes: "", mood: "", clueProgress: "", endingHook: "", status: "none" }])); } }, t("worldAdd")),
						h("button", { className: "vg-btn vg-btn-primary", disabled: !dirty || props.busy, onClick: function () { props.saveAsset("outline", rows.rev, { rows: rows.list }, function () { setRows(null); }); } }, t("save")),
					),
					h(AiBar, { busy: props.busy, channelBlocked: props.channelBlocked, onGo: function (req) { props.sendTask("generate-outline", {}, req); } }),
				);
			}

			/** 章节工作台：蓝图/草稿/审稿/定稿四子视图（§2.6）。 */
			function ChapterStage(props) {
				var chapters = props.detail.chapters || [];
				var planned = props.detail.manifest.plannedChapters || 10;
				var maxN = Math.max(planned, chapters.length, 1);
				var nums = [];
				for (var i = 1; i <= maxN; i++) nums.push(i);
				var chState = React.useState({ no: 1, sub: "blueprint" });
				var cur = chState[0], setCur = chState[1];
				var cid = ("000" + cur.no).slice(-4);
				// 章节资产正文按需拉取（detail 只带 revision 摘要）
				var bodyState = React.useState(null);
				var bodies = bodyState[0], setBodies = bodyState[1];
				var tick = props.detail.updatedAt;
				// 本地草稿编辑缓冲 + 审稿问题勾选（hooks 须在 early return 之前）
				var draftBuf = React.useState(null);
				var draftTextBuf = draftBuf[0], setDraftBuf = draftBuf[1];
				var checked = React.useState({});
				var checkedMap = checked[0], setChecked = checked[1];
				React.useEffect(function () {
					var alive = true;
					setBodies(null);
					Promise.all([
						dramaApi("drama.asset.get", { workspaceId: props.workspaceId, projectId: props.projectId, assetRef: "chapters/" + cid + "/blueprint" }).catch(function () { return null; }),
						dramaApi("drama.asset.get", { workspaceId: props.workspaceId, projectId: props.projectId, assetRef: "chapters/" + cid + "/draft" }).catch(function () { return null; }),
						dramaApi("drama.asset.get", { workspaceId: props.workspaceId, projectId: props.projectId, assetRef: "chapters/" + cid + "/review" }).catch(function () { return null; }),
						dramaApi("drama.asset.get", { workspaceId: props.workspaceId, projectId: props.projectId, assetRef: "chapters/" + cid + "/final" }).catch(function () { return null; }),
						dramaApi("drama.candidate.list", { workspaceId: props.workspaceId, projectId: props.projectId, chapter: cur.no }).catch(function () { return null; }),
					]).then(function (rs) {
						if (alive) setBodies({ blueprint: rs[0], draft: rs[1], review: rs[2], final: rs[3], candidates: rs[4] && rs[4].candidates || [] });
					});
					return function () { alive = false; };
				}, [props.projectId, cid, tick]);
				if (!bodies) return h("p", { className: "vg-hint" }, t("loading"));
				var chMeta = null;
				for (var ci = 0; ci < chapters.length; ci++) { if (chapters[ci].number === cur.no) chMeta = chapters[ci]; }
				var hasFinal = chMeta && chMeta.finalRevision !== "absent";
				var draftText = bodies.draft && bodies.draft.data !== null ? String(bodies.draft.data) : "";
				var shownDraft = draftTextBuf !== null ? draftTextBuf : draftText;
				var bp = bodies.blueprint && bodies.blueprint.data || {};
				var review = bodies.review && bodies.review.data || { problems: [] };
				var problems = review.problems || [];
				var SUBS = [["blueprint", "subBlueprint"], ["draft", "subDraft"], ["review", "subReview"], ["final", "subFinal"]];
				var saveBlueprint = function () {
					props.saveAsset("chapters/" + cid + "/blueprint", bodies.blueprint ? bodies.blueprint.revision : "absent", bp, function () { setBodies(null); });
				};
				var bpDirty = JSON.stringify(bp) !== JSON.stringify((bodies.blueprint && bodies.blueprint.data) || {});
				var saveDraft = function () {
					props.saveAsset("chapters/" + cid + "/draft", bodies.draft ? bodies.draft.revision : "absent", shownDraft, function () { setDraftBuf(null); });
				};
				var finalize = function () {
					props.saveAsset("chapters/" + cid + "/final", chMeta && chMeta.finalRevision !== "absent" ? chMeta.finalRevision : "absent", draftText, function () { setBodies(null); props.onFinalized(); });
				};
				var saveCandidate = function () {
					dramaApi("drama.candidate.save", { workspaceId: props.workspaceId, projectId: props.projectId, chapter: cur.no, content: draftText })
						.then(function () { props.onCandidatesChanged(); })
						.catch(function (e) { props.onCandidateError(String(e.message || e)); });
				};
				var setBp = function (key, value) {
					var n = JSON.parse(JSON.stringify(bp)); n[key] = value;
					// bp 是 bodies 快照的引用：借助 setBodies 触发重渲染
					setBodies(Object.assign({}, bodies, { blueprint: Object.assign({}, bodies.blueprint, { data: n }) }));
				};
				return h("div", null,
					h("div", { className: "vg-row", style: { marginBottom: 8 } },
						nums.map(function (n) {
							var meta = null;
							for (var x = 0; x < chapters.length; x++) { if (chapters[x].number === n) meta = chapters[x]; }
							var done = meta && meta.finalRevision !== "absent";
							return h("button", {
								key: n, className: "vg-tab" + (n === cur.no ? " vg-tab-active" : ""),
								style: done ? { borderColor: "#2f6f4f", color: "#3fa76a" } : undefined,
								onClick: function () { setCur({ no: n, sub: cur.sub }); },
							}, fill(t("chapterN"), { n: n }) + (done ? " ✓" : ""));
						}),
					),
					h("div", { className: "vg-subtabs" },
						SUBS.map(function (s) {
							return h("button", { key: s[0], className: "vg-tab" + (cur.sub === s[0] ? " vg-tab-active" : ""), onClick: function () { setCur({ no: cur.no, sub: s[0] }); } }, t(s[1]));
						}),
						h("div", { style: { flex: 1 } }),
						hasFinal ? h("span", { className: "vg-badge vg-badge-done" }, t("finalBadge")) : null,
					),
					cur.sub === "blueprint" ? h("div", { className: "vg-card" },
						h("div", { className: "vg-grid" },
							Field("本章目标", h("input", { className: "vg-input", value: bp.goal || "", onChange: function (e) { setBp("goal", e.target.value); } })),
							Field("冲突", h("input", { className: "vg-input", value: bp.conflict || "", onChange: function (e) { setBp("conflict", e.target.value); } })),
							Field("场景", h("input", { className: "vg-input", value: bp.scenes || "", onChange: function (e) { setBp("scenes", e.target.value); } })),
							Field("出场角色（逗号分隔 id）", h("input", { className: "vg-input", value: (bp.characterIds || []).join(","), onChange: function (e) { setBp("characterIds", csvToArr(e.target.value)); } })),
							Field("需承接的上一章事实（每行一条）", h("textarea", { className: "vg-textarea", rows: 2, value: arrToLines(bp.factsFromPrev), onChange: function (e) { setBp("factsFromPrev", linesToArr(e.target.value)); } })),
							Field("本章新增事实（每行一条）", h("textarea", { className: "vg-textarea", rows: 2, value: arrToLines(bp.newFacts), onChange: function (e) { setBp("newFacts", linesToArr(e.target.value)); } })),
							Field("关键事件（每行一条）", h("textarea", { className: "vg-textarea", rows: 2, value: arrToLines(bp.keyEvents), onChange: function (e) { setBp("keyEvents", linesToArr(e.target.value)); } })),
							Field("结尾钩子", h("input", { className: "vg-input", value: bp.endingHook || "", onChange: function (e) { setBp("endingHook", e.target.value); } })),
						),
						h("div", { className: "vg-actions" },
							h("button", { className: "vg-btn vg-btn-primary", disabled: !bpDirty || props.busy, onClick: saveBlueprint }, t("save")),
							h("button", { className: "vg-btn", disabled: props.busy || props.channelBlocked, onClick: function () { props.sendTask("generate-chapter-blueprint", { chapter: cur.no }, ""); } }, t("aiGenerate")),
						),
					) : null,
					cur.sub === "draft" ? h("div", { className: "vg-card" },
						h(AiBar, { busy: props.busy, channelBlocked: props.channelBlocked, label: t("aiDraft"), onGo: function (req) { props.sendTask("generate-chapter-draft", { chapter: cur.no }, req); } }),
						h("textarea", {
							className: "vg-textarea", rows: 14, style: { width: "100%", fontFamily: "inherit", lineHeight: 1.7 },
							value: shownDraft, onChange: function (e) { setDraftBuf(e.target.value); },
						}),
						(bodies.candidates && bodies.candidates.length > 0)
						? h("div", { className: "vg-row", style: { marginTop: 6 } },
							h("span", { className: "vg-tpl-meta" }, fill(t("candidateList"), { n: bodies.candidates.length })),
							bodies.candidates.map(function (c) { return h("span", { key: c.rel, className: "vg-chip vg-chip-pending" }, c.name.replace("candidate-", "").replace(".md", "")); }),
						)
						: null,
						h("div", { className: "vg-row", style: { marginTop: 6 } },
							h("span", { className: "vg-tpl-meta" }, fill(t("wordCount"), { n: shownDraft.length })),
							h("div", { style: { flex: 1 } }),
							h("button", { className: "vg-btn vg-btn-primary", disabled: (draftTextBuf === null) || props.busy, onClick: saveDraft }, t("save")),
							h("button", { className: "vg-btn", disabled: !draftText || props.busy, onClick: saveCandidate }, t("saveCandidate")),
							h("button", {
								className: "vg-btn vg-btn-danger", disabled: !draftText || props.busy,
								title: t("finalize"), onClick: finalize,
							}, t("finalize")),
						),
					) : null,
					cur.sub === "review" ? h("div", { className: "vg-card" },
						h(AiBar, { busy: props.busy, channelBlocked: props.channelBlocked, label: t("aiReview"), onGo: function (req) { props.sendTask("review-chapter", { chapter: cur.no }, req); } }),
						h("h3", { style: { margin: "6px 0" } }, t("problemList") + " · " + problems.length),
						problems.length === 0 ? h("p", { className: "vg-hint" }, "—") : null,
						problems.map(function (p) {
							var catKey = { continuity: "probContinuity", motivation: "probMotivation", foreshadow: "probForeshadow", goal: "probGoal" }[p.category] || "probGoal";
							var statusKey = { resolved: "probResolved", unresolved: "probUnresolved", "needs-verify": "probNeedsVerify" }[p.status] || "probUnresolved";
							return h("div", { key: p.id, className: "vg-checkline" },
								h("input", {
									type: "checkbox", checked: !!checkedMap[p.id],
									onChange: function (e) { var n = Object.assign({}, checkedMap); if (e.target.checked) n[p.id] = true; else delete n[p.id]; setChecked(n); },
								}),
								h("span", { className: "vg-chip vg-chip-pending" }, t(catKey)),
								h("span", { style: { flex: 1, minWidth: 0 } },
									p.description,
									p.evidence ? h("span", { className: "vg-tpl-meta", style: { display: "block" } }, t("evidence") + "：" + p.evidence) : null,
								),
								h("span", { className: "vg-chip " + (p.status === "resolved" ? "vg-chip-done" : p.status === "needs-verify" ? "vg-chip-running" : "vg-chip-failed") }, t(statusKey)),
							);
						}),
						h("div", { className: "vg-row", style: { marginTop: 8 } },
							h("span", { className: "vg-hint" }, t("reviseHint")),
							h("div", { style: { flex: 1 } }),
							h("button", {
								className: "vg-btn vg-btn-primary", disabled: props.busy || props.channelBlocked || Object.keys(checkedMap).length === 0,
								onClick: function () { props.sendTask("revise-chapter", { chapter: cur.no, problemIds: Object.keys(checkedMap) }, ""); },
							}, t("aiRevise")),
						),
					) : null,
					cur.sub === "final" ? h("div", { className: "vg-card" },
						hasFinal
							? h("pre", { style: { whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.7, margin: 0 } }, String(bodies.final && bodies.final.data || ""))
							: h("p", { className: "vg-hint" }, t("ovUntouched")),
					) : null,
				);
			}

			function AdaptStage(props) {
				var chapters = props.detail.chapters || [];
				var adaptations = props.detail.adaptations || [];
				var dur = React.useState("90s");
				var duration = dur[0], setDur = dur[1];
				var fid = React.useState("faithful");
				var fidelity = fid[0], setFid = fid[1];
				var lang = React.useState("中文");
				var narration = lang[0], setLang = lang[1];
				var chapterOptions = chapters.filter(function (c) { return c.draftRevision !== "absent" || c.finalRevision !== "absent"; });
				var firstOk = chapterOptions.length > 0 ? chapterOptions[0].number : 1;
				var sel = React.useState(firstOk);
				var chapterNo = sel[0], setSel = sel[1];
				return h("div", { className: "vg-card" },
					h("h3", { style: { margin: "0 0 6px" } }, t("stageAdapt")),
					h("p", { className: "vg-hint" }, t("adaptHint")),
					h("div", { className: "vg-grid" },
						Field(t("adaptSource"), h("select", { className: "vg-select", value: chapterNo, onChange: function (e) { setSel(Number(e.target.value)); } },
							chapterOptions.length === 0 ? h("option", { value: 1 }, "—") : null,
							chapterOptions.map(function (c) { return h("option", { key: c.number, value: c.number }, fill(t("chapterN"), { n: c.number }) + (c.finalRevision !== "absent" ? "（" + t("finalBadge") + "）" : "")); }),
						)),
						Field(t("adaptDuration"), h("select", { className: "vg-select", value: duration, onChange: function (e) { setDur(e.target.value); } },
							["30s", "60s", "90s", "120s"].map(function (d) { return h("option", { key: d, value: d }, d); }),
						)),
						Field(t("adaptFidelity"), h("select", { className: "vg-select", value: fidelity, onChange: function (e) { setFid(e.target.value); } },
							h("option", { value: "faithful" }, t("faithful")),
							h("option", { value: "condensed" }, t("condensed")),
						)),
						Field(t("adaptNarration"), h("input", { className: "vg-input", value: narration, onChange: function (e) { setLang(e.target.value); } })),
					),
					h("div", { className: "vg-actions" },
						h("button", {
							className: "vg-btn vg-btn-primary", disabled: props.busy || props.channelBlocked || chapterOptions.length === 0,
							title: props.channelBlocked ? t("channelWarn") : undefined,
							onClick: function () { props.onCreateAdaptation(("000" + chapterNo).slice(-4), { targetDuration: duration, aspect: "9:16", fidelity: fidelity, narrationLanguage: narration }); },
						}, t("adaptCreate")),
					),
					h("h3", { style: { margin: "10px 0 4px", fontSize: 13 } }, t("adaptations") + " · " + adaptations.length),
					adaptations.map(function (a) {
						return h("div", { key: a.adaptationId, className: "vg-checkline" },
							h("span", { className: "vg-chip vg-chip-pending" }, fill(t("chapterN"), { n: Number(a.chapterId) })),
							h("span", { style: { flex: 1, minWidth: 0 }, className: "vg-tpl-meta" },
								a.adaptationId + " · " + (a.runId ? t("adaptRun") + " " + a.runId : "· " + t("taskNone")) + " · " + a.params.targetDuration + " · " + (a.params.fidelity === "condensed" ? t("condensed") : t("faithful")),
							),
							a.runId ? h("button", { className: "vg-btn vg-btn-mini", onClick: function () { props.onOpenRun(a.runId); } }, t("stageRuns")) : null,
						);
					}),
				);
			}

			/** 视频任务：复用现有 StudioView（runs 列表/详情）。 */
			function RunsStage(props) {
				var runsState = React.useState(null);
				var runs = runsState[0], setRuns = runsState[1];
				var detailState = React.useState(null);
				var detail = detailState[0], setDetail = detailState[1];
				var selected = props.selectedRun;
				React.useEffect(function () {
					var alive = true;
					var tick = function () {
						if (typeof document !== "undefined" && document.visibilityState === "visible") {
							var p = api("runs.list").then(function (v) { if (alive) setRuns(v); });
							if (selected) {
								Promise.all([p, api("runs.get", { id: selected }).then(function (v) { if (alive) setDetail(v); }).catch(function () {})]).catch(function () {});
							}
						}
					};
					tick();
					var timer = setInterval(tick, 3000);
					return function () { alive = false; clearInterval(timer); };
				}, [selected]);
				return h(StudioView, {
					t: t, runs: runs, detail: detail, selected: selected,
					onSelectRun: props.onSelectRun, onBack: props.onClearRun,
				});
			}

			function OverviewStage(props) {
				var d = props.detail;
				var m = d.manifest;
				var counts = {
					premise: d.premise.revision !== "absent" ? "✓" : null,
					arch: d.architecture.revision !== "absent" ? "✓" : null,
					world: (d.worldbuilding.data && d.worldbuilding.data.entries ? fill(t("ovEntries"), { n: d.worldbuilding.data.entries.length }) : null),
					chars: (d.characters.data && d.characters.data.characters ? fill(t("ovEntries"), { n: d.characters.data.characters.length }) : null),
					outline: (d.outline.data && d.outline.data.rows ? fill(t("ovRows"), { n: d.outline.data.rows.length }) : null),
				};
				return h("div", { className: "vg-card" },
					h("div", { className: "vg-kv" },
						h("span", { className: "k" }, t("stagePremise")), h("span", null, (d.premise.data && d.premise.data.logline) || t("ovUntouched")),
						h("span", { className: "k" }, t("stageArch")), h("span", null, counts.arch || t("ovUntouched")),
						h("span", { className: "k" }, t("stageWorld")), h("span", null, counts.world || t("ovUntouched")),
						h("span", { className: "k" }, t("stageChars")), h("span", null, counts.chars || t("ovUntouched")),
						h("span", { className: "k" }, t("stageOutline")), h("span", null, counts.outline || t("ovUntouched")),
						h("span", { className: "k" }, t("stageChapter")), h("span", null, fill(t("chaptersProgress"), { done: props.chaptersFinal, planned: m.plannedChapters })),
					),
				);
			}

			/* ── 二级：项目工作台（三栏壳）── */

			function ProjectWorkbench(props) {
				var wsId = props.workspaceId;
				var projectId = props.projectId;
				var dState = React.useState(null);
				var detail = dState[0], setDetail = dState[1];
				var stageState = React.useState("overview");
				var stage = stageState[0], setStage = stageState[1];
				var reviewState = React.useState(null);
				var reviewing = reviewState[0], setReviewing = reviewState[1];
				var busyState = React.useState(false);
				var busy = busyState[0], setBusy = busyState[1];
				var msgState = React.useState("");
				var msg = msgState[0], setMsg = msgState[1];
				var errState = React.useState("");
				var err = errState[0], setErr = errState[1];
				var sideOpenState = React.useState(true);
				var sideOpen = sideOpenState[0], setSideOpen = sideOpenState[1];
				var selectedRunState = React.useState(null);
				var selectedRun = selectedRunState[0], setSelectedRun = selectedRunState[1];
				var channelsOkState = React.useState(true);
				var channelsOk = channelsOkState[0], setChannelsOk = channelsOkState[1];

				var refresh = React.useCallback(function () {
					return dramaApi("drama.project.get", { workspaceId: wsId, projectId: projectId }).then(function (v) { setDetail(v); });
				}, [wsId, projectId]);

				React.useEffect(function () {
					refresh().catch(function (e) { setErr(String(e.message || e)); });
					api("channels.list").then(function (v) {
						var any = (v.channels || []).some(function (c) { return c.enabled; });
						setChannelsOk(any);
					}).catch(function () {});
				}, [refresh]);

				// 3s 可见性门控轮询
				React.useEffect(function () {
					var timer = setInterval(function () {
						if (typeof document !== "undefined" && document.visibilityState === "visible") refresh().catch(function () {});
					}, 3000);
					var onVis = function () { if (typeof document !== "undefined" && document.visibilityState === "visible") refresh().catch(function () {}); };
					if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
					return function () { clearInterval(timer); if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis); };
				}, [refresh]);

				var saveAsset = function (assetRef, baseRevision, replacement, after) {
					setBusy(true); setErr("");
					dramaApi("drama.asset.update", { workspaceId: wsId, projectId: projectId, assetRef: assetRef, baseRevision: baseRevision, replacement: replacement })
						.then(function () { setMsg(t("saved")); if (after) after(); return refresh(); })
						.catch(function (e) { setErr(String(e.message || e) + (e.code === "stale-revision" ? "（" + t("staleProposal") + "）" : "")); })
						.then(function () { setBusy(false); });
				};
				var sendTask = function (kind, params, userRequest) {
					setBusy(true); setErr(""); setMsg("");
					return dramaApi("drama.task.create", { workspaceId: wsId, projectId: projectId, kind: kind, params: params || {}, userRequest: userRequest || "" })
						.then(function (v) {
							return Promise.resolve(deps.sendInstruction(v.instruction)).then(function (sent) {
								var patch = { status: "running", event: { type: sent.result === "copied" ? "instruction-sent" : "instruction-copy-failed" } };
								if (sent.sessionId) patch.sessionId = sent.sessionId;
								return dramaApi("drama.task.update", { workspaceId: wsId, projectId: projectId, taskId: v.taskId, patch: patch });
							});
						})
						.then(function () { setMsg(t("instructCopied")); return refresh(); })
						.catch(function (e) { setErr(String(e.message || e)); })
						.then(function () { setBusy(false); });
				};
				var createAdaptation = function (chapterId, params) {
					setBusy(true); setErr("");
					dramaApi("drama.adaptation.create", { workspaceId: wsId, projectId: projectId, chapterId: chapterId, params: params })
						.then(function (v) {
							return Promise.resolve(deps.sendInstruction(v.instruction)).then(function (sent) {
								var patch = { status: "running", event: { type: sent.result === "copied" ? "instruction-sent" : "instruction-copy-failed" } };
								if (sent.sessionId) patch.sessionId = sent.sessionId;
								return dramaApi("drama.task.update", { workspaceId: wsId, projectId: projectId, taskId: v.taskId, patch: patch });
							});
						})
						.then(function () { setMsg(t("instructCopied")); return refresh(); })
						.catch(function (e) { setErr(String(e.message || e)); })
						.then(function () { setBusy(false); });
				};
				var quickProposalAction = function (proposalId, action) {
					setBusy(true); setErr("");
					var call = action === "apply"
						? dramaApi("drama.proposal.apply", { workspaceId: wsId, projectId: projectId, proposalId: proposalId })
						: dramaApi("drama.proposal.reject", { workspaceId: wsId, projectId: projectId, proposalId: proposalId });
					call.then(function (v) { setMsg(action === "apply" ? fill(t("applyOk"), { rev: shortRev(v.revision) }) : t("rejectOk")); setReviewing(null); return refresh(); })
						.catch(function (e) { setErr(String(e.message || e)); })
						.then(function () { setBusy(false); });
				};

				if (!detail) {
					return err ? h("div", { className: "vg-msg vg-msg-err" }, err) : h("p", { className: "vg-hint" }, t("loading"));
				}
				var pending = (detail.proposals || []).filter(function (p) { return p.status === "pending"; });
				var reviewingProposal = null;
				if (reviewing) {
					for (var i = 0; i < (detail.proposals || []).length; i++) {
						if (detail.proposals[i].proposalId === reviewing) reviewingProposal = detail.proposals[i];
					}
				}
				var chaptersFinal = (detail.chapters || []).filter(function (c) { return c.finalRevision !== "absent"; }).length;
				var stageProps = {
					detail: detail, busy: busy, channelBlocked: !channelsOk,
					saveAsset: saveAsset, sendTask: sendTask, onReview: function (id) { setReviewing(id); },
					workspaceId: wsId, projectId: projectId,
					onFinalized: function () { setMsg(t("finalized")); },
					onCreateAdaptation: createAdaptation,
					onOpenRun: function (runId) { setSelectedRun(runId); setStage("runs"); },
					selectedRun: selectedRun, onSelectRun: function (id) { setSelectedRun(id); }, onClearRun: function () { setSelectedRun(null); },
					chaptersFinal: chaptersFinal,
				};
				var mainView = null;
				if (reviewingProposal) {
					mainView = h(ProposalDiff, {
						workspaceId: wsId, projectId: projectId, proposal: reviewingProposal,
						onApplied: function (m) { setMsg(m); setReviewing(null); refresh().catch(function () {}); },
						onRejected: function (m) { setMsg(m); setReviewing(null); refresh().catch(function () {}); },
						onBack: function () { setReviewing(null); },
					});
				} else if (stage === "overview") mainView = h(OverviewStage, stageProps);
				else if (stage === "premise") mainView = h(PremiseStage, stageProps);
				else if (stage === "arch") mainView = h(ArchStage, stageProps);
				else if (stage === "world") mainView = h(WorldStage, stageProps);
				else if (stage === "chars") mainView = h(CharsStage, stageProps);
				else if (stage === "outline") mainView = h(OutlineStage, stageProps);
				else if (stage === "chapter") mainView = h(ChapterStage, stageProps);
				else if (stage === "adapt") mainView = h(AdaptStage, stageProps);
				else if (stage === "runs") mainView = h(RunsStage, stageProps);
				var navCount = { chapter: chaptersFinal + "/" + (detail.manifest.plannedChapters || 0), adapt: (detail.adaptations || []).length || "" };
				return h("div", null,
					h("div", { className: "vg-row", style: { marginBottom: 10 } },
						h("button", { className: "vg-btn", onClick: props.onBack }, "← " + t("backToList")),
						h("span", { className: "vg-wb-title" }, detail.manifest.title),
						statusChip(t, detail.status),
						h("span", { className: "vg-tpl-meta" }, fill(t("chaptersProgress"), { done: chaptersFinal, planned: detail.manifest.plannedChapters })),
						(pending.length > 0 ? h("span", { className: "vg-badge vg-badge-review" }, fill(t("pendingN"), { n: pending.length })) : null),
						h("div", { style: { flex: 1 } }),
						h("button", { className: "vg-btn vg-btn-mini", onClick: deps.backToConversation }, "← " + t("backToChat")),
						h("button", { className: "vg-btn vg-btn-mini", onClick: function () { setSideOpen(!sideOpen); } }, sideOpen ? t("collapse") : t("expand")),
					),
					msg ? h("div", { className: "vg-msg vg-msg-ok" }, msg) : null,
					err ? h("div", { className: "vg-msg vg-msg-err" }, err) : null,
					!channelsOk ? h("div", { className: "vg-banner warn" }, t("channelWarn")) : null,
					h("div", { className: "vg-wb-shell" },
						h("div", { className: "vg-wb-nav" },
							WB_STAGES.map(function (s) {
								return h("button", {
									key: s[0], className: stage === s[0] ? "active" : "",
									onClick: function () { setStage(s[0]); setReviewing(null); },
								}, h("span", null, t(s[1])), navCount[s[0]] ? h("span", { className: "cnt" }, navCount[s[0]]) : null);
							}),
						),
						h("div", { className: "vg-wb-main" }, mainView),
						sideOpen ? h("div", { className: "vg-wb-side" },
							h(AgentPanel, {
								detail: detail,
								onOpenSession: deps.openSession,
								onReviewProposal: function (id) { setReviewing(id); },
							}),
							h("div", { className: "vg-card" },
								h("h4", null, t("pendingProposals") + " · " + pending.length),
								pending.map(function (p) {
									return h("div", { key: p.proposalId, className: "vg-proposal" },
										h("div", { className: "vg-proposal-head" },
											h("span", { className: "vg-badge vg-badge-review" }, fill(t("proposalCard"), { kind: p.kind })),
											!p.fresh ? h("span", { className: "vg-chip vg-chip-failed" }, "stale") : null,
										),
										h("p", { className: "vg-hint", style: { margin: "4px 0" } }, (p.summary || "").slice(0, 80)),
										h("div", { className: "vg-actions" },
											h("button", { className: "vg-btn vg-btn-mini", onClick: function () { setReviewing(p.proposalId); } }, t("viewDiff")),
											h("button", { className: "vg-btn vg-btn-mini", disabled: busy || !p.fresh, onClick: function () { quickProposalAction(p.proposalId, "apply"); } }, t("doApply")),
											h("button", { className: "vg-btn vg-btn-mini vg-btn-danger", disabled: busy, onClick: function () { quickProposalAction(p.proposalId, "reject"); } }, t("doReject")),
										),
									);
								}),
								pending.length === 0 ? h("p", { className: "vg-hint" }, "—") : null,
							),
						) : null,
					),
				);
			}

			/* ── 一级：项目列表页 ── */

			function DramaApp() {
				var wsState = React.useState(null);
				var ws = wsState[0], setWs = wsState[1];
				var wsIdState = React.useState("");
				var wsId = wsIdState[0], setWsId = wsIdState[1];
				var projectsState = React.useState(null);
				var projects = projectsState[0], setProjects = projectsState[1];
				var openIdState = React.useState(null);
				var openId = openIdState[0], setOpenId = openIdState[1];
				var wizState = React.useState(false);
				var wizard = wizState[0], setWizard = wizState[1];
				var msgState = React.useState("");
				var msg = msgState[0], setMsg = msgState[1];
				var errState = React.useState("");
				var err = errState[0], setErr = errState[1];
				var filterState = React.useState({ status: "all", q: "" });
				var filter = filterState[0], setFilter = filterState[1];

				var loadWs = React.useCallback(function () {
					return dramaApi("drama.workspace.resolve", {}).then(function (v) {
						setWs(v);
						setWsId(function (cur) { return cur || ((v.workspaces && v.workspaces[0] && v.workspaces[0].id) || ""); });
					});
				}, []);
				var loadProjects = React.useCallback(function () {
					return dramaApi("drama.project.list", wsId ? { workspaceId: wsId } : {}).then(function (v) { setProjects(v.projects || []); });
				}, [wsId]);

				React.useEffect(function () { loadWs().catch(function (e) { setErr(String(e.message || e)); }); }, []);
				React.useEffect(function () { loadProjects().catch(function () {}); }, [loadProjects]);
				React.useEffect(function () {
					var timer = setInterval(function () {
						if (typeof document !== "undefined" && document.visibilityState === "visible" && openId === null) loadProjects().catch(function () {});
					}, 3000);
					return function () { clearInterval(timer); };
				}, [loadProjects, openId]);

				if (ws && !ws.registryAvailable) {
					return h("div", { className: "vg-root" },
						h("h2", { style: { margin: 0, fontSize: 16 } }, t("wbTitle")),
						h("div", { className: "vg-banner warn" }, t("registryMissing")),
					);
				}
				if (openId !== null && wsId) {
					return h("div", { className: "vg-root", style: { maxWidth: "none" } },
						h(ProjectWorkbench, { workspaceId: wsId, projectId: openId, onBack: function () { setOpenId(null); loadProjects().catch(function () {}); } }),
					);
				}
				var list = (projects || []).filter(function (p) {
					if (filter.status !== "all" && p.status !== filter.status) return false;
					if (filter.q && String(p.title || "").toLowerCase().indexOf(filter.q.toLowerCase()) === -1) return false;
					return true;
				});
				return h("div", { className: "vg-root" },
					h("div", { className: "vg-row" },
						h("h2", { style: { margin: 0, fontSize: 16 } }, t("wbTitle")),
						h("div", { style: { flex: 1 } }),
						h("button", { className: "vg-btn vg-btn-mini", onClick: deps.backToConversation }, "← " + t("backToChat")),
						h("button", { className: "vg-btn", disabled: !wsId, onClick: function () { loadProjects().catch(function () {}); } }, t("refresh")),
						h("button", { className: "vg-btn vg-btn-primary", disabled: !wsId, onClick: function () { setWizard(true); } }, t("newProject")),
					),
					h("p", { className: "vg-intro" }, t("wbIntro")),
					msg ? h("div", { className: "vg-msg vg-msg-ok" }, msg) : null,
					err ? h("div", { className: "vg-msg vg-msg-err" }, err) : null,
					!ws ? h("p", { className: "vg-hint" }, t("loading")) : null,
					ws && wsId ? h("div", { className: "vg-wb-toolbar" },
						h("span", { className: "vg-tpl-meta" }, t("wsPick")),
						h("select", {
							className: "vg-select", value: wsId,
							onChange: function (e) { setWsId(e.target.value); setProjects(null); },
						}, (ws.workspaces || []).map(function (w) { return h("option", { key: w.id, value: w.id }, w.title || w.id); })),
						h("select", {
							className: "vg-select", value: filter.status,
							onChange: function (e) { setFilter(Object.assign({}, filter, { status: e.target.value })); },
						}, ["all", "writing", "pending-review", "adapting", "done"].map(function (s) {
							return h("option", { key: s, value: s }, s === "all" ? t("filterAll") : t(D_STATUS_KEY[s]));
						})),
						h("input", {
							className: "vg-input", placeholder: t("search"), value: filter.q,
							onChange: function (e) { setFilter(Object.assign({}, filter, { q: e.target.value })); },
						}),
						h("span", { className: "vg-tpl-meta" }, t("autoRefreshHint")),
					) : null,
					wizard ? h(ProjectWizard, {
						workspaceId: wsId,
						onCreated: function (projectId) { setWizard(false); setMsg(t("created")); loadProjects().catch(function () {}); setOpenId(projectId); },
						onCancel: function () { setWizard(false); },
					}) : null,
					!wizard && projects && list.length === 0 ? h("p", { className: "vg-hint" }, t("emptyProjects")) : null,
					list.map(function (p) {
						return h(ProjectCard, { key: p.workspaceId + "/" + p.id, project: p, onOpen: function () { setOpenId(p.id); } });
					}),
				);
			}

			return DramaApp;
		}


		/* ── 入口：注册 locale 字典 + settings.section + 工作台 ── */

		var inject = ["slots", "locale", "sessions", "uiConversation", "layout"];

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
			
			// 设置页注册（通道与预算；§8 收敛后仅此一项）。防御：注册失败只降级。
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

			// ── 任务指令发送桥（§6.2）：复制指令 → 建立或复用普通会话 → 切回会话视图。
			// 面板激活时输入壳未挂载（fillDraft 类 API 无接收面），沿用零耦合剪贴板方案：
			// 粘贴(⌘V/Ctrl+V)回车即发。返回 Promise<{result:'copied'|'none', sessionId?}>。
			var sendInstruction = function (text) {
				var current;
				try {
					current = ctx.sessions && ctx.sessions.list && typeof ctx.sessions.list.getSnapshot === "function"
						? ctx.sessions.list.getSnapshot().current : undefined;
				} catch (e) { current = undefined; }
				var write = Promise.resolve("none");
				try {
					if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
						write = navigator.clipboard.writeText(text)
							.then(function () { return "copied"; })
							.catch(function () { return "none"; });
					}
				} catch (error) { /* 剪贴板不可用 */ }
				return Promise.resolve(write).then(function (result) {
					if (result !== "copied") return { result: "none", sessionId: current };
					var ensure;
					if (!current && ctx.sessions && typeof ctx.sessions.create === "function") {
						ensure = ctx.sessions.create().then(function (id) {
							try { if (typeof ctx.sessions.open === "function") ctx.sessions.open(id); } catch (openError) { /* 已选中 */ }
							return id;
						}).catch(function () { return undefined; });
					} else {
						ensure = Promise.resolve(current);
					}
					return ensure.then(function (sid) {
						try {
							if (ctx.layout && typeof ctx.layout.selectPanel === "function") ctx.layout.selectPanel(null);
						} catch (layoutError) { /* 服务不可达：留在当前面板 */ }
						return { result: "copied", sessionId: sid || current };
					});
				});
			};

			var openSessionById = function (sessionId) {
				var pre = ctx.sessions && typeof ctx.sessions.refresh === "function"
					? Promise.resolve(ctx.sessions.refresh()).catch(function () {}) : Promise.resolve();
				pre.then(function () {
					try { if (ctx.sessions && typeof ctx.sessions.open === "function") ctx.sessions.open(sessionId); } catch (e) { return; }
					try { if (ctx.layout && typeof ctx.layout.selectPanel === "function") ctx.layout.selectPanel(null); } catch (e) { /* 留在当前面板 */ }
				});
			};

			var backToConversation = function () {
				try { if (ctx.layout && typeof ctx.layout.selectPanel === "function") ctx.layout.selectPanel(null); } catch (e) { /* 服务不可达 */ }
			};

			var PanelIcon = function (props) {
				return React.createElement("svg", {
					width: (props && props.size) || 18,
					height: (props && props.size) || 18,
					viewBox: "0 0 24 24", fill: "none",
					stroke: "currentColor", strokeWidth: 2,
					strokeLinecap: "round", strokeLinejoin: "round",
					"aria-hidden": true,
				},
					React.createElement("path", { d: "M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" }),
					React.createElement("path", { d: "m6.2 5.3 3.1 3.9" }),
					React.createElement("path", { d: "m12.4 3.4 3.1 4" }),
					React.createElement("path", { d: "M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" }),
				);
			};

			var DramaApp = makeDramaComponents(t, {
				sendInstruction: sendInstruction,
				openSession: openSessionById,
				backToConversation: backToConversation,
			});

			// ── 0.1.5 左侧栏原生接入（sidebar.panellist + main keyed）──
			// 图标行位于「新任务」与工作区列表之间（order 110，场记板字形）；
			// main keyed slot 挂漫剧工坊主面板（项目列表 → 三栏工作台）。
			// 软探测：宿主 ≤0.1.4 无这些 slot 时静默跳过，设置页入口仍在（验收 2）。
			try {
				ctx.slots.inject("sidebar.panellist", function () {
					var disposeIcon = ctx.slots.register({
						name: "sidebar.panellist",
						id: PANEL_ID,
						order: 110,
						label: function () { return t("nav"); },
						locale: NS,
					}, PanelIcon);
					var disposePanel = ctx.slots.register({
						name: "main",
						key: PANEL_ID,
					}, DramaApp);
					return function () { disposePanel(); disposeIcon(); };
				});
			} catch (error) {
				console.warn("[dsh-video-generator] 宿主无左侧栏 slot（≤0.1.4?），跳过 panellist 接入，设置页入口不受影响:", error && error.message);
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
