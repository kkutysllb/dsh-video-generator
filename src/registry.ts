/** 通道 + 模型 -> Provider 工厂。路由依据 model-catalog 的 kind + 附录 B.4 的协议地图。
 *  成本估算唯一来源是站点价目表（pricing.ts）；model-catalog 的 pricingCny 仅作展示元数据，不参与护栏。
 *  estimate 注入链：M3b 流水线接 PricingTable 后 quote() 才有真实报价。
 */

import { resolveModel } from './model-catalog.ts'
import { createOpenaiImagesProvider } from './providers/openai-images.ts'
import { createDashscopeRelayProvider } from './providers/dashscope-relay.ts'
import { createKlingCompatProvider } from './providers/kling-compat.ts'
import type { Provider } from './provider.ts'

export interface ChannelRef {
  id: string
  baseUrl: string
  apiKey: string
}

/** 附录 B.4 协议地图：模型名 -> 视频协议族。 */
function videoProtocolFamily(model: string): 'dashscope' | 'kling' {
  const id = model.toLowerCase()
  if (id.includes('wan') || id.includes('happyhorse')) return 'dashscope'
  return 'kling'
}

export function providerForModel(
  channel: ChannelRef,
  model: string,
  opts: { fetchImpl?: typeof fetch; estimate?: (model: string) => number | null } = {},
): Provider {
  const fetchImpl = opts.fetchImpl ?? fetch
  const { entry } = resolveModel(model)
  if (entry.kind === 'image') {
    return createOpenaiImagesProvider({ baseUrl: channel.baseUrl, apiKey: channel.apiKey, model, estimate: opts.estimate }, fetchImpl)
  }
  if (entry.kind === 'video') {
    if (videoProtocolFamily(model) === 'dashscope') {
      return createDashscopeRelayProvider({ baseUrl: channel.baseUrl, apiKey: channel.apiKey, model, estimate: opts.estimate }, fetchImpl)
    }
    return createKlingCompatProvider({ baseUrl: channel.baseUrl, apiKey: channel.apiKey, model, estimate: opts.estimate }, fetchImpl)
  }
  // tts：M3 接入语音段时补适配器；此期给出清晰错误
  throw new Error(`模型形态 tts 尚未支持: ${model}`)
}
