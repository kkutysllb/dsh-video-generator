/**
 * 宿主家目录解析（数据根前缀，单一事实源）。
 *
 * - QiLin 启动器注入 `QILIN_HOME`，并把 `DSH_HOME` 钉到同一处
 *   （@qilin/dsh-compat 行为），两种读法都落在麒麟家目录；
 * - DSH / KCoder 桌面端设 `DSH_HOME`（KCoder 为 ~/.kcoder）；
 * - 都缺席时返回 null，调用方回退 `homedir()`（历史行为，兼容裸 node 直跑）。
 *
 * 口径与 dsh-super-ppts（templates.js）、dsh-skills-stock（stock-home）、
 * dsh-ssh-remote（home.js）一致。
 */

/** 宿主家目录；env 均缺席时返回 null。 */
export function harnessHome(env: NodeJS.ProcessEnv = process.env): string | null {
  return env['QILIN_HOME'] ?? env['DSH_HOME'] ?? null
}
