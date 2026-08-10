// Loads a shared/ TypeScript module for use from these plain-Node scripts.
// The app's shared/ code uses bundler-style extensionless imports (resolved
// by Vite/Nuxt at build time), which plain `node` can't resolve on its own -
// so bundle the requested entry point (and everything it imports from
// shared/) with esbuild, then execute the result. Keeps these scripts free
// of any runtime dependency on the app's Nuxt build.
import { buildSync } from 'esbuild'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const require = createRequire(import.meta.url)

/** @param {string} relativePath Path to a .ts entry point, relative to the repo root. */
export function loadSharedModule(relativePath) {
  const result = buildSync({
    entryPoints: [path.join(repoRoot, relativePath)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    write: false
  })

  const mod = { exports: {} }
  const fn = new Function('module', 'exports', 'require', '__filename', '__dirname', result.outputFiles[0].text)
  fn(mod, mod.exports, require, path.join(repoRoot, relativePath), repoRoot)
  return mod.exports
}
