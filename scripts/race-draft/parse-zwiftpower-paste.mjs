#!/usr/bin/env node
// Turns a raw ZwiftPower results paste into one race block of the local
// calibration dataset (`field-results.json`), anonymised and validated.
//
// This script is what makes the race-draft calibration repeatable without ever
// storing a rider's name. The published result lists are public, but nothing in
// the analysis needs a name to work, so names never reach the output, the
// summary, or an error message - rows are referred to by category and position
// only. See README.md, "Where the data lives".
//
// What a ZwiftPower category-list copy-paste actually looks like (ragged,
// several lines per rider):
//
//   A	4
//    Some Rider Name [Team]TEAM
//   31:43+1.380s	3.1w/kg	260w
//   316w
//   3.0w/kg	3.8w/kg	6.6w/kg	7.5w/kg	8.5w/kg	83.0kg	Vet	156bpm	187bpm	187cm	3.06
//
// i.e. per rider: a category letter (+ optional position), a NAME line, a line
// with finish time (+ gap for non-winners), average w/kg and average watts, a
// line with normalised power, then a line of power-curve w/kg values followed by
// weight, age-group tag, heart rates, height and points.
//
// Parsing therefore keys on unit suffixes rather than column positions - the
// column count varies between events and between categories - and takes:
//   first time token   -> timeSec (see `--no-gap-times` for the exact rule)
//   first `Nw` token   -> avgW      (mechanical average power)
//   second `Nw` token  -> npW       (normalised power)
//   the `N.Nkg` token  -> weightKg
//   the `Ncm` token    -> heightCm
// Everything else is discarded, names and age/HR/points included.
//
// Usage:
//   node scripts/race-draft/parse-zwiftpower-paste.mjs \
//     --slug la-boucle --label "La Boucle" \
//     --route france-la-boucle --laps 1 --event-km 24.4 \
//     --distance-note "matches zwift-data route + lead-in" \
//     --append ./scripts/race-draft/field-results.json  < paste.txt
//
//     --append <file>    merge the block into the local dataset (refuses to
//                        overwrite an existing slug without --force); without
//                        it the block is printed to stdout
//     --force            allow --append to replace an existing slug
//     --allow-mismatch   report validation failures but still write/print
//     --dnf-cut <sec>    drop finishers more than <sec> behind their category
//                        winner (default: keep everything - the analyzer
//                        separates bunch finishers from stragglers itself)
//     --no-gap-times     use each row's own displayed mm:ss instead of
//                        "category winner + published gap"
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const value = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

const slug = value('--slug')
const label = value('--label')
const routeSlug = value('--route')
const laps = Number(value('--laps') ?? 1)
const eventDistanceKm = value('--event-km') === undefined ? undefined : Number(value('--event-km'))
const distanceNote = value('--distance-note')
const appendPath = value('--append')
const force = flag('--force')
const allowMismatch = flag('--allow-mismatch')
const dnfCutSec = value('--dnf-cut') === undefined ? undefined : Number(value('--dnf-cut'))
const useGapTimes = !flag('--no-gap-times')

if (!slug || !routeSlug) {
  console.error('parse-zwiftpower-paste: --slug and --route are required (see the usage block at the top of this file).')
  process.exit(2)
}
if (!Number.isFinite(laps) || laps < 1) {
  console.error(`parse-zwiftpower-paste: --laps must be a positive number, got ${JSON.stringify(value('--laps'))}.`)
  process.exit(2)
}
if (eventDistanceKm !== undefined && !(Number.isFinite(eventDistanceKm) && eventDistanceKm > 0)) {
  console.error(`parse-zwiftpower-paste: --event-km must be a positive number, got ${JSON.stringify(value('--event-km'))}.`)
  process.exit(2)
}

/**
 * Plausibility windows for the unit-suffixed tokens. They exist because the
 * name line is arbitrary text that gets tokenised along with everything else:
 * a number outside these ranges is far more likely to be part of a name, a
 * team tag or a stray column than the field it looks like, and taking it would
 * corrupt a row silently. Anything rejected here is simply ignored.
 */
const RANGES = {
  weightKg: [30, 200],
  heightCm: [100, 230],
  watts: [40, 2000],
  wkg: [0.4, 15]
}
const inRange = (n, [low, high]) => Number.isFinite(n) && n >= low && n <= high

/** `mm:ss`, `h:mm:ss` or `mm:ss.mmm` -> seconds. */
function parseClockSec(token) {
  const parts = token.split(':').map(Number)
  if (parts.some(p => !Number.isFinite(p))) return undefined
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return undefined
}

/** `+1.380s`, `+12s`, `+1:23` or `+1:23.4` -> seconds behind the winner. */
function parseGapSec(token) {
  const body = token.slice(1).replace(/s$/, '')
  return body.includes(':') ? parseClockSec(body) : (Number.isFinite(Number(body)) ? Number(body) : undefined)
}

/**
 * ZwiftPower prints the finish time and the gap in one cell, unseparated
 * ("31:42+1.380s"), so they arrive as a single token. Split them before
 * anything is classified - the alternative is a clock pattern that also has to
 * swallow the gap, which then can't be validated independently.
 */
// The seconds field allows one digit because ZwiftPower drops its leading
// zero on hour-plus finishes: a two-hour race prints "2:00:9", not "2:00:09".
// Only the trailing field is loosened - minutes stay two digits, so this
// cannot start matching something that was never a clock.
const CLOCK_WITH_GAP = /^(\d{1,2}:\d{2}(?::\d{1,2})?(?:\.\d+)?)(\+.+)$/
function splitClockAndGap(token) {
  const match = CLOCK_WITH_GAP.exec(token)
  return match ? [match[1], match[2]] : [token]
}

const CATEGORY = /^[A-E]$/
const CLOCK = /^\d{1,2}:\d{2}(:\d{1,2})?(\.\d+)?$/
const GAP = /^\+\d[\d.:]*s?$/
const WKG = /^(\d+(\.\d+)?)w\/kg$/i
const WATTS = /^(\d+(\.\d+)?)w$/i
const KG = /^(\d+(\.\d+)?)kg$/i
const CM = /^(\d+(\.\d+)?)cm$/i
const INTEGER = /^\d{1,4}$/

/**
 * Splits the paste into one token list per rider.
 *
 * A record starts at a bare category letter that is the FIRST token on its
 * line, which is stricter than "any bare A-E token anywhere" for a specific
 * reason: names contain single-letter initials ("John A Smith"), and treating
 * one of those as a record boundary would split a rider in half and quietly
 * shift every field after it. Category letters always lead their own line in a
 * ZwiftPower paste, so this costs nothing and removes the whole failure mode.
 */
function splitRecords(text) {
  const records = []
  for (const line of text.split(/\r?\n/)) {
    const tokens = line.trim().split(/\s+/).filter(Boolean).flatMap(splitClockAndGap)
    if (tokens.length === 0) continue
    if (CATEGORY.test(tokens[0])) records.push({ cat: tokens[0], tokens: tokens.slice(1) })
    else if (records.length) records[records.length - 1].tokens.push(...tokens)
  }
  return records
}

/** One rider's published numbers, from their token list. Everything unrecognised is dropped on the floor. */
function readRecord(record) {
  const row = { cat: record.cat }
  const watts = []
  for (const token of record.tokens) {
    let match
    if (CLOCK.test(token) && row.clockSec === undefined) row.clockSec = parseClockSec(token)
    else if (GAP.test(token) && row.gapSec === undefined) row.gapSec = parseGapSec(token)
    else if ((match = WKG.exec(token))) {
      // The first w/kg on the row is the published average; the rest are the
      // power-curve columns, which nothing here uses.
      if (row.publishedWkg === undefined && inRange(Number(match[1]), RANGES.wkg)) row.publishedWkg = Number(match[1])
    } else if ((match = WATTS.exec(token))) {
      if (inRange(Number(match[1]), RANGES.watts)) watts.push(Number(match[1]))
    } else if ((match = KG.exec(token))) {
      if (row.weightKg === undefined && inRange(Number(match[1]), RANGES.weightKg)) row.weightKg = Number(match[1])
    } else if ((match = CM.exec(token))) {
      if (row.heightCm === undefined && inRange(Number(match[1]), RANGES.heightCm)) row.heightCm = Math.round(Number(match[1]))
    } else if (INTEGER.test(token) && row.pos === undefined) {
      row.pos = Number(token)
    }
  }
  if (watts.length > 0) row.avgW = Math.round(watts[0])
  if (watts.length > 1) row.npW = Math.round(watts[1])
  return row
}

const paste = readFileSync(0, 'utf8')
const rows = splitRecords(paste).map(readRecord)
if (rows.length === 0) {
  console.error('parse-zwiftpower-paste: no rider rows found on stdin. Expected a ZwiftPower category result list - see the format at the top of this file.')
  process.exit(1)
}

// Positions are what every message below refers to a row by, so fill in any the
// paste didn't carry from the row's order within its category.
const byCat = new Map()
for (const row of rows) {
  if (!byCat.has(row.cat)) byCat.set(row.cat, [])
  const group = byCat.get(row.cat)
  if (row.pos === undefined) row.pos = group.length + 1
  group.push(row)
}

const problems = []
const where = row => `cat ${row.cat} pos ${row.pos}`

for (const [cat, group] of byCat) {
  // The winner's own clock is the time base: ZwiftPower prints every row's
  // mm:ss truncated to the second but publishes the gap to three decimals, so
  // "winner + gap" resolves a bunch finish that whole seconds flatten out.
  const winner = group.find(row => row.pos === 1) ?? group[0]
  const baseSec = winner?.clockSec
  if (baseSec === undefined) problems.push(`cat ${cat}: no finish time on the winning row - cannot establish a time base`)
  for (const row of group) {
    if (useGapTimes && baseSec !== undefined && row.gapSec !== undefined) row.timeSec = Math.round(baseSec + row.gapSec)
    else if (row.clockSec !== undefined) row.timeSec = Math.round(row.clockSec)
    if (row.timeSec === undefined) problems.push(`${where(row)}: no finish time could be parsed`)
    else if (baseSec !== undefined && row.timeSec < Math.round(baseSec)) problems.push(`${where(row)}: finish time ${row.timeSec}s is ahead of the category winner's ${Math.round(baseSec)}s`)
    if (row.avgW === undefined) problems.push(`${where(row)}: no average power could be parsed`)
    // The published average w/kg is an independent statement of avgW/weightKg,
    // so it catches a field grabbed off the wrong column - the single most
    // likely parse failure, and one that is invisible in the output otherwise.
    // Tolerance 0.055 because the source rounds w/kg to 0.1.
    if (row.avgW !== undefined && row.weightKg && row.publishedWkg !== undefined) {
      const computed = row.avgW / row.weightKg
      if (Math.abs(computed - row.publishedWkg) > 0.055) {
        problems.push(`${where(row)}: ${row.avgW} W / ${row.weightKg} kg = ${computed.toFixed(2)} W/kg, but the paste publishes ${row.publishedWkg.toFixed(1)} W/kg`)
      }
    }
  }

  const positions = group.map(row => row.pos)
  for (let i = 0; i < positions.length; i++) {
    if (positions[i] !== i + 1) {
      problems.push(`cat ${cat}: positions are not consecutive from 1 (position ${positions[i]} found at index ${i + 1})`)
      break
    }
  }
  for (let i = 1; i < group.length; i++) {
    const previous = group[i - 1]
    const current = group[i]
    if (previous.timeSec !== undefined && current.timeSec !== undefined && current.timeSec < previous.timeSec) {
      problems.push(`cat ${cat}: pos ${current.pos} finished ${previous.timeSec - current.timeSec}s before pos ${previous.pos}`)
    }
  }
}

// Applied after validation, so a cut can never hide a parse error.
let dropped = 0
if (dnfCutSec !== undefined) {
  if (!Number.isFinite(dnfCutSec) || dnfCutSec <= 0) {
    console.error(`parse-zwiftpower-paste: --dnf-cut must be a positive number of seconds, got ${JSON.stringify(value('--dnf-cut'))}.`)
    process.exit(2)
  }
  for (const [, group] of byCat) {
    const winnerSec = group.find(row => row.pos === 1)?.timeSec ?? group[0]?.timeSec
    if (winnerSec === undefined) continue
    for (const row of group) {
      if (row.timeSec !== undefined && row.timeSec - winnerSec > dnfCutSec) {
        row.cut = true
        dropped++
      }
    }
  }
}

const riders = rows.filter(row => !row.cut).map(row => ({
  cat: row.cat,
  pos: row.pos,
  timeSec: row.timeSec,
  avgW: row.avgW,
  npW: row.npW,
  // A row whose weight was not published keeps neither weight nor height: the
  // analysis skips it, and half a rider is worse than none.
  ...(row.weightKg ? { weightKg: row.weightKg, heightCm: row.heightCm } : {})
}))

const block = {
  label: label ?? slug,
  routeSlug,
  laps,
  ...(eventDistanceKm === undefined ? {} : { eventDistanceKm }),
  ...(distanceNote === undefined ? {} : { distanceNote }),
  riders
}

const withoutWeight = riders.filter(rider => rider.weightKg === undefined).length
console.error(`parse-zwiftpower-paste: ${rows.length} rows parsed (${[...byCat].map(([cat, group]) => `${cat}:${group.length}`).join(' ')}), `
  + `${withoutWeight} without a published weight, ${problems.length} flagged`
  + (dropped ? `, ${dropped} dropped by --dnf-cut` : ''))

if (problems.length) {
  for (const problem of problems) console.error(`  ${allowMismatch ? 'WARN' : 'ERROR'}: ${problem}`)
  if (!allowMismatch) {
    console.error('\nNothing was written. Fix the paste, or re-run with --allow-mismatch if these rows are genuinely like this in the source.')
    process.exit(1)
  }
}

if (!appendPath) {
  process.stdout.write(`${JSON.stringify({ [slug]: block }, null, 1)}\n`)
  process.exit(0)
}

if (!existsSync(appendPath)) {
  console.error(`parse-zwiftpower-paste: ${appendPath} does not exist. Create it from scripts/race-draft/field-results.sample.json first (and keep it out of git - it is gitignored for a reason).`)
  process.exit(1)
}
const dataset = JSON.parse(readFileSync(appendPath, 'utf8'))
dataset.races ??= {}
if (dataset.races[slug] && !force) {
  console.error(`parse-zwiftpower-paste: ${appendPath} already has a race called "${slug}" (${dataset.races[slug].riders?.length ?? 0} riders). Pass --force to replace it.`)
  process.exit(1)
}
const replacing = Boolean(dataset.races[slug])
dataset.races[slug] = block
writeFileSync(appendPath, `${JSON.stringify(dataset, null, 1)}\n`)
console.error(`parse-zwiftpower-paste: ${replacing ? 'replaced' : 'appended'} "${slug}" (${riders.length} riders) in ${appendPath}. `
  + 'Re-run analyze-field-draft.mjs and compare the pooled bunch median to RACE_DRAFT_SAVING - see README.md.')
