#!/usr/bin/env node
// Imports the ZwiftInsider sheet's HELD-OUT test rows into the speed-data
// tables as validation blocks (issue #168):
//
//   - frames: the 150 W row -> `at150W` on the matching FRAME_SPEED_DATA /
//     TT_FRAME_SPEED_DATA entry (Stage 0 + Stage 5, flat + climb)
//   - wheels: the 150 W row -> `at150W`, and the wheel's "Zwift TT" 300 W
//     row (same wheel on the TT frame) -> `onTtFrame`, on WHEEL_SPEED_DATA
//
// Nothing at runtime reads these blocks. The CdA/mass deltas are solved from
// the top-level 300 W fields alone; `physics/equipment.test.ts` then forward-
// simulates those deltas at 150 W / on the TT baseline and compares against
// these blocks - the only way to tell whether a two-equation solve found the
// right aero-vs-mass split. Diagnostic/maintenance only; re-run when
// ZwiftInsider re-tests:
//
//   node scripts/zwiftinsider/import-validation-gaps.mjs                              # fetch live sheet
//   node scripts/zwiftinsider/import-validation-gaps.mjs --csv-frames=a --csv-wheels=b # offline CSVs
//   node scripts/zwiftinsider/import-validation-gaps.mjs --dry-run                    # report only
//
// Safety rules (violations are reported, never silently written):
//   - the TOP-LEVEL 300 W fields are never touched - the rewrite strips and
//     re-appends only its own blocks, and asserts the rest of the line is
//     byte-identical afterwards.
//   - the baseline rows must be where they should be: the 150 W "Zwift
//     Carbon"/"Zwift TT" frame rows read 0 gaps and their speeds equal
//     `BASELINE_SPEED_TEST_MPH.at150W`; each wheel group's "Zwift 32mm
//     Carbon" reads 0/0. Otherwise the layout changed - refuse to guess.
//   - every printed gap is checked against its own two speed cells under the
//     sheet's definition (`sheetGapSec`). Irreconcilable rows (Pinarello
//     Espada's 150 W gaps contradict its speeds by ~100 s/h) are listed and
//     skipped; moderate, systematic disagreement is baseline-era drift and
//     is imported as printed but listed - see the tolerance constants.
//   - names map to repo keys by exact match plus the explicit alias maps
//     below (the sheet spells many wheels differently from the game, and
//     spells the SAME bike differently between its own 150 W and 300 W
//     rows). Unmatched names are listed with their closest catalog key so
//     an alias can be added deliberately - never fuzzy-matched. Note the
//     Shimano trap: the sheet's "Shimano DURA-ACE C50" is the 2026 wheel the
//     game calls "Shimano C50", while the game's "Shimano DURA-ACE C50" is
//     the sheet's "... C50 2021" - so aliases are applied BEFORE the exact
//     match, and every alias that overrides an exact key is reported.
//   - only rows in the repo tables get a block; equipment the sheet tests
//     but the tables lack is listed, not added (adding equipment is a
//     ranking change with its own intake process).
import { readFileSync, writeFileSync } from 'node:fs'
import { loadSharedModule } from '../route-surfaces/loadShared.mjs'
import { FRAMES_CSV_URL, WHEELS_CSV_URL, loadCsv, parseArgs, parseCsv, sheetGapSec } from './sheet.mjs'

const { FRAME_SPEED_DATA, TT_FRAME_SPEED_DATA, BASELINE_SPEED_TEST_MPH } = loadSharedModule('shared/data/frameSpeedData.ts')
const { WHEEL_SPEED_DATA } = loadSharedModule('shared/data/wheelSpeedData.ts')

const FRAME_DATA_FILE = new URL('../../shared/data/frameSpeedData.ts', import.meta.url)
const WHEEL_DATA_FILE = new URL('../../shared/data/wheelSpeedData.ts', import.meta.url)

// A printed gap is a rounded (1 decimal) function of two 4-decimal mph
// speeds, so a self-consistent row agrees to ~0.1 s/h; 0.6 is rounding.
// Beyond that the sheet has two kinds of disagreement, handled differently:
//
//   - BASELINE-ERA DRIFT, ~4-5 s/h: the sheet's tests span years and the
//     reference bikes were re-run in between. Every TT frame's 150 W Stage 5
//     flat gap implies a Zwift TT baseline of 19.6733 mph where the printed
//     baseline row says 19.6464; every 2025+ road frame's 150 W Stage 0 flat
//     gap implies a Zwift Carbon baseline of 18.9636 vs the printed 18.9858.
//     The printed gaps were computed against the baseline as it was when
//     that bike was tested - which is the right comparison - and the app's
//     300 W-solved deltas reproduce THOSE numbers to ~2 s/h while missing the
//     speed-derived ones by ~5. So the printed gap is imported as-is and the
//     row is listed for the record. (The 300 W rows have none of this.)
//   - CORRUPT CELLS, tens to hundreds of s/h: a gap formula pointing at the
//     wrong row (Pinarello Espada's 150 W gaps are ~100 s/h off its own
//     speeds) or a speed cell that is itself nonsense. Never imported.
const GAP_VS_SPEED_ROUNDING_SEC = 0.6
const GAP_VS_SPEED_CORRUPT_SEC = 10

// Sheet spelling -> repo/zwift-data spelling. The frame list is the stage
// importer's, plus the spellings the 150 W rows use where they differ from
// the 300 W rows of the same bike.
const FRAME_ALIASES = {
  'Specialized S-Works Tarmac SL9': 'Specialized Tarmac SL9',
  'Van Rysel RCR Pro': 'VanRysel RCR Pro',
  'Van Rysel RCR-F': 'VanRysel RCR-F',
  'Van Rysel RCR-X': 'VanRysel RCR-X',
  'Wilier Filante SLR ID2': 'Wilier Filante SLR ID2 Team',
  'WilierFilante Filante SLR ID2 Team': 'Wilier Filante SLR ID2 Team',
  'Canyon Aeroad CFR - CANYON//SRAM': 'Canyon Aeroad 2024 / SRAM',
  'Quintana Roo V-PR': 'QuintanaRoo Roo V-PR'
}

// Verified against the WHEEL_SPEED_DATA keys (which validate-speed-data.mjs
// pins to the game catalog). Trailing ASCII whitespace is trimmed from sheet
// names before lookup; the Princeton key's trailing NBSP is the game's own.
const WHEEL_ALIASES = {
  // 2026 revisions: the sheet adds "DURA-ACE", the game dropped it.
  'Shimano DURA-ACE C36': 'Shimano C36',
  'Shimano DURA-ACE C50': 'Shimano C50',
  'Shimano DURA-ACE C60': 'Shimano C60',
  // Legacy revisions: the sheet appends the model year, the game does not.
  'Shimano DURA-ACE C36 2025': 'Shimano DURA-ACE C36',
  'Shimano DURA-ACE C50 2021': 'Shimano DURA-ACE C50',
  'Shimano DURA-ACE C60 2019': 'Shimano DURA-ACE C60',
  // No legacy twin for these two; the sheet name is just the 2026 name plus "DURA-ACE".
  'Shimano DURA-ACE C40': 'Shimano C40',
  'Shimano DURA-ACE C99/Disc': 'Shimano C99/Disc',
  // Zwift's own wheels: the game's names carry "Wheels"/"Wheelset"/"Wheel" suffixes the sheet drops.
  'Zwift Baseline': 'Zwift Zwift Baseline Wheels',
  'Zwift Groovy Time Trial': 'Zwift Groovy Time Trial Wheels',
  'Zwift Pride On': 'Zwift Pride On Disc',
  'Zwift Supersonic': 'Zwift Supersonic Wheelset',
  'Zwift Tri Spoke // Disc': 'Zwift Tri Spoke // Disc Wheel',
  'DT Swiss ARC 1100 DICUT 62': 'DTSwiss ARC 1100 DICUT 62',
  'DT Swiss ARC 1100 DICUT 65': 'DTSwiss ARC 1100 DICUT 65',
  'DT Swiss ARC 1100 DICUT 85/Disc': 'DTSwiss ARC 1100 DICUT 85/Disc',
  'DT Swiss ARC 1100 DICUT DISC': 'DTSwiss ARC 1100 DICUT DISC',
  'CADEX 36': 'Cadex 36',
  'CADEX 42': 'Cadex 42',
  'CADEX 65': 'Cadex 65',
  'CADEX Max 50': 'Cadex Max 50',
  'ENVE SES 2.2': 'Enve SES 2.2',
  'ENVE SES 3.4': 'Enve SES 3.4',
  'ENVE SES 4.5 PRO': 'Enve SES 4.5 PRO',
  'ENVE SES 6.7': 'Enve SES 6.7',
  'ENVE SES 7.8': 'Enve SES 7.8',
  'ENVE SES 8.9': 'Enve SES 8.9',
  'Lightweight Meilenstein': 'Lightweight Lightweight Meilenstein',
  'Novatec R4': 'Novatec Novatec R4',
  'Princeton Carbonworks Alta 3532': 'Princeton Alta 3532',
  'Princeton Carbonworks Wake 6560 White': 'Princeton Wake 6560 White',
  'Princeton Carbonworks Wake 6560 Lava': 'Princeton Wake 6560 Lava',
  'Princeton Carbonworks Mach TSV2/Blur Disc': 'Princeton  Mach TSV2/Blur Disc\u00A0',
  'Princeton  Mach TSV2/Blur Disc': 'Princeton  Mach TSV2/Blur Disc\u00A0',
  'Roval Rapide Sprint CLX': 'Roval Sprint CLX',
  'Swiss Side HADRON Ultimate 650': 'SwissSide HADRON Ultimate 650',
  'Swiss Side HADRON Ultimate 850/Disc': 'SwissSide HADRON Ultimate Disc',
  'SwissSide HADRON Ultimate Disc': 'SwissSide HADRON Ultimate Disc'
}

const args = parseArgs(process.argv.slice(2))
const report = {
  fatal: [],
  frames: { unmatched: [], incomplete: [], corrupt: [], eraDrift: [], duplicates: [], aliasOverrides: [], notCovered: [] },
  wheels: { unmatched: [], incomplete: [], corrupt: [], eraDrift: [], duplicates: [], aliasOverrides: [], noPowerRow: [], noTtRow: [] },
  rewriteFailed: []
}

const num = cell => (cell === '' || cell === undefined || cell === '-3600.0') ? undefined : Number(cell)
const fmt = n => String(Number(n))

function normalize(name) {
  return name.toLowerCase().replace(/\s+/gu, ' ').trim()
}

/** For the unmatched report: the repo key that differs only by case/whitespace, if any. */
function nearMiss(name, keys) {
  return keys.find(k => normalize(k) === normalize(name))
}

/**
 * Resolves a sheet name to a repo key. Aliases win over an exact match
 * (Shimano), and every such override is reported so it stays a conscious
 * decision. Returns undefined (and records the miss) when nothing matches.
 */
function resolveKey(sheetName, aliases, keys, section) {
  const aliased = aliases[sheetName]
  if (aliased !== undefined) {
    if (keys.includes(sheetName) && aliased !== sheetName) section.aliasOverrides.push(`${JSON.stringify(sheetName)} -> ${JSON.stringify(aliased)} (the sheet name is ALSO a repo key)`)
    return keys.includes(aliased) ? aliased : undefined
  }
  if (keys.includes(sheetName)) return sheetName
  const near = nearMiss(sheetName, keys)
  section.unmatched.push(near ? `${sheetName}  (near miss: ${JSON.stringify(near)} - add an alias if it is the same equipment)` : sheetName)
  return undefined
}

/**
 * Reads one (speed, gap) cell pair. Returns the printed gap, or undefined
 * when the cell is empty/sentinel (`incomplete`) or the gap is irreconcilable
 * with its speed cells (`corrupt`), after recording why. A moderate
 * disagreement is recorded as `eraDrift` and the printed gap still returned
 * - see the tolerance constants above.
 */
function readGap(row, speedCol, gapCol, baselineSpeed, label, section) {
  const speed = num(row[speedCol])
  const gap = num(row[gapCol])
  if (speed === undefined || gap === undefined || Number.isNaN(speed) || Number.isNaN(gap)) {
    section.incomplete.push(label)
    return undefined
  }
  const fromSpeeds = sheetGapSec(speed, baselineSpeed)
  const disagreement = Math.abs(fromSpeeds - gap)
  if (disagreement > GAP_VS_SPEED_CORRUPT_SEC) {
    section.corrupt.push(`${label}: printed ${gap}, but its speed cells say ${fromSpeeds.toFixed(1)} (${speed} vs baseline ${baselineSpeed} mph)`)
    return undefined
  }
  if (disagreement > GAP_VS_SPEED_ROUNDING_SEC) {
    section.eraDrift.push(`${label}: printed ${gap} implies a baseline of ${(speed / (1 + gap / 3600)).toFixed(4)} mph, the baseline row says ${baselineSpeed} (${fromSpeeds.toFixed(1)} s/h)`)
  }
  return gap
}

// ---------------------------------------------------------------- frames ---
async function importFrames() {
  const rows = parseCsv(await loadCsv({ path: args['csv-frames'], url: FRAMES_CSV_URL }))
  // Row 0 is the "Flat Test Results / Climb Test Results" group header, row 1
  // the real header - same layout the stage-curve importer relies on.
  const header = rows[1] ?? []
  if (header[0] !== 'Bike' || header[7] !== 'Power (W)' || header[9] !== 'Stage 0 - Hour Time Gap' || header[21] !== 'Stage 0 - Hour Time Gap') {
    report.fatal.push('frames tab layout changed - expected Bike/Power (W) in columns A/H and stage-0 gap columns J and V; refusing to guess')
    return new Map()
  }
  const rows150 = rows.slice(2).filter(r => r[0] && r[7] === '150')

  // Baselines first: the 150 W reference rows must read 0 gaps and match the
  // speeds already committed in BASELINE_SPEED_TEST_MPH, or these are not the
  // rows we think they are.
  const baselines = {}
  for (const name of ['Zwift Carbon', 'Zwift TT']) {
    const row = rows150.find(r => r[0] === name)
    const expected = BASELINE_SPEED_TEST_MPH[name].at150W
    if (!row) {
      report.fatal.push(`frames tab: no 150 W row for ${name}`)
      continue
    }
    if (num(row[9]) !== 0 || num(row[21]) !== 0) report.fatal.push(`frames tab: ${name} 150 W stage-0 gaps read ${row[9]}/${row[21]}, expected 0/0`)
    if (num(row[8]) !== expected.flat || num(row[20]) !== expected.climb) report.fatal.push(`frames tab: ${name} 150 W speeds ${row[8]}/${row[20]} mph do not match BASELINE_SPEED_TEST_MPH (${expected.flat}/${expected.climb})`)
    baselines[name] = { flat: num(row[8]), climb: num(row[20]) }
  }
  if (report.fatal.length) return new Map()

  const keys = [...Object.keys(FRAME_SPEED_DATA), ...Object.keys(TT_FRAME_SPEED_DATA)]
  const blocks = new Map() // repo key -> at150W block
  for (const row of rows150) {
    const key = resolveKey(row[0], FRAME_ALIASES, keys, report.frames)
    if (!key) continue
    const baseline = key in TT_FRAME_SPEED_DATA ? baselines['Zwift TT'] : baselines['Zwift Carbon']
    const section = { incomplete: [], corrupt: [], eraDrift: [] }
    const block = {
      flatGapSec0: readGap(row, 8, 9, baseline.flat, `${key} flat S0`, section),
      flatGapSec5: readGap(row, 18, 19, baseline.flat, `${key} flat S5`, section),
      climbGapSec0: readGap(row, 20, 21, baseline.climb, `${key} climb S0`, section),
      climbGapSec5: readGap(row, 30, 31, baseline.climb, `${key} climb S5`, section)
    }
    // A block is all-or-nothing; report the row once under the reason that applies.
    report.frames.eraDrift.push(...section.eraDrift)
    if (section.corrupt.length) {
      report.frames.corrupt.push(...section.corrupt)
      continue
    }
    if (section.incomplete.length) {
      report.frames.incomplete.push(`${key} (${section.incomplete.map(s => s.slice(key.length + 1)).join(', ')})`)
      continue
    }
    if (blocks.has(key)) {
      report.frames.duplicates.push(row[0])
      continue
    }
    blocks.set(key, { at150W: block })
  }
  report.frames.notCovered = keys.filter(k => !blocks.has(k) && k !== 'Zwift Golden Concept Z1') // shares CONCEPT_Z1 with 'Zwift Concept Z1'
  return blocks
}

// ---------------------------------------------------------------- wheels ---
async function importWheels() {
  const rows = parseCsv(await loadCsv({ path: args['csv-wheels'], url: WHEELS_CSV_URL }))
  const header = rows[0] ?? []
  if (header[0] !== 'Bike' || header[1] !== 'Wheels' || header[6] !== 'Power (W)' || header[8] !== 'Hour Time Gap' || header[10] !== 'Hour Time Gap') {
    report.fatal.push('wheels tab layout changed - expected Bike, Wheels, Power (W) in columns A/B/G and gap columns I and K; refusing to guess')
    return new Map()
  }
  const keys = Object.keys(WHEEL_SPEED_DATA)
  const blocks = new Map() // repo key -> { at150W?, onTtFrame? }

  for (const [frame, power, field] of [['Zwift Carbon', '150', 'at150W'], ['Zwift TT', '300', 'onTtFrame']]) {
    const group = rows.slice(1).filter(r => r[0] === frame && r[6] === power)
    const baselineRow = group.find(r => r[1].replace(/[ \t]+$/, '') === 'Zwift 32mm Carbon')
    if (!baselineRow) {
      report.fatal.push(`wheels tab: no "Zwift 32mm Carbon" row in the ${frame} @ ${power} W group`)
      continue
    }
    if (num(baselineRow[8]) !== 0 || num(baselineRow[10]) !== 0) {
      report.fatal.push(`wheels tab: ${frame} @ ${power} W baseline gaps read ${baselineRow[8]}/${baselineRow[10]}, expected 0/0`)
      continue
    }
    const baseline = { flat: num(baselineRow[7]), climb: num(baselineRow[9]) }
    const seen = new Set()
    for (const row of group) {
      const key = resolveKey(row[1].replace(/[ \t]+$/, ''), WHEEL_ALIASES, keys, report.wheels)
      if (!key) continue
      if (seen.has(key)) {
        report.wheels.duplicates.push(`${row[1]} (${frame} @ ${power} W)`)
        continue
      }
      seen.add(key)
      const section = { incomplete: [], corrupt: [], eraDrift: [] }
      const block = {
        flatGapSec: readGap(row, 7, 8, baseline.flat, `${key} ${field} flat`, section),
        climbGapSec: readGap(row, 9, 10, baseline.climb, `${key} ${field} climb`, section)
      }
      report.wheels.eraDrift.push(...section.eraDrift)
      if (section.corrupt.length) {
        report.wheels.corrupt.push(...section.corrupt)
        continue
      }
      if (section.incomplete.length) {
        report.wheels.incomplete.push(`${key} ${field}`)
        continue
      }
      blocks.set(key, { ...blocks.get(key), [field]: block })
    }
  }
  // The unmatched list is per (name, group); dedupe for the report.
  report.wheels.unmatched = [...new Set(report.wheels.unmatched)]
  report.wheels.aliasOverrides = [...new Set(report.wheels.aliasOverrides)]
  report.wheels.noPowerRow = keys.filter(k => !blocks.get(k)?.at150W)
  report.wheels.noTtRow = keys.filter(k => !blocks.get(k)?.onTtFrame)
  return blocks
}

// --------------------------------------------------------------- rewrite ---
const BLOCK_RE = /, (?:at150W|onTtFrame): \{[^}]*\}/g

/**
 * Removes every validation block from a source line. Repeats until the line
 * stops changing: this is a TypeScript source line, not HTML, but CodeQL's
 * "incomplete multi-character sanitization" rule reads a single-pass removal
 * of a pattern containing "on" as an HTML-attribute sanitizer and flags it;
 * the loop is the shape it accepts, and is also what a nested match would
 * need anyway.
 */
function stripBlocks(line) {
  let previous
  do {
    previous = line
    line = line.replace(BLOCK_RE, '')
  } while (line !== previous)
  return line
}

function formatBlock(name, block) {
  return `${name}: { ${Object.entries(block).map(([k, v]) => `${k}: ${fmt(v)}`).join(', ')} }`
}

/**
 * Re-appends the validation blocks (canonical order: at150W, onTtFrame) at
 * the end of a single-line table entry, after any stage arrays, before the
 * closing brace. Idempotent, and never touches anything outside the blocks.
 */
function augmentLine(line, blocks) {
  const stripped = stripBlocks(line)
  const suffix = ['at150W', 'onTtFrame'].filter(k => blocks[k]).map(k => formatBlock(k, blocks[k])).join(', ')
  if (!suffix) return stripped
  return stripped.replace(/ \}(,?)(\s*(?:\/\/.*)?)$/, `, ${suffix} }$1$2`)
}

/** The key as it appears in the source file - the Princeton key's trailing NBSP is written as a `\\u00A0` escape there. */
function sourceKey(key) {
  return key.replace(/\u00A0/g, '\\u00A0')
}

/** @returns {{ written: number, changed: number }} */
function rewriteFile(file, blocksByKey, markerFor) {
  const source = readFileSync(file, 'utf8')
  const lines = source.split('\n')
  let written = 0
  let changed = 0
  for (const [key, blocks] of blocksByKey) {
    const marker = markerFor(key)
    const idx = lines.findIndex(l => l.includes(marker) && l.includes('flatGapSec'))
    if (idx === -1) {
      report.rewriteFailed.push(`${key}: no single-line entry found in ${file.pathname.split('/').pop()}`)
      continue
    }
    const next = augmentLine(lines[idx], blocks)
    if (stripBlocks(next) !== stripBlocks(lines[idx]) || !['at150W', 'onTtFrame'].some(k => blocks[k] && next.includes(`${k}: {`))) {
      report.rewriteFailed.push(`${key}: could not attach the blocks to its line without touching the rest of it`)
      continue
    }
    if (next !== lines[idx]) changed++
    lines[idx] = next
    written++
  }
  if (!args['dry-run'] && changed) writeFileSync(file, lines.join('\n'))
  return { written, changed }
}

// ------------------------------------------------------------------ main ---
const frameBlocks = await importFrames()
const wheelBlocks = await importWheels()

if (report.fatal.length) {
  console.error('REFUSING TO IMPORT:\n  ' + report.fatal.join('\n  '))
  process.exit(1)
}

// The Concept Z1's sample lives in a shared const (`CONCEPT_Z1`), not an
// inline object - both the plain and Golden keys point at it.
const frameResult = rewriteFile(FRAME_DATA_FILE, frameBlocks, key => key === 'Zwift Concept Z1' ? 'const CONCEPT_Z1: FrameSpeedSample = {' : `'${sourceKey(key)}': {`)
const wheelResult = rewriteFile(WHEEL_DATA_FILE, wheelBlocks, key => `'${sourceKey(key)}': {`)

const verb = args['dry-run'] ? '[dry-run] would write' : 'wrote'
const frameTotal = Object.keys(FRAME_SPEED_DATA).length + Object.keys(TT_FRAME_SPEED_DATA).length
console.log(`${verb} at150W blocks for ${frameResult.written} of ${frameTotal} frame rows (${frameResult.changed} changed)`)
const with150 = [...wheelBlocks.values()].filter(b => b.at150W).length
const withTt = [...wheelBlocks.values()].filter(b => b.onTtFrame).length
console.log(`${verb} blocks for ${wheelResult.written} of ${Object.keys(WHEEL_SPEED_DATA).length} wheel rows (${with150} at150W, ${withTt} onTtFrame; ${wheelResult.changed} changed)`)

const list = (label, items) => {
  if (items.length) console.log(`\n${label} (${items.length}):\n  ${items.join('\n  ')}`)
}
list('FRAMES - sheet 150 W rows with no matching table key (expected for gravel/MTB/fun bikes and cosmetic variants)', report.frames.unmatched)
list('FRAMES - alias overrode an exact key', report.frames.aliasOverrides)
list('FRAMES - CORRUPT: gap irreconcilable with its own speed cells, not imported', report.frames.corrupt)
list('FRAMES - baseline-era drift: printed gap imported, but computed against a different baseline speed than the baseline row prints (see the header)', report.frames.eraDrift)
list('FRAMES - 150 W row incomplete, not imported', report.frames.incomplete)
list('FRAMES - duplicate 150 W rows (first kept)', report.frames.duplicates)
list('FRAMES - table rows with no usable 150 W row', report.frames.notCovered)
list('WHEELS - sheet names with no matching table key (expected for wheels the tables do not carry)', report.wheels.unmatched)
list('WHEELS - alias overrode an exact key (Shimano generations - expected)', report.wheels.aliasOverrides)
list('WHEELS - CORRUPT: gap irreconcilable with its own speed cells, not imported', report.wheels.corrupt)
list('WHEELS - baseline-era drift: printed gap imported, computed against a different baseline speed than the baseline row prints', report.wheels.eraDrift)
list('WHEELS - row incomplete, not imported', report.wheels.incomplete)
list('WHEELS - duplicate rows (first kept)', report.wheels.duplicates)
list('WHEELS - table rows with no 150 W row', report.wheels.noPowerRow)
list('WHEELS - table rows with no Zwift TT row', report.wheels.noTtRow)
list('REWRITE FAILED - matched the sheet but the data file line could not be updated', report.rewriteFailed)
process.exitCode = report.rewriteFailed.length ? 1 : 0
