import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMacSayCommand, buildSapiScript, resolveVoice } from '../src/finalcut/voice.ts'

test('resolveVoice：voiceFile 优先直通；否则按平台 say/SAPI；其他平台 null', () => {
  assert.deepEqual(resolveVoice({ voiceFile: '/x.mp3' }, 'darwin'), { kind: 'file', src: '/x.mp3' })
  assert.deepEqual(resolveVoice({ voiceHint: '旁白' }, 'darwin'), { kind: 'say', text: '旁白' })
  assert.deepEqual(resolveVoice({ voiceHint: '旁白' }, 'win32'), { kind: 'sapi', text: '旁白' })
  assert.equal(resolveVoice({ voiceHint: '旁白' }, 'linux'), null)
  assert.equal(resolveVoice({}, 'darwin'), null)
})

test('buildMacSayCommand：aiff 输出 + Tingting 缺省音色', () => {
  const cmd = buildMacSayCommand('你好鲸鱼', '/tmp/out.aiff')
  assert.deepEqual(cmd.args, ['-v', 'Tingting', '-o', '/tmp/out.aiff', '你好鲸鱼'])
  assert.equal(cmd.file, '/tmp/out.aiff')
})

test('buildSapiScript：纯函数生成 PowerShell 脚本（单引号转义）', () => {
  const s = buildSapiScript("It's fine", '/tmp/out.wav')
  assert.ok(s.includes("It''s fine"))
  assert.ok(s.includes('System.Speech'))
  assert.ok(s.includes("'/tmp/out.wav'"))
})
