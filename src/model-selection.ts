/** 用途槽选型层：未绑定/能力不匹配统一 model-unavailable（规格 2026-09-28 §2.3）。
 *  单槽单模型——这里没有任何"候选列表/轮询/自动兜底"语义；image.shot 未绑定回落
 *  image.master 是唯一的显式缺省。
 */

import { SLOT_META, slotUnavailableMessage, type SlotBinding, type SlotId } from './store/slots.ts'

export class ModelUnavailableError extends Error {
  readonly code = 'model-unavailable' as const
  readonly slot: SlotId
  readonly channelId: string | null
  readonly model: string | null

  constructor(slot: SlotId, opts: { channelId?: string | null; model?: string | null; reason?: string } = {}) {
    const meta = SLOT_META[slot]
    const head = opts.model
      ? `用途槽「${meta.label}」(${slot}) 绑定的模型 ${opts.model} 不可用`
      : slotUnavailableMessage(slot)
    const detail = opts.reason?.trim() ? `原因：${opts.reason.trim()}。` : ''
    const hint = opts.model ? '请在设置页「漫剧工坊 → 用途槽」更换模型，或先「测试」验证该槽位。' : ''
    super(head + '。' + detail + hint)
    this.name = 'ModelUnavailableError'
    this.slot = slot
    this.channelId = opts.channelId ?? null
    this.model = opts.model ?? null
  }
}

/** 槽位未绑定。 */
export function slotUnavailable(slot: SlotId): ModelUnavailableError {
  return new ModelUnavailableError(slot)
}

/** 槽位已绑定但能力/上游不可用。 */
export function bindingUnavailable(binding: SlotBinding, reason: string): ModelUnavailableError {
  return new ModelUnavailableError(binding.slot, { channelId: binding.channelId, model: binding.model, reason })
}

/**
 * 从槽位表解析绑定；未绑定抛 model-unavailable。
 * image.shot 未绑定时回落 image.master（规格 §2.2 的唯一显式缺省）。
 */
export function requireSlotBinding(slots: Partial<Record<SlotId, SlotBinding>>, slot: SlotId): SlotBinding {
  const hit = slots[slot]
  if (hit) return hit
  if (slot === 'image.shot') {
    const master = slots['image.master']
    if (master) return { ...master, slot: 'image.shot' }
  }
  throw slotUnavailable(slot)
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
