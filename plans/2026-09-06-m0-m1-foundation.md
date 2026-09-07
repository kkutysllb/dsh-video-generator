# dsh-video-generator M0+M1 地基实施计划

**Goal:** 建立插件骨架：Provider 接口层、多通道三要素 vault（CRUD+脱敏+原子写）、两层模型目录、通道探测模块（产品能力）、runs 持久化、HTTP 路由（health + /api 操作面）与 mock 供应商冒烟，最终以向量引擎通道完成 M0 首次实测。

**Architecture:** cordis `apply(ctx)` 插件接入 DSH（对齐 dsh-super-ppts：tsc 直出 lib、`cordis.patch.yml` insert 注册、`/api/<method>` 操作面 + 信任围栏）。核心模块全部纯函数/依赖注入化，`node --test`（Node 24 strip-types）直测 src。路由 handler 与 HTTP 解耦，便于无宿主测试。

**Tech Stack:** TypeScript 5.9（strict）+ NodeNext + `rewriteRelativeImportExtensions`；Node ≥24 原生 strip-types 跑测试；零运行时依赖。设计规格：`docs/superpowers/specs/2026-09-06-dsh-video-generator-design.md`（v1.1）。

**范围说明:** 本计划只覆盖 M0+M1。M2（openai-compat 图像/视频适配器）、M3（流水线+成片）、M4（评审+UI）在各自前置里程碑落地后另出计划——视频任务端点格式未实测前，M2 计划无法不含占位地写出。

**工程红线（全计划生效，来自规格 §6）:**
- Node 24 strip-only 不支持构造器参数属性（`constructor(private x)` 禁用），字段显式声明 + 构造器体内赋值
- 所有相对导入用 `.ts` 扩展名；vault 写盘必须 0700/0600 + tmp+rename 原子写；凭证全出口脱敏
- 测试断言任何序列化响应字符串不含明文 key

---

## 文件结构总览

```
├── package.json               # 插件清单 + 脚本
├── tsconfig.json              # tsc 直出 lib
├── cordis.patch.yml           # DSH 插件注册 patch
├── .gitignore
├── src/
│   ├── provider.ts            # 六方法 Provider 接口 + assertProvider + route
│   ├── model-catalog.ts       # 两层模型目录查表
│   ├── probe.ts               # 通道探测（/models 枚举 + 鉴权校验）
│   ├── store/
│   │   ├── vault.ts           # 多通道三要素 vault（CRUD/脱敏/原子写/权限）
│   │   └── runs.ts            # run 持久化（run.json 事实源）
│   ├── providers/
│   │   └── mock.ts            # 零 key mock 供应商
│   └── host/
│       ├── routes.ts          # 纯函数 API handler + 信封 + 信任围栏
│       └── index.ts           # apply(ctx) 接线
├── scripts/
│   ├── probe-relay.ts         # M0 CLI：对任一通道跑探测
│   ├── probe-video-endpoints.ts # M0 CLI：视频任务端点候选探测
│   └── demo-mock.ts           # mock 全链路冒烟
└── test/                      # node --test 直测 src
    ├── provider.test.ts
    ├── vault.test.ts
    ├── model-catalog.test.ts
    ├── mock.test.ts
    ├── probe.test.ts
    ├── runs.test.ts
    └── routes.test.ts
```

---

### Task 1: 仓库脚手架

**Files:**
- Create: `package.json`、`tsconfig.json`、`cordis.patch.yml`、`.gitignore`、`test/smoke.test.ts`

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "dsh-video-generator",
  "version": "0.1.0",
  "description": "DSH 原生视频生成插件：短视频/短剧/漫剧管线，用户自配 OpenAI 兼容通道（官方/中转皆可）",
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "node --test test/",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "demo:mock": "node scripts/demo-mock.ts"
  },
  "main": "./lib/host/index.js",
  "exports": {
    ".": { "default": "./lib/host/index.js" },
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" }
  },
  "files": ["lib", "cordis.patch.yml", "README.md"],
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 2: 写 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rewriteRelativeImportExtensions": true,
    "declaration": true,
    "outDir": "./lib",
    "rootDir": "./src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 写 cordis.patch.yml 与 .gitignore**

```yaml
# dsh-video-generator plugin registration patch
- insert:
    - id: dsh-video-generator
      name: 'dsh-video-generator'
```

```
node_modules/
lib/
*.tsbuildinfo
```

- [ ] **Step 4: 写冒烟测试 `test/smoke.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'

test('node strip-types 可执行且断言可用', () => {
  assert.equal(1 + 1, 2)
})
```

- [ ] **Step 5: 安装并跑测试**

Run: `npm install && npm test`
Expected: `# pass 1` / `# fail 0`

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json cordis.patch.yml .gitignore test/smoke.test.ts package-lock.json
git commit -m "chore: 插件脚手架（tsc 直出 lib + node --test strip-types）"
```

---

### Task 2: Provider 接口层（provider.ts）

**Files:**
- Create: `src/provider.ts`
- Test: `test/provider.test.ts`

- [ ] **Step 1: 写失败测试 `test/provider.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertProvider, route, type Provider } from '../src/provider.ts'

function fakeProvider(id: string, caps: Provider['capabilities']): Provider {
  return {
    id,
    capabilities: caps,
    quote: async () => ({ qualityTier: 5, costEstimate: 0, currency: 'CNY' }),
    submit: async () => ({ jobId: `${id}-job` }),
    status: async () => ({ state: 'done', progress: 100 }),
    fetch: async () => ({ outputs: [] }),
    health: async () => ({ ok: true }),
  }
}

test('assertProvider 对完整 provider 原样返回', () => {
  const p = fakeProvider('a', {})
  assert.equal(assertProvider(p), p)
})

test('assertProvider 缺方法即抛错', () => {
  const broken = fakeProvider('bad', {})
  delete (broken as Partial<Provider>).fetch
  assert.throws(() => assertProvider(broken as Provider), /缺少方法/)
})

test('route 按能力过滤并按 qualityTier 高->低排序', () => {
  const low = fakeProvider('low', { image: true, qualityTier: 1 })
  const high = fakeProvider('high', { image: true, qualityTier: 9 })
  const noImage = fakeProvider('nope', { qualityTier: 10 })
  const got = route([low, high, noImage], { image: true })
  assert.equal(got?.id, 'high')
})

test('route preferCost 时低价档优先；无匹配返回 null', () => {
  const low = fakeProvider('low', { image: true, qualityTier: 1 })
  const high = fakeProvider('high', { image: true, qualityTier: 9 })
  assert.equal(route([high, low], { image: true }, true)?.id, 'low')
  assert.equal(route([low], { imageToVideo: true }), null)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test 2>&1 | tail -5`
Expected: FAIL（找不到 `../src/provider.ts`）

- [ ] **Step 3: 实现 `src/provider.ts`**

```ts
/** 六方法 Provider 薄抽象（继承鲸影验证过的接口形态）。 */

export interface ProviderCapabilities {
  textToVideo?: boolean
  imageToVideo?: boolean
  image?: boolean
  tts?: boolean
  maxDurationSec?: number
  resolutions?: string[]
  qualityTier?: number
}

export interface ProviderQuote {
  qualityTier: number
  costEstimate: number
  currency: string
}

export interface ProviderStatus {
  state: 'running' | 'done' | 'failed' | 'unknown'
  progress: number | null
  error?: string
}

export interface ProviderSubmitResult {
  jobId: string
}

export interface ProviderFetchResult {
  outputs: string[]
  meta?: Record<string, unknown>
}

export interface ProviderHealth {
  ok: boolean
  quotaRemaining?: number | null
}

export interface Provider {
  id: string
  capabilities: ProviderCapabilities
  quote(stage: string, spec: Record<string, unknown>): Promise<ProviderQuote>
  submit(stage: string, spec: Record<string, unknown>): Promise<ProviderSubmitResult>
  status(jobId: string): Promise<ProviderStatus>
  fetch(jobId: string): Promise<ProviderFetchResult>
  health(): Promise<ProviderHealth>
}

const REQUIRED: Array<keyof Provider> = ['id', 'capabilities', 'quote', 'submit', 'status', 'fetch', 'health']

export function assertProvider<T extends Provider>(p: T): T {
  for (const m of REQUIRED) {
    if (typeof p[m] === 'undefined') {
      throw new Error(`provider ${p?.id ?? '?'} 缺少方法/字段: ${String(m)}`)
    }
  }
  return p
}

export function route(providers: Provider[], need: ProviderCapabilities, preferCost = false): Provider | null {
  const ok = providers.filter((p) =>
    Object.entries(need).every(([k, v]) => !v || Boolean(p.capabilities[k as keyof ProviderCapabilities])),
  )
  if (!ok.length) return null
  ok.sort((a, b) => {
    const ta = a.capabilities.qualityTier ?? 5
    const tb = b.capabilities.qualityTier ?? 5
    return preferCost ? ta - tb : tb - ta
  })
  return ok[0] ?? null
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: pass（含 Task 1 冒烟）

- [ ] **Step 5: Commit**

```bash
git add src/provider.ts test/provider.test.ts
git commit -m "feat: 六方法 Provider 接口 + assertProvider + capabilities 路由"
```

---

### Task 3: vault 路径、原子写与权限（store/vault.ts 第一半）

**Files:**
- Create: `src/store/vault.ts`
- Test: `test/vault.test.ts`

- [ ] **Step 1: 写失败测试（路径/原子写/权限/脱敏部分）**

追加到 `test/vault.test.ts`：

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { maskCredential, resolveVaultPath, VaultStore } from '../src/store/vault.ts'

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), 'vgen-vault-'))
}

test('maskCredential 短串全遮、长串前3后3', () => {
  assert.equal(maskCredential('abc'), '••••')
  assert.equal(maskCredential('sk-1234567890xyz'), 'sk-••••xyz')
})

test('resolveVaultPath 跟随 DSH_HOME，无则回退 home', () => {
  assert.equal(resolveVaultPath({ DSH_HOME: '/lab' }), join('/lab', '.dsh-video-generator', 'vault.json'))
  const p = resolveVaultPath({})
  assert.ok(p.includes(join('.dsh-video-generator', 'vault.json')))
})

test('save 落盘为 0600、目录 0700、内容可回读', () => {
  const home = tmpHome()
  try {
    const store = VaultStore.open({ file: join(home, '.dsh-video-generator', 'vault.json') })
    const data = store.load()
    store.save(data)
    const st = statSync(join(home, '.dsh-video-generator', 'vault.json'))
    assert.equal(st.mode & 0o777, 0o600)
    assert.equal(statSync(join(home, '.dsh-video-generator')).mode & 0o777, 0o700)
    const round = JSON.parse(readFileSync(join(home, '.dsh-video-generator', 'vault.json'), 'utf8'))
    assert.equal(round.version, 1)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('损坏文件从默认空库开始，不抛错', () => {
  const home = tmpHome()
  try {
    const file = join(home, 'vault.json')
    mkdirSync(home, { recursive: true })
    readFileSync; writeFileSync(file, '{broken', 'utf8')
    const store = VaultStore.open({ file })
    assert.deepEqual(store.load().channels, [])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
```

注意：上面第 4 个测试用了 `writeFileSync`，把文件顶部 import 行换成：

```ts
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test 2>&1 | tail -5`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/store/vault.ts`（本 Task 只实现路径/存储/脱敏）**

```ts
/** 多通道三要素保险库：0700/0600 + tmp+rename 原子写 + 全出口脱敏。 */

import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type ModelKind = 'image' | 'video' | 'tts'

export interface ChannelModel {
  model: string
  kind: ModelKind
  endpointProfile?: string
  pricingCny?: number
  qualityTier?: number
}

export interface ChannelConfig {
  id: string
  label: string
  kind: 'openai-compat'
  baseUrl: string
  apiKey: string
  models: ChannelModel[]
  enabled: boolean
  createdAt: string
}

export type GateMode = 'auto' | 'ask' | 'manual'

export interface VaultData {
  version: 1
  channels: ChannelConfig[]
  defaultChannelId: string | null
  budget: { confirmThresholdCny: number }
  gateDefaults: Record<string, GateMode>
}

export function defaultVaultData(): VaultData {
  return {
    version: 1,
    channels: [],
    defaultChannelId: null,
    budget: { confirmThresholdCny: 1 },
    gateDefaults: {},
  }
}

export function resolveVaultPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env['DSH_HOME'] ? join(env['DSH_HOME']!, '.dsh-video-generator') : join(homedir(), '.dsh-video-generator')
  return join(base, 'vault.json')
}

export function maskCredential(s: string): string {
  if (s.length <= 8) return '••••'
  return `${s.slice(0, 3)}••••${s.slice(-3)}`
}

/** 显式声明字段 + 构造器体内赋值（Node strip-only 禁参数属性）。 */
export class VaultStore {
  readonly file: string

  constructor(file: string) {
    this.file = file
  }

  static open(opts: { file?: string; env?: NodeJS.ProcessEnv } = {}): VaultStore {
    return new VaultStore(opts.file ?? resolveVaultPath(opts.env))
  }

  load(): VaultData {
    let raw: string
    try {
      raw = readFileSync(this.file, 'utf8')
    } catch {
      return defaultVaultData()
    }
    try {
      const parsed = JSON.parse(raw) as Partial<VaultData>
      return { ...defaultVaultData(), ...parsed, version: 1 }
    } catch {
      return defaultVaultData()
    }
  }

  save(data: VaultData): void {
    const dir = dirname(this.file)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    chmodSync(dir, 0o700)
    const tmp = `${this.file}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
    renameSync(tmp, this.file)
    chmodSync(this.file, 0o600)
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: pass

- [ ] **Step 5: Commit**

```bash
git add src/store/vault.ts test/vault.test.ts
git commit -m "feat: vault 存储层——DSH_HOME 跟随/0600 原子写/脱敏"
```

---

### Task 4: vault 通道 CRUD 与校验（store/vault.ts 第二半）

**Files:**
- Modify: `src/store/vault.ts`（追加方法）
- Test: `test/vault.test.ts`（追加用例）

- [ ] **Step 1: 追加失败测试**

```ts
import { VaultError } from '../src/store/vault.ts'

const GOOD = { id: 'vectorengine', baseUrl: 'https://api.vectorengine.ai/v1', apiKey: 'sk-vgen-1234567890' }

test('createChannel 正常路径：落库、返回脱敏、明文不泄露', () => {
  const home = tmpHome()
  try {
    const store = VaultStore.open({ file: join(home, 'vault.json') })
    const masked = store.createChannel({ ...GOOD, label: '向量引擎' })
    assert.equal(masked.id, 'vectorengine')
    assert.equal(masked.apiKeyMasked, 'sk-••••890')
    assert.ok(!('apiKey' in masked))
    const full = store.getChannel('vectorengine')
    assert.equal(full?.apiKey, GOOD.apiKey)
    assert.equal(full?.enabled, true)
    assert.equal(full?.kind, 'openai-compat')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('createChannel 校验：非法 id/http baseUrl/短 key/重复 id', () => {
  const home = tmpHome()
  try {
    const store = VaultStore.open({ file: join(home, 'vault.json') })
    store.createChannel({ ...GOOD })
    assert.throws(() => store.createChannel({ ...GOOD, id: 'Bad Id' }), VaultError)
    assert.throws(() => store.createChannel({ ...GOOD, id: 'insecure', baseUrl: 'http://x.example' }), VaultError)
    assert.throws(() => store.createChannel({ ...GOOD, id: 'short', apiKey: 'sk-1' }), VaultError)
    assert.throws(() => store.createChannel({ ...GOOD }), /conflict/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('updateChannel 只改提供的字段且永不明文回显；delete 生效', () => {
  const home = tmpHome()
  try {
    const store = VaultStore.open({ file: join(home, 'vault.json') })
    store.createChannel({ ...GOOD })
    const updated = store.updateChannel('vectorengine', { label: 'VE', enabled: false, baseUrl: 'https://api.vectorengine.cn/v1' })
    assert.equal(updated.label, 'VE')
    assert.equal(updated.enabled, false)
    assert.equal(updated.baseUrl, 'https://api.vectorengine.cn/v1')
    store.deleteChannel('vectorengine')
    assert.equal(store.getChannel('vectorengine'), null)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('setDefaultChannel + 预算阈值读写 + 跨实例持久化', () => {
  const home = tmpHome()
  const file = join(home, 'vault.json')
  try {
    const store = VaultStore.open({ file })
    store.createChannel({ ...GOOD })
    store.setDefaultChannel('vectorengine')
    store.setBudget(5)
    const again = VaultStore.open({ file })
    assert.equal(again.load().defaultChannelId, 'vectorengine')
    assert.equal(again.getBudget().confirmThresholdCny, 5)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test 2>&1 | tail -5`
Expected: FAIL（VaultError / createChannel 未定义）

- [ ] **Step 3: 在 `src/store/vault.ts` 追加实现**

```ts
export class VaultError extends Error {
  constructor(
    readonly code: 'bad-request' | 'not-found' | 'conflict',
    message: string,
  ) {
    super(message)
  }
}

export type MaskedChannel = Omit<ChannelConfig, 'apiKey'> & { apiKeyMasked: string }

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/
const MAX_CHANNELS = 20

export interface ChannelInput {
  id: string
  baseUrl: string
  apiKey: string
  label?: string
  models?: ChannelModel[]
  enabled?: boolean
}
```

并在 `VaultStore` 类体内追加（放到 `save()` 之后；注意类内方法用普通属性访问）：

```ts
  private data: VaultData | null = null

  private mutate<T>(fn: (d: VaultData) => T): T {
    const d = this.data ?? this.load()
    this.data = d
    const out = fn(d)
    this.save(d)
    return out
  }

  listChannels(): MaskedChannel[] {
    return this.load().channels.map((c) => masked(c))
  }

  getChannel(id: string): ChannelConfig | null {
    return this.load().channels.find((c) => c.id === id) ?? null
  }

  createChannel(input: ChannelInput): MaskedChannel {
    const id = String(input.id ?? '')
    if (!ID_RE.test(id)) throw new VaultError('bad-request', `非法通道 id: ${id}`)
    const baseUrl = validateBaseUrl(input.baseUrl)
    const apiKey = String(input.apiKey ?? '').trim()
    if (apiKey.length < 8 || apiKey.length > 4096) throw new VaultError('bad-request', 'apiKey 长度须在 8..4096')
    const label = (input.label ?? id).slice(0, 80)
    const models = validateModels(input.models ?? [])
    return this.mutate((d) => {
      if (d.channels.some((c) => c.id === id)) throw new VaultError('conflict', `通道已存在: ${id}`)
      if (d.channels.length >= MAX_CHANNELS) throw new VaultError('bad-request', `通道数超过上限 ${MAX_CHANNELS}`)
      const ch: ChannelConfig = {
        id,
        label,
        kind: 'openai-compat',
        baseUrl,
        apiKey,
        models,
        enabled: input.enabled ?? true,
        createdAt: new Date().toISOString(),
      }
      d.channels.push(ch)
      if (!d.defaultChannelId) d.defaultChannelId = id
      return masked(ch)
    })
  }

  updateChannel(id: string, patch: Partial<Pick<ChannelConfig, 'label' | 'baseUrl' | 'enabled' | 'models'>> & { apiKey?: string }): MaskedChannel {
    return this.mutate((d) => {
      const ch = d.channels.find((c) => c.id === id)
      if (!ch) throw new VaultError('not-found', `通道不存在: ${id}`)
      if (patch.label !== undefined) ch.label = String(patch.label).slice(0, 80)
      if (patch.baseUrl !== undefined) ch.baseUrl = validateBaseUrl(patch.baseUrl)
      if (patch.enabled !== undefined) ch.enabled = Boolean(patch.enabled)
      if (patch.models !== undefined) ch.models = validateModels(patch.models)
      if (patch.apiKey !== undefined) {
        const key = String(patch.apiKey).trim()
        if (key.length < 8 || key.length > 4096) throw new VaultError('bad-request', 'apiKey 长度须在 8..4096')
        ch.apiKey = key
      }
      return masked(ch)
    })
  }

  deleteChannel(id: string): void {
    this.mutate((d) => {
      const before = d.channels.length
      d.channels = d.channels.filter((c) => c.id !== id)
      if (d.channels.length === before) throw new VaultError('not-found', `通道不存在: ${id}`)
      if (d.defaultChannelId === id) d.defaultChannelId = d.channels[0]?.id ?? null
    })
  }

  setDefaultChannel(id: string | null): void {
    this.mutate((d) => {
      if (id !== null && !d.channels.some((c) => c.id === id)) throw new VaultError('not-found', `通道不存在: ${id}`)
      d.defaultChannelId = id
    })
  }

  getBudget(): VaultData['budget'] {
    return this.load().budget
  }

  setBudget(confirmThresholdCny: number): void {
    const v = Number(confirmThresholdCny)
    if (!Number.isFinite(v) || v < 0 || v > 10000) throw new VaultError('bad-request', '阈值须在 0..10000')
    this.mutate((d) => {
      d.budget = { confirmThresholdCny: v }
    })
  }

  getGateDefaults(): Record<string, GateMode> {
    return this.load().gateDefaults
  }

  setGateDefault(stage: string, mode: GateMode): void {
    if (!['auto', 'ask', 'manual'].includes(mode)) throw new VaultError('bad-request', `非法 gate 模式: ${mode}`)
    this.mutate((d) => {
      d.gateDefaults[stage] = mode
    })
  }
```

模块级辅助函数（放文件底部）：

```ts
function masked(c: ChannelConfig): MaskedChannel {
  const { apiKey, ...rest } = c
  return { ...rest, apiKeyMasked: maskCredential(apiKey) }
}

function validateBaseUrl(u: string): string {
  const s = String(u ?? '').trim().replace(/\/+$/, '')
  let parsed: URL
  try {
    parsed = new URL(s)
  } catch {
    throw new VaultError('bad-request', `非法 baseUrl: ${u}`)
  }
  if (parsed.protocol === 'https:') return s
  if (parsed.protocol === 'http:' && process.env['VGEN_ALLOW_INSECURE'] === '1') return s
  throw new VaultError('bad-request', 'baseUrl 必须为 https（本地调试可设 VGEN_ALLOW_INSECURE=1）')
}

function validateModels(models: ChannelModel[]): ChannelModel[] {
  if (!Array.isArray(models) || models.length > 100) throw new VaultError('bad-request', 'models 须为数组且 ≤100')
  return models.map((m) => {
    const model = String(m?.model ?? '')
    if (model.length < 1 || model.length > 200) throw new VaultError('bad-request', `非法模型名: ${m?.model}`)
    if (!['image', 'video', 'tts'].includes(m?.kind)) throw new VaultError('bad-request', `非法模型 kind: ${m?.kind}`)
    const out: ChannelModel = { model, kind: m.kind }
    if (m.endpointProfile !== undefined) out.endpointProfile = String(m.endpointProfile).slice(0, 120)
    if (m.pricingCny !== undefined) {
      const p = Number(m.pricingCny)
      if (!Number.isFinite(p) || p < 0) throw new VaultError('bad-request', `非法 pricingCny: ${m.pricingCny}`)
      out.pricingCny = p
    }
    if (m.qualityTier !== undefined) {
      const q = Number(m.qualityTier)
      if (!Number.isInteger(q) || q < 0 || q > 10) throw new VaultError('bad-request', `非法 qualityTier: ${m.qualityTier}`)
      out.qualityTier = q
    }
    return out
  })
}
```

注意：删掉 Step 3 里 `private data` 不存在时的重复 load——`mutate` 已统一处理；`load()` 永远从磁盘读，`this.data` 只是同一 mutate 会话内的缓存。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: pass（脱敏断言包含"明文不泄露"）

- [ ] **Step 5: Commit**

```bash
git add src/store/vault.ts test/vault.test.ts
git commit -m "feat: vault 通道 CRUD——边界校验/conflict/脱敏回显/跨实例持久化"
```

---

### Task 5: 两层模型目录（model-catalog.ts）

**Files:**
- Create: `src/model-catalog.ts`
- Test: `test/model-catalog.test.ts`

- [ ] **Step 1: 写失败测试 `test/model-catalog.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveModel } from '../src/model-catalog.ts'

test('内置目录按模型名子串匹配', () => {
  assert.equal(resolveModel('wan2.2-t2v-plus').entry.kind, 'video')
  assert.equal(resolveModel('Kling-v3').entry.kind, 'video')
  assert.equal(resolveModel('seedream-4.0').entry.kind, 'image')
  assert.equal(resolveModel('mj_imagine-6').entry.kind, 'image')
})

test('用户覆盖 > 内置 > unknown 三层查表', () => {
  const override = { pricingCny: 0.5 }
  const r1 = resolveModel('wan2.2-t2v-plus', override)
  assert.equal(r1.source, 'user')
  assert.equal(r1.entry.pricingCny, 0.5)
  const r2 = resolveModel('wan2.2-t2v-plus')
  assert.equal(r2.source, 'builtin')
  const r3 = resolveModel('totally-unknown-model')
  assert.equal(r3.source, 'unknown')
  assert.equal(r3.entry.kind, 'video') // unknown 一律按最贵形态 video 处理 -> 走成本确认
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test 2>&1 | tail -3`
Expected: FAIL

- [ ] **Step 3: 实现 `src/model-catalog.ts`**

```ts
/** 两层模型目录：内置缺省（按名字模式）+ 用户覆盖。查表：user > builtin > unknown。 */

import type { ModelKind } from './store/vault.ts'
import type { ProviderCapabilities } from './provider.ts'

export interface CatalogEntry {
  kind: ModelKind
  capabilities: ProviderCapabilities
  pricingCny?: number
  qualityTier: number
}

interface BuiltinRule extends CatalogEntry {
  patterns: string[]
}

const VIDEO: ProviderCapabilities = { imageToVideo: true, textToVideo: true, maxDurationSec: 10, qualityTier: 5 }
const IMAGE: ProviderCapabilities = { image: true, qualityTier: 5 }

export const BUILTIN_CATALOG: BuiltinRule[] = [
  { patterns: ['seedance', 'kling', 'wan2', 'wan-x', 'hailuo', 'sora', 'vidu', 'video'], kind: 'video', capabilities: VIDEO, qualityTier: 5 },
  { patterns: ['seedream', 'flux', 'mj', 'midjourney', 'dall', 'sd3', 'image', 'banana'], kind: 'image', capabilities: IMAGE, qualityTier: 5 },
  { patterns: ['tts', 'speech', 'voice'], kind: 'tts', capabilities: { tts: true }, qualityTier: 5 },
]

export interface ResolvedModel {
  model: string
  entry: CatalogEntry
  source: 'user' | 'builtin' | 'unknown'
}

export function resolveModel(
  model: string,
  override?: Partial<CatalogEntry>,
  builtin: BuiltinRule[] = BUILTIN_CATALOG,
): ResolvedModel {
  const id = String(model ?? '').toLowerCase()
  if (override && Object.keys(override).length > 0) {
    const base = matchBuiltin(id, builtin) ?? unknownEntry()
    return { model, entry: { ...base, ...override }, source: 'user' }
  }
  const hit = matchBuiltin(id, builtin)
  if (hit) return { model, entry: hit, source: 'builtin' }
  return { model, entry: unknownEntry(), source: 'unknown' }
}

function matchBuiltin(id: string, rules: BuiltinRule[]): CatalogEntry | null {
  for (const r of rules) {
    if (r.patterns.some((p) => id.includes(p))) {
      const { patterns, ...entry } = r
      return entry
    }
  }
  return null
}

function unknownEntry(): CatalogEntry {
  return { kind: 'video', capabilities: { ...VIDEO }, qualityTier: 5, pricingCny: undefined }
}
```

说明：unknown 判为 video（管线里最贵形态），配合 §4.4「unknown 价一律走确认」。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: pass

- [ ] **Step 5: Commit**

```bash
git add src/model-catalog.ts test/model-catalog.test.ts
git commit -m "feat: 两层模型目录——内置名模式匹配 + 用户覆盖 + unknown 保守归档"
```

---

### Task 6: mock 供应商（providers/mock.ts）

**Files:**
- Create: `src/providers/mock.ts`
- Test: `test/mock.test.ts`

- [ ] **Step 1: 写失败测试 `test/mock.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockProvider } from '../src/providers/mock.ts'
import { assertProvider } from '../src/provider.ts'

test('mock 全生命周期：submit -> 两次 poll 后 done -> fetch 出占位产物', async () => {
  const p = assertProvider(createMockProvider())
  assert.equal(p.id, 'mock')
  const { jobId } = await p.submit('video', { prompt: '鲸鱼跃出海面' })
  assert.ok(jobId.startsWith('mock-'))
  const s1 = await p.status(jobId)
  assert.equal(s1.state, 'running')
  const s2 = await p.status(jobId)
  assert.equal(s2.state, 'done')
  const f = await p.fetch(jobId)
  assert.equal(f.outputs.length, 1)
  assert.ok(f.outputs[0]!.startsWith('mock://'))
})

test('mock quote 零成本、health 恒 ok、failFirst 可造失败', async () => {
  const p = createMockProvider({ failFirst: 1 })
  await assert.rejects(p.submit('video', {}), /mock-注入失败/)
  const { jobId } = await p.submit('video', {})
  assert.ok(jobId)
  const q = await p.quote('video', {})
  assert.equal(q.costEstimate, 0)
  assert.equal((await p.health()).ok, true)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test 2>&1 | tail -3`
Expected: FAIL

- [ ] **Step 3: 实现 `src/providers/mock.ts`**

```ts
/** 零 key mock 供应商：内存任务状态机，两次 poll 后 done。 */

import { assertProvider, type Provider, type ProviderSubmitResult } from '../provider.ts'

export interface MockOptions {
  /** 前 N 次 submit 注入失败（测退避/换道逻辑）。 */
  failFirst?: number
  seq?: () => number
}

interface MockJob {
  stage: string
  polls: number
}

export function createMockProvider(options: MockOptions = {}): Provider {
  let submits = 0
  let seq = 0
  const jobs = new Map<string, MockJob>()
  const nextSeq = options.seq ?? (() => ++seq)

  const provider: Provider = {
    id: 'mock',
    capabilities: { image: true, textToVideo: true, imageToVideo: true, tts: true, qualityTier: 0 },
    async quote() {
      return { qualityTier: 0, costEstimate: 0, currency: 'CNY' }
    },
    async submit(stage: string): ProviderSubmitResult | never {
      submits++
      if (options.failFirst !== undefined && submits <= options.failFirst) {
        throw new Error(`mock-注入失败 #${submits}`)
      }
      const jobId = `mock-${nextSeq()}`
      jobs.set(jobId, { stage, polls: 0 })
      return { jobId }
    },
    async status(jobId) {
      const job = jobs.get(jobId)
      if (!job) return { state: 'unknown', progress: null, error: 'no-such-job' }
      job.polls++
      if (job.polls >= 2) return { state: 'done', progress: 100 }
      return { state: 'running', progress: 30 * job.polls }
    },
    async fetch(jobId) {
      const job = jobs.get(jobId)
      if (!job) return { outputs: [] }
      return { outputs: [`mock://${jobId}/${job.stage}.png`], meta: { mock: true } }
    },
    async health() {
      return { ok: true, quotaRemaining: null }
    },
  }
  return assertProvider(provider)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: pass

- [ ] **Step 5: Commit**

```bash
git add src/providers/mock.ts test/mock.test.ts
git commit -m "feat: mock 供应商——零 key 生命周期状态机 + failFirst 注入"
```

---

### Task 7: 通道探测模块（probe.ts）

**Files:**
- Create: `src/probe.ts`
- Test: `test/probe.test.ts`

- [ ] **Step 1: 写失败测试 `test/probe.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probeChannel } from '../src/probe.ts'

function fetchOk(body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch
}

test('探测成功：枚举 data[].id 并排序', async () => {
  const r = await probeChannel(
    { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-12345678' },
    fetchOk({ data: [{ id: 'wan2.2-t2v-plus' }, { id: 'seedream-4.0' }, { id: 'abc-model' }] }),
  )
  assert.equal(r.ok, true)
  assert.deepEqual(r.models, ['abc-model', 'seedream-4.0', 'wan2.2-t2v-plus'])
})

test('探测兼容裸字符串数组与 models 字段', async () => {
  const r = await probeChannel(
    { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-12345678' },
    fetchOk({ models: ['b', 'a'] }),
  )
  assert.deepEqual(r.models, ['a', 'b'])
})

test('401 -> auth-failed；404 -> http-404；空列表 -> no-models', async () => {
  const r401 = await probeChannel(
    { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-12345678' },
    (async () => new Response('denied', { status: 401 })) as unknown as typeof fetch,
  )
  assert.equal(r401.error, 'auth-failed')
  const r404 = await probeChannel(
    { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-12345678' },
    (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch,
  )
  assert.equal(r404.error, 'http-404')
  const empty = await probeChannel(
    { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-12345678' },
    fetchOk({ data: [] }),
  )
  assert.equal(empty.error, 'no-models')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test 2>&1 | tail -3`
Expected: FAIL

- [ ] **Step 3: 实现 `src/probe.ts`**

```ts
/** 通道探测：/models 枚举 + 鉴权校验。开发前置（M0 实测）与产品"测试通道"共用。 */

export interface ProbeTarget {
  baseUrl: string
  apiKey: string
}

export interface ProbeResult {
  ok: boolean
  baseUrl: string
  models: string[]
  status: number | null
  error?: 'auth-failed' | 'no-models' | 'bad-json' | 'network' | `http-${number}`
}

export async function probeChannel(
  target: ProbeTarget,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 15000,
): Promise<ProbeResult> {
  const base = target.baseUrl.trim().replace(/\/+$/, '')
  const url = `${base}/models`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${target.apiKey}` },
      signal: ac.signal,
    })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, baseUrl: base, models: [], status: res.status, error: 'auth-failed' }
    }
    if (!res.ok) {
      return { ok: false, baseUrl: base, models: [], status: res.status, error: `http-${res.status}` }
    }
    let json: unknown
    try {
      json = await res.json()
    } catch {
      return { ok: false, baseUrl: base, models: [], status: res.status, error: 'bad-json' }
    }
    const obj = json as { data?: unknown; models?: unknown }
    const raw = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.models) ? obj.models : []
    const models = raw
      .map((m) => (typeof m === 'string' ? m : (m as { id?: string })?.id ?? ''))
      .filter((s) => typeof s === 'string' && s.length > 0)
      .sort()
    if (!models.length) return { ok: false, baseUrl: base, models: [], status: res.status, error: 'no-models' }
    return { ok: true, baseUrl: base, models, status: res.status }
  } catch {
    return { ok: false, baseUrl: base, models: [], status: null, error: 'network' }
  } finally {
    clearTimeout(timer)
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: pass

- [ ] **Step 5: Commit**

```bash
git add src/probe.ts test/probe.test.ts
git commit -m "feat: 通道探测模块——/models 枚举/鉴权判定/15s 超时中止"
```

---

### Task 8: runs 持久化（store/runs.ts）

**Files:**
- Create: `src/store/runs.ts`
- Test: `test/runs.test.ts`

- [ ] **Step 1: 写失败测试 `test/runs.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunStore } from '../src/store/runs.ts'

function tmpRuns(): string {
  return mkdtempSync(join(tmpdir(), 'vgen-runs-'))
}

test('run 生命周期：create -> setStage -> appendEvent -> 落盘可回读', () => {
  const dir = tmpRuns()
  try {
    const store = RunStore.open({ rootDir: dir })
    const run = store.create('鲸鱼漫剧第一集')
    assert.ok(run.id.startsWith('run-'))
    store.setStage(run.id, 'story', 'done')
    store.appendEvent(run.id, 'stage-done', { stage: 'story' })
    const got = store.get(run.id)
    assert.equal(got?.stages['story'], 'done')
    assert.equal(got?.events.length, 1)
    assert.equal(got?.title, '鲸鱼漫剧第一集')
    const again = RunStore.open({ rootDir: dir })
    assert.equal(again.get(run.id)?.stages['story'], 'done')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('list 按 updatedAt 倒序；prune 保留最近 N 个', () => {
  const dir = tmpRuns()
  try {
    const store = RunStore.open({ rootDir: dir })
    const a = store.create('a')
    const b = store.create('b')
    const c = store.create('c')
    store.appendEvent(a.id, 'touch', {})
    const ids = store.list().map((r) => r.id)
    assert.deepEqual(ids, [a.id, c.id, b.id])
    assert.equal(store.prune(2), 1)
    assert.equal(store.get(b.id), null)
    assert.ok(store.get(c.id))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test 2>&1 | tail -3`
Expected: FAIL

- [ ] **Step 3: 实现 `src/store/runs.ts`**

```ts
/** run 持久化：每个 run 一个目录，run.json 即事实源（修鲸影内存 runs 之坑）。 */

import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export type StageState = 'pending' | 'done' | 'failed'
export type RunStatus = 'running' | 'done' | 'failed'

export interface RunEvent {
  at: string
  type: string
  detail?: Record<string, unknown>
}

export interface RunRecord {
  id: string
  title: string
  status: RunStatus
  stages: Record<string, StageState>
  events: RunEvent[]
  createdAt: string
  updatedAt: string
}

export function resolveRunsDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env['DSH_HOME'] ? join(env['DSH_HOME']!, '.dsh-video-generator') : join(homedir(), '.dsh-video-generator')
  return join(base, 'runs')
}

export class RunStore {
  readonly rootDir: string

  constructor(rootDir: string) {
    this.rootDir = rootDir
  }

  static open(opts: { rootDir?: string; env?: NodeJS.ProcessEnv } = {}): RunStore {
    return new RunStore(opts.rootDir ?? resolveRunsDir(opts.env))
  }

  private dirOf(id: string): string {
    return join(this.rootDir, id)
  }

  private fileOf(id: string): string {
    return join(this.dirOf(id), 'run.json')
  }

  create(title: string): RunRecord {
    const now = new Date().toISOString()
    const id = `run-${Date.now()}-${randomBytes(3).toString('hex')}`
    const record: RunRecord = {
      id,
      title: String(title ?? '').slice(0, 120) || 'untitled',
      status: 'running',
      stages: {},
      events: [],
      createdAt: now,
      updatedAt: now,
    }
    mkdirSync(this.dirOf(id), { recursive: true })
    this.persist(record)
    return record
  }

  get(id: string): RunRecord | null {
    try {
      return JSON.parse(readFileSync(this.fileOf(id), 'utf8')) as RunRecord
    } catch {
      return null
    }
  }

  list(): RunRecord[] {
    let ids: string[] = []
    try {
      ids = readdirSync(this.rootDir)
    } catch {
      return []
    }
    return ids
      .map((id) => this.get(id))
      .filter((r): r is RunRecord => r !== null)
      .sort((a, b) => (a.updatedAt === b.updatedAt ? (a.id < b.id ? 1 : -1) : a.updatedAt < b.updatedAt ? 1 : -1))
  }

  mutate(id: string, fn: (r: RunRecord) => void): RunRecord | null {
    const record = this.get(id)
    if (!record) return null
    fn(record)
    record.updatedAt = new Date().toISOString()
    this.persist(record)
    return record
  }

  appendEvent(id: string, type: string, detail?: Record<string, unknown>): void {
    this.mutate(id, (r) => {
      r.events.push({ at: new Date().toISOString(), type, detail })
    })
  }

  setStage(id: string, stage: string, state: StageState): void {
    this.mutate(id, (r) => {
      r.stages[stage] = state
    })
  }

  setStatus(id: string, status: RunStatus): void {
    this.mutate(id, (r) => {
      r.status = status
    })
  }

  prune(keep = 50): number {
    const all = this.list()
    let removed = 0
    for (const r of all.slice(keep)) {
      rmSync(this.dirOf(r.id), { recursive: true, force: true })
      removed++
    }
    return removed
  }

  private persist(record: RunRecord): void {
    mkdirSync(this.dirOf(record.id), { recursive: true })
    const tmp = `${this.fileOf(record.id)}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify(record, null, 2))
    renameSync(tmp, this.fileOf(record.id))
  }
}
```

注意 `writeFileSync` 需在文件顶部 import（已包含）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: pass

- [ ] **Step 5: Commit**

```bash
git add src/store/runs.ts test/runs.test.ts
git commit -m "feat: runs 持久化——run.json 事实源/倒序列表/prune 保留窗口"
```

---

### Task 9: 路由 handler 与信任围栏（host/routes.ts）

**Files:**
- Create: `src/host/routes.ts`
- Test: `test/routes.test.ts`

- [ ] **Step 1: 写失败测试 `test/routes.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleApi, healthPayload, isLoopbackRequest } from '../src/host/routes.ts'
import { VaultStore, VaultError } from '../src/store/vault.ts'
import { RunStore } from '../src/store/runs.ts'
import { probeChannel } from '../src/probe.ts'

function ctx() {
  const dir = mkdtempSync(join(tmpdir(), 'vgen-routes-'))
  const vault = VaultStore.open({ file: join(dir, 'vault.json') })
  const runs = RunStore.open({ rootDir: join(dir, 'runs') })
  return {
    dir,
    vault,
    runs,
    api: { vault, runs, probe: probeChannel },
  }
}

test('信任围栏：loopback host/ip 放行，其他拒绝', () => {
  assert.equal(isLoopbackRequest('127.0.0.1:3000', '127.0.0.1'), true)
  assert.equal(isLoopbackRequest('localhost:3000', '::1'), true)
  assert.equal(isLoopbackRequest('evil.example.com', '10.1.2.3'), false)
})

test('healthPayload 汇报版本与通道计数（不含任何明文）', () => {
  const c = ctx()
  try {
    c.vault.createChannel({ id: 'ch1', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-secret-12345678' })
    const payload = healthPayload({ vault: c.vault, runs: c.runs }) as Record<string, unknown>
    assert.equal(payload['ok'], true)
    assert.equal((payload['channels'] as Record<string, unknown>).total, 1)
    assert.ok(!JSON.stringify(payload).includes('sk-secret'))
  } finally {
    rmSync(c.dir, { recursive: true, force: true })
  }
})

test('handleApi：channels.create/list/update/delete + settings', () => {
  const c = ctx()
  try {
    const created = handleApi(c.api, 'channels.create', { id: 've', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-vgen-12345678' })
    assert.equal((created as { ok: boolean }).ok, true)
    assert.ok(!JSON.stringify(created).includes('sk-vgen-12345678'))

    const list = handleApi(c.api, 'channels.list', {}) as { ok: boolean; value: { channels: unknown[] } }
    assert.equal(list.ok, true)
    assert.equal(list.value.channels.length, 1)

    const upd = handleApi(c.api, 'channels.update', { id: 've', label: '向量引擎' }) as { ok: boolean }
    assert.equal(upd.ok, true)

    const def = handleApi(c.api, 'channels.setDefault', { id: 've' }) as { ok: boolean }
    assert.equal(def.ok, true)

    const settings = handleApi(c.api, 'settings.get', {}) as { value: { defaultChannelId: string; budget: { confirmThresholdCny: number } } }
    assert.equal(settings.value.defaultChannelId, 've')
    assert.equal(settings.value.budget.confirmThresholdCny, 1)

    handleApi(c.api, 'settings.update', { confirmThresholdCny: 3 })
    assert.equal(c.vault.getBudget().confirmThresholdCny, 3)

    handleApi(c.api, 'channels.delete', { id: 've' })
    assert.equal(c.vault.getChannel('ve'), null)
  } finally {
    rmSync(c.dir, { recursive: true, force: true })
  }
})

test('handleApi：VaultError 映射为 ok:false 信封；未知方法报 unknown-method', () => {
  const c = ctx()
  try {
    const bad = handleApi(c.api, 'channels.create', { id: 'Bad!', baseUrl: 'https://x.example', apiKey: 'sk-vgen-12345678' }) as { ok: boolean; error: { code: string } }
    assert.equal(bad.ok, false)
    assert.equal(bad.error.code, 'bad-request')
    const unknown = handleApi(c.api, 'nope', {}) as { ok: boolean; error: { code: string } }
    assert.equal(unknown.error.code, 'unknown-method')
  } finally {
    rmSync(c.dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test 2>&1 | tail -3`
Expected: FAIL

- [ ] **Step 3: 实现 `src/host/routes.ts`**

```ts
/**
 * /dsh-video-generator API 面：纯函数 handler + {ok,value}/{ok,error} 信封 + loopback 信任围栏。
 * 对齐 dsh-super-ppts 路由模式；handler 不碰 node:http，便于无宿主测试。
 */

import type { VaultStore } from '../store/vault.ts'
import { VaultError } from '../store/vault.ts'
import type { RunStore } from '../store/runs.ts'
import { probeChannel } from '../probe.ts'

export const PLUGIN_ID = 'dsh-video-generator'
export const PLUGIN_VERSION = '0.1.0'

export interface ApiContext {
  vault: VaultStore
  runs: RunStore
  probe: typeof probeChannel
}

export type Envelope = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }

export function isLoopbackRequest(host: string | undefined, remote: string | undefined): boolean {
  const hostOk = !!host && (host.startsWith('127.0.0.1') || host.startsWith('localhost') || host.startsWith('[::1]'))
  const ipOk =
    !!remote && (remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1')
  return hostOk || ipOk
}

export function healthPayload(ctx: { vault: VaultStore; runs: RunStore }): Record<string, unknown> {
  const data = ctx.vault.load()
  return {
    ok: true,
    plugin: PLUGIN_ID,
    version: PLUGIN_VERSION,
    channels: { total: data.channels.length, enabled: data.channels.filter((c) => c.enabled).length },
    runs: ctx.runs.list().length,
  }
}

export function handleApi(ctx: ApiContext, name: string, args: Record<string, unknown>): Envelope {
  try {
    return { ok: true, value: dispatch(ctx, name, args) }
  } catch (err) {
    if (err instanceof VaultError) {
      return { ok: false, error: { code: err.code, message: err.message } }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { code: 'internal', message } }
  }
}

function dispatch(ctx: ApiContext, name: string, args: Record<string, unknown>): unknown {
  const id = typeof args['id'] === 'string' ? args['id'] : undefined
  switch (name) {
    case 'channels.list':
      return { channels: ctx.vault.listChannels(), defaultChannelId: ctx.vault.load().defaultChannelId }
    case 'channels.create':
      return ctx.vault.createChannel({
        id: String(args['id'] ?? ''),
        baseUrl: String(args['baseUrl'] ?? ''),
        apiKey: String(args['apiKey'] ?? ''),
        label: args['label'] === undefined ? undefined : String(args['label']),
        models: (args['models'] ?? []) as never,
      })
    case 'channels.update':
      return ctx.vault.updateChannel(id ?? '', (args['patch'] ?? {}) as never)
    case 'channels.delete':
      ctx.vault.deleteChannel(id ?? '')
      return { deleted: id }
    case 'channels.setDefault':
      ctx.vault.setDefaultChannel(id ?? null)
      return { defaultChannelId: id ?? null }
    case 'channels.test': {
      const ch = id ? ctx.vault.getChannel(id) : null
      if (!ch) throw new VaultError('not-found', `通道不存在: ${id}`)
      // 同步信封内不 await：探测结果经 probe 异步落 args.testResult 由调用方二次查询。
      // 简化：此处直接返回 promise 由 wiring 层 await（routes 测试直接传 promise 断言）。
      return ctx.probe({ baseUrl: ch.baseUrl, apiKey: ch.apiKey }).then((r) => ({ probe: r }))
    }
    case 'runs.list':
      return { runs: ctx.runs.list() }
    case 'settings.get': {
      const d = ctx.vault.load()
      return { defaultChannelId: d.defaultChannelId, budget: d.budget, gateDefaults: d.gateDefaults }
    }
    case 'settings.update':
      if (args['confirmThresholdCny'] !== undefined) ctx.vault.setBudget(Number(args['confirmThresholdCny']))
      return ctx.vault.load().budget
    default:
      throw new VaultError('bad-request', `unknown-method: ${name}`)
  }
}
```

注意：`channels.test` 返回 Promise——把 `handleApi` 的返回类型放宽：`export type Envelope = ... | Promise<Envelope>`，并在 wiring 层 await；测试中该分支用 `await`。为此把 `handleApi` 签名改为：

```ts
export type MaybePromise<T> = T | Promise<T>
export function handleApi(ctx: ApiContext, name: string, args: Record<string, unknown>): MaybePromise<Envelope> {
  try {
    const value = dispatch(ctx, name, args)
    if (value instanceof Promise) {
      return value.then(
        (v) => ({ ok: true, value: v }) as Envelope,
        (err: unknown) => ({ ok: false, error: toError(err) }),
      )
    }
    return { ok: true, value }
  } catch (err) {
    return { ok: false, error: toError(err) }
  }
}

function toError(err: unknown): { code: string; message: string } {
  if (err instanceof VaultError) return { code: err.code, message: err.message }
  return { code: 'internal', message: err instanceof Error ? err.message : String(err) }
}
```

同时 `channels.test` 分支改为直接 `return { probe: ... }` 的 Promise 值（即 `dispatch` 返回 Promise，由上面统一包装），并补一条异步测试：

```ts
test('channels.test 返回探测信封（异步包装）', async () => {
  const c = ctx()
  try {
    c.vault.createChannel({ id: 've', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-vgen-12345678' })
    const fakeProbe = (async () => ({ ok: true, baseUrl: 'https://api.example.com/v1', models: ['m1'], status: 200 })) as typeof probeChannel
    const res = await handleApi({ vault: c.vault, runs: c.runs, probe: fakeProbe }, 'channels.test', { id: 've' })
    assert.equal((res as { ok: boolean }).ok, true)
    const value = (res as { value: { probe: { models: string[] } } }).value
    assert.deepEqual(value.probe.models, ['m1'])
  } finally {
    rmSync(c.dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: pass

- [ ] **Step 5: Commit**

```bash
git add src/host/routes.ts test/routes.test.ts
git commit -m "feat: API 操作面 handler——信封/信任围栏/通道 CRUD/探测异步包装"
```

---

### Task 10: apply(ctx) 接线 + mock 冒烟 + 构建

**Files:**
- Create: `src/host/index.ts`、`scripts/demo-mock.ts`
- Modify: 无

- [ ] **Step 1: 实现 `src/host/index.ts`**

```ts
/** DSH 插件入口：cordis 风格注册 webServer 路由（effect 生命周期管理）。 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { VaultStore, resolveVaultPath } from '../store/vault.ts'
import { RunStore, resolveRunsDir } from '../store/runs.ts'
import { probeChannel } from '../probe.ts'
import { PLUGIN_ID, handleApi, healthPayload, isLoopbackRequest } from './routes.ts'

export const name = PLUGIN_ID

interface WebServerFace {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void
}

interface HostContext {
  inject(services: string[], cb: (svc: unknown) => void): void
  effect(fn: () => () => void, name?: string): () => void
}

export function apply(ctx: HostContext): () => void {
  const vault = VaultStore.open({ env: process.env })
  const runs = RunStore.open({ env: process.env })

  ctx.inject(['webServer'], (svc) => {
    const web = svc as WebServerFace

    ctx.effect(
      () =>
        web.register({
          kind: 'exact',
          path: `/${PLUGIN_ID}/health`,
          handler: (_req, res) => json(res, 200, healthPayload({ vault, runs })),
        }),
      `${PLUGIN_ID}: health route`,
    )

    ctx.effect(
      () =>
        web.register({
          kind: 'exact',
          path: `/${PLUGIN_ID}/runs`,
          handler: (_req, res) => json(res, 200, { ok: true, value: { runs: runs.list() } }),
        }),
      `${PLUGIN_ID}: runs route`,
    )

    ctx.effect(
      () =>
        web.register({
          kind: 'prefix',
          path: `/${PLUGIN_ID}/api/`,
          handler: async (req, res) => {
            if (!isLoopbackRequest(req.headers.host, req.socket.remoteAddress)) {
              json(res, 403, { ok: false, error: { code: 'forbidden', message: '仅限本机回环访问' } })
              return
            }
            if (req.method !== 'POST') {
              json(res, 405, { ok: false, error: { code: 'method-not-allowed', message: '仅 POST' } })
              return
            }
            const methodName = (req.url ?? '').split('/api/')[1]?.split('?')[0] ?? ''
            let body: Record<string, unknown> = {}
            try {
              body = await readJsonBody(req)
            } catch {
              json(res, 400, { ok: false, error: { code: 'bad-json', message: '请求体非法 JSON' } })
              return
            }
            const envelope = await handleApi({ vault, runs, probe: probeChannel }, methodName, body)
            json(res, envelope.ok ? 200 : errorStatus(envelope), envelope)
          },
        }),
      `${PLUGIN_ID}: api face`,
    )
  })

  return () => {}
}

function errorStatus(envelope: { ok: boolean; error?: { code: string } }): number {
  const code = envelope.error?.code
  if (code === 'not-found') return 404
  if (code === 'conflict') return 409
  if (code === 'forbidden') return 403
  if (code === 'bad-request' || code === 'unknown-method' || code === 'bad-json') return 400
  return 500
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

async function readJsonBody(req: IncomingMessage, limitBytes = 1 << 20): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > limitBytes) throw new Error('body too large')
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  return JSON.parse(raw) as Record<string, unknown>
}
```

- [ ] **Step 2: 实现 `scripts/demo-mock.ts`（mock 全链路冒烟）**

```ts
/** 零 key 冒烟：mock 供应商 submit -> poll -> fetch，产物与 run 状态落盘。 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMockProvider } from '../src/providers/mock.ts'
import { RunStore } from '../src/store/runs.ts'

async function main(): Promise<void> {
  const runs = RunStore.open({ env: process.env })
  const run = runs.create('mock 冒烟')
  const p = createMockProvider()

  runs.setStage(run.id, 'video', 'running')
  const { jobId } = await p.submit('video', { prompt: 'mock 冒烟' })
  let status = await p.status(jobId)
  while (status.state === 'running') {
    status = await p.status(jobId)
  }
  if (status.state !== 'done') throw new Error(`mock 未完成: ${status.state}`)

  const fetched = await p.fetch(jobId)
  const outDir = join(runs.rootDir, run.id, 'clips')
  mkdirSync(outDir, { recursive: true })
  for (const [i, out] of fetched.outputs.entries()) {
    writeFileSync(join(outDir, `shot-${i}.txt`), `placeholder for ${out}`)
  }
  runs.setStage(run.id, 'video', 'done')
  runs.appendEvent(run.id, 'mock-done', { jobId, outputs: fetched.outputs })

  const final = runs.get(run.id)
  if (final?.stages['video'] !== 'done') throw new Error('run 状态未落盘')
  console.log(`[demo:mock] OK run=${run.id} clips=${join(outDir, 'shot-0.txt')}`)
}

main().catch((err: unknown) => {
  console.error('[demo:mock] FAILED', err)
  process.exit(1)
})
```

- [ ] **Step 3: 全量验证**

Run: `npm test && npm run typecheck && npm run build && npm run demo:mock`
Expected: 测试全绿；typecheck 0 错误；`lib/host/index.js` 生成；冒烟打印 `[demo:mock] OK run=...`

- [ ] **Step 4: 最小 profile 真机 boot（鲸影规则 10，手动验证）**

```bash
DSH_HOME=/tmp/vgen-lab-home dsh plugin --profile vgen-lab add "$(pwd)" 2>&1 | tail -3
# 若 add 本地路径的旗形不同，先 dsh plugin --help 对照（参考鲸影 README：dsh plugin --profile web add github:hackerFish/dsh-video-studio）
curl -s http://127.0.0.1:<端口>/dsh-video-generator/health | head -c 400
curl -s -X POST http://127.0.0.1:<端口>/dsh-video-generator/api/channels.create -H 'content-type: application/json' \
  -d '{"id":"ve","baseUrl":"https://api.vectorengine.ai/v1","apiKey":"sk-vgen-placeholder-1"}' | head -c 300
curl -s -X POST http://127.0.0.1:<端口>/dsh-video-generator/api/channels.list -H 'content-type: application/json' -d '{}' | head -c 300
```

Expected: health 返回 `{"ok":true,...}`；channels.create 返回脱敏 key（`••••`）；跨站伪造 Host 的请求返回 403。
（端口以 DSH 启动日志为准；验证完 `dsh plugin --profile vgen-lab remove dsh-video-generator` 清理。）

- [ ] **Step 5: Commit**

```bash
git add src/host/index.ts scripts/demo-mock.ts
git commit -m "feat: apply(ctx) 接线（health/runs/api 三路由+围栏）+ mock 全链路冒烟"
```

---

### Task 11: M0 首通道实测（向量引擎）并回填附录 B

**Files:**
- Create: `scripts/probe-relay.ts`、`scripts/probe-video-endpoints.ts`
- Modify: `docs/superpowers/specs/2026-09-06-dsh-video-generator-design.md`（附录 B）

- [ ] **Step 1: 实现 `scripts/probe-relay.ts`**

```ts
/** M0 CLI：对任一 OpenAI 兼容通道跑探测。用法：
 *  VGEN_BASE_URL=https://api.vectorengine.ai/v1 VGEN_API_KEY=sk-xxx node scripts/probe-relay.ts
 */

import { probeChannel } from '../src/probe.ts'

async function main(): Promise<void> {
  const baseUrl = process.env['VGEN_BASE_URL']
  const apiKey = process.env['VGEN_API_KEY']
  if (!baseUrl || !apiKey) {
    console.error('用法: VGEN_BASE_URL=... VGEN_API_KEY=... node scripts/probe-relay.ts')
    process.exit(2)
  }
  const r = await probeChannel({ baseUrl, apiKey })
  console.log(JSON.stringify({ ok: r.ok, status: r.status, error: r.error, modelCount: r.models.length }, null, 2))
  console.log('models:', r.models.join('\n  '))
  process.exit(r.ok ? 0 : 1)
}

main()
```

- [ ] **Step 2: 实现 `scripts/probe-video-endpoints.ts`（端点活性探测，不发真实生成任务）**

```ts
/** M0 CLI：对候选视频任务端点做活性探测——用注定不存在的模型名，
 *  404=路由不存在；400/422=路由存在但参数校验拒绝（未计费）；200=路由存在（需人工确认是否已建任务）。
 *  用法: VGEN_BASE_URL=... VGEN_API_KEY=... node scripts/probe-video-endpoints.ts
 */

const CANDIDATES = ['videos', 'video/generations', 'video/submit', 'generations']

async function main(): Promise<void> {
  const base = (process.env['VGEN_BASE_URL'] ?? '').replace(/\/+$/, '')
  const key = process.env['VGEN_API_KEY']
  if (!base || !key) {
    console.error('用法: VGEN_BASE_URL=... VGEN_API_KEY=... node scripts/probe-video-endpoints.ts')
    process.exit(2)
  }
  for (const path of CANDIDATES) {
    const status = await tryOne(`${base}/${path}`, key)
    console.log(`${path.padEnd(20)} -> HTTP ${status}`)
  }
}

async function tryOne(url: string, key: string): Promise<number | string> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: '__vgen_probe_nonexistent__', prompt: 'probe', seconds: 5 }),
      signal: AbortSignal.timeout(20000),
    })
    // 消费掉响应体避免连接悬挂；失败不关心内容
    await res.text().catch(() => '')
    return res.status
  } catch (err) {
    return err instanceof Error ? err.message : 'error'
  }
}

main()
```

- [ ] **Step 3: 真机实测（需要你的向量引擎 key，人工执行）**

```bash
export VGEN_BASE_URL="https://api.vectorengine.ai/v1"
export VGEN_API_KEY="<你的key>"
node scripts/probe-relay.ts | tee /tmp/vgen-m0-models.txt
node scripts/probe-video-endpoints.ts | tee /tmp/vgen-m0-endpoints.txt
```

Expected: probe-relay 退出码 0 并列出模型清单；端点探测输出各候选路径的状态码。**判定规则**：`videos` 或 `video/generations` 出现 400/422 即为存在的路由候选；全 404 则需要翻中转站文档确认其视频 Relay 路径（可能走 `/mj` 式专用前缀）。

- [ ] **Step 4: 回填附录 B 并提交**

把 `/tmp/vgen-m0-models.txt` 的图像/视频模型清单、端点判定结论、（如已发生）计费事实写进规格 `附录 B`，同时在 `src/model-catalog.ts` 的 `BUILTIN_CATALOG` 上方加注释注明缺省值依据。然后：

```bash
git add scripts/probe-relay.ts scripts/probe-video-endpoints.ts docs/superpowers/specs/2026-09-06-dsh-video-generator-design.md src/model-catalog.ts
git commit -m "feat(m0): 通道探测 CLI + 首通道（向量引擎）实测结论回填附录 B"
```

- [ ] **Step 5: M0/M1 出口核对（对照规格 §9）**

- [x] probe.ts + 内置目录初版 → Task 7/11
- [ ] 首通道实测结论入文档 → 本 Task
- [x] `/health` 在线 + 通道增删改测全通 → Task 10 Step 4
- [x] mock 全链路绿 → Task 10 Step 3

全部勾选后，M2 计划（openai-compat images/video 适配器 + 成本护栏）以此结论为输入另起一份 plan。

---

## 自审记录（writing-plans Self-Review）

1. **规格覆盖（M0+M1 范围内）**：provider 接口(Task 2)、vault 三要素 CRUD+脱敏+原子写+DSH_HOME(Task 3/4)、两层模型目录(Task 5)、probe 产品化(Task 7/9/11)、runs 持久化(Task 8)、/api 操作面+信封+围栏(Task 9/10)、mock 冒烟(Task 6/10)、M0 实测回填(Task 11)。M2-M4 明示另出计划（本计划头部范围说明）。无缺口。
2. **占位扫描**：无 TBD/TODO；Task 10 Step 4 的"旗形不同先 --help"是操作验证指引而非实现占位。
3. **类型一致性**：`ChannelModel/ChannelConfig/VaultData`（Task 3 定义，Task 4/9 复用）；`MaskedChannel`（Task 4）；`ProbeResult/ProbeTarget`（Task 7 定义，Task 9 `ApiContext.probe: typeof probeChannel` 复用）；`RunRecord/RunStore`（Task 8 定义，Task 9/10 复用）；`handleApi` 返回 `MaybePromise<Envelope>`（Task 9 内自洽，wiring 层 await）。已核对一致。
