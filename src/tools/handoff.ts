/** LLM 三段交接工具（规格 §5 表）：会话模型产出结构化 JSON → 校验 + 落盘 + run 推进。 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VaultStore } from '../store/vault.ts'
import type { RunStore } from '../store/runs.ts'
import { validateStory, validateScript, validateStoryboard, HandoffError, type StoryboardShot } from '../schema/handoff.ts'
import { buildShotPrompt } from '../prompts.ts'
import { STAGES } from '../stages.ts'

export interface HandoffContext {
  vault: VaultStore
  runs: RunStore
}

export type ToolResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }

function runDir(runs: RunStore, runId: string): string {
  return join(runs.rootDir, runId)
}

function persist(runs: RunStore, runId: string, name: 'story' | 'script' | 'storyboard', data: unknown): void {
  const dir = runDir(runs, runId)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = join(dir, `${name}.json.tmp-${process.pid}`)
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  renameSync(tmp, join(dir, `${name}.json`))
}

function requireRun(runs: RunStore, runId: unknown): string {
  const id = typeof runId === 'string' ? runId : ''
  if (!runs.get(id)) throw new HandoffError('not-found', `run 不存在: ${id}`)
  return id
}

function wrap(fn: () => unknown): ToolResult {
  try {
    return { ok: true, value: fn() }
  } catch (err) {
    if (err instanceof HandoffError) return { ok: false, error: { code: err.code, message: err.message } }
    return { ok: false, error: { code: 'internal', message: err instanceof Error ? err.message : String(err) } }
  }
}

export interface HandoffTools {
  story: { execute: (args: { story: unknown }) => Promise<ToolResult> }
  script: { execute: (args: { runId: string; script: unknown }) => Promise<ToolResult> }
  storyboard: { execute: (args: { runId: string; shots: unknown; style?: string }) => Promise<ToolResult> }
}

/** 四层提示词注入：角色锚 + 运镜 + 风格 + 参考图提示，产出 positive/negative 落盘。 */
function enrichShots(
  shots: StoryboardShot[],
  characters: Array<{ id: string; name: string; appearance: string }>,
  style: string,
): Array<StoryboardShot & { positive: string; negative: string }> {
  return shots.map((shot) => {
    const anchors = shot.characterIds.map((cid) => {
      const ch = characters.find((c) => c.id === cid)
      return ch ? `${ch.name}（${ch.appearance}）` : cid
    })
    const merged = buildShotPrompt({
      // manual 层以手写画面描述为准；shot.line 是镜头台词（给后续 voiceover/字幕，不进画面提示词）。
      line: shot.prompt,
      characterAnchors: anchors,
      camera: shot.camera,
      style,
      // referenceHint 只有角色入镜时才有意义：无角色入镜时画面主体退回手写 line，避免空参考提示污染。
      referenceHint: shot.characterIds.length ? '画面主体与服饰严格参考参考图中的角色形象' : undefined,
    })
    return { ...shot, positive: merged.positive, negative: merged.negative }
  })
}

export function buildHandoffTools(ctx: HandoffContext): HandoffTools {
  const { vault, runs } = ctx
  void vault
  return {
    story: {
      execute: async (args) => wrap(() => {
        const story = validateStory(args?.['story'])
        const run = runs.create(story.title)
        persist(runs, run.id, 'story', story)
        runs.setStage(run.id, 'story', 'done')
        runs.appendEvent(run.id, 'stage-done', { stage: 'story' })
        return { runId: run.id, stages: STAGES.slice(0, 1), next: '调用 vgen_script 提交剧本' }
      }),
    },
    script: {
      execute: async (args) => wrap(() => {
        const runId = requireRun(runs, args?.['runId'])
        const script = validateScript(args?.['script'])
        persist(runs, runId, 'script', script)
        runs.setStage(runId, 'script', 'done')
        runs.appendEvent(runId, 'stage-done', { stage: 'script' })
        return { runId, stages: STAGES.slice(0, 2), next: '调用 vgen_storyboard 提交分镜' }
      }),
    },
    storyboard: {
      execute: async (args) => wrap(() => {
        const runId = requireRun(runs, args?.['runId'])
        const scriptFile = join(runDir(runs, runId), 'script.json')
        if (!existsSync(scriptFile)) {
          throw new HandoffError('bad-request', `run ${runId} 尚无剧本：请先调用 vgen_script 提交 script`)
        }
        const script = JSON.parse(readFileSync(scriptFile, 'utf8')) as Record<string, unknown>
        const storyboard = validateStoryboard({
          shots: args?.['shots'],
          characters: script['characters'],
          scenes: script['scenes'],
        })
        const style = typeof args?.['style'] === 'string' ? args['style'] : typeof script['style'] === 'string' ? script['style'] : ''
        const enriched = enrichShots(
          storyboard.shots,
          storyboard.characters as Array<{ id: string; name: string; appearance: string }>,
          style,
        )
        persist(runs, runId, 'storyboard', { shots: enriched })
        runs.setStage(runId, 'storyboard', 'done')
        runs.appendEvent(runId, 'stage-done', { stage: 'storyboard' })
        return { runId, stages: STAGES.slice(0, 3), shots: enriched.map((s) => ({ index: s.index, prompt: s.positive })) }
      }),
    },
  }
}

/* ── DSH tools registry 的 raw definition（plain object，零依赖注册形态，照 super-ppts 契约） ── */

/** dsh tools registry 接受的最小定义形态（见 @deepseek-ai/dsh-tools register()）。 */
export interface DshToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render: (args: unknown, value: unknown) => Array<{ type: string; text: string }>
  }
  timeoutMs?: number
  execute: (args: unknown) => Promise<unknown>
}

function jsonRender(_args: unknown, value: unknown): Array<{ type: string; text: string }> {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

const STORY_PARAM = {
  type: 'object',
  description: '故事对象：title/logline/style/characters[{id,name,appearance}]/chapters[]',
} as const

const RUNID_PARAM = {
  type: 'string',
  description: 'vgen_story 返回的 runId（run- 前缀）',
} as const

/** 三工具定义（照 super-ppts 契约：plain object + JSON Schema + JSON render）。 */
export function handoffToolDefs(handoff: HandoffTools): DshToolDefinition[] {
  return [
    {
      name: 'vgen_story',
      description: '提交结构化故事 JSON，开新 run 并落盘（LLM 三段交接第 1 步）。返回 runId 与阶段列表。',
      parameters: { type: 'object', properties: { story: STORY_PARAM }, required: ['story'] },
      output: { schema: { type: 'object' }, render: jsonRender },
      timeoutMs: 10_000,
      execute: (args) => handoff.story.execute(args as { story: unknown }),
    },
    {
      name: 'vgen_script',
      description: '提交剧本（场次/角色引用/对白，引用完整性校验），挂到已有 run（LLM 三段交接第 2 步）。',
      parameters: {
        type: 'object',
        properties: { runId: RUNID_PARAM, script: { type: 'object', description: '剧本对象：story 字段 + scenes[{id,name,characters[]}]/dialog[{sceneId,characterId,line}]' } },
        required: ['runId', 'script'],
      },
      output: { schema: { type: 'object' }, render: jsonRender },
      timeoutMs: 10_000,
      execute: (args) => handoff.script.execute(args as { runId: string; script: unknown }),
    },
    {
      name: 'vgen_storyboard',
      description:
        '提交分镜数组（每镜 index/line/prompt/characterIds/sceneId/camera/durationSec 2-10/voiceHint），校验引用完整性并自动注入四层提示词，落盘 storyboard.json（LLM 三段交接第 3 步，之后接 vgen_generate 素材生成）。',
      parameters: {
        type: 'object',
        properties: {
          runId: RUNID_PARAM,
          shots: {
            type: 'array',
            description:
              '分镜数组：index 从 1 连续、line 镜头台词、prompt 手写画面描述、characterIds 引用 story 角色 id、sceneId 可选、camera 可选（≤200）、durationSec 2..10、voiceHint 可选',
          },
          style: { type: 'string', description: '可选：本批分镜风格；缺省回退 story.style' },
        },
        required: ['runId', 'shots'],
      },
      output: { schema: { type: 'object' }, render: jsonRender },
      timeoutMs: 10_000,
      execute: (args) => handoff.storyboard.execute(args as { runId: string; shots: unknown; style?: string }),
    },
  ]
}
