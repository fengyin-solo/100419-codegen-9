// 校验脚本运行器：用 esbuild 把 TS 用例即时打包到临时目录，再交给 node 执行。
// 用法：node scripts/run-verify.mjs all | rules | read-failure
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import esbuild from 'esbuild'

const cases = {
  'read-failure': 'scripts/verify-read-failure.ts',
  rules: 'scripts/verify-rules.ts',
}
const arg = process.argv[2] ?? 'all'
const entries = arg === 'all' ? Object.values(cases) : [cases[arg]]
if (!entries.every(Boolean)) {
  console.error(`未知用例：${arg}，可选 all / rules / read-failure`)
  process.exit(1)
}

const outdir = join('scripts', '.build')
await esbuild.build({
  entryPoints: entries,
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir,
  logLevel: 'silent',
})

for (const entry of entries) {
  const name = entry.split('/').pop()?.replace('.ts', '')
  console.log(`\n=== ${name} ===`)
  await import('../' + join(outdir, name + '.js'))
}
rmSync(outdir, { recursive: true, force: true })
