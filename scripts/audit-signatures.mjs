// Runs `npm audit signatures` for CI, and survives one specific registry
// fault without giving up the guarantee that matters.
//
// `npm audit signatures` verifies two things over the installed tree: the
// registry's ECDSA signature on every package (name@version:integrity signed
// with the key from /-/npm/v1/keys), and the Sigstore provenance bundle of
// every package whose metadata advertises one. npm fetches that bundle from
// /-/npm/v1/attestations/<name>@<version>. When the registry advertises a
// bundle but answers 404 for it, npm does not record a verdict - it throws,
// aborts the whole run, and reports nothing about the other packages.
//
// That happened on 2026-10-07 with unimport@7.0.2: published with provenance
// a month earlier (its release log shows the signed statement), metadata
// still advertising the bundle, endpoint returning 404 for that version only
// (7.0.1 and 6.5.0 fine). One registry-side inconsistency in a 1300-package
// tree blocked every PR. npm's own code (checked on its main branch) still
// only catches EINTEGRITYSIGNATURE and EATTESTATIONVERIFY, so this is not
// going away upstream soon.
//
// So: run npm first and trust it when it finishes. If it aborts on exactly
// that 404 pattern, fall back to verifying the registry signature of every
// package in package-lock.json ourselves - the same check npm performs, same
// message, same keys - and fail if any is missing or invalid. Provenance
// bundles are not verified in that degraded run; the output says so, names
// the package, and the next run without the fault is a full one again. Any
// other npm failure, including a genuinely invalid signature or attestation,
// is passed through unchanged.
import { spawnSync } from 'node:child_process'
import { createPublicKey, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const registry = 'https://registry.npmjs.org'

const npm = spawnSync('npm', ['audit', 'signatures'], { cwd: repoRoot, encoding: 'utf8', shell: process.platform === 'win32' })
process.stdout.write(npm.stdout ?? '')
process.stderr.write(npm.stderr ?? '')
if (npm.status === 0) process.exit(0)

// npm prints "404 Not Found - GET <registry>/-/npm/v1/attestations/<name>@<version> - Not found".
const missing = /E404[\s\S]*?\/-\/npm\/v1\/attestations\/(\S+)@(\S+?) - Not found/.exec(npm.stderr ?? '')
if (!missing) process.exit(npm.status ?? 1)

const [, missingName, missingVersion] = missing
console.warn(`\nnpm aborted: the registry advertises a provenance attestation for ${missingName}@${missingVersion} but serves 404 for it.`)
console.warn('Falling back to verifying every package\'s registry signature directly. Provenance bundles are NOT verified in this run.\n')

const lock = JSON.parse(readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'))
const packages = new Map()
for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location || entry.link || entry.inBundle || !entry.resolved?.startsWith(`${registry}/`)) continue
  const name = location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length)
  packages.set(`${name}@${entry.version}`, { name, version: entry.version, integrity: entry.integrity })
}

const { keys } = await (await fetch(`${registry}/-/npm/v1/keys`)).json()
const publicKeys = new Map(keys.map(k => [k.keyid, createPublicKey({ key: Buffer.from(k.key, 'base64'), format: 'der', type: 'spki' })]))

const failures = []
const queue = [...packages.values()]
async function worker() {
  for (let pkg = queue.shift(); pkg; pkg = queue.shift()) {
    const res = await fetch(`${registry}/${pkg.name}/${pkg.version}`)
    if (!res.ok) {
      failures.push(`${pkg.name}@${pkg.version}: registry returned ${res.status} for its version document`)
      continue
    }
    const { dist } = await res.json()
    const signatures = dist?.signatures ?? []
    if (signatures.length === 0) {
      failures.push(`${pkg.name}@${pkg.version}: no registry signature`)
      continue
    }
    const message = Buffer.from(`${pkg.name}@${pkg.version}:${pkg.integrity}`)
    const valid = signatures.some(({ keyid, sig }) => {
      const key = publicKeys.get(keyid)
      return key !== undefined && verify('sha256', message, key, Buffer.from(sig, 'base64'))
    })
    if (!valid) failures.push(`${pkg.name}@${pkg.version}: registry signature INVALID for the integrity in package-lock.json`)
  }
}
await Promise.all(Array.from({ length: 24 }, worker))

if (failures.length > 0) {
  console.error(`${failures.length} of ${packages.size} packages failed registry signature verification:`)
  for (const f of failures.sort()) console.error(`  ${f}`)
  process.exit(1)
}
console.log(`${packages.size} packages have verified registry signatures (degraded run: provenance not verified because of ${missingName}@${missingVersion}).`)
