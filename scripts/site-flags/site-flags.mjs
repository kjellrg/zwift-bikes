// The edit loop for the runtime site flags (docs/site-flags.md):
//
//   npm run flags:pull            fetch the live flags into infra/site-flags.json
//   npm run flags:push            validate the file and write it to KV
//   npm run flags:diff            show local-file-vs-live drift
//
// Every command targets the PREVIEW namespace unless `-- --prod` is passed -
// the dangerous direction is always deliberate. The rehearsal flow is:
// push to preview, eyeball it on any open PR's workers.dev URL, then
// `npm run flags:push -- --prod`.
//
// infra/site-flags.json is deliberately gitignored: KV is the source of
// truth, and committing the values would send every flags change through the
// pre-commit build and the deploy workflow - the exact ~7-minute loop this
// feature exists to bypass. `push` stamps `updatedAt` so the live value
// records when it last changed.
//
// Validation uses the STRICT schema (shared/utils/siteFlags.ts): here a
// surplus key is a typo, and push time is the only chance to catch it -
// the Worker's lenient runtime parse would just ignore the misspelled
// intent, silently doing nothing.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSharedModule } from '../route-surfaces/loadShared.mjs'

const { DEFAULT_SITE_FLAGS, siteFlagsStrictSchema } = loadSharedModule('shared/utils/siteFlags.ts')

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const flagsFile = path.join(repoRoot, 'infra/site-flags.json')

const KV_KEY = 'site-flags'
const BINDING = 'SITE_FLAGS'

const args = process.argv.slice(2)
const command = args.find(arg => !arg.startsWith('--'))
const isProd = args.includes('--prod')
const target = isProd ? 'PRODUCTION' : 'preview'

/** wrangler resolves `--binding` to the right namespace id itself - prod from
 * the top-level block, preview via `--env preview` - so this script never
 * parses wrangler.jsonc. */
function wrangler(kvArgs) {
  const envArgs = isProd ? [] : ['--env', 'preview']
  const result = spawnSync('npx', ['wrangler', 'kv', 'key', ...kvArgs, '--binding', BINDING, '--remote', ...envArgs], {
    cwd: repoRoot,
    encoding: 'utf8'
  })
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout)
    console.error(`wrangler kv key ${kvArgs[0]} failed (${target})`)
    process.exit(1)
  }
  return result.stdout
}

/** The live flags, or null when the key doesn't exist yet. */
function fetchLive() {
  const envArgs = isProd ? [] : ['--env', 'preview']
  const result = spawnSync('npx', ['wrangler', 'kv', 'key', 'get', KV_KEY, '--binding', BINDING, '--remote', ...envArgs], {
    cwd: repoRoot,
    encoding: 'utf8'
  })
  if (result.status !== 0) {
    if (/not found/i.test(result.stderr ?? '')) return null
    console.error(result.stderr || result.stdout)
    console.error(`wrangler kv key get failed (${target})`)
    process.exit(1)
  }
  // The value is JSON on stdout; slice from the first brace in case wrangler
  // ever prints a banner line around it.
  const raw = result.stdout.slice(result.stdout.indexOf('{'))
  try {
    return JSON.parse(raw)
  } catch {
    console.error(`The live ${target} value is not valid JSON - fix it with a push.`)
    process.exit(1)
  }
}

function readLocal() {
  let raw
  try {
    raw = readFileSync(flagsFile, 'utf8')
  } catch {
    console.error(`${path.relative(repoRoot, flagsFile)} does not exist - run \`npm run flags:pull\` first.`)
    process.exit(1)
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    console.error(`${path.relative(repoRoot, flagsFile)} is not valid JSON: ${error.message}`)
    process.exit(1)
  }
  const result = siteFlagsStrictSchema.safeParse(parsed)
  if (!result.success) {
    console.error(`${path.relative(repoRoot, flagsFile)} failed validation:`)
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    }
    process.exit(1)
  }
  return result.data
}

function writeLocal(flags) {
  mkdirSync(path.dirname(flagsFile), { recursive: true })
  writeFileSync(flagsFile, `${JSON.stringify(flags, null, 2)}\n`)
}

const canonical = flags => JSON.stringify(flags, null, 2)

switch (command) {
  case 'pull': {
    const live = fetchLive()
    writeLocal(live ?? DEFAULT_SITE_FLAGS)
    console.log(live
      ? `Pulled the live ${target} flags into ${path.relative(repoRoot, flagsFile)}.`
      : `No ${target} flags are set yet - wrote the defaults to ${path.relative(repoRoot, flagsFile)}; edit and \`npm run flags:push\`.`)
    break
  }

  case 'push': {
    const flags = readLocal()
    flags.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    writeLocal(flags)
    // Through a temp file rather than argv, where shells would mangle the
    // JSON's quotes.
    const tmpFile = path.join(os.tmpdir(), `zwift-bikes-site-flags-${process.pid}.json`)
    writeFileSync(tmpFile, JSON.stringify(flags))
    try {
      wrangler(['put', KV_KEY, '--path', tmpFile])
    } finally {
      rmSync(tmpFile, { force: true })
    }
    console.log(`Pushed ${path.relative(repoRoot, flagsFile)} to ${target}. Live within ~60s (KV propagation + the Worker's read cache).`)
    if (!isProd) console.log('Rehearse on a PR preview, then `npm run flags:push -- --prod`.')
    break
  }

  case 'diff': {
    const live = fetchLive()
    const local = readLocal()
    if (live === null) {
      console.log(`No ${target} flags are set yet; the local file is all new.`)
      break
    }
    if (canonical(live) === canonical(local)) {
      console.log(`${path.relative(repoRoot, flagsFile)} matches the live ${target} flags.`)
    } else {
      console.log(`Local file and live ${target} flags differ.\n--- live (${target})\n${canonical(live)}\n--- local\n${canonical(local)}`)
      process.exitCode = 1
    }
    break
  }

  default:
    console.error('Usage: node scripts/site-flags/site-flags.mjs <pull|push|diff> [--prod]')
    process.exit(1)
}
