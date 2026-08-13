#!/usr/bin/env node
// Trims the staticwebapp.config.json that nitro's `azure-swa` preset writes
// to the repo root on every build, and enforces Azure's hard size limit on
// it. Runs as the second half of `npm run build` (see package.json) - which
// is the command both the husky pre-commit hook and Oryx (inside the SWA
// deploy action) run, so the trimmed file is what actually ships.
//
// Why this exists:
//
// `writeSWARoutes()` in nitropack's azure preset emits one route rule per
// prerendered page - `{ route: '/routes/x', rewrite: '/routes/x/index.html' }`
// - into the `routes` array. Azure Static Web Apps caps that file at 20 KB
// ("Restrictions: Max file size is 20 KB",
// https://learn.microsoft.com/en-us/azure/static-web-apps/configuration), and
// the 335 prerendered route pages alone generate ~36 KB of them. Left alone,
// the deploy fails validation in the SWA action - not in `nuxt build` - so
// the failure would land on main rather than in local/CI build output.
//
// Those rules are also redundant. SWA already resolves a folder request to
// its index.html: with `trailingSlash: 'never'` (set in nuxt.config.ts) the
// documented behaviour for a request to /about is to serve /about/index.html
// with a 200, and /about/index.html itself 301s onto /about. Dropping the
// generated rewrites therefore changes no routing behaviour; it only stops
// the file restating what the platform does by default.
//
// The `/` rule is kept: it's what's been serving the prerendered homepage in
// production, and it costs ~60 bytes.
//
// If nitropack ever changes the shape of what it generates, this script fails
// loudly (missing file, or still-oversized output) rather than silently
// shipping a config that Azure will reject.

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_BYTES = 20 * 1024

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const configPath = path.join(repoRoot, 'staticwebapp.config.json')

let raw
try {
  raw = readFileSync(configPath, 'utf8')
} catch (error) {
  if (error.code === 'ENOENT') {
    console.error(
      `[trim-swa-config] ${path.relative(repoRoot, configPath)} not found.\n`
      + 'The azure-swa preset is expected to write it during `nuxt build`. If it no\n'
      + 'longer does, this script and the assumptions in its header need revisiting.'
    )
    process.exit(1)
  }
  throw error
}

const config = JSON.parse(raw)
const routes = Array.isArray(config.routes) ? config.routes : []

// A generated per-page rewrite is the only kind of rule that points at an
// .html file. Anything else in here came from `nitro.azure.config.routes` and
// is ours to keep.
const isGeneratedPageRewrite = rule =>
  rule.route !== '/' && typeof rule.rewrite === 'string' && rule.rewrite.endsWith('.html')

const kept = routes.filter(rule => !isGeneratedPageRewrite(rule))
const dropped = routes.length - kept.length

config.routes = kept
const output = `${JSON.stringify(config, null, 2)}\n`
const bytes = Buffer.byteLength(output, 'utf8')

if (bytes > MAX_BYTES) {
  console.error(
    `[trim-swa-config] staticwebapp.config.json is ${bytes} bytes after trimming,\n`
    + `over Azure's ${MAX_BYTES} byte limit. Azure would reject this deploy.`
  )
  process.exit(1)
}

writeFileSync(configPath, output)

console.log(
  `[trim-swa-config] dropped ${dropped} generated page rewrite(s), `
  + `kept ${kept.length} route rule(s), ${bytes}/${MAX_BYTES} bytes.`
)
