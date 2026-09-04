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
// `pull` is the step that can do damage by accident: if it mistook a broken
// binding or namespace id for "no flags set yet", it would write the
// defaults over the local file, and the documented pull -> edit -> push loop
// would then push those defaults over the live values - during an incident,
// un-setting the very kill switches someone is there to adjust (issue #157).
// So a missing value is only believed once the namespace has been listed
// (see `fetchLive`), and `pull` refuses to replace a local file that holds
// operator edits with defaults unless `--force` is passed.
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
import { differsFromDefaults, isKvValueMissing, listContainsKey } from './kvErrors.mjs'

const { DEFAULT_SITE_FLAGS, siteFlagsStrictSchema } = loadSharedModule('shared/utils/siteFlags.ts')

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const flagsFile = path.join(repoRoot, 'infra/site-flags.json')

const KV_KEY = 'site-flags'
const BINDING = 'SITE_FLAGS'

const args = process.argv.slice(2)
const command = args.find(arg => !arg.startsWith('--'))
const isProd = args.includes('--prod')
const isForced = args.includes('--force')
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

function kv(kvArgs) {
  const envArgs = isProd ? [] : ['--env', 'preview']
  return spawnSync('npx', ['wrangler', 'kv', 'key', ...kvArgs, '--binding', BINDING, '--remote', ...envArgs], {
    cwd: repoRoot,
    encoding: 'utf8'
  })
}

/**
 * The live flags, or null when the key doesn't exist yet.
 *
 * wrangler answers a missing key and a missing namespace with the same
 * 404 line (see kvErrors.mjs), so a 404 alone is not proof of an unseeded
 * key. The namespace is listed first: if the list succeeds and lacks the
 * key, the key is genuinely unset; if the list fails, the binding or
 * namespace is broken and nothing about the live value can be trusted.
 */
function fetchLive() {
  const result = kv(['get', KV_KEY])
  if (result.status !== 0) {
    if (!isKvValueMissing(result.stderr, KV_KEY)) {
      console.error(result.stderr || result.stdout)
      console.error(`wrangler kv key get failed (${target})`)
      process.exit(1)
    }
    const list = kv(['list'])
    if (list.status !== 0) {
      console.error(list.stderr || list.stdout)
      console.error(`The ${target} value came back 404 and the namespace cannot be listed - the SITE_FLAGS binding or namespace id is wrong, not the key. Nothing was written.`)
      process.exit(1)
    }
    if (listContainsKey(list.stdout, KV_KEY)) {
      console.error(`The ${target} value came back 404 but the namespace lists "${KV_KEY}" - a transient API error. Retry.`)
      process.exit(1)
    }
    return null
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

/** Whether the local file exists and differs from the defaults (beyond the `updatedAt` stamp). */
function localHoldsEdits() {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(flagsFile, 'utf8'))
  } catch {
    return false
  }
  return differsFromDefaults(parsed, DEFAULT_SITE_FLAGS)
}

function writeLocal(flags) {
  mkdirSync(path.dirname(flagsFile), { recursive: true })
  writeFileSync(flagsFile, `${JSON.stringify(flags, null, 2)}\n`)
}

const canonical = flags => JSON.stringify(flags, null, 2)

switch (command) {
  case 'pull': {
    const live = fetchLive()
    if (live === null && !isForced && localHoldsEdits()) {
      console.error(`No ${target} flags are set, but ${path.relative(repoRoot, flagsFile)} is not the defaults - it may hold edits you meant to push. Push them, or re-run with --force to overwrite the file with the defaults.`)
      process.exit(1)
    }
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
    console.error('Usage: node scripts/site-flags/site-flags.mjs <pull|push|diff> [--prod] [--force]')
    process.exit(1)
}
