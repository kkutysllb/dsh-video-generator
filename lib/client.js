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
 * DSH 0.1.7-rc.2 契约对齐（会话桥 v4，详见下方会话桥注释）：
 * SessionListState 删 current、sessions.open() 删、binding/scope 只认已 retain
 * 的 generation ⇒ 当前会话按 retainedBy.mainView 判定、选中并展示走
 * uiWorkspace.openSession（可选面经 ctx.get 软探测）、递送期 sessions.using 持引用；
 * 旧宿主（≤0.1.6）的 list.current / sessions.open 面保留软降级，双世代兼容。
 *
 * 设置页「视频工坊」双 tab：
 * - 工坊：run 列表 → 详情（阶段徽章/gate/评审档案/产物预览/花费），3s 轮询仅在
 *   本 tab 可见（document.visibilityState === 'visible'）时运转；
 * - 通道管理：通道 CRUD（apiKey 脱敏回显）/启用/测试探测/用途槽（每槽恰好一个模型 +
 *   真实小额测试 + 音乐映射模板）/预算阈值/gate 缺省。
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
		var STAGES = ["story", "script", "storyboard", "master-asset", "shot-assets", "video", "music", "final-cut"];
		var MEDIA_STAGES = ["master-asset", "shot-assets", "video", "music", "final-cut"];

		/* ── 双语文案（zh / en，键集完整一致）────────────────── */

		var zh = {
			nav: "漫剧工坊",
			title: "漫剧工坊",
			tabChannels: "通道管理",
			autoRefreshHint: "每 3 秒自动刷新",
			intro: "生成通道与预算配置：视频/图像/TTS 模型三要素自配（官方/中转皆可）。创作请在侧边栏「漫剧工坊」进行。",
			runs: "生成任务",
			runsEmpty: "还没有 run。在对话里让 Agent 走 vgen_story → vgen_script → vgen_storyboard → vgen_generate 三段交接即可开工。",
			refresh: "刷新",
			retrySend: "重试发送",
			regenBtn: "重新生成",
			regenRequest: "基于最新版本重新生成该资产内容（此前提案已过期）",
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
			enable: "启用",
			test: "测试通道",
			testing: "探测中…",
			testOk: "探测成功：枚举到 {n} 个模型",
			testFail: "探测失败：{err}",
			slotsTitle: "用途槽",
			slotsIntro: "每个用途只绑定一个模型：选通道、填模型名，保存后点「测试」做一次真实小额验证；未绑定的用途不可用。音乐槽可套用映射模板（按协议形态预填，不绑定任何服务商）。",
			slotChannel: "通道",
			slotModel: "模型名",
			slotCaps: "能力",
			slotProtocol: "协议族",
			slotTest: "测试",
			slotTesting: "测试中…",
			slotSave: "保存绑定",
			slotUnbound: "未绑定",
			slotVoice: "音色（可选）",
			slotInstructions: "语气指令（可选）",
			slotMaxDur: "单段最长秒数",
			slotMapping: "通用映射（JSON）",
			slotTpl: "套用模板",
			slotTplSaveAs: "另存为模板",
			slotTplSavePrompt: "模板名称：",
			slotTplDelete: "删除模板…",
			slotTplDeleteConfirm: "确定删除模板「{name}」？此操作不可撤销。",
			slotInvalidJson: "映射不是合法 JSON",
			slotTestOk: "测试通过：{detail}",
			slotTestFail: "测试失败：{err}",
			slotSavedOk: "绑定已保存",
			slotNeedChannel: "请先在上方添加并启用通道",
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
			autoRefreshHint: "auto-refreshes every 3s",
			intro: "Channels & budget: bring your own OpenAI-compatible endpoints (official or relay). For creation, use the Drama Workbench in the sidebar.",
			runs: "Runs",
			runsEmpty: "No runs yet. Ask the Agent in chat to walk the vgen_story → vgen_script → vgen_storyboard → vgen_generate handoffs to get started.",
			refresh: "Refresh",
			retrySend: "Retry send",
			regenBtn: "Regenerate",
			regenRequest: "Regenerate this asset from the latest revision (previous proposal went stale)",
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
			enable: "Enabled",
			test: "Test channel",
			testing: "Probing…",
			testOk: "Probe OK: {n} models enumerated",
			testFail: "Probe failed: {err}",
			slotsTitle: "Use slots",
			slotsIntro: "Each purpose binds exactly one model: pick a channel, type the model name, save, then Test (one real minimal paid call). Unbound purposes are unavailable. Music slots accept mapping templates (shape-based prefills, provider-agnostic).",
			slotChannel: "Channel",
			slotModel: "Model",
			slotCaps: "Capabilities",
			slotProtocol: "Protocol",
			slotTest: "Test",
			slotTesting: "Testing…",
			slotSave: "Save binding",
			slotUnbound: "Unbound",
			slotVoice: "Voice (optional)",
			slotInstructions: "Instructions (optional)",
			slotMaxDur: "Max seconds per clip",
			slotMapping: "Generic mapping (JSON)",
			slotTpl: "Apply template",
			slotTplSaveAs: "Save as template",
			slotTplSavePrompt: "Template name:",
			slotTplDelete: "Delete template…",
			slotTplDeleteConfirm: "Delete template \"{name}\"? This cannot be undone.",
			slotInvalidJson: "Mapping is not valid JSON",
			slotTestOk: "Test passed: {detail}",
			slotTestFail: "Test failed: {err}",
			slotSavedOk: "Binding saved",
			slotNeedChannel: "Add and enable a channel first",
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
			wsAll: "全部工作区",
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
			wizConfirmHint: "确认无误后点击「创建项目」，项目将创建到当前所选工作区。",
			// 工作台三栏
			backToList: "返回列表",
			"tk-generate-architecture": "生成故事架构",
			"tk-generate-worldbuilding": "生成世界观",
			"tk-complete-characters": "补全角色",
			"tk-generate-outline": "生成全书大纲",
			"tk-generate-chapter-blueprint": "写本章蓝图",
			"tk-generate-chapter-draft": "写本章草稿",
			"tk-review-chapter": "本章审稿",
			"tk-revise-chapter": "修订草稿",
			"tk-adapt-chapter": "漫剧改编",
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
			adaptNoChapters: "暂无可改编章节（需先有初稿或定稿）",
			adaptNoChaptersHint: "改编以章节正文为源（优先定稿，其次初稿；仅蓝图不行）。请先到「章节」页让 Agent 写初稿，并在提案卡片上应用。",
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
			instructPrefilled: "任务指令已填入会话输入框——回车即可发送",
			instructNone: "指令复制失败：请到任务详情手动复制指令内容",
			taskCreated: "任务已创建",
			worldCited: "供正文引用",
			worldAdd: "添加条目",
			charAdd: "添加角色",
			latestFinal: "最近成片",
			costRisk: "成本/风险",
			sessionInterrupted: "会话可能已中断（宿主重启）——可重发任务指令继续",
			resendInstruction: "重发指令",
			resendNone: "任务指令缺失，无法重发",
			visualAsset: "视觉",
			visualAssetHint: "已在视频任务生成 master-asset 角色图",
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
			wsAll: "All workspaces",
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
			wizConfirmHint: "Review the details, then click Create — the project will be created in the selected workspace.",
			backToList: "Back",
			"tk-generate-architecture": "Generate architecture",
			"tk-generate-worldbuilding": "Generate worldbuilding",
			"tk-complete-characters": "Complete characters",
			"tk-generate-outline": "Generate outline",
			"tk-generate-chapter-blueprint": "Chapter blueprint",
			"tk-generate-chapter-draft": "Chapter draft",
			"tk-review-chapter": "Review chapter",
			"tk-revise-chapter": "Revise chapter",
			"tk-adapt-chapter": "Adaptation",
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
			adaptNoChapters: "No adaptable chapters yet (a draft or final is required)",
			adaptNoChaptersHint: "Adaptation uses the chapter manuscript (final first, then draft — a blueprint alone is not enough). Generate a draft on the Chapters page and apply its proposal first.",
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
			instructPrefilled: "Instruction placed in the chat composer — press Enter to send",
			instructNone: "Copy failed: open the task details and copy the instruction manually",
			taskCreated: "Task created",
			worldCited: "cited in body",
			worldAdd: "Add entry",
			charAdd: "Add character",
			latestFinal: "Latest cut",
			costRisk: "Cost/Risk",
			sessionInterrupted: "Session may be gone (host restarted) — resend the instruction to continue",
			resendInstruction: "Resend instruction",
			resendNone: "Task instruction missing; cannot resend",
			visualAsset: "visual",
			visualAssetHint: "master-asset character image generated in video runs",
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
			// 主题令牌别名层（对齐自动化任务/动效技能插件的宿主配色配方）：三个根容器
			// 定义 --vg-* 本地别名，全部规则只引用本地别名；底层一律 --dsw-alias-*
			// 原生令牌 + 硬编码 fallback，明暗主题随宿主切换，插件自身不再自带色板。
			".vg-root,.vg-set,.vg-wb-page{"
				+ "--vg-fg:var(--dsw-alias-label-primary,#1f2329);"
				+ "--vg-fg-2:var(--dsw-alias-label-secondary,#5a6472);"
				+ "--vg-muted:var(--dsw-alias-label-tertiary,#8a94a3);"
				+ "--vg-caption:var(--dsw-alias-label-caption,#9aa3b0);"
				+ "--vg-fill:var(--dsw-alias-bg-skeleton,rgba(127,127,127,.14));"
				+ "--vg-fill-hover:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.2));"
				+ "--vg-border:var(--dsw-alias-border-l3,rgba(127,127,127,.3));"
				+ "--vg-border-strong:var(--dsw-alias-border-l4,rgba(127,127,127,.48));"
				+ "--vg-layer:var(--dsw-alias-bg-layer-2,#ffffff);"
				+ "--vg-primary:var(--dsw-alias-button-primary-fill,#4176e6);"
				+ "--vg-primary-hover:var(--dsw-alias-button-primary-hover,#3668d4);"
				+ "--vg-primary-fg:var(--dsw-alias-label-primary-foreground,#ffffff);"
				+ "--vg-info:var(--dsw-alias-state-business-primary,#2e90fa);"
				+ "--vg-success:var(--dsw-alias-state-success-primary,#0f9d58);"
				+ "--vg-warn:var(--dsw-alias-state-warn-primary,#f5a209);"
				+ "--vg-error:var(--dsw-alias-state-error-primary,#d0403d);"
				+ "}",
			".vg-root{display:flex;flex-direction:column;gap:20px;max-width:760px;color:var(--vg-fg);font-size:13px;line-height:1.5;}",
			".vg-intro{margin:0;color:var(--vg-muted);}",
			".vg-card{border:1px solid var(--vg-border);border-radius:12px;padding:14px 16px;}",
			".vg-card h3{margin:0 0 4px;font-size:14px;font-weight:600;}",
			".vg-hint{margin:0 0 10px;font-size:12px;color:var(--vg-muted);}",
			".vg-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}",
			// 列表行（run 行 / 通道行共用）：分隔线 + 名称/元信息排版
			".vg-tpl{padding:10px 0;border-top:1px solid var(--vg-border);}",
			".vg-tpl:first-of-type{border-top:none;}",
			".vg-tpl-name{font-weight:600;color:var(--vg-fg);}",
			".vg-tpl-desc{font-size:12px;margin-top:2px;color:var(--vg-fg-2);}",
			".vg-tpl-meta{font-size:11px;display:flex;gap:12px;flex-wrap:wrap;color:var(--vg-muted);font-variant-numeric:tabular-nums;}",
			// 徽章/chip：999px 胶囊 + 同色 16% color-mix 铺底（自动化任务同款状态色映射：
			// running/writing=info、pending/review/adapting=warn、done=success、failed=error）
			".vg-badge{border-radius:999px;padding:2px 8px;font-size:11px;font-weight:500;color:var(--vg-success);background:color-mix(in srgb,var(--vg-success) 16%,transparent);}",
			".vg-badge-running{color:var(--vg-info);background:color-mix(in srgb,var(--vg-info) 16%,transparent);}",
			".vg-badge-failed{color:var(--vg-error);background:color-mix(in srgb,var(--vg-error) 16%,transparent);}",
			".vg-badge-done{color:var(--vg-success);background:color-mix(in srgb,var(--vg-success) 16%,transparent);}",
			".vg-badge-review{color:var(--vg-warn);background:color-mix(in srgb,var(--vg-warn) 16%,transparent);}",
			".vg-actions{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;}",
			".vg-btn{border:1px solid var(--vg-border-strong);background:transparent;color:var(--vg-fg);border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;transition:background .15s,border-color .15s;}",
			".vg-btn:hover{background:var(--vg-fill-hover);}",
			".vg-btn[disabled]{opacity:.45;cursor:not-allowed;}",
			".vg-btn[disabled]:hover{background:transparent;}",
			".vg-btn-danger:hover{border-color:var(--vg-error);color:var(--vg-error);}",
			// 主按钮：宿主品牌实底（去渐变/发光/位移）；mini 按钮同族缩小
			".vg-btn-primary{background:var(--vg-primary);border-color:transparent;color:var(--vg-primary-fg);font-weight:500;}",
			".vg-btn-primary:hover{background:var(--vg-primary-hover);border-color:transparent;}",
			".vg-btn-primary[disabled]{background:var(--vg-fill);border-color:transparent;color:var(--vg-muted);cursor:not-allowed;}",
			".vg-btn-mini{border:1px solid var(--vg-border);background:transparent;color:var(--vg-fg-2);border-radius:8px;padding:3px 9px;font-size:11px;cursor:pointer;transition:background .15s,color .15s,border-color .15s;}",
			".vg-btn-mini:hover{background:var(--vg-fill-hover);color:var(--vg-fg);}",
			".vg-btn-mini[disabled]{opacity:.4;cursor:not-allowed;}",
			".vg-field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px;}",
			".vg-field label{font-size:12px;color:var(--vg-fg-2);}",
			".vg-input,.vg-select,.vg-textarea{border:1px solid var(--vg-border);border-radius:8px;background:transparent;color:var(--vg-fg);padding:5px 10px;font-size:13px;transition:border-color .15s;}",
			".vg-input:hover,.vg-select:hover,.vg-textarea:hover{border-color:var(--vg-border-strong);}",
			".vg-input:focus,.vg-select:focus,.vg-textarea:focus{outline:none;border-color:var(--vg-info);}",
			".vg-input::placeholder,.vg-textarea::placeholder{color:var(--vg-caption);}",
			".vg-textarea{resize:vertical;min-height:56px;font-family:inherit;line-height:1.45;}",
			// 设置页工坊 tab 的任务导向 hero（左侧主色细条）
			".vg-work-hero{border:1px solid var(--vg-border);border-left:3px solid var(--vg-primary);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;}",
			".vg-work-hero h2{margin:0;font-size:15px;font-weight:600;}",
			".vg-work-intro{margin:0;font-size:12px;color:var(--vg-muted);}",
			".vg-work-cta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}",
			".vg-work-sent{font-size:12px;color:var(--vg-info);}",
			".vg-work-sec{margin-top:0;}",
			".vg-work-sec>h3{margin:0 0 2px;font-size:13px;font-weight:600;}",
			".vg-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;}",
			".vg-msg{border-radius:8px;padding:6px 10px;font-size:12px;}",
			".vg-msg-ok{background:color-mix(in srgb,var(--vg-success) 12%,transparent);color:var(--vg-success);}",
			".vg-msg-err{background:color-mix(in srgb,var(--vg-error) 12%,transparent);color:var(--vg-error);}",
			// 双 tab 条 + 阶段 chips（四态色复用徽章色板）
			".vg-tabs{display:flex;gap:8px;margin:8px 0 4px;}",
			".vg-tab{border:1px solid var(--vg-border-strong);background:transparent;color:var(--vg-fg);border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;}",
			".vg-tab:hover{background:var(--vg-fill-hover);}",
			".vg-tab-done{border-color:var(--vg-success);color:var(--vg-success);}",
			".vg-tab-active{border-color:var(--vg-primary);color:var(--vg-primary);font-weight:600;}",
			".vg-stage-chips{display:flex;gap:4px;flex-wrap:wrap;}",
			".vg-chip{border-radius:999px;padding:2px 8px;font-size:11px;color:var(--vg-muted);background:var(--vg-fill);}",
			".vg-chip-pending{color:var(--vg-muted);background:var(--vg-fill);}",
			".vg-chip-running{color:var(--vg-info);background:color-mix(in srgb,var(--vg-info) 16%,transparent);}",
			".vg-chip-done{color:var(--vg-success);background:color-mix(in srgb,var(--vg-success) 16%,transparent);}",
			".vg-chip-failed{color:var(--vg-error);background:color-mix(in srgb,var(--vg-error) 16%,transparent);}",
			// 产物预览网格：图片缩略 / 视频内联播放
			".vg-preview-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;}",
			".vg-preview-grid img{width:100%;border-radius:8px;}",
			".vg-preview-grid video{width:100%;border-radius:8px;background:#000;}",
			".vg-probe{font-size:12px;margin-top:6px;}",
			".vg-probe-ok{color:var(--vg-success);}",
			".vg-probe-err{color:var(--vg-error);}",
			"@media (max-width:640px){.vg-grid{grid-template-columns:1fr;}}",
			// ── 设置页菜单式版式（vg-set-* 前缀，对齐 dsh-coding-sidebar SideCardSection 配方）──
			// DSH 原生令牌（--dsw-alias-*）驱动明暗主题；分组卡片 + 菜单式设置行（标题/描述在左、
			// 控件在右、细分隔线）+ 开关/按钮/输入框 DSH 原生风格。
			".vg-set{display:flex;flex-direction:column;gap:16px;max-width:760px;color:var(--dsw-alias-label-primary,#1a1a1a);font-size:13px;line-height:1.5;}",
			".vg-set-intro{margin:0;padding:0 2px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,#888);}",
			".vg-set-version{display:flex;align-items:baseline;gap:7px;padding:0 2px;font-size:13px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary,#1a1a1a);}",
			".vg-set-version-tag{padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#f0f0f0);font-size:11px;line-height:16px;font-weight:500;color:var(--dsw-alias-label-secondary,#666);font-variant-numeric:tabular-nums;}",
			// 分组卡片：DSH 原生卡片配方（PluginCard）— l2 细线边框、16px 圆角、layer-3 填充
			".vg-set-group{flex:none;display:flex;flex-direction:column;gap:8px;padding:20px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:16px;background:var(--dsw-alias-bg-layer-3,#fff);}",
			".vg-set-group-head{display:flex;align-items:baseline;gap:7px;padding:0 2px 6px;font-size:13px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary,#1a1a1a);}",
			".vg-set-group-count{padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#f0f0f0);font-size:11px;line-height:16px;font-weight:500;color:var(--dsw-alias-label-secondary,#666);font-variant-numeric:tabular-nums;}",
			".vg-set-group-hint{margin:0;padding:0 2px 4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888);}",
			// 菜单式设置行：标题/描述在左、控件在右、细分隔线（对齐 DSH General section 行配方）
			".vg-set-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 2px;border-bottom:1px solid var(--dsw-alias-border-l2,#ddd);}",
			".vg-set-row:last-child{border-bottom:none;}",
			".vg-set-row-text{display:flex;flex-direction:column;gap:4px;min-width:0;}",
			".vg-set-row-title{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,#1a1a1a);}",
			".vg-set-row-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888);overflow-wrap:anywhere;}",
			".vg-set-row-control{flex:none;display:flex;align-items:center;gap:6px;}",
			// 开关：真实 checkbox（原生语义+焦点）驱动 36×20 轨道+滑块
			".vg-set-switch{position:relative;display:inline-flex;flex:none;cursor:pointer;}",
			".vg-set-switch-input{position:absolute;width:1px;height:1px;margin:0;opacity:0;}",
			".vg-set-switch-track{display:inline-flex;align-items:center;width:36px;height:20px;padding:2px;box-sizing:border-box;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,#ddd);background:var(--dsw-alias-bg-layer-2,#f0f0f0);transition:background .15s ease,border-color .15s ease;}",
			".vg-set-switch-thumb{display:block;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#888);transition:transform .15s ease,background .15s ease;}",
			".vg-set-switch:hover .vg-set-switch-track{border-color:var(--dsw-alias-label-dimmed,#aaa);}",
			".vg-set-switch-input:checked + .vg-set-switch-track{border-color:var(--dsw-alias-button-primary-fill,#4176e6);background:var(--dsw-alias-button-primary-fill,#4176e6);}",
			".vg-set-switch-input:checked + .vg-set-switch-track .vg-set-switch-thumb{transform:translateX(16px);background:var(--dsw-alias-bg-layer-3,#fff);}",
			".vg-set-switch-input:focus-visible + .vg-set-switch-track{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:2px;}",
			// DSH 原生输入框/下拉/文本域
			".vg-set-input,.vg-set-select,.vg-set-textarea{border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:8px;background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);padding:5px 10px;font-size:13px;line-height:22px;transition:border-color .15s ease;}",
			".vg-set-input:focus,.vg-set-select:focus,.vg-set-textarea:focus{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:1px;border-color:var(--dsw-alias-state-business-primary,#4176e6);}",
			".vg-set-input::placeholder{color:var(--dsw-alias-label-tertiary,#888);}",
			".vg-set-textarea{resize:vertical;min-height:56px;font-family:inherit;}",
			".vg-set-select{cursor:pointer;appearance:auto;}",
			".vg-set-input-num{width:76px;}",
			// DSH 原生按钮：次要按钮描边、主按钮品牌填充、danger 悬停红色
			".vg-set-btn{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l2,#ddd);background:var(--dsw-alias-bg-layer-2,#f0f0f0);color:var(--dsw-alias-label-secondary,#666);border-radius:8px;padding:5px 12px;font-size:12px;line-height:18px;cursor:pointer;transition:background .12s ease,border-color .12s ease,color .12s ease;}",
			".vg-set-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));border-color:var(--dsw-alias-interactive-bg-hover-accent,rgba(38,49,72,.14));color:var(--dsw-alias-label-primary,#1a1a1a);}",
			".vg-set-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:2px;}",
			".vg-set-btn[disabled]{opacity:.45;cursor:not-allowed;}",
			".vg-set-btn[disabled]:hover{background:var(--dsw-alias-bg-layer-2,#f0f0f0);border-color:var(--dsw-alias-border-l2,#ddd);color:var(--dsw-alias-label-secondary,#666);}",
			".vg-set-btn-primary{background:var(--dsw-alias-button-primary-fill,#4176e6);border-color:var(--dsw-alias-button-primary-fill,#4176e6);color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:500;}",
			".vg-set-btn-primary:hover{background:var(--dsw-alias-button-primary-hover,#3668d4);border-color:var(--dsw-alias-button-primary-hover,#3668d4);color:var(--dsw-alias-label-primary-foreground,#fff);}",
			".vg-set-btn-primary[disabled]{background:var(--dsw-alias-bg-layer-2,#f0f0f0);border-color:var(--dsw-alias-border-l2,#ddd);color:var(--dsw-alias-label-tertiary,#888);}",
			".vg-set-btn-danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(236,19,19,.05));border-color:var(--dsw-alias-state-error-primary,#e60013);color:var(--dsw-alias-state-error-primary,#e60013);}",
			// 消息横幅（成功/失败）
			".vg-set-msg{border-radius:8px;padding:6px 12px;font-size:12px;line-height:18px;}",
			".vg-set-msg-ok{background:var(--dsw-alias-state-success-tertiary,rgba(0,180,80,.12));color:var(--dsw-alias-state-success-primary,#00b450);}",
			".vg-set-msg-err{background:var(--dsw-alias-state-warn-tertiary,rgba(236,19,19,.08));color:var(--dsw-alias-state-error-primary,#e60013);}",
			// 环境诊断键值网格
			".vg-set-kv{display:grid;grid-template-columns:88px 1fr;gap:4px 10px;font-size:12px;}",
			".vg-set-kv .k{color:var(--dsw-alias-label-tertiary,#888);}",
			".vg-set-kv .v{color:var(--dsw-alias-label-secondary,#666);overflow-wrap:anywhere;}",
			".vg-set-probe-ok{color:var(--dsw-alias-state-success-primary,#00b450);}",
			".vg-set-probe-err{color:var(--dsw-alias-state-error-primary,#e60013);}",
			// ── 漫剧工坊（wb-* 前缀）：项目卡片 / 三栏壳 / 阶段导航 / 提案卡 / diff ──
			// 宽度策略对齐自动化任务面板：铺满宿主面板、不限宽居中，区块间距靠容器 gap。
			".vg-wb-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}",
			".vg-wb-page{display:flex;flex-direction:column;gap:16px;padding:16px 24px 32px;font-size:13px;line-height:1.5;color:var(--vg-fg);}",
			".vg-wb-hero{display:flex;align-items:center;gap:12px;padding:4px 0 0;}",
			".vg-wb-hero-icon{width:40px;height:40px;border-radius:10px;background:var(--vg-primary);display:flex;align-items:center;justify-content:center;color:var(--vg-primary-fg);flex:none;}",
			".vg-wb-hero h2{margin:0;font-size:18px;font-weight:600;}",
			".vg-wb-hero .sub{font-size:12px;color:var(--vg-muted);margin-top:2px;}",
			// 项目卡片：发丝边 + 透明底，hover 铺底加深边（去渐变扫光/位移/阴影）
			".vg-wb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;}",
			".vg-wb-card{position:relative;border:1px solid var(--vg-border);border-radius:12px;padding:14px 16px 12px;cursor:pointer;background:transparent;transition:border-color .15s,background .15s;overflow:hidden;}",
			".vg-wb-card:hover{border-color:var(--vg-border-strong);background:var(--vg-fill-hover);}",
			".vg-wb-card .title{font-size:14px;font-weight:600;line-height:1.4;color:var(--vg-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
			".vg-wb-progress{height:4px;border-radius:999px;background:var(--vg-fill);overflow:hidden;margin:10px 0 6px;}",
			".vg-wb-progress .bar{height:100%;border-radius:999px;background:var(--vg-primary);transition:width .3s;}",
			".vg-wb-empty{border:1px dashed var(--vg-border-strong);border-radius:12px;padding:48px 24px 40px;text-align:center;color:var(--vg-fg);}",
			".vg-wb-empty .hint{font-size:12px;color:var(--vg-muted);margin:12px 0 0;}",
			".vg-wb-title{font-weight:600;font-size:16px;color:var(--vg-fg);}",
			".vg-wb-meta{font-size:11px;color:var(--vg-muted);display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;justify-content:space-between;}",
			".vg-chip-writing{color:var(--vg-info);background:color-mix(in srgb,var(--vg-info) 16%,transparent);}",
			".vg-chip-review{color:var(--vg-warn);background:color-mix(in srgb,var(--vg-warn) 16%,transparent);}",
			".vg-chip-adapting{color:var(--vg-warn);background:color-mix(in srgb,var(--vg-warn) 16%,transparent);}",
			// 工具条/详情头：去盒子，纯 flex 行（对齐自动化任务 toolbar/header 配方）
			".vg-wb-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}",
			".vg-wb-toolbar .lbl{font-size:12px;color:var(--vg-muted);}",
			".vg-wb-wbhead{padding:0;}",
			".vg-wb-shell{display:flex;gap:16px;align-items:flex-start;}",
			".vg-wb-nav{flex:0 0 168px;display:flex;flex-direction:column;gap:2px;border:1px solid var(--vg-border);border-radius:10px;padding:6px;}",
			".vg-wb-nav button{background:transparent;border:none;color:var(--vg-fg);text-align:left;font-size:12.5px;padding:6px 10px;border-radius:6px;cursor:pointer;display:flex;justify-content:space-between;gap:6px;align-items:center;}",
			".vg-wb-nav button:hover{background:var(--vg-fill-hover);}",
			".vg-wb-nav button.active{background:var(--vg-fill-hover);color:var(--vg-primary);font-weight:600;}",
			".vg-wb-nav .cnt{font-size:10px;color:var(--vg-muted);font-variant-numeric:tabular-nums;}",
			".vg-wb-main{flex:1;min-width:0;}",
			".vg-wb-side{flex:0 0 300px;display:flex;flex-direction:column;gap:12px;}",
			".vg-wb-side h4{margin:0 0 6px;font-size:12px;font-weight:600;color:var(--vg-fg-2);}",
			".vg-wb-side .vg-card{padding:10px 12px;}",
			// 角色列表字母头像（规格 §2.6 列表「头像占位」）
			".vg-char-avatar{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:var(--vg-fill);font-size:11px;line-height:1;margin-right:6px;flex:none;}",
			"@media (max-width:900px){.vg-wb-side{flex:1 1 100%;}.vg-wb-nav{flex-basis:110px;}}",
			".vg-timeline{display:flex;flex-direction:column;gap:6px;font-size:12px;}",
			".vg-timeline .tl-row{display:flex;gap:8px;}",
			".vg-timeline .tl-at{flex:none;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--vg-muted);font-variant-numeric:tabular-nums;}",
			// 提案卡：warn 左条 + 同色淡底（待审核语义）
			".vg-proposal{border:1px solid var(--vg-border);border-left:3px solid var(--vg-warn);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:color-mix(in srgb,var(--vg-warn) 8%,transparent);}",
			".vg-proposal .vg-proposal-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;}",
			".vg-diff{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;}",
			".vg-diff .pane{border:1px solid var(--vg-border);border-radius:8px;padding:8px;font-size:11.5px;max-height:280px;overflow:auto;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--vg-fg);}",
			".vg-diff .pane.del{background:color-mix(in srgb,var(--vg-error) 8%,transparent);}",
			".vg-diff .pane.add{background:color-mix(in srgb,var(--vg-success) 8%,transparent);}",
			".vg-diff h5{margin:0 0 4px;font-size:11px;color:var(--vg-muted);font-weight:600;}",
			".vg-diff-row{display:flex;gap:8px;font-size:11.5px;padding:2px 0;border-bottom:1px dashed var(--vg-border);}",
			".vg-diff-row .k{flex:0 0 110px;color:var(--vg-muted);overflow:hidden;text-overflow:ellipsis;}",
			".vg-diff-row .v{flex:1;min-width:0;white-space:pre-wrap;}",
			".vg-diff-row.changed .v.new{color:var(--vg-success);}",
			".vg-diff-row.changed .v.old{color:var(--vg-error);text-decoration:line-through;opacity:.75;}",
			".vg-subtabs{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;}",
			// 横幅：中性/警告两档 notice（去紫边盒子）；嵌套在卡片内使用，自带下边距
			".vg-banner{border-radius:8px;padding:8px 12px;font-size:12px;margin-bottom:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:var(--vg-fill);color:var(--vg-fg);}",
			".vg-banner.warn{background:color-mix(in srgb,var(--vg-warn) 12%,transparent);}",
			".vg-kv{display:grid;grid-template-columns:88px 1fr;gap:4px 10px;font-size:12px;}",
			".vg-kv .k{color:var(--vg-muted);}",
			".vg-checkline{display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-top:1px dashed var(--vg-border);font-size:12px;}",
			// 设置页导航图标替换：DSH 0.1.x 的 settings.section 契约只投影
			// id/order/label，壳层对外部分区一律渲染通用齿轮。这里只对本插件
			// 被标记的行生效：隐藏齿轮 SVG，用 ::before mask 画场记板字形。
			"[" + NAV_MARKER + "] > svg:first-child{display:none;}",
			"[" + NAV_MARKER + "]::before{content:'';flex:none;width:16px;height:16px;background:currentColor;"
				+ "-webkit-mask:url(\"" + NAV_ICON_SVG + "\") center / contain no-repeat;"
				+ "mask:url(\"" + NAV_ICON_SVG + "\") center / contain no-repeat;}",
		].join("\n");

		function ensureStyles() {
			if (typeof document === "undefined") return null;
			if (document.getElementById("dsh-video-generator-styles")) return null;
			var style = document.createElement("style");
			style.id = "dsh-video-generator-styles";
			style.textContent = CSS;
			document.head.appendChild(style);
			/* 返回移除函数：卸载收口用（既存标签返回 null，不动别人的） */
			return function () {
				var el = document.getElementById("dsh-video-generator-styles");
				if (el !== null) el.remove();
			};
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

		// v2 通道层：模型池/picker 已整体退役（用途槽：每槽恰好一个模型；见 slots.set RPC）。

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
				var musicFiles = artifacts.music || [];
				if (musicFiles.length > 0) {
					previewGroups.push(React.createElement("div", { key: "music" },
						React.createElement("h4", { style: { margin: "8px 0 4px", fontSize: 12 } }, "BGM"),
						React.createElement("div", { className: "vg-preview-grid" },
							musicFiles.map(function (file) {
								return React.createElement("audio", {
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
		 * 数据形态：picker = { rows: [{model, kind, isConfigured, isNew}], checked: Set<model>, search, kindFilter, busy }
		 * 交互：搜索 / 按 kind 筛选 / 行内 checkbox / 行内 kind 选择器 / 全选反选 / 保存选中。
		 * 所有变更走 onChange（合并回 probe[id].picker）；保存走 onSave（ChannelRow → ChannelsView → Stateful）。
		 */
		function ChannelRow(props) {
			var t = props.t;
			var ch = props.ch;
			var probe = props.probe || {};
			var children = [
				// 菜单式行：标题/描述在左、开关在右、细分隔线（对齐 SideCardSection row 配方）
				React.createElement("div", { key: "row", className: "vg-set-row" },
					React.createElement("div", { className: "vg-set-row-text" },
						React.createElement("div", { className: "vg-set-row-title" }, ch.label || ch.id),
						React.createElement("div", { className: "vg-set-row-desc" },
							ch.id + " · " + ch.baseUrl + " · " + ch.apiKeyMasked,
						),
					),
					React.createElement("div", { className: "vg-set-row-control" },
						// 启用开关（DSH 原生 switch 配方）
						React.createElement("label", { className: "vg-set-switch", title: t("enable"), "aria-label": t("enable") },
							React.createElement("input", {
								type: "checkbox", className: "vg-set-switch-input",
								checked: !!ch.enabled,
								onChange: function (e) { props.onToggleEnabled(ch.id, e.target.checked); },
							}),
							React.createElement("span", { className: "vg-set-switch-track" },
								React.createElement("span", { className: "vg-set-switch-thumb" }),
							),
						),
					),
				),
				// 操作按钮行（测试 = 连通/鉴权/协议族实测，不导入任何模型）
				React.createElement("div", { key: "acts", className: "vg-set-row", style: { borderBottom: "none", paddingTop: 0, paddingBottom: 8 } },
					React.createElement("div", { className: "vg-set-row-text" }),
					React.createElement("div", { className: "vg-set-row-control" },
						React.createElement("button", { className: "vg-set-btn", disabled: props.busy || !!probe.busy, onClick: function () { props.onTestChannel(ch.id); } },
							probe.busy ? t("testing") : t("test")),
						React.createElement("button", { className: "vg-set-btn vg-set-btn-danger", disabled: props.busy, onClick: function () { props.onDeleteChannel(ch); } }, t("deleteCh")),
					),
				),
			];
			if (probe.message) {
				children.push(React.createElement("div", { key: "probe", className: "vg-set-row-desc " + (probe.ok ? "vg-set-probe-ok" : "vg-set-probe-err"), style: { padding: "0 2px 8px" } },
					probe.message,
				));
			}
			return React.createElement("div", { className: "vg-set-group", style: { padding: "12px 20px" } }, children);
		}

		/* ── 用途槽（v2 通道层核心：每槽恰好一个模型 + 真实小额测试）───────── */

		var SLOT_ORDER = ["image.master", "image.shot", "video", "tts", "music.bgm", "music.song"];
		var SLOT_PROTOCOL_FIXED = { "image.master": "openai-images", "image.shot": "openai-images", tts: "openai-tts", "music.bgm": "generic-music", "music.song": "generic-music" };

		function defaultSlotProtocol(slot, binding) {
			if (SLOT_PROTOCOL_FIXED[slot]) return SLOT_PROTOCOL_FIXED[slot];
			return (binding && binding.protocol) || "dashscope-video";
		}

		function defaultCapsFor(slot) {
			if (slot === "video") return { imageToVideo: true, textToVideo: false, maxDurationSec: 10 };
			if (slot === "image.master") return { sizeParam: true };
			if (slot === "image.shot") return { referenceImage: true };
			return {};
		}

		/** 从已保存绑定初始化槽位草稿（仅首次；刷新不覆盖用户未保存编辑）。 */
		function initSlotDrafts(savedList) {
			var byId = Object.create(null);
			(savedList || []).forEach(function (b) { byId[b.slot] = b; });
			var drafts = {};
			SLOT_ORDER.forEach(function (slot) {
				var b = byId[slot];
				drafts[slot] = {
					channelId: (b && b.channelId) || "",
					model: (b && b.model) || "",
					protocol: defaultSlotProtocol(slot, b),
					caps: Object.assign(defaultCapsFor(slot), (b && b.capabilities) || {}),
					mappingText: b && b.music ? JSON.stringify(b.music, null, 2) : "",
				};
			});
			return drafts;
		}

		function SlotRow(props) {
			var t = props.t;
			var slot = props.slot;
			var meta = (props.slotMeta && props.slotMeta[slot]) || {};
			// 全字段防御：草稿未初始化（首帧 slotDrafts 为空）时也必须可渲染——
			// 任何一处直接读 caps.* 都会在真实 React 里抛错并卸载整棵设置树（白屏）。
			var draft = props.draft || {};
			var caps = draft.caps || {};
			var binding = props.binding;
			var msg = props.slotMsg || {};
			var setDraft = function (patch) { props.setDraft(slot, Object.assign({}, draft, patch)); };
			var isMusic = slot === "music.bgm" || slot === "music.song";
			var isVideo = slot === "video";
			var row = function (title, desc, control, key) {
				return React.createElement("div", { key: key || title, className: "vg-set-row" },
					React.createElement("div", { className: "vg-set-row-text" },
						React.createElement("div", { className: "vg-set-row-title" }, title),
						desc ? React.createElement("div", { className: "vg-set-row-desc" }, desc) : null,
					),
					React.createElement("div", { className: "vg-set-row-control" }, control),
				);
			};
			var kids = [
				React.createElement("div", { key: "head", className: "vg-set-row" },
					React.createElement("div", { className: "vg-set-row-text" },
						React.createElement("div", { className: "vg-set-row-title" },
							(meta.label || slot),
							React.createElement("span", { className: "vg-set-group-count", style: { marginLeft: 8 } }, slot),
						),
						React.createElement("div", { className: "vg-set-row-desc" },
							(meta.purpose || "") + (binding ? " · " + t("slotModel") + ": " + binding.model + (binding.verifiedAt ? " · ✓" : "") : " · " + t("slotUnbound")),
						),
					),
				),
			];
			var channels = (props.chans && props.chans.channels) || [];
			kids.push(row(t("slotChannel"), null,
				React.createElement("select", {
					className: "vg-set-select", value: draft.channelId,
					onChange: function (e) { setDraft({ channelId: e.target.value }); },
				},
					React.createElement("option", { value: "" }, channels.length ? t("slotChannel") + "…" : t("slotNeedChannel")),
					channels.map(function (c) { return React.createElement("option", { key: c.id, value: c.id }, (c.label || c.id) + (c.enabled ? "" : " (off)")); }),
				), "ch"));
			kids.push(row(t("slotModel"), null,
				React.createElement("input", {
					className: "vg-set-input", value: draft.model, placeholder: "model-name",
					onChange: function (e) { setDraft({ model: e.target.value }); },
				}), "model"));
			if (isVideo) {
				kids.push(row(t("slotProtocol"), null,
					React.createElement("select", {
						className: "vg-set-select", value: draft.protocol,
						onChange: function (e) { setDraft({ protocol: e.target.value }); },
					},
						React.createElement("option", { value: "dashscope-video" }, "dashscope-video"),
						React.createElement("option", { value: "kling-video" }, "kling-video"),
						React.createElement("option", { value: "openai-video" }, "openai-video"),
					), "proto"));
			} else {
				kids.push(row(t("slotProtocol"), null,
					React.createElement("span", { className: "vg-set-row-desc" }, SLOT_PROTOCOL_FIXED[slot]), "proto"));
			}
			if (slot === "image.master" || slot === "image.shot") {
				var capKey = slot === "image.master" ? "sizeParam" : "referenceImage";
				kids.push(row(t("slotCaps"), capKey,
					React.createElement("input", {
						type: "checkbox", checked: !!caps[capKey],
						onChange: function (e) { var c = Object.assign({}, caps); c[capKey] = e.target.checked; setDraft({ caps: c }); },
					}), "caps"));
			}
			if (isVideo) {
				kids.push(row(t("slotCaps"), "imageToVideo / textToVideo",
					React.createElement("span", null,
						React.createElement("input", {
							type: "checkbox", checked: !!caps.imageToVideo,
							onChange: function (e) { var c = Object.assign({}, draft.caps); c.imageToVideo = e.target.checked; setDraft({ caps: c }); },
						}), " i2v ",
						React.createElement("input", {
							type: "checkbox", checked: !!caps.textToVideo,
							onChange: function (e) { var c = Object.assign({}, draft.caps); c.textToVideo = e.target.checked; setDraft({ caps: c }); },
						}), " t2v",
					),
					"caps"));
				kids.push(row(t("slotMaxDur"), null,
					React.createElement("input", {
						className: "vg-set-input vg-set-input-num", type: "number", min: 2, max: 20,
						value: caps.maxDurationSec,
						onChange: function (e) { var c = Object.assign({}, draft.caps); c.maxDurationSec = Number(e.target.value); setDraft({ caps: c }); },
					}), "maxdur"));
			}
			if (slot === "tts") {
				kids.push(row(t("slotVoice"), null,
					React.createElement("input", {
						className: "vg-set-input", value: caps.voice || "",
						onChange: function (e) { var c = Object.assign({}, draft.caps); c.voice = e.target.value; setDraft({ caps: c }); },
					}), "voice"));
				kids.push(row(t("slotInstructions"), null,
					React.createElement("input", {
						className: "vg-set-input", value: caps.instructions || "",
						onChange: function (e) { var c = Object.assign({}, draft.caps); c.instructions = e.target.value; setDraft({ caps: c }); },
					}), "ins"));
			}
			if (isMusic) {
				var userTpls = (props.templates || []).filter(function (x) { return x.source === "user"; });
				kids.push(row(t("slotTpl"), null,
					React.createElement("span", null,
						React.createElement("select", {
							className: "vg-set-select", value: "",
							onChange: function (e) { if (e.target.value) props.onApplyTemplate(slot, e.target.value); },
						},
							React.createElement("option", { value: "" }, t("slotTpl") + "…"),
							(props.templates || []).map(function (tpl) { return React.createElement("option", { key: tpl.id, value: tpl.id }, tpl.label); }),
						),
						React.createElement("button", { className: "vg-set-btn", style: { marginLeft: 8 }, disabled: props.busy, onClick: function () { props.onSaveTemplate(slot); } }, t("slotTplSaveAs")),
						userTpls.length > 0 ? React.createElement("select", {
							className: "vg-set-select", value: "", style: { marginLeft: 8, maxWidth: 180 },
							title: t("slotTplDelete"),
							onChange: function (e) {
								var id = e.target.value;
								if (!id || typeof window === "undefined" || typeof window.confirm !== "function") return;
								var tpl = userTpls.find(function (x) { return x.id === id; });
								if (!tpl || !window.confirm(fill(t("slotTplDeleteConfirm"), { name: tpl.label }))) return;
								props.onDeleteTemplate(id);
							},
						},
							React.createElement("option", { value: "" }, t("slotTplDelete")),
							userTpls.map(function (tpl) { return React.createElement("option", { key: tpl.id, value: tpl.id }, tpl.label); }),
						) : null,
					), "tpl"));
				kids.push(React.createElement("div", { key: "map", className: "vg-set-row" },
					React.createElement("div", { className: "vg-set-row-text" },
						React.createElement("div", { className: "vg-set-row-title" }, t("slotMapping")),
						React.createElement("div", { className: "vg-set-row-desc" }, "endpoint.path / request.promptField / response.audioPath / mode"),
					),
					React.createElement("div", { className: "vg-set-row-control" },
						React.createElement("textarea", {
							className: "vg-set-input", rows: 8, style: { minWidth: 320, fontFamily: "ui-monospace,monospace", fontSize: 11 },
							value: draft.mappingText,
							onChange: function (e) { setDraft({ mappingText: e.target.value }); },
						}),
					),
				));
			}
			kids.push(React.createElement("div", { key: "acts", className: "vg-set-row", style: { borderBottom: "none", paddingBottom: 8 } },
				React.createElement("div", { className: "vg-set-row-text" },
					msg.text ? React.createElement("span", { className: msg.ok ? "vg-set-probe-ok" : "vg-set-probe-err" }, msg.text) : null,
				),
				React.createElement("div", { className: "vg-set-row-control" },
					React.createElement("button", { className: "vg-set-btn vg-set-btn-primary", disabled: props.busy || msg.busy, onClick: function () { props.onSaveSlot(slot); } }, t("slotSave")),
					React.createElement("button", { className: "vg-set-btn", disabled: props.busy || msg.busy || !binding, title: binding ? "" : t("slotUnbound"), onClick: function () { props.onTestSlot(slot); } },
						msg.busy ? t("slotTesting") : t("slotTest")),
				),
			));
			return React.createElement("div", { className: "vg-set-group", style: { padding: "12px 20px", marginBottom: 12 } }, kids);
		}

		function SlotsCard(props) {
			var t = props.t;
			var saved = (props.slotsData && props.slotsData.slots) || [];
			var byId = Object.create(null);
			(Array.isArray(saved) ? saved : []).forEach(function (b) { byId[b.slot] = b; });
			var slotMeta = (props.slotsData && props.slotsData.slotMeta) || {};
			return React.createElement("div", { className: "vg-set-group", style: { padding: "12px 20px" } },
				React.createElement("div", { className: "vg-set-group-head" }, t("slotsTitle")),
				React.createElement("p", { className: "vg-set-group-hint" }, t("slotsIntro")),
				SLOT_ORDER.map(function (slot) {
					return React.createElement(SlotRow, {
						key: slot, t: t, slot: slot,
						slotMeta: slotMeta,
						binding: byId[slot] || null,
						chans: props.chans,
						templates: props.templates || [],
						draft: (props.slotDrafts || {})[slot] || {},
						slotMsg: (props.slotMsg || {})[slot] || {},
						busy: props.busy,
						setDraft: props.onSetSlotDraft,
						onSaveSlot: props.onSaveSlot,
						onTestSlot: props.onTestSlot,
						onApplyTemplate: props.onApplyTemplate,
						onSaveTemplate: props.onSaveTemplate,
						onDeleteTemplate: props.onDeleteTemplate,
					});
				}),
			);
		}

		function ChannelsView(props) {
			var t = props.t;
			var data = props.chans || { channels: [] };
			var channels = data.channels || [];
			var budgetDraft = props.budgetDraft;
			var form = props.form;
			var gateValue = function (stage) { return (budgetDraft.gates || {})[stage] || "auto"; };
			var setGate = function (stage, value) {
				var gates = Object.assign({}, budgetDraft.gates);
				gates[stage] = value;
				props.setBudgetDraft({ threshold: budgetDraft.threshold, gates: gates });
			};
			return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 16 } },
				// 分组卡片2：模型通道（菜单式行：通道名/描述在左、开关在右）
				React.createElement("div", { className: "vg-set-group" },
					React.createElement("div", { className: "vg-set-group-head" },
						t("channels"),
						React.createElement("span", { className: "vg-set-group-count" }, String(channels.length)),
					),
					React.createElement("p", { className: "vg-set-group-hint" }, t("channelsIntro")),
					channels.length === 0
						? React.createElement("p", { className: "vg-set-group-hint" }, t("chEmpty"))
						: channels.map(function (ch) {
							return React.createElement(ChannelRow, {
								key: ch.id, t: t, ch: ch, busy: props.busy,
								probe: props.probe[ch.id],
								onToggleEnabled: props.onToggleEnabled,
								onTestChannel: props.onTestChannel,
								onDeleteChannel: props.onDeleteChannel,
							});
						}),
				),
				// 分组卡片2.5：用途槽（v2 核心——每槽恰好一个模型 + 真实小额测试）
				React.createElement(SlotsCard, {
					t: t, busy: props.busy,
					slotsData: props.slotsData,
					chans: props.chans,
					templates: props.templates,
					slotDrafts: props.slotDrafts,
					slotMsg: props.slotMsg,
					onSetSlotDraft: props.onSetSlotDraft,
					onSaveSlot: props.onSaveSlot,
					onTestSlot: props.onTestSlot,
					onApplyTemplate: props.onApplyTemplate,
					onSaveTemplate: props.onSaveTemplate,
					onDeleteTemplate: props.onDeleteTemplate,
				}),
				// 分组卡片3：添加通道（菜单式行：字段名在左、输入框在右）
				React.createElement("form", {
					className: "vg-set-group",
					onSubmit: function (e) { e.preventDefault(); props.onCreateChannel(); },
				},
					React.createElement("div", { className: "vg-set-group-head" }, t("addChannel")),
					React.createElement("div", { className: "vg-set-row" },
						React.createElement("div", { className: "vg-set-row-text" },
							React.createElement("div", { className: "vg-set-row-title" }, t("chId")),
							React.createElement("div", { className: "vg-set-row-desc" }, t("chIdPlaceholder")),
						),
						React.createElement("div", { className: "vg-set-row-control" },
							React.createElement("input", {
								className: "vg-set-input", placeholder: t("chIdPlaceholder"),
								value: form.id,
								onChange: function (e) { props.setForm({ id: e.target.value, label: form.label, baseUrl: form.baseUrl, apiKey: form.apiKey }); },
							}),
						),
					),
					React.createElement("div", { className: "vg-set-row" },
						React.createElement("div", { className: "vg-set-row-text" },
							React.createElement("div", { className: "vg-set-row-title" }, t("chLabel")),
						),
						React.createElement("div", { className: "vg-set-row-control" },
							React.createElement("input", {
								className: "vg-set-input",
								value: form.label,
								onChange: function (e) { props.setForm({ id: form.id, label: e.target.value, baseUrl: form.baseUrl, apiKey: form.apiKey }); },
							}),
						),
					),
					React.createElement("div", { className: "vg-set-row" },
						React.createElement("div", { className: "vg-set-row-text" },
							React.createElement("div", { className: "vg-set-row-title" }, t("chBaseUrl")),
							React.createElement("div", { className: "vg-set-row-desc" }, "https://api.example.com"),
						),
						React.createElement("div", { className: "vg-set-row-control" },
							React.createElement("input", {
								className: "vg-set-input", type: "url", placeholder: "https://api.example.com",
								value: form.baseUrl,
								onChange: function (e) { props.setForm({ id: form.id, label: form.label, baseUrl: e.target.value, apiKey: form.apiKey }); },
							}),
						),
					),
					React.createElement("div", { className: "vg-set-row" },
						React.createElement("div", { className: "vg-set-row-text" },
							React.createElement("div", { className: "vg-set-row-title" }, t("chApiKey")),
						),
						React.createElement("div", { className: "vg-set-row-control" },
							React.createElement("input", {
								className: "vg-set-input", type: "password", autoComplete: "off",
								value: form.apiKey,
								onChange: function (e) { props.setForm({ id: form.id, label: form.label, baseUrl: form.baseUrl, apiKey: e.target.value }); },
							}),
						),
					),
					React.createElement("div", { className: "vg-set-row", style: { borderBottom: "none", paddingBottom: 8 } },
						React.createElement("div", { className: "vg-set-row-text" }),
						React.createElement("div", { className: "vg-set-row-control" },
							React.createElement("button", { className: "vg-set-btn vg-set-btn-primary", disabled: props.busy, onClick: props.onCreateChannel }, t("chCreate")),
						),
					),
					React.createElement("p", { className: "vg-set-group-hint", style: { marginTop: 8, marginBottom: 0 } }, t("watermarkNote")),
				),
				// 分组卡片4：预算与 gate（菜单式行：阈值/gate 在左、控件在右）
				React.createElement("form", {
					className: "vg-set-group",
					onSubmit: function (e) { e.preventDefault(); props.onSaveBudget(); },
				},
					React.createElement("div", { className: "vg-set-group-head" }, t("budget")),
					React.createElement("p", { className: "vg-set-group-hint" }, t("budgetHint")),
					React.createElement("div", { className: "vg-set-row" },
						React.createElement("div", { className: "vg-set-row-text" },
							React.createElement("div", { className: "vg-set-row-title" }, t("threshold")),
							React.createElement("div", { className: "vg-set-row-desc" }, "CNY"),
						),
						React.createElement("div", { className: "vg-set-row-control" },
							React.createElement("input", {
								className: "vg-set-input vg-set-input-num", type: "number", min: 0, step: "0.01",
								value: budgetDraft.threshold,
								onChange: function (e) {
									props.setBudgetDraft({ threshold: e.target.value === "" ? "" : Number(e.target.value), gates: budgetDraft.gates }); // 留空=""，保存时跳过该项，不落 Number("")=0
								},
							}),
						),
					),
					MEDIA_STAGES.map(function (stage) {
						return React.createElement("div", { key: stage, className: "vg-set-row" },
							React.createElement("div", { className: "vg-set-row-text" },
								React.createElement("div", { className: "vg-set-row-title" }, stage),
								React.createElement("div", { className: "vg-set-row-desc" }, t("gateDefaults")),
							),
							React.createElement("div", { className: "vg-set-row-control" },
								React.createElement("select", {
									className: "vg-set-select", value: gateValue(stage),
									onChange: function (e) { setGate(stage, e.target.value); },
								},
									React.createElement("option", { value: "auto" }, "auto"),
									React.createElement("option", { value: "ask" }, "ask"),
									React.createElement("option", { value: "manual" }, "manual"),
								),
							),
						);
					}),
					React.createElement("div", { className: "vg-set-row", style: { borderBottom: "none", paddingBottom: 8 } },
						React.createElement("div", { className: "vg-set-row-text" }),
						React.createElement("div", { className: "vg-set-row-control" },
							React.createElement("button", { className: "vg-set-btn vg-set-btn-primary", disabled: props.busy, onClick: props.onSaveBudget }, t("save")),
						),
					),
				),
			);
		}

		/* ── 设置页主组件（无状态渲染 + 有状态容器）────────── */

		function SectionView(props) {
			var t = props.t;
			return React.createElement("div", { className: "vg-set" },
				// 头部：插件名 + 版本徽标 + 刷新按钮（对齐 SideCardSection versionBadge 配方）
				React.createElement("div", { className: "vg-set-version" },
					React.createElement("span", null, t("title")),
					props.diags && props.diags.version ? React.createElement("span", { className: "vg-set-version-tag" }, "v" + String(props.diags.version)) : null,
					React.createElement("div", { style: { flex: 1 } }),
					React.createElement("button", { className: "vg-set-btn", disabled: props.busy, onClick: props.onRefresh }, t("refresh")),
				),
				React.createElement("p", { className: "vg-set-intro" }, t("intro")),
				props.message ? React.createElement("div", { className: "vg-set-msg vg-set-msg-ok" }, props.message) : null,
				props.error ? React.createElement("div", { className: "vg-set-msg vg-set-msg-err" }, props.error) : null,
				// 分组卡片1：环境与诊断（菜单式行：键在左、值在右）
				props.diags ? React.createElement("div", { className: "vg-set-group" },
					React.createElement("div", { className: "vg-set-group-head" }, t("diagTitle")),
					React.createElement("div", { className: "vg-set-row" },
						React.createElement("div", { className: "vg-set-row-text" },
							React.createElement("div", { className: "vg-set-row-title" }, t("diagVersion")),
						),
						React.createElement("div", { className: "vg-set-row-control vg-set-row-desc" }, String(props.diags.version)),
					),
					React.createElement("div", { className: "vg-set-row" },
						React.createElement("div", { className: "vg-set-row-text" },
							React.createElement("div", { className: "vg-set-row-title" }, t("diagFfmpeg")),
							React.createElement("div", { className: "vg-set-row-desc" },
								props.diags.ffmpeg && props.diags.ffmpeg.version
									? props.diags.ffmpeg.path + "（" + String(props.diags.ffmpeg.version).slice(0, 60) + "）"
									: t("diagFfmpegMissing"),
							),
						),
					),
					React.createElement("div", { className: "vg-set-row" },
						React.createElement("div", { className: "vg-set-row-text" },
							React.createElement("div", { className: "vg-set-row-title" }, t("diagDrawtext")),
						),
						React.createElement("div", { className: "vg-set-row-control vg-set-row-desc " + (props.diags.ffmpeg && props.diags.ffmpeg.drawtext ? "vg-set-probe-ok" : "vg-set-probe-err") },
							props.diags.ffmpeg && props.diags.ffmpeg.drawtext ? t("diagOk") : t("diagMissing"),
						),
					),
					React.createElement("div", { className: "vg-set-row" },
						React.createElement("div", { className: "vg-set-row-text" },
							React.createElement("div", { className: "vg-set-row-title" }, t("diagTts")),
							React.createElement("div", { className: "vg-set-row-desc" },
								props.diags.tts && props.diags.tts.available
									? fill(t("diagTtsOk"), { m: props.diags.tts.model })
									: t("diagTtsMissing"),
							),
						),
					),
					React.createElement("div", { className: "vg-set-row" },
						React.createElement("div", { className: "vg-set-row-text" },
							React.createElement("div", { className: "vg-set-row-title" }, t("diagRunsRoot")),
						),
						React.createElement("div", { className: "vg-set-row-control vg-set-row-desc", style: { fontFamily: "ui-monospace,monospace", fontSize: 11 } }, String(props.diags.runsRoot)),
					),
				) : null,
				React.createElement(ChannelsView, {
						t: t, busy: props.busy,
						chans: props.chans, probe: props.probe,
						form: props.form, setForm: props.setForm,
						budgetDraft: props.budgetDraft, setBudgetDraft: props.setBudgetDraft,
						slotsData: props.slotsData,
						templates: props.templates,
						slotDrafts: props.slotDrafts,
						slotMsg: props.slotMsg,
						onSetSlotDraft: props.onSetSlotDraft,
						onSaveSlot: props.onSaveSlot,
						onTestSlot: props.onTestSlot,
						onApplyTemplate: props.onApplyTemplate,
						onSaveTemplate: props.onSaveTemplate,
						onDeleteTemplate: props.onDeleteTemplate,
						onCreateChannel: props.onCreateChannel,
						onToggleEnabled: props.onToggleEnabled,
						onTestChannel: props.onTestChannel,
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
				// 设置页只承担通道/用途槽/预算；工坊 run 列表/详情在工作台主面板
				// 通道：列表 + 设置 + 探测结果 + 表单草稿
				var chansState = React.useState(null);
				var chans = chansState[0], setChansData = chansState[1];
				var probeState = React.useState({});
				var probe = probeState[0], setProbe = probeState[1];
				var formState = React.useState({ id: "", label: "", baseUrl: "", apiKey: "" });
				var form = formState[0], setForm = formState[1];
				var budgetDraftState = React.useState({ threshold: 1, gates: {} });
				var budgetDraft = budgetDraftState[0], setBudgetDraft = budgetDraftState[1];
				// 用途槽：绑定表 + 模板 + 每槽草稿 + 每槽测试状态
				var slotsState = React.useState(null);
				var slotsData = slotsState[0], setSlotsData = slotsState[1];
				var templatesState = React.useState([]);
				var templates = templatesState[0], setTemplates = templatesState[1];
				var slotDraftsState = React.useState({});
				var slotDrafts = slotDraftsState[0], setSlotDrafts = slotDraftsState[1];
				var slotMsgState = React.useState({});
				var slotMsg = slotMsgState[0], setSlotMsg = slotMsgState[1];
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
						api("slots.list").then(function (v) {
							setSlotsData(v);
							// 草稿只初始化一次：刷新不覆盖用户未保存的编辑
							setSlotDrafts(function (prev) {
								if (Object.keys(prev).length > 0) return prev;
								return initSlotDrafts((v && v.slots) || []);
							});
						}),
						api("musicTemplates.list").then(function (v) { setTemplates((v && v.templates) || []); }).catch(function () {}),
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

				var onDeleteChannel = function (ch) {
					var text = fill(t("deleteConfirm"), { name: ch.label || ch.id });
					if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(text)) return;
					run(api("channels.delete", { id: ch.id }));
				};

				var onTestChannel = function (id) {
					// 通道级测试 = 连通/鉴权/枚举自检；不导入任何模型（模型导入面已随 picker 退役）
					setProbeEntry(id, { busy: true, ok: false, message: "" });
					api("channels.test", { id: id }).then(function (value) {
						var p = (value && value.probe) || {};
						if (p.ok) {
							setProbeEntry(id, { busy: false, ok: true, message: fill(t("testOk"), { n: (p.models || []).length }) });
						} else {
							setProbeEntry(id, { busy: false, ok: false, message: fill(t("testFail"), { err: p.error || "unknown" }) });
						}
					}).catch(function (e) {
						setProbeEntry(id, { busy: false, ok: false, message: fill(t("testFail"), { err: String(e.message || e) }) });
					});
				};

				/* ── 用途槽操作 ── */
				var setSlotDraft = function (slot, patch) {
					setSlotDrafts(function (prev) {
						var next = Object.assign({}, prev);
						next[slot] = Object.assign({}, prev[slot] || {}, patch);
						return next;
					});
				};

				var capsPayload = function (slot, draft) {
					draft = draft || {};
					var caps = draft.caps || {};
					if (slot === "video") {
						return { imageToVideo: !!caps.imageToVideo, textToVideo: !!caps.textToVideo, maxDurationSec: Number(caps.maxDurationSec) || 10 };
					}
					if (slot === "image.master") return { sizeParam: !!caps.sizeParam };
					if (slot === "image.shot") return { referenceImage: !!caps.referenceImage };
					if (slot === "tts") {
						var out = {};
						if (caps.voice) out.voice = String(caps.voice);
						if (caps.instructions) out.instructions = String(caps.instructions);
						return out;
					}
					return {};
				};

				var setSlotMsg = function (slot, entry) {
					setSlotMsg(function (prev) {
						var next = Object.assign({}, prev);
						next[slot] = Object.assign({}, prev[slot] || {}, entry);
						return next;
					});
				};

				var onSaveSlot = function (slot) {
					var draft = slotDrafts[slot] || {};
					if (!draft.channelId) { flash("", t("slotNeedChannel")); return; }
					var payload = {
						slot: slot,
						channelId: draft.channelId,
						model: String(draft.model || "").trim(),
						protocol: draft.protocol || defaultSlotProtocol(slot, null),
						capabilities: capsPayload(slot, draft),
					};
					if (slot === "music.bgm" || slot === "music.song") {
						try {
							payload.music = JSON.parse(draft.mappingText || "{}");
						} catch (e) {
							flash("", t("slotInvalidJson"));
							return;
						}
					}
					setBusy(true);
					api("slots.set", payload)
						.then(function () { flash(t("slotSavedOk")); })
						.catch(function (e) { flash("", String(e.message || e)); })
						.then(function () { return refreshChannels(); })
						.then(function () { setBusy(false); })
						.catch(function () { setBusy(false); });
				};

				var onTestSlot = function (slot) {
					// 测试针对「已保存」的绑定做一次真实最小调用（会产生小额消费）
					setSlotMsg(slot, { busy: true, ok: false, text: "" });
					api("slots.test", { slot: slot }).then(function (res) {
						var ok = !!(res && res.ok);
						var detail = ok ? ((res && res.detail) || "") : ((res && res.error) || "unknown");
						setSlotMsg(slot, { busy: false, ok: ok, text: fill(ok ? t("slotTestOk") : t("slotTestFail"), ok ? { detail: detail } : { err: detail }) });
					}).catch(function (e) {
						setSlotMsg(slot, { busy: false, ok: false, text: fill(t("slotTestFail"), { err: String(e.message || e) }) });
					});
				};

				var onApplyTemplate = function (slot, templateId) {
					var tpl = (templates || []).find(function (x) { return x.id === templateId; });
					if (!tpl) return;
					setSlotDraft(slot, { mappingText: JSON.stringify(tpl.fields, null, 2) });
				};

				var onSaveTemplate = function (slot) {
					var draft = slotDrafts[slot] || {};
					var parsed;
					try { parsed = JSON.parse(draft.mappingText || "{}"); } catch (e) { flash("", t("slotInvalidJson")); return; }
					var label = (typeof window !== "undefined" && window.prompt) ? window.prompt(t("slotTplSavePrompt")) : "";
					if (!label) return;
					setBusy(true);
					api("musicTemplates.save", { label: label, fields: parsed })
						.then(function () { flash(t("saved")); })
						.catch(function (e) { flash("", String(e.message || e)); })
						.then(function () { return refreshChannels(); })
						.then(function () { setBusy(false); })
						.catch(function () { setBusy(false); });
				};

				var onDeleteTemplate = function (templateId) {
					setBusy(true);
					api("musicTemplates.delete", { id: templateId })
						.then(function () { flash(t("saved")); })
						.catch(function (e) { flash("", String(e.message || e)); })
						.then(function () { return refreshChannels(); })
						.then(function () { setBusy(false); })
						.catch(function () { setBusy(false); });
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
					slotsData: slotsData,
					templates: templates,
					slotDrafts: slotDrafts,
					slotMsg: slotMsg,
					onSetSlotDraft: setSlotDraft,
					onSaveSlot: onSaveSlot,
					onTestSlot: onTestSlot,
					onApplyTemplate: onApplyTemplate,
					onSaveTemplate: onSaveTemplate,
					onDeleteTemplate: onDeleteTemplate,
					busy: busy,
					message: msg.ok, error: msg.err,
					onRefresh: function () { run(refreshChannels()); },
					onCreateChannel: onCreateChannel,
					onToggleEnabled: onToggleEnabled,
					onTestChannel: onTestChannel,
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

		// 工作台记住的工作区选择（localStorage；跨面板重挂载与页面刷新）。
		// 空串 = 「全部工作区」聚合视图。
		var WS_PICK_KEY = "dsh-video-generator.workbench.workspaceId";
		function readSavedWsId() {
			try { return localStorage.getItem(WS_PICK_KEY) || ""; } catch (error) { return ""; }
		}
		function saveWsId(id) {
			try { localStorage.setItem(WS_PICK_KEY, id || ""); } catch (error) { /* 隐私模式等：仅会话内记忆 */ }
		}

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
		var D_STATUS_CHIP = { writing: "vg-chip-writing", "pending-review": "vg-chip-review", adapting: "vg-chip-adapting", done: "vg-chip-done" };

		/** 创作任务类型本地化（tk- 词典键；未识别的 kind 原样回显）。 */
		function taskKindLabel(t, kind) {
			var raw = String(kind || "");
			if (!TASK_KIND_KEYS[raw]) return raw;
			var label = t("tk-" + raw);
			return label === "tk-" + raw ? raw : label;
		}
		var TASK_KIND_KEYS = {
			"generate-architecture": 1,
			"generate-worldbuilding": 1,
			"complete-characters": 1,
			"generate-outline": 1,
			"generate-chapter-blueprint": 1,
			"generate-chapter-draft": 1,
			"review-chapter": 1,
			"revise-chapter": 1,
			"adapt-chapter": 1,
		};

		/** 场记板字形（与侧边栏图标同源，页面内复用）。 */
		function ClapperIcon(props) {
			var size = (props && props.size) || 20;
			var color = (props && props.color) || "currentColor";
			return h("svg", {
				width: size, height: size, viewBox: "0 0 24 24", fill: "none",
				stroke: color, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
			},
				h("path", { d: "M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" }),
				h("path", { d: "m6.2 5.3 3.1 3.9" }),
				h("path", { d: "m12.4 3.4 3.1 4" }),
				h("path", { d: "M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" }),
			);
		}

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

		/** diff 行展开（规格 §2.7「字段级对比」+ §13 大纲/角色整库提案「逐条目高亮」）：
		 *  数组按索引逐条展开（characters[3].name），嵌套对象逐字段；标量直接对比。
		 *  模块级纯函数：ProposalDiff 与 __testHooks 共用。 */
		function flattenRows(oldData, newData) {
			var rows = [];
			var val = function (v) { return v === undefined ? "" : JSON.stringify(v); };
			var isObj = function (v) { return v !== null && typeof v === "object" && !Array.isArray(v); };
			var walk = function (prefix, o, n) {
				if (Array.isArray(o) || Array.isArray(n)) {
					var oa = Array.isArray(o) ? o : [];
					var na = Array.isArray(n) ? n : [];
					var len = Math.max(oa.length, na.length);
					for (var i = 0; i < len; i++) walk(prefix + "[" + i + "]", oa[i], na[i]);
					return;
				}
				if (isObj(o) || isObj(n)) {
					var oo = isObj(o) ? o : {};
					var nn = isObj(n) ? n : {};
					var keys = [];
					var seen = {};
					var k;
					for (k in oo) { if (!seen[k]) { keys.push(k); seen[k] = 1; } }
					for (k in nn) { if (!seen[k]) { keys.push(k); seen[k] = 1; } }
					for (var j = 0; j < keys.length; j++) {
						var key = keys[j];
						var ov = oo[key];
						var nv = nn[key];
						var childPrefix = prefix ? prefix + "." + key : key;
						if (isObj(ov) || isObj(nv) || Array.isArray(ov) || Array.isArray(nv)) walk(childPrefix, ov, nv);
						else rows.push({ key: childPrefix, old: val(ov), new: val(nv), changed: val(ov) !== val(nv) });
					}
					return;
				}
				rows.push({ key: prefix, old: val(o), new: val(n), changed: val(o) !== val(n) });
			};
			walk("", oldData, newData);
			return rows;
		}

		function Field(label, control) {
			return h("div", { className: "vg-field" }, h("label", null, label), control);
		}

		function statusChip(t, status) {
			return h("span", { className: "vg-chip " + (D_STATUS_CHIP[status] || "vg-chip-pending") }, t(D_STATUS_KEY[status] || "statusWriting"));
		}

		/** 组装全部漫剧工坊组件。deps: sendInstruction/openSession/backToConversation（apply 注入宿主桥）。 */
		function makeDramaComponents(t, deps) {

			/* ── 一级：项目列表 ── */

			function ProjectCard(props) {
				var p = props.project;
				var done = p.chaptersFinal || 0;
				var planned = p.plannedChapters || 0;
				var pct = planned > 0 ? Math.min(100, Math.round((done / planned) * 100)) : 0;
				return h("div", { className: "vg-wb-card", onClick: function () { props.onOpen(p); } },
					h("div", { className: "vg-row", style: { alignItems: "flex-start", gap: 8 } },
						h("div", { style: { flex: 1, minWidth: 0 } },
							h("div", { className: "title" }, p.title || p.id),
							h("div", { className: "vg-tpl-meta", style: { marginTop: 2 } }, p.category || "", p.language ? " · " + p.language : "", props.wsLabel ? " · " + props.wsLabel : ""),
						),
						statusChip(t, p.status),
						(p.pendingProposals || 0) > 0 ? h("span", { className: "vg-badge vg-badge-review" }, fill(t("pendingN"), { n: p.pendingProposals })) : null,
					),
					h("div", { className: "vg-wb-progress" }, h("div", { className: "bar", style: { width: pct + "%" } })),
					h("div", { className: "vg-row", style: { justifyContent: "space-between", margin: 0 } },
						h("span", { className: "vg-tpl-meta" }, fill(t("chaptersProgress"), { done: done, planned: planned }) + " · " + pct + "%"),
						h("button", {
							className: "vg-btn vg-btn-mini",
							onClick: function (e) { e.stopPropagation(); props.onOpen(p); },
						}, t("open")),
					),
					h("div", { className: "vg-wb-meta" },
						h("span", null, t("latestTask") + ": " + (p.latestTask ? taskKindLabel(t, p.latestTask.kind) + " · " + p.latestTask.status : t("taskNone"))),
						h("span", null, t("latestFinal") + ": " + (p.latestRun ? "#" + shortId(p.latestRun.runId) + " · " + t(STATUS_KEY[p.latestRun.status] || "statusRunning") : t("taskNone"))),
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
					h("p", { className: "vg-hint" }, t("wizConfirmHint")),
					errMsg ? h("div", { className: "vg-msg vg-msg-err" }, errMsg) : null,
					h("div", { className: "vg-actions" },
						h("button", { className: "vg-btn vg-btn-primary", disabled: isBusy, onClick: submit }, t("create")),
						h("button", { className: "vg-btn", disabled: isBusy, onClick: function () { setStep(1); } }, t("back")),
					),
				);
			}

			/* ── Proposal 审核：diff 视图 + 编辑建议 + 应用/拒绝 ── */

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
							props.onRegenerate ? h("button", { className: "vg-btn", disabled: isBusy, title: t("regenRequest"), onClick: function () { props.onRegenerate(p); } }, t("regenBtn")) : null,
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
						events.push({ at: evs[j].at, type: evs[j].type + (tasks[i].kind ? " · " + taskKindLabel(t, tasks[i].kind) : "") });
					}
				}
				// 成本/风险提示（规格 §2.5）：最近改编 run 的花费汇总 + 任务/run 失败风险
				var latestRun = null;
				var adaptations = detail.adaptations || [];
				for (var ai = 0; ai < adaptations.length; ai++) {
					if (adaptations[ai].runId) latestRun = adaptations[ai];
				}
				var costText = latestRun && latestRun.runSpend ? fill(t("spend"), { n: latestRun.runSpend.estCny, c: latestRun.runSpend.entries }) : "—";
				var riskText = latest && latest.status === "failed"
					? taskKindLabel(t, latest.kind) + " 失败"
					: latestRun && latestRun.runStatus === "failed" ? "成片 run 失败" : null;
				return h("div", { className: "vg-card" },
					h("h4", null, t("agentPanel")),
					h("div", { className: "vg-kv" },
						h("span", { className: "k" }, t("currentTask")),
						h("span", null, latest ? taskKindLabel(t, latest.kind) : "—",
							latest ? h("span", { className: "vg-chip vg-chip-" + (latest.status === "done" ? "done" : latest.status === "failed" ? "failed" : "running"), style: { marginLeft: 6 } }, latest.status) : null),
					),
					h("div", { className: "vg-kv", style: { marginTop: 4 } },
						h("span", { className: "k" }, t("costRisk")),
						h("span", null, costText,
							riskText ? h("span", { className: "vg-chip vg-chip-failed", style: { marginLeft: 6 } }, riskText) : null),
					),
					// 规格 §2.8：宿主重启后运行中任务提示「会话已中断，可继续」——重发任务指令续跑
					latest && latest.status === "running" ? h("p", { className: "vg-hint", style: { margin: "4px 0 0" } }, t("sessionInterrupted")) : null,
					latest && latest.status === "running" && props.onResendTask
						? h("div", { className: "vg-actions", style: { marginTop: 4 } },
							h("button", { className: "vg-btn vg-btn-mini", disabled: !!props.busy, onClick: function () { props.onResendTask(latest.taskId); } }, t("resendInstruction")),
						)
						: null,
					latest && latest.sessionId
						? h("div", { className: "vg-actions", style: { marginTop: 4 } }, h("button", { className: "vg-btn vg-btn-mini", onClick: function () { props.onOpenSession(latest.sessionId); } }, t("openSession")))
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
							return h("button", { key: i, className: "vg-tab" + (i === selected ? " vg-tab-active" : ""), onClick: function () { setSelected(i); } },
								h("span", { className: "vg-char-avatar" }, (c.name || c.id || "?").slice(0, 1).toUpperCase()),
								c.name || c.id || String(i + 1),
								c.hasVisualAsset ? h("span", { className: "vg-chip vg-chip-done", style: { marginLeft: 4, fontSize: 10, padding: "0 6px" } }, t("visualAsset")) : null,
							);
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
						Field(t("visualAsset"), h("label", { className: "vg-row", style: { gap: 6, margin: 0 } },
							h("input", { type: "checkbox", checked: !!cur.hasVisualAsset, onChange: function (e) { setField("hasVisualAsset", e.target.checked); } }),
							h("span", { className: "vg-tpl-desc" }, t("visualAssetHint")),
						)),
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
								h("span", { className: "vg-chip " + ((r.characters || []).length > 0 ? "vg-chip-running" : "vg-chip-pending") }, "第 " + r.chapter + " 章"),
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
				// detail 顶层没有 updatedAt——在 manifest 里。此前取错层级导致 tick 恒为
				// undefined：保存/定稿清空正文后 effect 依赖不变、永不重取，页面卡在加载中。
				var tick = (props.detail.manifest && props.detail.manifest.updatedAt) || "";
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
					}).catch(function () {
						// 兜底：意外失败也不停在加载中——按全空资产渲染（absent 基线可重写恢复）
						if (alive) setBodies({ blueprint: null, draft: null, review: null, final: null, candidates: [] });
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
								key: n, className: "vg-tab" + (done ? " vg-tab-done" : "") + (n === cur.no ? " vg-tab-active" : ""),
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
							chapterOptions.length === 0 ? h("option", { value: 1 }, t("adaptNoChapters")) : null,
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
					chapterOptions.length === 0 ? h("p", { className: "vg-hint", style: { margin: "8px 0 0" } }, t("adaptNoChaptersHint")) : null,
					h("div", { className: "vg-actions" },
						h("button", {
							className: "vg-btn vg-btn-primary", disabled: props.busy || props.channelBlocked || chapterOptions.length === 0,
							title: props.channelBlocked ? t("channelWarn") : (chapterOptions.length === 0 ? t("adaptNoChapters") : undefined),
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
				// 指令发送可重试态（规格 §2.8「[重试发送]；已发指令不重复发」）：
				// mode=create → task.create 本身失败（无任务产生，整任务重发）；mode=instruction →
				// 任务已建、指令未送达（仅重发指令 + 补记事件，不重复建任务）。
				var sendRetryState = React.useState(null);
				var sendRetry = sendRetryState[0], setSendRetry = sendRetryState[1];

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
					setBusy(true); setErr(""); setMsg(""); setSendRetry(null);
					return dramaApi("drama.task.create", { workspaceId: wsId, projectId: projectId, kind: kind, params: params || {}, userRequest: userRequest || "" })
						.then(function (v) {
							// create 成功即记可重试态：指令未送达时只重发指令，不重复建任务（已发指令不重复发）
							setSendRetry({ mode: "instruction", instruction: v.instruction, taskId: v.taskId });
							return Promise.resolve(deps.sendInstruction(v.instruction)).then(function (sent) {
								var patch = { status: "running", event: { type: sent.result === "none" ? "instruction-copy-failed" : "instruction-sent" } };
								if (sent.sessionId) patch.sessionId = sent.sessionId;
								var update = dramaApi("drama.task.update", { workspaceId: wsId, projectId: projectId, taskId: v.taskId, patch: patch });
								if (sent.result === "none") { setErr(t("instructNone")); return update; }
								setMsg(sent.result === "prefilled" ? t("instructPrefilled") : t("instructCopied"));
								setSendRetry(null);
								return update;
							});
						})
						.then(function () { return refresh(); })
						.catch(function (e) {
							// create 本身失败（尚无任务产生）→ 记整任务重试态；instruction 态已记则保留不覆盖
							setSendRetry(function (cur) { return cur || { mode: "create", kind: kind, params: params || {}, userRequest: userRequest || "" }; });
							setErr(String(e.message || e));
						})
						.then(function () { setBusy(false); });
				};
				var retrySend = function () {
					var r = sendRetry;
					if (!r || busy) return;
					if (r.mode === "create") { sendTask(r.kind, r.params, r.userRequest); return; }
					setBusy(true); setErr(""); setMsg("");
					Promise.resolve(deps.sendInstruction(r.instruction)).then(function (sent) {
						var patch = { status: "running", event: { type: sent.result === "none" ? "instruction-copy-failed" : "instruction-sent" } };
						if (sent.sessionId) patch.sessionId = sent.sessionId;
						var update = dramaApi("drama.task.update", { workspaceId: wsId, projectId: projectId, taskId: r.taskId, patch: patch });
						if (sent.result === "none") { setErr(t("instructNone")); return update; }
						setMsg(sent.result === "prefilled" ? t("instructPrefilled") : t("instructCopied"));
						setSendRetry(null);
						return update;
					}).then(function () { return refresh(); })
						.catch(function (e) { setErr(String(e.message || e)); })
						.then(function () { setBusy(false); });
				};
				// 提案「重新生成」（规格 §2.7/验收 9 后半）：按 assetRef 推导同 kind 任务重新发起，
				// 产出基于最新 revision 的新提案；final 资产无 AI 任务入口 → 返回 null 不渲染按钮。
				var regenPlanFor = function (assetRef) {
					var m = /^chapters\/(\d{1,4})\/(blueprint|draft|review|final)$/.exec(String(assetRef || ""));
					if (m) {
						var chapter = Number(m[1]);
						if (m[2] === "blueprint") return { kind: "generate-chapter-blueprint", params: { chapter: chapter } };
						if (m[2] === "draft") return { kind: "generate-chapter-draft", params: { chapter: chapter } };
						if (m[2] === "review") return { kind: "review-chapter", params: { chapter: chapter } };
						return null;
					}
					if (assetRef === "architecture") return { kind: "generate-architecture", params: {} };
					if (assetRef === "worldbuilding") return { kind: "generate-worldbuilding", params: {} };
					if (assetRef === "characters") return { kind: "complete-characters", params: {} };
					if (assetRef === "outline") return { kind: "generate-outline", params: {} };
					return null;
				};
				var regenerateProposal = function (proposal) {
					if (!proposal || busy) return;
					var plan = regenPlanFor(proposal.assetRef);
					if (!plan) return;
					setReviewing(null);
					sendTask(plan.kind, plan.params, t("regenRequest"));
				};
				// 运行中任务「重发指令」（规格 §2.8 会话已中断可继续）：指令随任务持久化，仅重发不重建任务
				var resendTask = function (taskId) {
					if (busy) return;
					var task = null;
					var list = detail.tasks || [];
					for (var i = 0; i < list.length; i++) { if (list[i].taskId === taskId) task = list[i]; }
					if (!task || !task.instruction) { setErr(t("resendNone")); return; }
					setBusy(true); setErr(""); setMsg("");
					Promise.resolve(deps.sendInstruction(task.instruction)).then(function (sent) {
						var patch = { status: "running", event: { type: sent.result === "none" ? "instruction-copy-failed" : "instruction-sent" } };
						if (sent.sessionId) patch.sessionId = sent.sessionId;
						var update = dramaApi("drama.task.update", { workspaceId: wsId, projectId: projectId, taskId: taskId, patch: patch });
						if (sent.result === "none") { setErr(t("instructNone")); return update; }
						setMsg(sent.result === "prefilled" ? t("instructPrefilled") : t("instructCopied"));
						return update;
					}).then(function () { return refresh(); })
						.catch(function (e) { setErr(String(e.message || e)); })
						.then(function () { setBusy(false); });
				};
				var createAdaptation = function (chapterId, params) {
					setBusy(true); setErr("");
					dramaApi("drama.adaptation.create", { workspaceId: wsId, projectId: projectId, chapterId: chapterId, params: params })
						.then(function (v) {
							return Promise.resolve(deps.sendInstruction(v.instruction)).then(function (sent) {
								setMsg(sent.result === "prefilled" ? t("instructPrefilled") : t("instructCopied"));
								var patch = { status: "running", event: { type: sent.result === "none" ? "instruction-copy-failed" : "instruction-sent" } };
								if (sent.sessionId) patch.sessionId = sent.sessionId;
								return dramaApi("drama.task.update", { workspaceId: wsId, projectId: projectId, taskId: v.taskId, patch: patch });
							});
						})
						.then(function () { return refresh(); })
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
						onRegenerate: regenerateProposal,
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
				return h("div", { className: "vg-wb-page", style: { maxWidth: "none" } },
					h("div", { className: "vg-wb-wbhead" },
						h("div", { className: "vg-row" },
							h("button", { className: "vg-btn vg-btn-mini", onClick: props.onBack }, "← " + t("backToList")),
							h("span", { className: "vg-wb-title" }, detail.manifest.title),
						statusChip(t, detail.status),
						h("span", { className: "vg-tpl-meta" }, fill(t("chaptersProgress"), { done: chaptersFinal, planned: detail.manifest.plannedChapters })),
						(pending.length > 0 ? h("span", { className: "vg-badge vg-badge-review" }, fill(t("pendingN"), { n: pending.length })) : null),
						h("div", { style: { flex: 1 } }),
						h("button", { className: "vg-btn vg-btn-mini", onClick: deps.backToConversation }, "← " + t("backToChat")),
							h("button", { className: "vg-btn vg-btn-mini", onClick: function () { setSideOpen(!sideOpen); } }, sideOpen ? t("collapse") : t("expand")),
						),
					),
					msg ? h("div", { className: "vg-msg vg-msg-ok" }, msg) : null,
					err ? h("div", { className: "vg-row", style: { flexWrap: "nowrap" } },
						h("div", { className: "vg-msg vg-msg-err", style: { flex: 1 } }, err),
						sendRetry ? h("button", { className: "vg-btn vg-btn-mini", style: { flex: "none" }, disabled: busy, onClick: retrySend, title: t("retrySend") }, t("retrySend")) : null,
					) : null,
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
								busy: busy,
								onOpenSession: deps.openSession,
								onResendTask: resendTask,
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
											!p.fresh && regenPlanFor(p.assetRef) ? h("button", { className: "vg-btn vg-btn-mini", disabled: busy, onClick: function () { regenerateProposal(p); } }, t("regenBtn")) : null,
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
				// 记住上次选中的工作区（localStorage 持久化，跨面板重挂载/重开页面）；
				// 空串 = 「全部工作区」聚合视图（服务端 project.list 缺省即跨工作区聚合），
				// 没有记忆时默认全部视图——打开工坊即见所有运行中/已完结任务，无需再选。
				var wsIdState = React.useState(function () { return readSavedWsId(); });
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

				var pickWs = function (id) { setWsId(id); saveWsId(id); };
				var loadWs = React.useCallback(function () {
					return dramaApi("drama.workspace.resolve", {}).then(function (v) {
						setWs(v);
						// 记忆的工作区已不存在（被移除/换仓）→ 回落全部视图；不强制默认第一个
						setWsId(function (cur) {
							if (!cur) return "";
							var exists = (v.workspaces || []).some(function (w) { return w.id === cur; });
							return exists ? cur : "";
						});
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
					return h("div", { className: "vg-wb-page" },
						h("h2", { style: { margin: 0, fontSize: 18 } }, t("wbTitle")),
						h("div", { className: "vg-banner warn" }, t("registryMissing")),
					);
				}
				if (openId !== null && wsId) {
					return h("div", { className: "vg-wb-page", style: { maxWidth: "none" } },
						h(ProjectWorkbench, { workspaceId: wsId, projectId: openId, onBack: function () { setOpenId(null); loadProjects().catch(function () {}); } }),
					);
				}
				var list = (projects || []).filter(function (p) {
					if (filter.status !== "all" && p.status !== filter.status) return false;
					if (filter.q && String(p.title || "").toLowerCase().indexOf(filter.q.toLowerCase()) === -1) return false;
					return true;
				});
				// 新建项目需要具体工作区：全部视图下先落到记忆的/第一个工作区（工具栏可见地切换）
				var startWizard = function () {
					if (!wsId) {
						var saved = readSavedWsId();
						var exists = saved && (ws.workspaces || []).some(function (w) { return w.id === saved; });
						var target = exists ? saved : ((ws.workspaces && ws.workspaces[0] && ws.workspaces[0].id) || "");
						if (!target) { setErr(t("registryMissing")); return; }
						pickWs(target);
					}
					setWizard(true);
				};
				var wsTitleMap = {};
				((ws && ws.workspaces) || []).forEach(function (w) { wsTitleMap[w.id] = w.title || w.id; });
				return h("div", { className: "vg-wb-page" },
					h("div", { className: "vg-wb-hero" },
						h("div", { className: "vg-wb-hero-icon" }, h(ClapperIcon, { size: 22 })),
						h("div", { style: { flex: 1, minWidth: 0 } },
							h("h2", null, t("wbTitle")),
							h("div", { className: "sub" }, t("wbIntro")),
						),
						h("button", { className: "vg-btn vg-btn-mini", onClick: deps.backToConversation }, "← " + t("backToChat")),
						h("button", { className: "vg-btn", disabled: !ws, onClick: function () { loadProjects().catch(function () {}); } }, t("refresh")),
						h("button", { className: "vg-btn vg-btn-primary", disabled: !ws, onClick: startWizard }, "+ " + t("newProject")),
					),
					msg ? h("div", { className: "vg-msg vg-msg-ok" }, msg) : null,
					err ? h("div", { className: "vg-msg vg-msg-err" }, err) : null,
					!ws ? h("p", { className: "vg-hint" }, t("loading")) : null,
					ws ? h("div", { className: "vg-wb-toolbar" },
						h("span", { className: "lbl" }, t("wsPick")),
						h("select", {
							className: "vg-select", value: wsId,
							onChange: function (e) { pickWs(e.target.value); setProjects(null); },
						}, [h("option", { key: "__all__", value: "" }, t("wsAll"))].concat((ws.workspaces || []).map(function (w) { return h("option", { key: w.id, value: w.id }, w.title || w.id); }))),
						h("select", {
							className: "vg-select", value: filter.status,
							onChange: function (e) { setFilter(Object.assign({}, filter, { status: e.target.value })); },
						}, ["all", "writing", "pending-review", "adapting", "done"].map(function (s) {
							return h("option", { key: s, value: s }, s === "all" ? t("filterAll") : t(D_STATUS_KEY[s]));
						})),
						h("input", {
							className: "vg-input", placeholder: t("search"), value: filter.q,
							style: { flex: 1, minWidth: 140, maxWidth: 260 },
							onChange: function (e) { setFilter(Object.assign({}, filter, { q: e.target.value })); },
						}),
						h("div", { style: { flex: 1 } }),
						h("span", { className: "vg-tpl-meta" }, t("autoRefreshHint")),
					) : null,
					wizard ? h("div", { style: { marginBottom: 16 } },
						h(ProjectWizard, {
							workspaceId: wsId,
							onCreated: function (projectId) { setWizard(false); setMsg(t("created")); loadProjects().catch(function () {}); setOpenId(projectId); },
							onCancel: function () { setWizard(false); },
						}),
					) : null,
					!wizard && projects && list.length === 0 ? h("div", { className: "vg-wb-empty" },
						h(ClapperIcon, { size: 30 }),
						h("p", { className: "hint" }, t("emptyProjects")),
						h("button", { className: "vg-btn vg-btn-primary", style: { marginTop: 12 }, onClick: startWizard }, "+ " + t("newProject")),
					) : null,
					list.length > 0 ? h("div", { className: "vg-wb-grid" },
						list.map(function (p) {
							return h(ProjectCard, {
								key: p.workspaceId + "/" + p.id, project: p,
								wsLabel: wsId ? "" : (wsTitleMap[p.workspaceId] || p.workspaceId || ""),
								onOpen: function () {
									// 全部视图进入项目：落位到该项目所在工作区（工作台需要具体 workspaceId）
									if (!wsId && p.workspaceId) pickWs(p.workspaceId);
									setOpenId(p.id);
								},
							});
						}),
					) : null,
				);
			}

			return DramaApp;
		}


		/* ── 入口：注册 locale 字典 + settings.section + 工作台 ── */

		var inject = ["slots", "locale", "sessions", "uiConversation", "layout"];

		/* ── 会话桥 v4（DSH 0.1.7 契约对齐）────────────────────────────
		 * 0.1.7 契约层核实（本地 fork deepseek-harness@0.1.7-rc.2）：
		 * - SessionListState 删 current 字段：当前会话 = byId[id].retainedBy.mainView>0
		 *   （uiWorkspace navigation 以 retain(source:'mainView') 持有选择态，
		 *   ui-session / ui-workspace 内部同口径判定）；
		 * - sessions.open() 已删：选中并展示会话走 uiWorkspace.openSession(target)
		 *   （uiWorkspace 是可选面，经 ctx.get 软探测；缺席回退旧宿主 sessions.open）；
		 * - sessions.binding / scope(id) 只认**已 retain** 的 generation：递送期用
		 *   sessions.using(id, {source}, op) 持引用（回调结算后自动 release）；
		 * - 壳解析沿 conversation.input.for(actx)（uiConversation.fillDraft 同口径）。
		 * 旧宿主（≤0.1.6）面（list.current / sessions.open / 无 using）保留软降级，
		 * 双世代兼容。UX 不变：预填草稿 → 切回会话视图，用户回车即发；
		 * 剪贴板始终同步写入兜底。
		 */

		/** 可选面（exports.inject 是 all-required）只能走 ctx.get 软探测：缺席返回 null。 */
		function uiWorkspaceFace(ctx) {
			try {
				if (ctx && typeof ctx.get === "function") return ctx.get("uiWorkspace") || null;
			} catch (probeError) { /* without inject / 服务缺席：按缺席处理 */ }
			return null;
		}

		/**
		 * 当前会话 id（0.1.7 口径）：mainView 持有者优先（byId[id].retainedBy.mainView>0）；
		 * 旧宿主（≤0.1.6）回退快照上的 current 字段直读。找不到返回 null。
		 */
		function currentSessionId(sessions) {
			try {
				if (!sessions || !sessions.list || typeof sessions.list.getSnapshot !== "function") return null;
				var list = sessions.list.getSnapshot();
				var byId = list && list.byId;
				if (byId) {
					for (var id in byId) {
						if (Object.prototype.hasOwnProperty.call(byId, id)) {
							var row = byId[id];
							if (row && row.retainedBy && (row.retainedBy.mainView || 0) > 0) return id;
						}
					}
				}
				return typeof list.current === "string" && list.current ? list.current : null;
			} catch (probeError) { return null; }
		}

		/**
		 * 输入壳解析（uiConversation.fillDraft 同口径）：conversation.input.for(actx)。
		 * 0.1.7：scope(id) 只借已 retain 的 generation（binding(id)?.ctx 兜底）；
		 * 旧宿主：actx.conversation 直读。要求 setDraft 在场。
		 */
		function inputShellFor(ctx, sessions, sessionId) {
			try {
				var actx = sessions && typeof sessions.scope === "function" ? sessions.scope(sessionId) : undefined;
				if (!actx && sessions && typeof sessions.binding === "function") {
					var binding = sessions.binding(sessionId);
					actx = binding && binding.ctx;
				}
				if (!actx) return null;
				var conversation = (ctx && typeof ctx.get === "function" ? ctx.get("conversation") : null) || actx.conversation;
				var input = conversation && conversation.input;
				var shell = input && typeof input.for === "function" ? input.for(actx) : null;
				return shell && typeof shell.setDraft === "function" ? shell : null;
			} catch (probeError) { return null; }
		}

		/** 挂载重试参数：0.1.7 conversation 挂载异步，openSession 后输入壳可能迟到位。 */
		var VG_BRIDGE_RETRIES = 8;
		var VG_BRIDGE_RETRY_MS = 250;

		/**
		 * 写草稿（**不自动提交**——用户回车即发）。输入壳未挂载按重试参数等待；
		 * 落地返回 'prefilled'，重试耗尽返回 'failed'（绝不假装成功）。
		 */
		function prefillToSession(ctx, sessions, sessionId, text, attempt) {
			attempt = attempt || 0;
			var shell = inputShellFor(ctx, sessions, sessionId);
			if (shell) {
				try {
					var ui = ctx && ctx.uiConversation;
					if (ui && typeof ui.fillDraft === "function") ui.fillDraft(sessionId, text);
					else shell.setDraft(text);
					return Promise.resolve("prefilled");
				} catch (fillError) { /* 写入失败：按未挂载重试 */ }
			}
			if (attempt + 1 < VG_BRIDGE_RETRIES) {
				return new Promise(function (resolve) { setTimeout(resolve, VG_BRIDGE_RETRY_MS); })
					.then(function () { return prefillToSession(ctx, sessions, sessionId, text, attempt + 1); });
			}
			return Promise.resolve("failed");
		}

		/** 剪贴板写入：'copied' | 'none'（剪贴板不可用即 none，绝不假装成功）。 */
		function clipboardCopy(text) {
			try {
				if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
					return navigator.clipboard.writeText(text)
						.then(function () { return "copied"; })
						.catch(function () { return "none"; });
				}
			} catch (error) { /* 剪贴板不可用 */ }
			return Promise.resolve("none");
		}

		/** 切回会话视图：面板激活时输入框在对话页，先离开面板再写草稿。 */
		function backToChat(ctx) {
			try { if (ctx && ctx.layout && typeof ctx.layout.selectPanel === "function") ctx.layout.selectPanel(null); } catch (layoutError) { /* 服务不可达：留在当前面板 */ }
		}

		/** 选中并展示会话：0.1.7 uiWorkspace.openSession（ctx.get 软探测）→ 旧宿主 sessions.open。 */
		function openSessionView(ctx, sessions, sessionId) {
			try {
				var uiws = uiWorkspaceFace(ctx);
				if (uiws && typeof uiws.openSession === "function") { uiws.openSession(sessionId); return true; }
				if (sessions && typeof sessions.open === "function") { sessions.open(sessionId); return true; }
			} catch (openError) { /* 已选中 */ }
			return false;
		}

		/**
		 * 任务指令发送桥 v4：定位会话 → 持引用预填草稿 → 切回会话视图。
		 * 1) 会话落点：当前会话（mainView 持有者）优先，缺席则 sessions.create() + 展示；
		 * 2) 递送：sessions.using(id, {source:'dsh-video-generator'}, op) 持引用
		 *    （0.1.7 binding/scope 借代的前提；using 缺席的旧宿主直接递送）；
		 * 3) prefillToSession：fillDraft/setDraft，输入壳挂载迟到位按重试参数等待。
		 * 剪贴板始终同步写入兜底。返回 Promise<{result:'prefilled'|'copied'|'none', sessionId?}>。
		 */
		function sendInstructionFor(ctx, text) {
			var sessions = ctx && ctx.sessions;
			var write = clipboardCopy(text);
			var current = currentSessionId(sessions);
			var plan;
			try {
				if (current) plan = Promise.resolve(current);
				else if (sessions && typeof sessions.create === "function") {
					plan = Promise.resolve(sessions.create()).then(function (id) {
						openSessionView(ctx, sessions, id);
						return id;
					}).catch(function () { return null; });
				} else plan = Promise.resolve(null);
			} catch (bridgeError) {
				console.warn("[dsh-video-generator] 会话桥定位异常:", bridgeError && bridgeError.message);
				plan = Promise.resolve(null);
			}
			return Promise.resolve(plan).then(function (sessionId) {
				return Promise.resolve(write).then(function (copied) {
					if (!sessionId) return { result: copied === "copied" ? "copied" : "none" };
					backToChat(ctx);
					var deliver = function () { return prefillToSession(ctx, sessions, sessionId, text, 0); };
					var delivered = sessions && typeof sessions.using === "function"
						? Promise.resolve(sessions.using(sessionId, { source: "dsh-video-generator" }, deliver)).catch(function () { return "failed"; })
						: deliver();
					return Promise.resolve(delivered).then(function (outcome) {
						if (outcome === "prefilled") return { result: "prefilled", sessionId: sessionId };
						return { result: copied === "copied" ? "copied" : "none", sessionId: sessionId };
					});
				});
			});
		}


		function apply(ctx) {
			var removeStyles = ensureStyles();
			if (removeStyles !== null && typeof ctx.effect === "function") {
				// 样式标签随插件 fiber 卸载移除（重复挂载返回 null，不动既存标签）
				ctx.effect(function () { return removeStyles; }, "dsh-video-generator: styles");
			}
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

			// ── 任务指令发送桥（§6.2）：会话桥 v4（模块级函数见上，ctx 显式传入）。
			// 预填会话输入框 → 切回会话视图，用户回车即发；剪贴板始终同步写入兜底。
			// 返回 Promise<{result:'prefilled'|'copied'|'none', sessionId?}>。
			var sendInstruction = function (text) {
				return sendInstructionFor(ctx, text);
			};

			var openSessionById = function (sessionId) {
				var sessions = ctx.sessions;
				var pre = sessions && typeof sessions.refresh === "function"
					? Promise.resolve(sessions.refresh()).catch(function () {}) : Promise.resolve();
				pre.then(function () {
					openSessionView(ctx, sessions, sessionId);
					backToChat(ctx);
				});
			};

			var backToConversation = function () {
				backToChat(ctx);
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

		exports.__testHooks = {
			currentSessionId: currentSessionId,
			inputShellFor: inputShellFor,
			prefillToSession: prefillToSession,
			openSessionView: openSessionView,
			sendInstructionFor: sendInstructionFor,
			flattenRows: flattenRows,
		};
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
