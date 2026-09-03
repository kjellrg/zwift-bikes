#!/usr/bin/env node
// Validates every hand-typed equipment name in the speed-data tables and
// classifier special-case sets against the `zwift-data` catalog, and runs as
// an early step of `npm run build` (see package.json) - which is also what
// the husky pre-commit hook runs.
//
// Why this exists: a speed-data key that doesn't byte-for-byte match the
// catalog name doesn't error anywhere - the lookup just misses and the
// wheel/frame silently falls back to the estimated heuristic preset, losing
// its real measurement and its "verified" badge. Issue #70's Princeton key
// was exactly this: the catalog name ends in a non-breaking space (U+00A0),
// the committed key ended in a plain space, and the two render identically
// in every editor and diff. A typecheck can't see it; this script turns it
// into a one-line build failure pointing at the exact codepoint.
//
// Errors (exit 1):
//   - a `WHEEL_SPEED_DATA` key that isn't a `bikeFrontWheels` name
//   - a `FRAME_SPEED_DATA` / `TT_FRAME_SPEED_DATA` key that isn't a
//     `bikeFrames` name, or a TT key whose frame isn't TT-classified
//   - a `FRAME_UPGRADE_SCHEMES` key that isn't a `bikeFrames` name
//   - a `*GapSecByStage` curve that is missing its sibling, isn't 6 stages
//     long, or disagrees with its own row's `*0`/`*5` endpoint fields
//   - an `INTEGRATED_ONLY_WHEELS` name that isn't in both wheel catalogs
//   - a `wheelSupplement.ts` entry that zwift-data now ships (by id or
//     name) - the supplement only bridges the gap until upstream catches up
//   - an `at150W` / `onTtFrame` validation block that is incomplete, a
//     reference row whose 300 W or 150 W values are not the sheet's, or a
//     row whose 150 W block just repeats its 300 W values
//
// Wheel-name checks run against the zwift-data catalog MERGED with
// `wheelSupplement.ts`, mirroring the runtime catalog in `getWheelsets()`.
//
// On a mismatch the closest catalog candidate (case/whitespace-insensitive)
// is printed with the codepoints of the differing span.
import { bikeFrames, bikeFrontWheels, bikeRearWheels } from 'zwift-data'
import { loadSharedModule } from './route-surfaces/loadShared.mjs'

const { WHEEL_SPEED_DATA } = loadSharedModule('shared/data/wheelSpeedData.ts')
const { SUPPLEMENT_FRONT_WHEELS, SUPPLEMENT_REAR_WHEELS, applyWheelSupplement } = loadSharedModule('shared/data/wheelSupplement.ts')
const { FRAME_SPEED_DATA, TT_FRAME_SPEED_DATA } = loadSharedModule('shared/data/frameSpeedData.ts')
const { FRAME_UPGRADE_SCHEMES } = loadSharedModule('shared/data/frameUpgradeSchemes.ts')
const { UNLOCALIZED_FRAME_NAME } = loadSharedModule('shared/utils/catalog.ts')

const errors = []

function normalize(name) {
  return name.toLowerCase().replace(/\s+/gu, ' ').trim()
}

function codepoints(s) {
  return [...s].map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ')
}

/** The first span where the two strings' codepoints differ, for the error message. */
function diffSpan(a, b) {
  const as = [...a]
  const bs = [...b]
  let start = 0
  while (start < as.length && start < bs.length && as[start] === bs[start]) start++
  const from = Math.max(0, start - 3)
  const to = start + 4
  return `  key      ...${JSON.stringify(as.slice(from, to).join(''))} = ${codepoints(as.slice(from, to).join(''))}\n`
    + `  catalog  ...${JSON.stringify(bs.slice(from, to).join(''))} = ${codepoints(bs.slice(from, to).join(''))}`
}

function checkKeys(label, keys, catalogNames) {
  const exact = new Set(catalogNames)
  const byNormalized = new Map(catalogNames.map(n => [normalize(n), n]))
  for (const key of keys) {
    if (exact.has(key)) continue
    const nearMiss = byNormalized.get(normalize(key))
    if (nearMiss) {
      errors.push(`${label}: key ${JSON.stringify(key)} does not exactly match catalog name ${JSON.stringify(nearMiss)} - first differing span:\n${diffSpan(key, nearMiss)}`)
    } else {
      errors.push(`${label}: key ${JSON.stringify(key)} matches no ${label.includes('WHEEL') ? 'wheel' : 'frame'} in the zwift-data catalog (renamed or removed upstream?)`)
    }
  }
}

// The wheel catalog is zwift-data plus the supplement (wheels live in the
// game but not yet shipped upstream - see `shared/data/wheelSupplement.ts`),
// merged exactly the way `getWheelsets()` merges them at runtime.
const frontWheelNames = applyWheelSupplement(bikeFrontWheels, SUPPLEMENT_FRONT_WHEELS).map(w => w.name)
const rearWheelNames = new Set(applyWheelSupplement(bikeRearWheels, SUPPLEMENT_REAR_WHEELS).map(w => w.name))
// `classifyWheel` looks rows up for front AND rear wheels, and some wheels
// are rear-only in the catalog (disc rears like "Zipp 808/Super9") - so the
// valid key domain is the union of both lists.
const anyWheelNames = [...new Set([...frontWheelNames, ...rearWheelNames])]

// Supplement staleness: the runtime merge silently prefers upstream on any
// name/id collision, so a zwift-data release can never break the app - but
// the moment upstream ships a supplemented wheel, its entry here is dead
// weight (and a *near-miss* name spelling would leave BOTH wheels in the
// catalog). Fail the build with the exact cleanup instruction instead of
// letting either state linger.
for (const [label, supplement, upstream] of [
  ['SUPPLEMENT_FRONT_WHEELS', SUPPLEMENT_FRONT_WHEELS, bikeFrontWheels],
  ['SUPPLEMENT_REAR_WHEELS', SUPPLEMENT_REAR_WHEELS, bikeRearWheels]
]) {
  const upstreamByNormalized = new Map(upstream.map(w => [normalize(w.name), w]))
  const upstreamById = new Map(upstream.map(w => [w.id, w]))
  for (const wheel of supplement) {
    const byId = upstreamById.get(wheel.id)
    const byName = upstreamByNormalized.get(normalize(wheel.name))
    if (!byId && !byName) continue
    const upstreamName = (byId ?? byName).name
    if (upstreamName === wheel.name) {
      errors.push(`${label}: zwift-data now ships ${JSON.stringify(wheel.name)} - delete its supplement entry`)
    } else {
      errors.push(`${label}: zwift-data now ships supplement entry ${JSON.stringify(wheel.name)} (id ${wheel.id}) under the name ${JSON.stringify(upstreamName)} - delete the supplement entry and re-key any speed data/garage identity on the upstream spelling - first differing span:\n${diffSpan(wheel.name, upstreamName)}`)
    }
  }
}
const frameNames = bikeFrames.map(f => f.name)

checkKeys('WHEEL_SPEED_DATA', Object.keys(WHEEL_SPEED_DATA), anyWheelNames)
checkKeys('FRAME_SPEED_DATA', Object.keys(FRAME_SPEED_DATA), frameNames)
checkKeys('TT_FRAME_SPEED_DATA', Object.keys(TT_FRAME_SPEED_DATA), frameNames)
checkKeys('FRAME_UPGRADE_SCHEMES', Object.keys(FRAME_UPGRADE_SCHEMES), frameNames)

// TT_FRAME_SPEED_DATA rows are measured against the "Zwift TT" baseline, so a
// road frame's row landing in the TT table (or vice versa) corrupts every
// score derived from it. `classifyBikeFrame` routes on `isTT` plus a name
// check - mirror the same test here.
const ttByName = new Map(bikeFrames.map(f => [f.name, f.isTT || /\btt\b/i.test(f.name)]))
for (const key of Object.keys(TT_FRAME_SPEED_DATA)) {
  if (ttByName.get(key) === false) errors.push(`TT_FRAME_SPEED_DATA: ${JSON.stringify(key)} is not a TT-classified frame - its row would never be read (only the tt branch reads this table)`)
}
for (const key of Object.keys(FRAME_SPEED_DATA)) {
  if (ttByName.get(key) === true) errors.push(`FRAME_SPEED_DATA: ${JSON.stringify(key)} is a TT-classified frame - its row would never be read (only the standard branch reads this table)`)
}

// Per-frame measured stage curves (`flatGapSecByStage`/`climbGapSecByStage`,
// imported by scripts/upgrade-levels/import-stage-curves.mjs) duplicate the
// `*0`/`*5` endpoints by design so the endpoint fields stay the single
// authoritative anchor. A curve whose endpoints drift from its row's fields
// means one of the two was edited by hand - fail the build rather than let
// levels 0/5 and 1-4 disagree about the same bike.
let stageCurveCount = 0
for (const [label, table] of [['FRAME_SPEED_DATA', FRAME_SPEED_DATA], ['TT_FRAME_SPEED_DATA', TT_FRAME_SPEED_DATA]]) {
  for (const [name, sample] of Object.entries(table)) {
    const pairs = [['flatGapSecByStage', sample.flatGapSec0, sample.flatGapSec5], ['climbGapSecByStage', sample.climbGapSec0, sample.climbGapSec5]]
    if (!sample.flatGapSecByStage !== !sample.climbGapSecByStage) {
      errors.push(`${label}: ${JSON.stringify(name)} has only one of flatGapSecByStage/climbGapSecByStage - the sheet always stage-tests both courses together`)
    }
    for (const [field, gap0, gap5] of pairs) {
      const curve = sample[field]
      if (!curve) continue
      stageCurveCount++
      if (curve.length !== 6) errors.push(`${label}: ${JSON.stringify(name)} ${field} has ${curve.length} stages, expected 6 (stage 0-5)`)
      if (curve[0] !== gap0) errors.push(`${label}: ${JSON.stringify(name)} ${field}[0] is ${curve[0]} but the row's stage-0 field says ${gap0}`)
      if (curve[curve.length - 1] !== gap5) errors.push(`${label}: ${JSON.stringify(name)} ${field}[5] is ${curve[curve.length - 1]} but the row's stage-5 field says ${gap5}`)
    }
  }
}

// Held-out validation blocks (`at150W` on frames and wheels, `onTtFrame` on
// wheels - imported by scripts/zwiftinsider/import-validation-gaps.mjs, read
// only by the golden tests in physics/equipment.test.ts). Two things can go
// wrong with them and neither shows up as a type error:
//   - a partial block (the importer writes all-or-nothing; a hand edit can
//     leave half a block behind)
//   - a 150 W number landing in a 300 W field, or the other way round - the
//     sheet's two power rows sit next to each other and look alike. The
//     reference rows are pinned to the sheet's values for both powers, and
//     no other row may carry the same tuple at both powers (a bike's gaps
//     are never power-invariant).
const REFERENCE_ROWS = [
  ['FRAME_SPEED_DATA', FRAME_SPEED_DATA['Zwift Carbon'], { flatGapSec0: 0, flatGapSec5: 26.5, climbGapSec0: 0, climbGapSec5: 36.9 }, { flatGapSec0: 0, flatGapSec5: 35.4, climbGapSec0: 0, climbGapSec5: 38.6 }],
  ['TT_FRAME_SPEED_DATA', TT_FRAME_SPEED_DATA['Zwift TT'], { flatGapSec0: 0, flatGapSec5: 45.6, climbGapSec0: 0, climbGapSec5: 26.6 }, { flatGapSec0: 0, flatGapSec5: 53.3, climbGapSec0: 0, climbGapSec5: 25.9 }],
  ['WHEEL_SPEED_DATA', WHEEL_SPEED_DATA['Zwift 32mm Carbon'], { flatGapSec: 0, climbGapSec: 0 }, { flatGapSec: 0, climbGapSec: 0 }]
]
for (const [label, sample, at300W, at150W] of REFERENCE_ROWS) {
  for (const [field, expected] of Object.entries(at300W)) {
    if (sample?.[field] !== expected) errors.push(`${label}: the reference row's 300 W ${field} is ${sample?.[field]}, the sheet says ${expected} - is a 150 W value in a 300 W field?`)
  }
  for (const [field, expected] of Object.entries(at150W)) {
    if (sample?.at150W?.[field] !== expected) errors.push(`${label}: the reference row's at150W.${field} is ${sample?.at150W?.[field]}, the sheet says ${expected} - is a 300 W value in the 150 W block?`)
  }
}
if (WHEEL_SPEED_DATA['Zwift 32mm Carbon']?.onTtFrame?.flatGapSec !== 0 || WHEEL_SPEED_DATA['Zwift 32mm Carbon']?.onTtFrame?.climbGapSec !== 0) {
  errors.push('WHEEL_SPEED_DATA: the reference wheel\'s onTtFrame block must read 0/0 - it IS the TT-frame baseline')
}

let validationBlockCount = 0
const tuple = (sample, fields) => fields.map(f => sample?.[f])
for (const [label, table, fields] of [
  ['FRAME_SPEED_DATA', FRAME_SPEED_DATA, ['flatGapSec0', 'flatGapSec5', 'climbGapSec0', 'climbGapSec5']],
  ['TT_FRAME_SPEED_DATA', TT_FRAME_SPEED_DATA, ['flatGapSec0', 'flatGapSec5', 'climbGapSec0', 'climbGapSec5']],
  ['WHEEL_SPEED_DATA', WHEEL_SPEED_DATA, ['flatGapSec', 'climbGapSec']]
]) {
  const isReference = name => name === 'Zwift Carbon' || name === 'Zwift TT' || name === 'Zwift 32mm Carbon'
  for (const [name, sample] of Object.entries(table)) {
    for (const block of ['at150W', 'onTtFrame']) {
      if (!(block in sample)) continue
      validationBlockCount++
      const values = tuple(sample[block], fields)
      if (values.some(v => typeof v !== 'number' || !Number.isFinite(v))) {
        errors.push(`${label}: ${JSON.stringify(name)} ${block} is incomplete (${JSON.stringify(sample[block])}) - the importer writes all ${fields.length} fields or nothing`)
      } else if (!isReference(name) && values.every((v, i) => v === sample[fields[i]])) {
        errors.push(`${label}: ${JSON.stringify(name)} ${block} repeats the row's 300 W values exactly - a bike's gaps are never power-invariant, so one of the two was pasted into the other`)
      }
    }
  }
}

// Classifier special-case sets (exported by their modules for exactly this
// check - a name here that drifts from the catalog silently stops
// special-casing anything).
const { FIXED_WHEEL_FRAMES, ROAD_HALO_FRAMES, PURCHASABLE_HALO_FRAMES } = loadSharedModule('shared/utils/classifyBikeFrame.ts')
const { INTEGRATED_ONLY_WHEELS } = loadSharedModule('shared/utils/wheelsets.ts')
const fixedWheelFrames = [...FIXED_WHEEL_FRAMES]
const roadHaloFrames = [...ROAD_HALO_FRAMES]
const purchasableHaloFrames = [...PURCHASABLE_HALO_FRAMES]
const integratedOnlyWheels = [...INTEGRATED_ONLY_WHEELS]

checkKeys('FIXED_WHEEL_FRAMES', fixedWheelFrames, frameNames)
checkKeys('ROAD_HALO_FRAMES', roadHaloFrames, frameNames)
checkKeys('PURCHASABLE_HALO_FRAMES', purchasableHaloFrames, frameNames)
checkKeys('INTEGRATED_ONLY_WHEELS (front)', integratedOnlyWheels, frontWheelNames)
for (const name of integratedOnlyWheels) {
  if (!rearWheelNames.has(name)) errors.push(`INTEGRATED_ONLY_WHEELS: ${JSON.stringify(name)} is not a bikeRearWheels name - the exclusion would only cover the front wheel`)
}

// A warning, not an error: an unlocalized placeholder name is an upstream
// gap (`getFrames()` drops it, see `UNLOCALIZED_FRAME_NAME`), and failing the
// build on it would block every deploy until zwift-data ships the string.
for (const frame of bikeFrames) {
  if (UNLOCALIZED_FRAME_NAME.test(frame.name)) {
    console.warn(`WARN: zwift-data frame ${frame.id} has an unlocalized placeholder name ${JSON.stringify(frame.name)} - hidden from the catalog until upstream ships the real name`)
  }
}

if (errors.length) {
  console.error(`validate-speed-data: ${errors.length} error(s)\n`)
  for (const e of errors) console.error(`ERROR: ${e}\n`)
  process.exit(1)
}
console.log(`validate-speed-data: OK (${Object.keys(WHEEL_SPEED_DATA).length} wheel rows, ${Object.keys(FRAME_SPEED_DATA).length + Object.keys(TT_FRAME_SPEED_DATA).length} frame rows, ${stageCurveCount} stage curves, ${Object.keys(FRAME_UPGRADE_SCHEMES).length} schemes, ${validationBlockCount} validation blocks, ${fixedWheelFrames.length + roadHaloFrames.length + purchasableHaloFrames.length + integratedOnlyWheels.length} special-case names)`)
