#!/usr/bin/env node
/**
 * dsh-video-generator → dsh-plugins 真源镜像同步。
 *
 * 方向：本仓（开发真源）→ ../dsh-plugins/dsh-video-generator/（分发镜像）。
 * 镜像内容与 package.json files 白名单一致（可安装包形态）+ LICENSE；
 * 不镜像 src/test/scripts/plans/tsconfig/node_modules/pnpm-lock/.git 等。
 *
 * 用法：
 *   node scripts/sync-to-dsh-plugins.mjs          # 执行镜像（rm+cp 重建）
 *   node scripts/sync-to-dsh-plugins.mjs --check  # 对账：零差异 exit 0；有差异列详情 exit 1
 *
 * 环境变量：KCODER_PLUGINS_DIR 可覆盖 dsh-plugins 仓位置（缺省 ../dsh-plugins）。
 *
 * 发版约定：本仓改动推送前先跑本脚本同步镜像并在 dsh-plugins 仓提交推送，
 * 保证两个安装入口（独立仓 / dsh-plugins 子目录）内容一致。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const DEFAULT_PLUGINS_DIR = resolve(REPO_ROOT, '..', 'dsh-plugins')
const PLUGINS_DIR = process.env.KCODER_PLUGINS_DIR
  ? resolve(process.env.KCODER_PLUGINS_DIR)
  : DEFAULT_PLUGINS_DIR
const MIRROR = join(PLUGINS_DIR, 'dsh-video-generator')

// 与 package.json files 白名单一致 + LICENSE
const INCLUDE = ['package.json', 'cordis.patch.yml', 'README.md', 'LICENSE', 'lib', 'presets', 'release']

function listFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === '.DS_Store') continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(full)
    }
  }
  walk(root)
  return out
}

function diffMirror() {
  if (!existsSync(MIRROR)) return { missing: true, onlySrc: [], onlyDst: [], changed: [] }
  const srcFiles = new Map()
  for (const inc of INCLUDE) {
    const p = join(REPO_ROOT, inc)
    if (!existsSync(p)) continue
    if (statSync(p).isFile()) srcFiles.set(inc, readFileSync(p))
    else for (const f of listFiles(p)) srcFiles.set(relative(REPO_ROOT, f), readFileSync(f))
  }
  const dstFiles = new Map()
  for (const f of listFiles(MIRROR)) {
    const rel = relative(MIRROR, f)
    if (srcFiles.has(rel)) dstFiles.set(rel, readFileSync(f))
    else dstFiles.set(rel, null) // 镜像多出的文件
  }
  const onlySrc = [], onlyDst = [], changed = []
  for (const [rel, buf] of srcFiles) {
    if (!dstFiles.has(rel)) onlySrc.push(rel)
    else if (!dstFiles.get(rel).equals(buf)) changed.push(rel)
  }
  for (const [rel, buf] of dstFiles) if (buf === null) onlyDst.push(rel)
  return { missing: false, onlySrc, onlyDst, changed }
}

const check = process.argv.includes('--check')
const d = diffMirror()

if (check) {
  if (!existsSync(PLUGINS_DIR)) {
    console.warn('[sync-to-dsh-plugins] dsh-plugins 仓不在位（纯独立仓分发？），跳过对账')
    process.exit(0)
  }
  if (d.missing || d.onlySrc.length || d.onlyDst.length || d.changed.length) {
    console.error('[sync-to-dsh-plugins] 镜像与真源不一致：')
    if (d.missing) console.error('  镜像目录不存在：' + MIRROR)
    for (const f of d.onlySrc) console.error('  仅真源有: ' + f)
    for (const f of d.onlyDst) console.error('  仅镜像有: ' + f)
    for (const f of d.changed) console.error('  内容不同: ' + f)
    process.exit(1)
  }
  console.log('[sync-to-dsh-plugins] 镜像对账通过：与真源一致')
  process.exit(0)
}

if (!existsSync(PLUGINS_DIR)) {
  console.error(`[sync-to-dsh-plugins] 未找到 dsh-plugins 仓：${PLUGINS_DIR}`)
  console.error('  克隆后重跑，或用 KCODER_PLUGINS_DIR 指定位置')
  process.exit(1)
}
rmSync(MIRROR, { recursive: true, force: true })
mkdirSync(MIRROR, { recursive: true })
for (const inc of INCLUDE) {
  const p = join(REPO_ROOT, inc)
  if (!existsSync(p)) continue
  cpSync(p, join(MIRROR, inc), { recursive: true })
}
console.log('[sync-to-dsh-plugins] 镜像已重建：' + MIRROR)
