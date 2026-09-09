/** 通道 + 模型 -> Provider 工厂。路由依据 model-catalog 的 kind + 附录 B.4 的协议地图。
 *  成本估算唯一来源是站点价目表（pricing.ts）；model-catalog 的 pricingCny 仅作展示元数据，不参与护栏。
 *  estimate 注入链：M3b 流水线接 PricingTable 后 quote() 才有真实报价。
 */

import { resolveModel } from './model-catalog.ts'
import { createOpenaiImagesProvider } from './providers/openai-images.ts'
import { createDashscopeRelayProvider } from './providers/dashscope-relay.ts'
import { createKlingCompatProvider } from './providers/kling-compat.ts'
import type { Provider, ProviderCapabilities } from './provider.ts'
import type { ModelKind, ChannelModel } from './store/vault.ts'

export interface ChannelRef {
  id: string
  label?: string
  baseUrl: string
  apiKey: string
  /** 当前默认通道的用户配置模型；旧 vault 可能缺失，宿主解析时归一为空数组。 */
  models?: ChannelModel[]
}

/** 附录 B.4 协议地图：模型名 -> 视频协议族。 */
function videoProtocolFamily(model: string, configured?: ChannelModel): 'dashscope' | 'kling' {
  const profile = configured?.endpointProfile?.trim().toLowerCase()
  if (profile?.includes('kling')) return 'kling'
  if (profile?.includes('dashscope') || profile?.includes('wan')) return 'dashscope'

  const id = model.toLowerCase()
  if (id.includes('wan') || id.includes('happyhorse')) return 'dashscope'
  if (id.includes('kling')) return 'kling'
  // A configured video kind is the user's explicit modality contract.
  // Unknown names therefore use the existing i2v relay adapter instead of
  // silently falling into Kling's text-to-video-only capability.
  return configured?.kind === 'video' ? 'dashscope' : 'kling'
}

function capabilitiesForKind(kind: ModelKind): ProviderCapabilities {
  if (kind === 'image') return { image: true, qualityTier: 5 }
  if (kind === 'video') return { imageToVideo: true, textToVideo: true, qualityTier: 5 }
  return { tts: true, qualityTier: 5 }
}

export function providerForModel(
  channel: ChannelRef,
  model: string,
  opts: { fetchImpl?: typeof fetch; estimate?: (model: string) => number | null } = {},
): Provider {
  const fetchImpl = opts.fetchImpl ?? fetch
  const configured = channel.models?.find((candidate) => candidate.model === model)
  const override = configured ? { kind: configured.kind, capabilities: capabilitiesForKind(configured.kind) } : undefined
  const { entry } = resolveModel(model, override)
  if (entry.kind === 'image') {
    return createOpenaiImagesProvider({ baseUrl: channel.baseUrl, apiKey: channel.apiKey, model, estimate: opts.estimate }, fetchImpl)
  }
  if (entry.kind === 'video') {
    if (videoProtocolFamily(model, configured) === 'dashscope') {
      return createDashscopeRelayProvider({
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        model,
        estimate: opts.estimate,
        imageToVideo: configured?.kind === 'video' && !/(?:t2v|text2video)/i.test(model),
      }, fetchImpl)
    }
    return createKlingCompatProvider({ baseUrl: channel.baseUrl, apiKey: channel.apiKey, model, estimate: opts.estimate }, fetchImpl)
  }
  // tts：M3 接入语音段时补适配器；此期给出清晰错误
  throw new Error(`模型形态 tts 尚未支持: ${model}`)
}
