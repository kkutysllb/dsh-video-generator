import readline from 'node:readline/promises'
import { VaultStore } from '../src/store/vault.ts'
import { RunStore } from '../src/store/runs.ts'
import { buildGenerateTools } from '../src/tools/generate.ts'

async function main(): Promise<void> {
  const workDir = process.argv[2]!
  const runId = process.argv[3]!
  const env = { ...process.env, DSH_HOME: workDir }
  const vault = VaultStore.open({ env })
  const runs = RunStore.open({ env })
  runs.setStage(runId, 'final-cut', 'pending') // 重置该段
  const channel = { id: 'vectorengine', baseUrl: process.env['VGEN_BASE_URL']!, apiKey: process.env['VGEN_API_KEY']! }
  const interactive = Boolean(process.stdin.isTTY)
  const confirm = async (est: number | null): Promise<boolean> => {
    if (!interactive) { console.log(`[auto-confirm: non-tty] ${est ?? 'unknown'}`); return true }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    return (await rl.question(`预估 ${est ?? 'unknown'} 继续？(y/N) `)).trim().toLowerCase() === 'y'
  }
  const gen = buildGenerateTools({ vault, runs, channel: () => channel, env, confirmer: confirm })
  const r = await gen.generate.execute({ runId, target: 'final', confirm: true })
  console.log(JSON.stringify(r, null, 2).slice(0, 400))
}
main()
