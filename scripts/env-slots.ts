/** demo/运维脚本共用：从环境变量构造用途槽绑定（v2 选型层的脚本侧适配）。
 *  VGEN_IMAGE_MODEL / VGEN_VIDEO_MODEL / VGEN_TTS_MODEL → image.master+image.shot / video / tts。
 *  协议启发式与 vault 迁移同款：kling 名 → kling-video；其余视频 → dashscope-video；
 *  t2v 名自动勾 textToVideo。未设对应 env 的槽保持未绑定（运行时给出 model-unavailable 指引）。
 */

import type { ChannelRef } from '../src/providers/protocols.ts'
import type { SlotBinding, SlotId } from '../src/store/slots.ts'

export interface EnvSlotOptions {
  /** 通道三要素（脚本直连模式）。 */
  channel: ChannelRef
  env?: NodeJS.ProcessEnv
}

export function envSlots(opts: EnvSlotOptions): () => Partial<Record<SlotId, SlotBinding>> {
  const env = opts.env ?? process.env
  const image = env['VGEN_IMAGE_MODEL']?.trim()
  const video = env['VGEN_VIDEO_MODEL']?.trim()
  const tts = env['VGEN_TTS_MODEL']?.trim()
  const slots: Partial<Record<SlotId, SlotBinding>> = {}
  const put = (slot: SlotId, model: string, protocol: SlotBinding['protocol'], capabilities?: Record<string, boolean | number>): void => {
    slots[slot] = { slot, channelId: opts.channel.id, model, protocol, capabilities: capabilities ?? {} }
  }
  if (image) {
    put('image.master', image, 'openai-images')
    put('image.shot', image, 'openai-images')
  }
  if (video) {
    put('video', video, /kling/i.test(video) ? 'kling-video' : 'dashscope-video', {
      imageToVideo: !/(?:t2v|text2video)/i.test(video),
      textToVideo: /(?:t2v|text2video)/i.test(video),
    })
  }
  if (tts) put('tts', tts, 'openai-tts')
  return () => slots
}

export function envChannelOf(channel: ChannelRef): (channelId: string) => ChannelRef | null {
  return (channelId) => (channelId === channel.id ? channel : null)
}
