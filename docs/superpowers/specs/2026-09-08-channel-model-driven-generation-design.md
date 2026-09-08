# 通道模型驱动生成与模型移除设计

## 背景

`dsh-video-generator` 的素材和视频流水线曾在 `src/pipeline/machine.ts` 中使用内置模型常量，导致用户在 Web 设置页配置的通道模型没有真正参与生成。安装产物上的临时修改也不能替代源码修复。与此同时，通道管理模型面板虽然支持勾选和新增模型，但保存时会自动保留未勾选的已配置模型，用户无法删除已选模型。

本变更将模型选择的事实源统一为默认通道的 vault 配置，并修复模型面板的删除语义。

## 目标与非目标

### 目标

1. 每次生成或评审重拍都从当前默认通道读取用户配置的模型，不写死 image/video 默认模型。
2. image、video、tts 模型缺失或能力不匹配时，返回明确的 `model-unavailable` 错误，指引用户切换通道或重新配置模型。
3. 上游明确报告模型/渠道不存在时，保留当前通道和模型上下文并给出同样的可操作提示；429、超时、网络错误仍作为暂时性故障处理，不误报为模型不存在。
4. 通道模型面板支持真正移除已配置模型：取消勾选并保存会删除；每行提供移除按钮，移除只在保存后落盘。
5. 保持现有 vault 数据结构兼容，不增加迁移步骤，不新增删除 API。

### 非目标

- 不在本次变更中增加“主模型”字段或重排模型的拖拽功能。
- 不改变现有 provider 协议映射，也不为某个具体供应商写入默认模型。
- 不把安装目录 `node_modules` 当作源代码发布入口。

## 选择规则

`ChannelConfig.models` 的数组顺序是用户选择顺序。同一 `kind` 有多个模型时，取数组中第一个匹配项：

- `master-asset` 与 `shot-assets`：第一个 `kind: "image"` 模型。
- `video` 与 `vgen_review` 自动重拍：第一个 `kind: "video"` 模型。
- final-cut 云端配音：若通道存在 `kind: "tts"` 模型则使用第一个；没有 tts 模型时继续使用现有本地 say/SAPI 回退。

`VGEN_VIDEO_MODEL` 不再作为生产路径覆盖通道选择，避免环境变量绕过设置页配置；内部依赖注入字段仍可用于单元测试和明确的内部调用。

## 架构与数据流

1. `host/index.ts` 的默认通道解析从 vault 返回 `id/baseUrl/apiKey/models`，仍在每次工具调用时读取，因此切换默认通道立即生效。
2. 新增小型模型选择模块，按 `kind` 选择第一个配置模型，并构造带 `channelId/model/kind` 上下文的 `ModelUnavailableError`。
3. `machine.ts` 使用该选择模块解析 image/video 模型，创建 provider 后检查当前阶段所需能力；生成提交失败时仅把明确的 400/404/无可用渠道类错误包装为 `model-unavailable`。
4. `tools/generate.ts` 和 `tools/review.ts` 将该错误转换为工具错误信封，错误码为 `model-unavailable`，文案明确提示“设置页切换默认通道，或测试并重新配置模型”。
5. 通道管理前端继续调用 `channels.update` 提交完整模型列表。`PickerPanel` 增加草稿行移除操作；保存只提交当前勾选行，允许空数组。

## API 契约

### 生成错误

```json
{
  "ok": false,
  "error": {
    "code": "model-unavailable",
    "message": "当前通道「向量引擎」的 video 模型「...」不可用。请在设置页切换默认通道，或测试并重新配置模型。"
  }
}
```

缺少模型时，模型名位置改为“未配置”，并指出所需 kind。原有 `confirm-required`、`gate-approval`、`manual-gate` 和 `not-found` 契约不变。

### 通道模型更新

继续使用：

```json
{
  "method": "channels.update",
  "args": {
    "id": "channel-id",
    "patch": {
      "models": [
        { "model": "image-model", "kind": "image" },
        { "model": "video-model", "kind": "video" }
      ]
    }
  }
}
```

`models: []` 合法，表示该通道暂不选择任何模型；后续生成时返回可操作的 `model-unavailable`。

## 错误处理

- 未配置目标 kind：立即失败，不产生消费确认或远程调用。
- Provider 能力与阶段不匹配：立即失败，不产生消费确认或远程调用。
- 上游 400/404 或消息明确表示模型/分发渠道不存在：转为 `model-unavailable`，包含通道和模型上下文。
- 429、超时、网络错误和任务本身失败：保留原错误类别与重试语义，避免用户误删一个实际可用模型。
- 所有错误不得回显 API key 或内部绝对路径。

## 测试策略

- 模型选择单元测试：按 kind 取第一项、缺少 kind 返回错误、空模型列表不调用 provider。
- machine 回归测试：素材和视频使用通道 models，而不是任何内置默认；能力不匹配在消费确认前失败；记录的 spend model 与实际选择一致。
- tools 测试：`model-unavailable` 透传为可操作错误信封；显式测试旧环境变量不会覆盖通道模型。
- routes/vault 测试：`models: []` 能保存；channels.update 能删除指定模型。
- client bundle 测试：存在移除文案和移除行为，保存按钮允许零选中模型，手写 bundle 仍能注册。

## 发布与回滚

- 版本提升至 `1.0.4`，同步 `PLUGIN_VERSION`、release 索引和新 release note。
- `npm run build` 生成 `lib`，`npm run typecheck`、`npm test`、`npm pack` 全部通过后，运行 `npm run sync:mirror` 同步 `../dsh-plugins/dsh-video-generator`，再运行 `npm run sync:check` 对账。
- 回滚时恢复 `1.0.3` 包和 dsh-plugins 镜像；vault 数据结构未改变，无需数据回滚。
