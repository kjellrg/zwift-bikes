#!/usr/bin/env node
// Checks that shipped race draft mode still behaves the way the calibration in
// docs/race-drafting.md says it does. Needs no dataset - every check here is
// against the code and the route catalog, so it runs anywhere:
//
//   node scripts/race-draft/validate-race-draft.mjs
//
// What it guards, and why each check exists:
//
//   1. The transform's anchor values. `RACE_DRAFT_SAVING` is only valid under
//      `racePowerScaleAtSpeed`'s exact formula (see that function) - the
//      constant was bisected per rider under it. A well-meant "improvement" to
//      the curve or the application point silently invalidates 31%, and these
//      anchors are what turns that into a failure instead of a shipped error.
//   2. The cheap estimate tracking the simulator. `estimateFinishTimeSec` is
//      the ranking key over the whole ~11k-combo pool while `simulateRoute`
//      produces the displayed time; if the two disagree about what race mode is
//      worth, the displayed order drifts from the ranked order.
//   3. The magnitudes docs §5 and §9 claim: ~12-13% faster than solo on the
//      flat, ~8-10% rolling, single digits on Alpe du Zwift, and monotone in
//      between. This is the check that would catch a draft benefit applied
//      without the speed-dependence curve, which looks fine on a flat route and
//      is badly wrong on a climb.
//   4. Solo mode untouched: with no draft argument, both models must return
//      exactly what they return with race mode absent from the codebase.
//   5. Every route in the catalog, in race mode, producing finite speeds - no
//      exceptions, no NaN.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSharedModule } from '../route-surfaces/loadShared.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const verbose = process.argv.includes('--verbose')

const { getRouteBySlug, getRoutesWithMeta } = loadSharedModule('shared/utils/catalog.ts')
const { getWheelsets } = loadSharedModule('shared/utils/wheelsets.ts')
const { classifyBikeFrame } = loadSharedModule('shared/utils/classifyBikeFrame.ts')
const { simulateRoute } = loadSharedModule('shared/utils/physics/simulator.ts')
const { geometryForRouteLaps } = loadSharedModule('shared/utils/physics/routeGeometry.ts')
const { computeRouteSurfaceSpeedProfile } = loadSharedModule('shared/utils/physics/routeSurfaceSpeedProfile.ts')
const { speedForPower } = loadSharedModule('shared/utils/physics/forces.ts')
const {
  DRAFT_SCALE_REFERENCE_SPEED_MPS,
  draftSavingsSpeedScale,
  raceGroupSpeedMps,
  racePowerScaleAtSpeed,
  RACE_DRAFT_SAVING
} = loadSharedModule('shared/utils/physics/draft.ts')
const { estimateFinishTimeSec } = loadSharedModule('shared/utils/finishTime.ts')

const errors = []
const check = (ok, message) => {
  if (!ok) errors.push(message)
}
const close = (actual, expected, tolerance) => Math.abs(actual - expected) <= tolerance

// The reference rider every magnitude below is quoted for: 75 kg, 183 cm,
// 3.0 W/kg. Deliberately the site's own default profile, so a number printed
// here is a number a visitor can reproduce by opening the page.
const RIDER = { weightKg: 75, heightCm: 183, powerW: 225 }
const WKG = RIDER.powerW / RIDER.weightKg
// The doc's "typical" equipment scenario - the median measured frame and
// wheelset, the same pair the calibration solved against.
const FRAME_NAME = 'Specialized Tarmac Pro'
const WHEELSET_NAME = 'Zipp 353 NSW'

const { bikeFrames } = await import('zwift-data')
const rawFrame = bikeFrames.find(f => f.name === FRAME_NAME)
if (!rawFrame) {
  console.error(`validate-race-draft: frame ${JSON.stringify(FRAME_NAME)} is no longer in the zwift-data catalog - pick a new reference frame.`)
  process.exit(1)
}
const frame = classifyBikeFrame(rawFrame, 5)
const wheelset = getWheelsets().find(w => w.name === WHEELSET_NAME)
if (!wheelset) {
  console.error(`validate-race-draft: wheelset ${JSON.stringify(WHEELSET_NAME)} is no longer in the catalog - pick a new reference wheelset.`)
  process.exit(1)
}

// ---------------------------------------------------------------- 1. anchors

check(RACE_DRAFT_SAVING === 0.31, `RACE_DRAFT_SAVING is ${RACE_DRAFT_SAVING}, expected 0.31 - if this was a deliberate recalibration, update docs/race-drafting.md §5 and this check together`)

const flatFactor = racePowerScaleAtSpeed(DRAFT_SCALE_REFERENCE_SPEED_MPS)
check(close(flatFactor, 1 / (1 - RACE_DRAFT_SAVING), 1e-9),
  `racePowerScaleAtSpeed at the reference speed is ${flatFactor.toFixed(6)}, expected ${(1 / (1 - RACE_DRAFT_SAVING)).toFixed(6)} - the scale must be exactly 1.0 there`)

const climbFactor = racePowerScaleAtSpeed(5)
const climbExpected = 1 / (1 - RACE_DRAFT_SAVING * (5 / DRAFT_SCALE_REFERENCE_SPEED_MPS) ** 2)
check(close(climbFactor, climbExpected, 1e-9), `racePowerScaleAtSpeed(5 m/s) is ${climbFactor.toFixed(4)}, expected ${climbExpected.toFixed(4)}`)
check(close(climbFactor, 1.06, 0.005), `racePowerScaleAtSpeed(5 m/s) is ${climbFactor.toFixed(4)}; docs §9 quotes ~1.060 (an 18 km/h climb keeps almost none of the draft)`)

check(racePowerScaleAtSpeed(0) === 1, `racePowerScaleAtSpeed(0) is ${racePowerScaleAtSpeed(0)}, expected exactly 1 - a stationary rider gets no draft`)

// The cap is what keeps the descent case finite: without it the v^2 scale would
// eventually drive the saving to 1 and the factor to infinity.
const capFactor = 1 / (1 - RACE_DRAFT_SAVING * 1.4)
for (const speedMps of [20, 30, 100, 1000]) {
  const factor = racePowerScaleAtSpeed(speedMps)
  check(factor <= capFactor + 1e-9, `racePowerScaleAtSpeed(${speedMps}) is ${factor.toFixed(4)}, above the ${capFactor.toFixed(4)} cap that draftSavingsSpeedScale's 1.4 ceiling implies`)
  check(Number.isFinite(factor), `racePowerScaleAtSpeed(${speedMps}) is not finite`)
}
check(close(racePowerScaleAtSpeed(1000), capFactor, 1e-9), `racePowerScaleAtSpeed at extreme speed is ${racePowerScaleAtSpeed(1000).toFixed(4)}, expected the ${capFactor.toFixed(4)} cap`)

let previousFactor = 0
for (let speedMps = 0; speedMps <= 25; speedMps += 0.25) {
  const factor = racePowerScaleAtSpeed(speedMps)
  check(factor >= previousFactor - 1e-12, `racePowerScaleAtSpeed is not monotone in speed: ${speedMps} m/s gives ${factor.toFixed(6)} after ${previousFactor.toFixed(6)}`)
  previousFactor = factor
}

// The `saving` parameter is the adjustability hook the doc's rejected
// per-category constants would use - if it stops being honoured, that door is
// quietly closed.
check(racePowerScaleAtSpeed(DRAFT_SCALE_REFERENCE_SPEED_MPS, 0) === 1, 'racePowerScaleAtSpeed with saving=0 must be exactly 1 (this is what makes the solo comparison honest)')
check(close(racePowerScaleAtSpeed(DRAFT_SCALE_REFERENCE_SPEED_MPS, 0.25), 1 / 0.75, 1e-9), 'racePowerScaleAtSpeed ignores its saving argument')

// `raceGroupSpeedMps` is a fixed point, so check it actually converged: at the
// speed it returns, the power the rider is worth must reproduce that speed.
for (const grade of [0, 0.02, 0.06, -0.04]) {
  const speedMps = raceGroupSpeedMps(RIDER.powerW, RIDER.weightKg + 7, grade, 0.004, 0.32)
  const residual = speedForPower(RIDER.powerW * racePowerScaleAtSpeed(speedMps), RIDER.weightKg + 7, grade, 0.004, 0.32)
  check(close(speedMps, residual, 0.02), `raceGroupSpeedMps has not converged at ${(grade * 100).toFixed(0)}%: returns ${speedMps.toFixed(3)} m/s, one more iteration gives ${residual.toFixed(3)}`)
  const soloSpeed = speedForPower(RIDER.powerW, RIDER.weightKg + 7, grade, 0.004, 0.32)
  check(speedMps > soloSpeed, `raceGroupSpeedMps at ${(grade * 100).toFixed(0)}% is not faster than solo (${speedMps.toFixed(3)} vs ${soloSpeed.toFixed(3)} m/s)`)
}

// ------------------------------------------- 2/3. magnitudes and agreement

/**
 * The route archetypes docs §9 pins the shipped magnitudes to, with the band
 * each one has to land in. The bands are wider than the measured values on
 * purpose: they are here to catch a draft applied without the speed curve (or a
 * curve applied twice), not to freeze the third decimal of the simulator.
 *
 * Note the *time* gain is always smaller than the power saving it comes from,
 * and by a lot: on the flat, speed goes as roughly the cube root of power, so
 * even the full 31% saving is worth only ~11.7% of finish time. The reference
 * rider below also rides the flat at ~40 km/h rather than the 42 km/h the curve
 * is normalised to, which trims another few tenths. A 12-13% time gain is a
 * strong rider's number, not this one's - see the rider-strength sweep below.
 */
const ARCHETYPES = [
  { slug: 'tempus-fugit', label: 'flat (1.5 m/km)', minGainPct: 10, maxGainPct: 13 },
  { slug: 'hell-of-the-north', label: 'flat circuit (12 m/km)', minGainPct: 9, maxGainPct: 12.5 },
  { slug: 'rolling-highlands', label: 'rolling (8 m/km)', minGainPct: 9.5, maxGainPct: 13 },
  { slug: 'mayan-san-remo', label: 'rolling (10 m/km)', minGainPct: 8, maxGainPct: 12 },
  { slug: 'three-sisters-rev', label: 'hilly (19 m/km)', minGainPct: 5.5, maxGainPct: 10 },
  { slug: 'road-to-sky', label: 'sustained climb (60 m/km)', minGainPct: 2, maxGainPct: 6 },
  { slug: 'ven-top', label: 'sustained climb (74 m/km)', minGainPct: 1.5, maxGainPct: 5.5 }
]

const rows = []
for (const archetype of ARCHETYPES) {
  const route = getRouteBySlug(archetype.slug)
  if (!route) {
    errors.push(`archetype route ${JSON.stringify(archetype.slug)} is no longer in the catalog - pick a replacement with a similar climb ratio`)
    continue
  }
  const geometry = geometryForRouteLaps(route, 1)
  const soloSec = simulateRoute({ rider: RIDER, frame, wheelset, geometry }).elapsedSec
  const raceSec = simulateRoute({ rider: RIDER, frame, wheelset, geometry, powerScaleAtSpeed: racePowerScaleAtSpeed }).elapsedSec
  const estimateSoloSec = estimateFinishTimeSec(route, frame, wheelset, RIDER.weightKg, RIDER.heightCm, WKG, 1)
  const estimateRaceSec = estimateFinishTimeSec(route, frame, wheelset, RIDER.weightKg, RIDER.heightCm, WKG, 1, { mode: 'race' })

  const gainPct = (1 - raceSec / soloSec) * 100
  const estimateGainPct = (1 - estimateRaceSec / estimateSoloSec) * 100
  rows.push({ ...archetype, distanceKm: geometry.totalDistanceM / 1000, climbRatio: route.terrain.climbRatio, soloSec, raceSec, gainPct, estimateGainPct })

  check(raceSec < soloSec, `${archetype.slug}: race mode is not faster than solo (${raceSec.toFixed(1)}s vs ${soloSec.toFixed(1)}s)`)
  check(gainPct >= archetype.minGainPct && gainPct <= archetype.maxGainPct,
    `${archetype.slug} (${archetype.label}): race mode is ${gainPct.toFixed(2)}% faster than solo, outside the expected ${archetype.minGainPct}-${archetype.maxGainPct}%`)
  // The two models are structurally different (per-timestep simulation vs a
  // uniform-average-grade closed form), so they are never going to agree to the
  // second - but they must agree about what the draft is worth, or the ranking
  // key and the displayed time part company.
  check(Math.abs(gainPct - estimateGainPct) <= 3.5,
    `${archetype.slug}: the cheap estimate says race mode saves ${estimateGainPct.toFixed(2)}% while the simulator says ${gainPct.toFixed(2)}% - more than 3.5 points apart, so the full-pool ranking no longer tracks the displayed times`)
}

// Monotone in climbing: the whole point of routing race mode through
// `draftSavingsSpeedScale` rather than a flat constant.
const flatRow = rows.find(row => row.slug === 'tempus-fugit')
const rollingRow = rows.find(row => row.slug === 'mayan-san-remo')
const climbRow = rows.find(row => row.slug === 'road-to-sky')
if (flatRow && rollingRow && climbRow) {
  check(flatRow.gainPct > rollingRow.gainPct && rollingRow.gainPct > climbRow.gainPct,
    `the race draft benefit is not monotone in climbing: flat ${flatRow.gainPct.toFixed(2)}%, rolling ${rollingRow.gainPct.toFixed(2)}%, Alpe ${climbRow.gainPct.toFixed(2)}%`)
}

// The same flat route at four rider strengths, which is where the speed
// dependence is visible as something other than a formula: a D-grade rider
// racing at 33 km/h keeps only ~0.8 of the flat draft, an A rider at 45 km/h
// slightly more than all of it. This is also the honest answer to "is race mode
// worth 12%?" - it depends on how fast the bunch is moving.
const STRENGTH_ROUTE = 'tempus-fugit'
const strengthRows = []
{
  const route = getRouteBySlug(STRENGTH_ROUTE)
  const geometry = route ? geometryForRouteLaps(route, 1) : undefined
  for (const wkg of [2.0, 2.5, 3.0, 3.5, 4.0, 4.5]) {
    if (!geometry) break
    const rider = { weightKg: RIDER.weightKg, heightCm: RIDER.heightCm, powerW: wkg * RIDER.weightKg }
    const soloSec = simulateRoute({ rider, frame, wheelset, geometry }).elapsedSec
    const raceSec = simulateRoute({ rider, frame, wheelset, geometry, powerScaleAtSpeed: racePowerScaleAtSpeed }).elapsedSec
    strengthRows.push({ wkg, soloSec, raceSec, gainPct: (1 - raceSec / soloSec) * 100, raceSpeedKmh: (geometry.totalDistanceM / raceSec) * 3.6 })
  }
  for (let i = 1; i < strengthRows.length; i++) {
    check(strengthRows[i].gainPct > strengthRows[i - 1].gainPct,
      `the race benefit is not increasing with rider strength on ${STRENGTH_ROUTE}: ${strengthRows[i - 1].wkg} W/kg gains ${strengthRows[i - 1].gainPct.toFixed(2)}%, ${strengthRows[i].wkg} W/kg gains ${strengthRows[i].gainPct.toFixed(2)}%`)
  }
}

// -------------------------------------------------------- 4. solo untouched

// Race mode must be inert unless it is asked for. Anything that leaks a draft
// into the solo path corrupts every number on the site, including the equipment
// data itself (see the warning in draft.ts).
for (const archetype of ARCHETYPES.slice(0, 3)) {
  const route = getRouteBySlug(archetype.slug)
  if (!route) continue
  const geometry = geometryForRouteLaps(route, 1)
  const a = simulateRoute({ rider: RIDER, frame, wheelset, geometry }).elapsedSec
  const b = simulateRoute({ rider: RIDER, frame, wheelset, geometry, powerScaleAtSpeed: undefined }).elapsedSec
  check(a === b, `${archetype.slug}: passing powerScaleAtSpeed=undefined changed the simulated time (${a} vs ${b})`)
  const c = estimateFinishTimeSec(route, frame, wheelset, RIDER.weightKg, RIDER.heightCm, WKG, 1)
  const d = estimateFinishTimeSec(route, frame, wheelset, RIDER.weightKg, RIDER.heightCm, WKG, 1, undefined)
  check(c === d, `${archetype.slug}: passing draft=undefined changed the estimate (${c} vs ${d})`)
}

// -------------------------------------------------------- 5. all-route sweep

let swept = 0
let skipped = 0
for (const route of getRoutesWithMeta()) {
  const hasChartData = (route.terrain.elevationProfile?.length ?? 0) >= 2 && (route.surface.segments?.length ?? 0) > 0
  if (!hasChartData) {
    skipped++
    continue
  }
  let profile
  try {
    profile = computeRouteSurfaceSpeedProfile(route, frame, wheelset, RIDER.weightKg, RIDER.heightCm, WKG, { mode: 'race' })
  } catch (error) {
    errors.push(`${route.slug}: the speed profile threw in race mode - ${error.message}`)
    continue
  }
  if (!profile) {
    errors.push(`${route.slug}: has chart data but the speed profile came back undefined in race mode`)
    continue
  }
  swept++
  const samples = [...profile.speedSamples, ...(profile.soloComparison?.speedSamples ?? [])]
  for (const sample of samples) {
    if (!Number.isFinite(sample.avgSpeedKmh) || sample.avgSpeedKmh <= 0) {
      errors.push(`${route.slug}: non-finite or non-positive speed sample (${sample.avgSpeedKmh} km/h at ${Math.round(sample.distanceM)} m) in race mode`)
      break
    }
  }
  if (!profile.soloComparison) {
    errors.push(`${route.slug}: race mode produced no solo comparison series, so the chart and the headline time can disagree`)
    continue
  }
  // The chart's own two lines have to agree with the headline: drafted faster
  // than solo, and by a margin the speed curve can actually produce.
  if (profile.overallAvgSpeedKmh <= profile.soloComparison.overallAvgSpeedKmh) {
    errors.push(`${route.slug}: race mode is not faster than solo on the speed chart (${profile.overallAvgSpeedKmh} vs ${profile.soloComparison.overallAvgSpeedKmh} km/h)`)
  }
  const chartGainPct = (1 - profile.soloComparison.overallAvgSpeedKmh / profile.overallAvgSpeedKmh) * 100
  if (chartGainPct > 20) errors.push(`${route.slug}: race mode is ${chartGainPct.toFixed(1)}% faster than solo on the speed chart, beyond anything the ${(RACE_DRAFT_SAVING * 1.4 * 100).toFixed(1)}% capped saving can produce`)
  if (profile.soloComparison.frontPullPowerW !== undefined) {
    errors.push(`${route.slug}: race mode reported a TTT front-pull wattage (${profile.soloComparison.frontPullPowerW} W) - race mode has no positions`)
  }
}

// ----------------------------------------------------------------- report

console.log(`Race draft mode: saving ${(RACE_DRAFT_SAVING * 100).toFixed(0)}%, reference speed ${DRAFT_SCALE_REFERENCE_SPEED_MPS} m/s (${(DRAFT_SCALE_REFERENCE_SPEED_MPS * 3.6).toFixed(0)} km/h)`)
console.log(`Reference rider: ${RIDER.weightKg} kg, ${RIDER.heightCm} cm, ${WKG.toFixed(1)} W/kg (${RIDER.powerW} W) on ${FRAME_NAME} + ${WHEELSET_NAME} at level 5\n`)
console.log('route                  m/km      km      solo      race    saved   gain%   est%   scale@race')
for (const row of rows) {
  const raceSpeedMps = (row.distanceKm * 1000) / row.raceSec
  console.log(
    `${row.slug.padEnd(22)} ${row.climbRatio.toFixed(1).padStart(4)} ${row.distanceKm.toFixed(1).padStart(7)} `
    + `${row.soloSec.toFixed(0).padStart(9)} ${row.raceSec.toFixed(0).padStart(9)} ${(row.soloSec - row.raceSec).toFixed(0).padStart(8)} `
    + `${row.gainPct.toFixed(2).padStart(7)} ${row.estimateGainPct.toFixed(2).padStart(6)} ${draftSavingsSpeedScale(raceSpeedMps).toFixed(2).padStart(12)}`
  )
}
console.log(`\n${STRENGTH_ROUTE}, by rider strength`)
console.log('  W/kg   race km/h      solo      race    gain%   draft scale')
for (const row of strengthRows) {
  console.log(`  ${row.wkg.toFixed(1)}   ${row.raceSpeedKmh.toFixed(1).padStart(9)} ${row.soloSec.toFixed(0).padStart(9)} ${row.raceSec.toFixed(0).padStart(9)} ${row.gainPct.toFixed(2).padStart(8)} ${draftSavingsSpeedScale(row.raceSpeedKmh / 3.6).toFixed(2).padStart(13)}`)
}
console.log(`\nSpeed-chart sweep: ${swept} routes in race mode (${skipped} without measured elevation+surface data, skipped)`)

if (errors.length) {
  console.error(`\nvalidate-race-draft: ${errors.length} error(s)\n`)
  for (const error of errors) console.error(`ERROR: ${error}\n`)
  process.exit(1)
}
console.log(`validate-race-draft: OK (${rows.length} archetypes, ${swept} routes swept, ${path.basename(__dirname)}/README.md documents recalibration)`)
if (verbose) console.log(`\nAnchors: flat factor ${flatFactor.toFixed(4)}, 18 km/h factor ${climbFactor.toFixed(4)}, descent cap ${capFactor.toFixed(4)}`)
