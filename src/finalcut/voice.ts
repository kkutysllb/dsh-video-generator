/** 配音：voiceFile 外挂优先（云 TTS/真人录音）；否则 macOS say / Windows SAPI 本地合成。 */

export interface VoiceIntent {
  voiceFile?: string
  voiceHint?: string
}

export type VoiceResolution =
  | { kind: 'file'; src: string }
  | { kind: 'say'; text: string }
  | { kind: 'sapi'; text: string }
  | null

export function resolveVoice(intent: VoiceIntent, platform: NodeJS.Platform): VoiceResolution {
  if (intent.voiceFile) return { kind: 'file', src: intent.voiceFile }
  const text = (intent.voiceHint ?? '').trim()
  if (!text) return null
  if (platform === 'darwin') return { kind: 'say', text }
  if (platform === 'win32') return { kind: 'sapi', text }
  return null
}

export function buildMacSayCommand(text: string, outAiff: string, voice = 'Tingting'): { cmd: string; args: string[]; file: string } {
  return { cmd: 'say', args: ['-v', voice, '-o', outAiff, text], file: outAiff }
}

export function buildSapiScript(text: string, outWav: string): string {
  const escaped = text.replace(/'/g, "''")
  return [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    `$s.SetOutputToWaveFile('${outWav.replace(/'/g, "''")}')`,
    `$s.Speak('${escaped}')`,
    '$s.Dispose()',
  ].join('\n')
}
