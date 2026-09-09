import type { ChannelModel, ModelKind } from './store/vault.ts'

export interface ModelSelectionChannel {
  id: string
  label?: string
  models?: ChannelModel[]
}

export class ModelUnavailableError extends Error {
  readonly code = 'model-unavailable' as const
  readonly channelId: string
  readonly channelLabel: string
  readonly kind: ModelKind | string
  readonly model: string | null

  constructor(channel: ModelSelectionChannel, kind: ModelKind | string, model: string | null, reason?: string) {
    const channelName = channel.label?.trim() || channel.id || '默认通道'
    const selectedModel = model?.trim() || '未配置'
    const detail = reason?.trim() ? '原因：' + reason.trim() + '。' : ''
    super('通道「' + channelName + '」(' + channel.id + ') 的 ' + kind + ' 模型不可用：' + selectedModel + '。' + detail + '请在设置页切换默认通道，或测试并重新配置模型。')
    this.name = 'ModelUnavailableError'
    this.channelId = channel.id
    this.channelLabel = channelName
    this.kind = kind
    this.model = model?.trim() || null
  }
}

export function modelUnavailableFrom(
  channel: ModelSelectionChannel,
  kind: ModelKind | string,
  model: string | null | undefined,
  reason?: string,
): ModelUnavailableError {
  return new ModelUnavailableError(channel, kind, model?.trim() || null, reason)
}

export function selectConfiguredModel(channel: ModelSelectionChannel, kind: ModelKind): string {
  const selected = channel.models?.find((entry) => entry.kind === kind && entry.model.trim())
  if (!selected) throw modelUnavailableFrom(channel, kind, null)
  return selected.model.trim()
}

/**
 * 判定上游是否明确表示模型或分发渠道不存在。
 * 429、超时、网络异常和 5xx 保持原有重试/失败语义。
 */
export function isExplicitModelUnavailable(error: unknown): boolean {
  if (error instanceof ModelUnavailableError) return true
  const status = readStatus(error)
  if (status === 404 || status === 422) return true
  if (status === 429 || status === 0 || (status !== undefined && status >= 500)) return false
  const message = readMessage(error)
  if (!message) return false
  if (status === 400) return MODEL_UNAVAILABLE_MESSAGE.test(message)
  return MODEL_UNAVAILABLE_MESSAGE.test(message) && !TRANSIENT_MESSAGE.test(message)
}

const MODEL_UNAVAILABLE_MESSAGE = /(\bmodel(?:\b|[_-])|模型|distributor|渠道|not\s+found|不存在|unavailable|不可用)/i
const TRANSIENT_MESSAGE = /(timeout|timed?\s*out|超时|network|网络|saturated|饱和|temporar|临时)/i

function readStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const value = (error as { status?: unknown }).status
  return typeof value === 'number' ? value : undefined
}

function readMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error !== 'object' || error === null) return ''
  const value = (error as { message?: unknown }).message
  return typeof value === 'string' ? value : ''
}
