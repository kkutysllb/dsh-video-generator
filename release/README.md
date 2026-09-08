# 版本发布说明 / Release Notes

本目录是 dsh-video-generator 的版本发布事实源：每个发布版本一份 `v<semver>.md`，
与 git tag 一一对应。`package.json` 的 `version` 是 KCoder 插件管理检测
新版本的信号——**每次发布必须 bump 版本号**；检测到新版本后由用户手动更新。

## 版本索引

| 版本 | 日期 | 说明 |
|---|---|---|
| [v1.0.2](v1.0.2.md) | 2026-09-08 | 通道管理 tab 模型勾选面板（探测后展开 + 改 kind + 未勾选保留） |
| [v1.0.1](v1.0.1.md) | 2026-09-07 | 修复预设安装写死品牌目录——跟随 harness home（DSH_HOME）；npm 1.0.0 废弃 |
| [v1.0.0](v1.0.0.md) | 2026-09-07 | 首个公开发布：三段交接 + 评审重拍闭环 + 设置页双 tab + gate manual + 漫剧导演题材包 |

## 发版约定

每个版本说明固定以下章节（缺项写「无」）：

1. **版本信息**：版本号 / 日期 / tag / 功能提交 / 发布渠道
2. **新增**：新功能、新文件、新渠道
3. **变更**：行为、默认值、文档、元数据的改动
4. **修复**：缺陷修复（写清症状 → 根因 → 修后行为）
5. **删除**：移除的功能、文件、渠道
6. **兼容性与升级说明**：接口契约、退出码、配置语义的变化；升级方式
7. **验证**：本版本实际跑过的验证与结果

## 发版 checklist

1. `package.json` bump `version`（semver：修复 → patch，功能 → minor，破坏性 → major），
   并同步 `src/host/routes.ts` 的 `PLUGIN_VERSION`
2. 写 `release/vX.Y.Z.md`（对照上述章节），更新本 README 的版本索引
3. 提交并打 tag：`git tag -a vX.Y.Z -m "..."`
4. 推送（含 tag）：`git push origin main --follow-tags`
5. npm 渠道：`npm publish`（`prepack` 会自动 build + typecheck + test）
6. **镜像同步**：`npm run sync:mirror` 把发布物镜像到 `../dsh-plugins/dsh-video-generator/`，
   在 dsh-plugins 仓提交推送（`KCODER_PLUGINS_DIR` 可覆盖仓位置）；保证独立仓 /
   dsh-plugins 子目录两个安装入口内容一致
7. 对账：`npm run sync:check` 零差异
8. GitHub Release 页面：把 `release/vX.Y.Z.md` 内容发布为对应 tag 的 Release
   （有 gh CLI 可 `gh release create vX.Y.Z -F release/vX.Y.Z.md`，或网页手动创建）
