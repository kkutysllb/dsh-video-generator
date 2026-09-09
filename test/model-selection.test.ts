import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isExplicitModelUnavailable,
  modelUnavailableFrom,
  ModelUnavailableError,
  selectConfiguredModel,
  type ModelSelectionChannel,
} from '../src/model-selection.ts'

const channel: ModelSelectionChannel = {
  id: 'relay-a',
  label: '中转 A',
  models: [
    { model: 'image-first', kind: 'image' },
    { model: 'video-first', kind: 'video' },
    { model: 'image-second', kind: 'image' },
    { model: 'tts-first', kind: 'tts' },
    { model: 'tts-second', kind: 'tts' },
  ],
}

test('selectConfiguredModel 按 models 顺序返回指定 kind 的第一项', () => {
  assert.equal(selectConfiguredModel(channel, 'image'), 'image-first')
  assert.equal(selectConfiguredModel(channel, 'video'), 'video-first')
  assert.equal(selectConfiguredModel(channel, 'tts'), 'tts-first')
})

test('selectConfiguredModel 缺少 kind 时抛出可操作的 model-unavailable', () => {
  assert.throws(
    () => selectConfiguredModel({ id: 'empty', models: [] }, 'video'),
    (err: unknown) => err instanceof ModelUnavailableError
      && err.code === 'model-unavailable'
      && err.message.includes('empty')
      && err.message.includes('video')
      && err.message.includes('未配置')
      && err.message.includes('切换默认通道')
      && err.message.includes('重新配置模型'),
  )
})

test('modelUnavailableFrom 能描述不存在的默认通道和具体模型', () => {
  const err = modelUnavailableFrom({ id: 'missing-default', models: [] }, 'image', null, '不存在')
  assert.equal(err.code, 'model-unavailable')
  assert.match(err.message, /missing-default/)
  assert.match(err.message, /image/)
  assert.match(err.message, /未配置/)
  assert.match(err.message, /不存在/)
})

test('isExplicitModelUnavailable 识别明确的模型或分发渠道错误', () => {
  assert.equal(isExplicitModelUnavailable({ status: 404, message: 'model not found' }), true)
  assert.equal(isExplicitModelUnavailable({ status: 422, message: 'unprocessable model' }), true)
  assert.equal(isExplicitModelUnavailable({ status: 400, message: 'model does not exist' }), true)
  assert.equal(isExplicitModelUnavailable({ status: 400, message: '无可用渠道（distributor）' }), true)
  assert.equal(isExplicitModelUnavailable(new Error('model unavailable')), true)
  assert.equal(isExplicitModelUnavailable({ status: 400, message: 'model_price_not_found' }), true)
})

test('isExplicitModelUnavailable 不把限流、超时、网络和临时饱和误报为模型不存在', () => {
  assert.equal(isExplicitModelUnavailable({ status: 429, message: 'upstream saturated' }), false)
  assert.equal(isExplicitModelUnavailable({ status: 0, message: 'timeout' }), false)
  assert.equal(isExplicitModelUnavailable(new Error('network error')), false)
  assert.equal(isExplicitModelUnavailable({ status: 503, message: '临时上游饱和' }), false)
})
