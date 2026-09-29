/** 通用音乐适配器单测（规格 §4）：声明式映射 sync/async 双流 + readPath 求值。 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGenericMusicProvider, readPath } from '../src/providers/generic-music.ts'
import { RelayError } from '../src/providers/relay-http.ts'
import { parseSlotBinding, type GenericMusicMapping, type SlotBinding } from '../src/store/slots.ts'

const CHANNEL = { baseUrl: 'https://music.example', apiKey: 'sk-vgen-music12345' }

function musicBinding(music: GenericMusicMapping, model = 'music-1'): SlotBinding {
  const b = parseSlotBinding('music.bgm', { channelId: 'ch-music', model, protocol: 'generic-music', music })
  assert.ok(b, 'fixture music binding 应可解析')
  return b
}

interface Call { url: string; method: string; body: Record<string, unknown> | null }

function fetchStub(handler: (call: Call) => unknown): { impl: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const impl = (async (url: unknown, init?: RequestInit) => {
    const call: Call = {
      url: String(url),
      method: String(init?.method ?? 'GET'),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    }
    calls.push(call)
    return new Response(JSON.stringify(handler(call)), { status: 200 })
  }) as unknown as typeof fetch
  return { impl, calls }
}

test('readPath：点号 + [n] 下标求值；缺失/跨类型返回 undefined', () => {
  assert.equal(readPath({ data: { audio_url: 'u1' } }, 'data.audio_url'), 'u1')
  assert.equal(readPath({ data: [{ url: 'u2' }] }, 'data[0].url'), 'u2')
  assert.equal(readPath({ a: { list: [{ v: 1 }, { v: 2 }] } }, 'a.list[1].v'), 2)
  assert.equal(readPath({}, 'data.audio_url'), undefined)
  assert.equal(readPath({ data: [] }, 'data[0].url'), undefined)
  assert.equal(readPath({ data: { url: 'u' } }, 'data[0].url'), undefined)
  assert.equal(readPath('plain-string', 'a.b'), undefined)
  assert.equal(readPath({ a: 1 }, 'a.b'), undefined)
})

test('sync 流：submit 组体（model+promptField+可选字段+extra 合并）→ 抽 audioPath → status 恒 done → fetch 取 URL', async () => {
  const mapping: GenericMusicMapping = {
    endpoint: { path: '/v1/audio/music', method: 'POST' },
    mode: 'sync',
    request: {
      promptField: 'prompt', lyricsField: 'lyrics',
      instrumentalField: 'instrumental', durationField: 'duration', extra: { quality: 'high' },
    },
    response: { audioPath: 'data.audio_url' },
  }
  const { impl, calls } = fetchStub(() => ({ data: { audio_url: 'https://cdn.example/a.mp3' } }))
  const p = createGenericMusicProvider(CHANNEL, musicBinding(mapping), impl)
  assert.equal(p.id, 'generic-music:music-1')

  const { jobId } = await p.submit('music', { prompt: '鲸落', lyrics: '深海之下', instrumental: true, durationSec: 30 })
  assert.ok(jobId.length > 0)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.url, 'https://music.example/v1/audio/music')
  assert.deepEqual(calls[0]!.body, {
    model: 'music-1', prompt: '鲸落', lyrics: '深海之下',
    instrumental: true, duration: 30, quality: 'high',
  })

  const st = await p.status(jobId)
  assert.equal(st.state, 'done')
  assert.equal(st.progress, 100)

  const f = await p.fetch(jobId)
  assert.deepEqual(f.outputs, ['https://cdn.example/a.mp3'])
  assert.equal(f.meta?.['urlIsSigned'], false)

  // 未知 jobId → RelayError（sync 暂存只在本进程内）
  await assert.rejects(p.fetch('sync-nope'), RelayError)
})

test('sync base64：audioIsBase64 → outputs 为空串占位 + meta.audioBase64', async () => {
  const mapping: GenericMusicMapping = {
    endpoint: { path: '/v1/music/generate', method: 'POST' },
    mode: 'sync',
    request: { promptField: 'prompt' },
    response: { audioPath: 'data.audio_b64', audioIsBase64: true },
  }
  const { impl } = fetchStub(() => ({ data: { audio_b64: 'QUJD' } }))
  const p = createGenericMusicProvider(CHANNEL, musicBinding(mapping), impl)
  const { jobId } = await p.submit('music', { prompt: 'x' })
  const f = await p.fetch(jobId)
  assert.deepEqual(f.outputs, [''])
  assert.equal(f.meta?.['audioBase64'], 'QUJD')
})

test('async 流：submit 抽 jobIdPath → status 轮询 statusPath（{id} 已替换）→ done/failed/取音频', async () => {
  const mapping: GenericMusicMapping = {
    endpoint: { path: '/v1/music/tasks', method: 'POST', statusPath: '/v1/music/tasks/{id}' },
    mode: 'async',
    request: { promptField: 'prompt' },
    response: {
      audioPath: 'data.audio_url', jobIdPath: 'data.id', statusValuePath: 'data.status',
      doneValues: ['completed'], failedValues: ['failed'], pollIntervalMs: 500,
    },
  }
  let poll: Record<string, unknown> = { data: { status: 'running' } }
  const { impl, calls } = fetchStub((call) => (call.method === 'POST' ? { data: { id: 'task-9' } } : poll))
  const p = createGenericMusicProvider(CHANNEL, musicBinding(mapping), impl)

  const { jobId } = await p.submit('music', { prompt: '晨雾' })
  assert.equal(jobId, 'task-9')

  // 轮询 URL：{id} 占位被替换
  const running = await p.status(jobId)
  assert.equal(running.state, 'running')
  assert.equal(running.progress, null)
  const getUrl = calls.find((c) => c.method === 'GET')?.url
  assert.equal(getUrl, 'https://music.example/v1/music/tasks/task-9')

  poll = { data: { status: 'completed' } }
  const done = await p.status(jobId)
  assert.equal(done.state, 'done')
  assert.equal(done.progress, 100)

  poll = { data: { status: 'failed' } }
  const failed = await p.status(jobId)
  assert.equal(failed.state, 'failed')
  assert.ok(failed.error?.includes('failed'))

  poll = { data: { status: 'completed', audio_url: 'https://cdn.example/final.mp3' } }
  const f = await p.fetch(jobId)
  assert.deepEqual(f.outputs, ['https://cdn.example/final.mp3'])

  // 轮询响应缺 audioPath → RelayError（消息含路径，便于定位映射错配）
  poll = { data: { status: 'completed' } }
  await assert.rejects(
    p.fetch(jobId),
    (e: unknown) => e instanceof RelayError && e.message.includes('data.audio_url'),
  )
})

test('async 异常：提交响应缺任务 id → RelayError；prompt 为空 → RelayError 400', async () => {
  const mapping: GenericMusicMapping = {
    endpoint: { path: '/v1/music/tasks', method: 'POST', statusPath: '/v1/music/tasks/{id}' },
    mode: 'async',
    request: { promptField: 'prompt' },
    response: { audioPath: 'data.audio_url', jobIdPath: 'data.id' },
  }
  const noId = fetchStub(() => ({ data: {} }))
  const p1 = createGenericMusicProvider(CHANNEL, musicBinding(mapping), noId.impl)
  await assert.rejects(p1.submit('music', { prompt: 'x' }), (e: unknown) => e instanceof RelayError && e.message.includes('任务 id'))

  const { impl } = fetchStub(() => ({}))
  const p2 = createGenericMusicProvider(CHANNEL, musicBinding(mapping), impl)
  await assert.rejects(p2.submit('music', {}), (e: unknown) => e instanceof RelayError && e.status === 400)
})

test('generic-music：sectionsPath 命中 → meta.sections（MV 对点 API 网格，P2）', async () => {
  const { createGenericMusicProvider } = await import('../src/providers/generic-music.ts')
  const { parseSlotBinding } = await import('../src/store/slots.ts')
  const binding = parseSlotBinding('music.song', {
    channelId: 'c', model: 'song-model', protocol: 'generic-music',
    music: {
      endpoint: { path: '/v1/songs' }, mode: 'sync',
      request: { promptField: 'prompt', instrumentalField: 'instrumental' },
      response: { audioPath: 'data.audio_url', sectionsPath: 'data.sections', sectionsStartField: 'start', sectionsEndField: 'end', sectionsLabelField: 'label' },
    },
  })!
  let posted: unknown
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    posted = JSON.parse(String(init?.body))
    return { ok: true, json: async () => ({ data: { audio_url: 'https://oss/song.mp3', sections: [
      { label: 'Intro', start: 0, end: 8 },
      { label: 'Chorus', start: 8, end: 20 },
    ] } }) }
  }) as unknown as typeof fetch
  const provider = createGenericMusicProvider({ baseUrl: 'https://x.example', apiKey: 'k' }, binding!, fetchImpl)
  const submitted = await provider.submit('music', { prompt: 'test song', instrumental: false }) as { jobId: string }
  assert.ok(String(submitted.jobId).startsWith('sync-'))
  assert.equal((posted as Record<string, unknown>)['instrumental'], false, 'song 槽 instrumental=false')
  const f = await provider.fetch(submitted.jobId)
  assert.deepEqual(f.meta?.sections, [
    { label: 'Intro', startSec: 0, endSec: 8 },
    { label: 'Chorus', startSec: 8, endSec: 20 },
  ])
})
