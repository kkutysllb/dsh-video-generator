/** 槽位「测试」：按槽类型做一次真实最小调用（规格 §5 / 验收 3）。
 *  结论写回槽位 verifiedAt/verifyNote（成败都留痕）；失败透出上游原始错误。
 *  注意：video/music 测试会产生一笔真实小额消费（最短时长），与生成共用确认外的独立路径——
 *  该按钮由用户在设置页显式点击，不再叠加 confirm 交互。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { providerForSlot, type ChannelRef } from './providers/protocols.ts'
import { pollUntil } from './poll.ts'
import { saveUrl } from './pipeline/shot-clip.ts'
import { synthesizeCloudSpeech, type CloudTtsConfig } from './finalcut/voice.ts'
import type { VaultStore } from './store/vault.ts'
import { capabilityFlag, type SlotBinding } from './store/slots.ts'

export interface SlotTestResult {
  ok: boolean
  slot: SlotBinding['slot']
  model: string
  detail: string
  error?: string
}

const IMAGE_TEST_SIZE = '512x512'
const VIDEO_TEST_SECONDS = 5

export async function testSlotBinding(
  vault: VaultStore,
  binding: SlotBinding,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<SlotTestResult> {
  const result = await runSlotTest(vault, binding, opts)
  const note = `${result.ok ? 'ok' : 'fail'}: ${result.error ?? result.detail}`.slice(0, 500)
  try {
    vault.setSlotBinding({ ...binding, verifiedAt: new Date().toISOString(), verifyNote: note })
  } catch {
    // 回写失败不影响测试结论本身
  }
  return result
}

async function runSlotTest(vault: VaultStore, binding: SlotBinding, opts: { fetchImpl?: typeof fetch }): Promise<SlotTestResult> {
  const channel = vault.getChannel(binding.channelId)
  if (!channel) return { ok: false, slot: binding.slot, model: binding.model, detail: '', error: `通道不存在: ${binding.channelId}` }
  if (!channel.enabled) return { ok: false, slot: binding.slot, model: binding.model, detail: '', error: `通道已停用: ${binding.channelId}` }
  const ch: ChannelRef = { id: channel.id, label: channel.label, baseUrl: channel.baseUrl, apiKey: channel.apiKey }
  const fetchImpl = opts.fetchImpl ?? fetch

  if (binding.slot === 'tts') {
    // 云端 TTS：一句最短文本，收到非空字节即通过（OpenAI 兼容 /v1/audio/speech）
    const cfg: CloudTtsConfig = {
      baseUrl: ch.baseUrl, apiKey: ch.apiKey, model: binding.model,
      voice: typeof binding.capabilities['voice'] === 'string' ? binding.capabilities['voice'] : undefined,
      instructions: typeof binding.capabilities['instructions'] === 'string' ? binding.capabilities['instructions'] : undefined,
    }
    try {
      const bytes = await synthesizeCloudSpeech(cfg, '测试', fetchImpl)
      return { ok: bytes.length > 0, slot: binding.slot, model: binding.model, detail: `tts ok（${bytes.length} bytes）` }
    } catch (err) {
      return { ok: false, slot: binding.slot, model: binding.model, detail: '', error: err instanceof Error ? err.message : String(err) }
    }
  }

  // 其余槽走 Provider 序列
  const provider = providerForSlot(ch, binding, { fetchImpl })
  const workDir = mkdtempSync(join(tmpdir(), 'vgen-slot-test-'))
  try {
    if (binding.slot === 'image.master' || binding.slot === 'image.shot') {
      const size = capabilityFlag(binding, 'sizeParam', true) ? IMAGE_TEST_SIZE : undefined
      const spec: Record<string, unknown> = { prompt: 'connectivity test: a single gray circle on white background' }
      if (size) spec['size'] = size
      const { jobId } = await provider.submit('master-asset', spec)
      await pollUntil(() => provider.status(jobId), {
        isFinal: (s) => s.state === 'done' || s.state === 'failed',
        maxPollMs: 120000,
      })
      const out = await provider.fetch(jobId)
      const url = out.outputs[0]
      if (!url) return { ok: false, slot: binding.slot, model: binding.model, detail: '', error: '任务完成但无输出 URL' }
      const headers = (out.meta as { headers?: Record<string, string> } | undefined)?.headers
      const file = join(workDir, 'probe.png')
      await saveUrl(fetchImpl, url, file, headers)
      return { ok: true, slot: binding.slot, model: binding.model, detail: `image ok（job ${String(jobId).slice(0, 60)}）` }
    }
    if (binding.slot === 'video') {
      // 测试恒走 t2v 最短时长（i2v 需公网参考图，无法离线测）；上游对模态的报错如实透出
      const { jobId } = await provider.submit('video', { prompt: 'connectivity test: slow zoom on a red circle', durationSec: VIDEO_TEST_SECONDS })
      const final = await pollUntil(() => provider.status(jobId), { isFinal: (s) => s.state === 'done' || s.state === 'failed', maxPollMs: 300000 })
      if (final.state === 'failed') return { ok: false, slot: binding.slot, model: binding.model, detail: '', error: final.error ?? 'task failed' }
      const out = await provider.fetch(jobId)
      const mode = capabilityFlag(binding, 'textToVideo', false) ? 't2v' : 'submit-level（未启用 textToVideo，i2v 无法离线验证）'
      return { ok: true, slot: binding.slot, model: binding.model, detail: `video ok（${mode}，job ${String(jobId).slice(0, 60)}）` }
    }
    // music.bgm / music.song：最短提示词，async 映射由 provider 内部轮询
    const { jobId } = await provider.submit('music', { prompt: 'connectivity test: 8 seconds of soft piano', instrumental: binding.slot === 'music.bgm', durationSec: 8 })
    const final = await pollUntil(() => provider.status(jobId), { isFinal: (s) => s.state === 'done' || s.state === 'failed', maxPollMs: 600000 })
    if (final.state === 'failed') return { ok: false, slot: binding.slot, model: binding.model, detail: '', error: final.error ?? 'task failed' }
    const out = await provider.fetch(jobId)
    const got = out.outputs[0] || (out.meta as { audioBase64?: string } | undefined)?.audioBase64
    if (!got) return { ok: false, slot: binding.slot, model: binding.model, detail: '', error: '任务完成但无音频输出' }
    return { ok: true, slot: binding.slot, model: binding.model, detail: `music ok（job ${String(jobId).slice(0, 60)}）` }
  } catch (err) {
    return { ok: false, slot: binding.slot, model: binding.model, detail: '', error: err instanceof Error ? err.message : String(err) }
  } finally {
    try { rmSync(workDir, { recursive: true, force: true }) } catch { /* 清理失败不阻塞结论 */ }
  }
}
