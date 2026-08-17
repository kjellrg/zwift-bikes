#!/usr/bin/env node
// Round-trip test for `parse-zwiftpower-paste.mjs`, run by hand or from CI:
//
//   node scripts/race-draft/test-parse-zwiftpower-paste.mjs
//
// It asserts two things. First, that the fixture paste produces exactly the
// expected race block - the parser keys on unit suffixes rather than column
// positions, so a regression there shows up as a shifted field rather than a
// crash, and only an exact comparison catches that. Second, that no letter
// sequence from the fixture's NAME lines appears anywhere in the parser's
// output or its diagnostics. That second assertion is the point of the whole
// script: the parser's job is to make the dataset repeatable without ever
// storing who rode the race.
//
// `parse-zwiftpower-paste.fixture.txt` is the one place fake rider names exist
// in this repo, and they are obviously fake ("Test Rider One").
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const parser = path.join(__dirname, 'parse-zwiftpower-paste.mjs')
const fixturePath = path.join(__dirname, 'parse-zwiftpower-paste.fixture.txt')
const fixture = readFileSync(fixturePath, 'utf8')

const EXPECTED = {
  'example-crit': {
    label: 'Example Crit',
    routeSlug: 'tempus-fugit',
    laps: 2,
    eventDistanceKm: 34.6,
    distanceNote: 'synthetic fixture - no real event',
    riders: [
      // Winner: no published gap, so their own displayed clock is the time base.
      { cat: 'A', pos: 1, timeSec: 1901, avgW: 245, npW: 268, weightKg: 72, heightCm: 178 },
      // 31:41 + 1.380s, rounded - NOT the displayed 31:42.
      { cat: 'A', pos: 2, timeSec: 1902, avgW: 291, npW: 312, weightKg: 84, heightCm: 190 },
      // Weight not published: the row survives without weight or height, and
      // the analyzer skips it. Half a rider would be worse than none.
      { cat: 'A', pos: 3, timeSec: 1903, avgW: 260, npW: 280 },
      { cat: 'B', pos: 1, timeSec: 1992, avgW: 210, npW: 228, weightKg: 68.5, heightCm: 172 },
      { cat: 'B', pos: 2, timeSec: 1993, avgW: 268, npW: 289, weightKg: 91, heightCm: 186 },
      { cat: 'B', pos: 3, timeSec: 1997, avgW: 232, npW: 250, weightKg: 75.5, heightCm: 180 },
      // Hour-plus finishes: ZwiftPower drops the leading zero on the seconds
      // ("1:02:9", not "1:02:09"), which the clock pattern used to reject -
      // silently costing every such row its finish time. 1h 02m 09s = 3729s.
      { cat: 'C', pos: 1, timeSec: 3729, avgW: 205, npW: 221, weightKg: 70, heightCm: 175 },
      { cat: 'C', pos: 2, timeSec: 3731, avgW: 219, npW: 235, weightKg: 73, heightCm: 178 }
    ]
  }
}

const failures = []

function run(extraArgs = [], input = fixture) {
  const argv = [
    parser,
    '--slug', 'example-crit',
    '--label', 'Example Crit',
    '--route', 'tempus-fugit',
    '--laps', '2',
    '--event-km', '34.6',
    '--distance-note', 'synthetic fixture - no real event',
    ...extraArgs
  ]
  try {
    const stdout = execFileSync(process.execPath, argv, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    return { status: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

// 1. Exact output.
const clean = run()
if (clean.status !== 0) failures.push(`the fixture should parse cleanly, but the parser exited ${clean.status}`)
let parsed
try {
  parsed = JSON.parse(clean.stdout)
} catch {
  failures.push('stdout was not valid JSON')
}
if (parsed && JSON.stringify(parsed) !== JSON.stringify(EXPECTED)) {
  failures.push(`output does not match the expected block.\n  expected: ${JSON.stringify(EXPECTED)}\n  actual:   ${JSON.stringify(parsed)}`)
}

// 2. No names anywhere - in the JSON or in the diagnostics.
const NAME_WORDS = [...new Set(
  fixture.split(/\r?\n/)
    .filter(line => /^\s+\S/.test(line)) // the indented name lines
    .flatMap(line => line.trim().split(/[^A-Za-z]+/))
    .filter(word => word.length >= 3)
)]
if (NAME_WORDS.length === 0) failures.push('the fixture has no recognisable name lines - the leak check would pass vacuously')
// Word-bounded rather than a bare substring search: "OTH" (a fixture team tag)
// occurs inside the word "nothing" in the parser's own diagnostics, and a test
// that fails on that is a test nobody will keep.
const combined = `${clean.stdout}\n${clean.stderr}`
for (const word of NAME_WORDS) {
  if (new RegExp(`\\b${word}\\b`, 'i').test(combined)) failures.push(`the name-line word ${JSON.stringify(word)} leaked into the parser's output`)
}

// 3. A row whose published w/kg contradicts avgW/weightKg must fail loudly, and
//    must still refer to the row by category and position only.
const corrupted = fixture.replace('72.0kg', '52.0kg')
const mismatch = run([], corrupted)
if (mismatch.status === 0) failures.push('a w/kg mismatch should exit non-zero without --allow-mismatch')
if (!/cat A pos 1/.test(mismatch.stderr)) failures.push('the mismatch error should identify the row by category and position')
if (mismatch.stdout.trim() !== '') failures.push('nothing should be written when validation fails')
const forced = run(['--allow-mismatch'], corrupted)
if (forced.status !== 0) failures.push('--allow-mismatch should downgrade the mismatch to a warning')

// 4. --dnf-cut drops only what it should.
const cut = run(['--dnf-cut', '3'])
if (cut.status !== 0) failures.push(`--dnf-cut should not fail, but the parser exited ${cut.status}`)
const cutRiders = cut.status === 0 ? JSON.parse(cut.stdout)['example-crit'].riders : []
if (cutRiders.length !== 7) failures.push(`--dnf-cut 3 should drop exactly the one rider 5s down, kept ${cutRiders.length} of 8`)

if (failures.length) {
  console.error(`test-parse-zwiftpower-paste: ${failures.length} failure(s)\n`)
  for (const failure of failures) console.error(`FAIL: ${failure}\n`)
  process.exit(1)
}
console.log(`test-parse-zwiftpower-paste: OK (${EXPECTED['example-crit'].riders.length} riders round-tripped, ${NAME_WORDS.length} name words checked for leaks)`)
