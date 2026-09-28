# P0 真机验证清单（dev 环境：~/.kcoder-dev，不碰 ~/.kcoder）

> 日期：2026-09-28 · 分支 `feat/channel-slot-refactor` @ 9b018e8 + 白屏修复
> 实例：`DSH_HOME=~/.kcoder-dev dsh --profile p0web` → http://127.0.0.1:3080（快照安装 2.0.2.tgz，非 symlink）
> 运行数据根：`~/.kcoder-dev/.dsh-video-generator/`（与生产完全隔离，已由设置页「产物根目录」核实）

## A. 已自动化验证（2026-09-28，全部通过）

| # | 项 | 结果 |
|---|---|---|
| A1 | 快照安装：p0headless / p0web 均 2.0.2 + cordis.patch 注册 | ✅ |
| A2 | 组合树：`--dump-config` 含 `dsh-video-generator` patch | ✅ |
| A3 | `/health` → version 2.0.2 | ✅ |
| A4 | `channels.list` / `channels.create`（key 脱敏 `sk-••••678`） | ✅ |
| A5 | `slots.list` 六槽元数据；`slots.set` 能力位缺省落库（`{imageToVideo:true,textToVideo:false,maxDurationSec:10}`）；`slots.get` | ✅ |
| A6 | `musicTemplates.list` 4 个内置模板 | ✅ |
| A7 | 伪造 Host → 403；media 路径穿越 → 404 | ✅ |
| A8 | `drama.workspace.resolve` → registry 可用 + 工作区列表（不泄漏路径） | ✅ |
| A9 | **GUI 设置页渲染**（Playwright 真浏览器）：诊断卡（dev runs 根目录）/ 模型通道 / 用途槽六行（video 行能力位 ☑i2v·10s 为绑定写入值——端到端数据链路） | ✅ 截图 `plans/p0-settings-slots.png`、`plans/p0-slots-card.png` |
| A10 | 单测 279/279 + typecheck 0 错误 + `demo:mock` 零 key 全链路 EXIT=0 | ✅ |

## B. 待人工（需要你的眼睛 / 真实通道 key）

- [ ] **真实通道逐槽「测试」**：在 p0web 实例里给 image.master / image.shot / video / tts / music.bgm / music.song 填真实模型名，各点一次「测试」（会产生小额真实消费；音乐槽先「套用模板」再填 path/字段）。核对 `verifiedAt/verifyNote` 留痕与失败文案。
- [ ] **保存绑定 → 生成链路**：绑定后对既有 run（或 demo 造的 run）执行 `vgen_generate`，核对模型确实来自槽位、spend 事件与阈值确认语义。
- [ ] **迁移真机验证**：拷一份真实旧 `vault.json`（含 models[] + 默认通道）到 dev home 的 vault 路径，重载设置页 → 核对六槽按规则填充、`.v1.bak-*` 备份生成；再用备份覆盖回滚一次。
- [ ] 漫剧工坊主面板（侧边栏）打开/返回/项目列表照常（本轮未动，回归目检即可）。

## C. 环境操作

```sh
# 启动（已在本轮后台运行，PID 见 ps）
DSH_HOME=~/.kcoder-dev dsh --profile p0web
# 停止
pkill -f "dsh --profile p0web"
# 重装快照（代码变更后）
cd /Users/libing/kk_Projects/dsh-video-generator && npm pack \
  && DSH_HOME=~/.kcoder-dev dsh plugin --profile p0web add ./dsh-video-generator-2.0.2.tgz
```

> 注意：`~/.kcoder/profiles/web` 与 `~/.kcoder-dev/profiles/web` 都是指向本仓的 symlink（生产实时生效）；p0web/p0headless 是快照安装。**验证一律用 p0web/p0headless，不要用 web profile。**
