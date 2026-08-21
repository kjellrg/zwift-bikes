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
//   - an `INTEGRATED_ONLY_WHEELS` name that isn't in both wheel catalogs
//   - a `wheelSupplement.ts` entry that zwift-data now ships (by id or
//     name) - the supplement only bridges the gap until upstream catches up
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

if (errors.length) {
  console.error(`validate-speed-data: ${errors.length} error(s)\n`)
  for (const e of errors) console.error(`ERROR: ${e}\n`)
  process.exit(1)
}
console.log(`validate-speed-data: OK (${Object.keys(WHEEL_SPEED_DATA).length} wheel rows, ${Object.keys(FRAME_SPEED_DATA).length + Object.keys(TT_FRAME_SPEED_DATA).length} frame rows, ${Object.keys(FRAME_UPGRADE_SCHEMES).length} schemes, ${fixedWheelFrames.length + roadHaloFrames.length + purchasableHaloFrames.length + integratedOnlyWheels.length} special-case names)`)
