// Imports per-frame measured stage curves (Stage 0-5 hour-gap seconds, flat
// and climb) from ZwiftInsider's public speed-test sheet into
// `shared/data/frameSpeedData.ts`, as `flatGapSecByStage`/`climbGapSecByStage`
// arrays on each matched row. Diagnostic/maintenance only - nothing in the
// app runs this. Re-run it whenever ZwiftInsider re-tests the roster
// (issue #88):
//
//   node scripts/upgrade-levels/import-stage-curves.mjs            # fetch live sheet
//   node scripts/upgrade-levels/import-stage-curves.mjs --csv=path # offline CSV
//   node scripts/upgrade-levels/import-stage-curves.mjs --dry-run  # report only
//
// Safety rules (all violations are reported, never silently written):
//   - only `Power = 300` rows are used - the sheet holds a 150W and a 300W
//     test row per bike and the repo's top-level fields are 300W (see the
//     note atop `frameSpeedData.ts`); mixing them would corrupt the data.
//     The 150W rows are imported separately, into their own `at150W`
//     block, by scripts/zwiftinsider/import-validation-gaps.mjs.
//   - a row only imports when its Stage 0/5 gaps EXACTLY equal the repo's
//     stored `*0`/`*5` endpoint fields (both are parsed one-decimal values,
//     so equal data compares equal). validate-speed-data.mjs enforces the
//     same exact equality on the committed arrays, so any looser tolerance
//     here would import cleanly and then fail every build. A mismatch of
//     any size means ZwiftInsider re-tested the bike since the endpoints
//     were imported - that's a job for the zwift-data-drift audit (update
//     the endpoint fields first, then re-run this), not this script.
//   - sheet names map to repo keys by exact match plus the explicit alias
//     map below (the sheet and zwift-data spell several frames differently -
//     see `validate-speed-data.mjs` for why guessing is dangerous). Unmatched
//     names are listed, not fuzzy-matched.
import { readFileSync, writeFileSync } from 'node:fs'
import { loadSharedModule } from '../route-surfaces/loadShared.mjs'
import { FRAMES_CSV_URL, loadCsv, parseArgs, parseCsv } from '../zwiftinsider/sheet.mjs'

const { FRAME_SPEED_DATA, TT_FRAME_SPEED_DATA } = loadSharedModule('shared/data/frameSpeedData.ts')

const DATA_FILE = new URL('../../shared/data/frameSpeedData.ts', import.meta.url)

// Sheet spelling -> repo/zwift-data spelling, for names that differ. Add
// here only after verifying the zwift-data name (see CLAUDE/skill notes on
// Van Rysel and Tarmac SL9 naming).
const SHEET_NAME_ALIASES = {
  'Specialized S-Works Tarmac SL9': 'Specialized Tarmac SL9',
  'Van Rysel RCR Pro': 'VanRysel RCR Pro',
  'Van Rysel RCR-F': 'VanRysel RCR-F',
  'Van Rysel RCR-X': 'VanRysel RCR-X',
  // zwift-data only has the "Team" edition of the Filante ID2; the sheet's
  // row (identical endpoints) drops the suffix. "...ID2 NEW" is a separate,
  // stage-less sheet row and stays unmatched on purpose.
  'Wilier Filante SLR ID2': 'Wilier Filante SLR ID2 Team',
  // The game/zwift-data name for the CANYON//SRAM team edition.
  'Canyon Aeroad CFR - CANYON//SRAM': 'Canyon Aeroad 2024 / SRAM'
}

const args = parseArgs(process.argv.slice(2))

const rows = parseCsv(await loadCsv({ path: args.csv, url: FRAMES_CSV_URL }))

// Row 0 is the "Flat Test Results / Climb Test Results" group header, row 1
// the real header. Gap columns: flat stages 0-5 at 9,11,13,15,17,19; climb
// stages 0-5 at 21,23,25,27,29,31 (each stage is a speed/gap column pair).
const FLAT_GAP_COLS = [9, 11, 13, 15, 17, 19]
const CLIMB_GAP_COLS = [21, 23, 25, 27, 29, 31]
const header = rows[1] ?? []
if (header[0] !== 'Bike' || header[9] !== 'Stage 0 - Hour Time Gap') {
  console.error('Sheet layout changed - expected "Bike" in column A and gap columns from J; refusing to guess.')
  process.exit(1)
}

const curves = new Map() // repo key -> { flat: number[6], climb: number[6] }
const report = { unmatched: [], incomplete: [], mismatched: [], duplicates: [], rewriteFailed: [] }

for (const row of rows.slice(2)) {
  const sheetName = row[0]
  if (!sheetName || row[7] !== '300') continue
  const name = SHEET_NAME_ALIASES[sheetName] ?? sheetName
  const sample = FRAME_SPEED_DATA[name] ?? TT_FRAME_SPEED_DATA[name]
  if (!sample) {
    report.unmatched.push(sheetName)
    continue
  }

  const gapsAt = cols => cols.map(i => row[i] === '' || row[i] === '-3600.0' ? undefined : Number(row[i]))
  const flat = gapsAt(FLAT_GAP_COLS)
  const climb = gapsAt(CLIMB_GAP_COLS)
  if ([...flat, ...climb].some(v => v === undefined || Number.isNaN(v))) {
    report.incomplete.push(sheetName)
    continue
  }

  const endpointErrors = [
    ['flatGapSec0', sample.flatGapSec0, flat[0]], ['flatGapSec5', sample.flatGapSec5, flat[5]],
    ['climbGapSec0', sample.climbGapSec0, climb[0]], ['climbGapSec5', sample.climbGapSec5, climb[5]]
  ].filter(([, repo, sheet]) => repo !== sheet)
  if (endpointErrors.length) {
    report.mismatched.push(`${name}: ${endpointErrors.map(([f, repo, sheet]) => `${f} repo ${repo} vs sheet ${sheet}`).join(', ')}`)
    continue
  }

  if (curves.has(name)) {
    report.duplicates.push(sheetName)
    continue
  }
  curves.set(name, { flat, climb })
}

const notCovered = [...Object.keys(FRAME_SPEED_DATA), ...Object.keys(TT_FRAME_SPEED_DATA)]
  .filter(name => !curves.has(name) && name !== 'Zwift Golden Concept Z1') // shares CONCEPT_Z1 with 'Zwift Concept Z1'

// --- Rewrite frameSpeedData.ts, appending the arrays to each matched row ---
const source = readFileSync(DATA_FILE, 'utf8')
const lines = source.split('\n')
let written = 0
let changed = 0

// The stage arrays go right after the endpoint fields, BEFORE any `at150W`/
// `onTtFrame` validation block import-validation-gaps.mjs appends to the same
// line - both scripts strip and re-append only their own fields, so running
// them in either order must leave the line in the same canonical shape.
function augmentLine(line, { flat, climb }) {
  const stripped = line.replace(/, flatGapSecByStage: \[[^\]]*\], climbGapSecByStage: \[[^\]]*\]/, '')
  const fmt = arr => `[${arr.map(n => String(n)).join(', ')}]`
  return stripped.replace(/((?:, (?:at150W|onTtFrame): \{[^}]*\})*) \}(,?)(\s*(?:\/\/.*)?)$/, ` , flatGapSecByStage: ${fmt(flat)}, climbGapSecByStage: ${fmt(climb)}$1 }$2$3`)
    .replace(/ , flatGapSecByStage/, ', flatGapSecByStage')
}

for (const [name, curve] of curves) {
  // The Concept Z1's sample lives in a shared const (`CONCEPT_Z1`), not an
  // inline object - both the plain and Golden keys point at it.
  const marker = name === 'Zwift Concept Z1' ? 'const CONCEPT_Z1: FrameSpeedSample = {' : `'${name}': {`
  const idx = lines.findIndex(l => l.includes(marker) && l.includes('flatGapSec0'))
  if (idx === -1) {
    report.rewriteFailed.push(`${name}: no single-line entry found in frameSpeedData.ts`)
    continue
  }
  const next = augmentLine(lines[idx], curve)
  // `next === lines[idx]` is fine - it means the line already carries these
  // exact arrays (the rewrite is idempotent). Only a line the augmentation
  // couldn't attach the arrays to at all is a failure.
  if (!next.includes('flatGapSecByStage')) {
    report.rewriteFailed.push(`${name}: could not attach arrays to its line`)
    continue
  }
  if (next !== lines[idx]) changed++
  lines[idx] = next
  written++
}

if (!args['dry-run']) writeFileSync(DATA_FILE, lines.join('\n'))

console.log(`${args['dry-run'] ? '[dry-run] would write' : 'wrote'} stage curves for ${written} of ${Object.keys(FRAME_SPEED_DATA).length + Object.keys(TT_FRAME_SPEED_DATA).length} table rows (${changed} changed, ${written - changed} already up to date)`)
const list = (label, items) => {
  if (items.length) console.log(`\n${label} (${items.length}):\n  ${items.join('\n  ')}`)
}
list('sheet 300W rows with no matching table key (expected for gravel/handcycle/fun bikes and cosmetic variants)', report.unmatched)
list('sheet rows missing stage data (left on scheme-chart fallback)', report.incomplete)
list('ENDPOINT MISMATCH - sheet re-tested since import, NOT written (run the zwift-data-drift audit)', report.mismatched)
list('REWRITE FAILED - matched the sheet but frameSpeedData.ts line could not be updated (stale curve!)', report.rewriteFailed)
list('duplicate 300W sheet rows (first occurrence kept)', report.duplicates)
list('table rows with no sheet stage curve (left on scheme-chart fallback)', notCovered)
process.exitCode = report.mismatched.length || report.rewriteFailed.length ? 1 : 0
