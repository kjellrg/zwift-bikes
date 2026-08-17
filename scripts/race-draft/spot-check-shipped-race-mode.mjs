#!/usr/bin/env node
// Does the SHIPPED race mode reproduce the races it was calibrated on?
//
//   node scripts/race-draft/spot-check-shipped-race-mode.mjs
//   node scripts/race-draft/spot-check-shipped-race-mode.mjs --race hell-of-the-north
//   node scripts/race-draft/spot-check-shipped-race-mode.mjs --all
//
// `analyze-field-draft.mjs` answers the calibration question - what saving would
// each rider's finish time imply? This answers the shipping question, which is
// not the same one: taking every bunch finisher's own average power and weight,
// and simulating them through `racePowerScaleAtSpeed` exactly as the recommend
// endpoints do, how close does the app's predicted finish time land to what they
// actually rode?
//
// It is the check that closes the loop, because it exercises the real code path
// rather than the solver. A refactor that quietly changed where the power scale
// is applied would still produce a plausible calibration report and would fail
// here.
//
// Only the five tarmac-ish constant-setting races count by default - the dirt,
// sustained-climb and distance-ambiguous races are excluded from the constant
// for the reasons in docs/race-drafting.md §5, so holding the shipped default to
// them would be measuring the exclusion rather than the code. `--all` reports
// every race anyway, unpooled, which is how the exclusions stay visible.
//
// Needs the LOCAL-ONLY dataset (see README.md, "Where the data lives").
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSharedModule } from '../route-surfaces/loadShared.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const onlyRace = args.includes('--race') ? args[args.indexOf('--race') + 1] : undefined
const showAll = args.includes('--all')

/** The races that set the constant - docs §5, "The seven clean races" minus the climb-evidence and dirt rows. */
const CONSTANT_RACES = new Set(['la-boucle', 'hell-of-the-north', 'rolling-highlands', 'sprinters-playground', 'braek-fast-crits-and-grits'])
/** What the pooled median error has to stay inside for this to be called a pass. Docs §5 measures a ~2.7% MAE floor from position variance alone, so anything much tighter than this would be a fake test - and anything looser would not notice the power scale being dropped. */
const POOLED_MEDIAN_TOLERANCE_PCT = 2
/** Finishers within this many seconds of each other rode to the line together - same rule as the analyzer. */
const GROUP_GAP_SEC = 5
const MIN_BUNCH_SIZE = 3

const datasetPath = path.join(__dirname, 'field-results.json')
if (!existsSync(datasetPath)) {
  console.error(`spot-check-shipped-race-mode: ${datasetPath} not found.

The per-rider dataset is LOCAL-ONLY and never committed. Build it with
parse-zwiftpower-paste.mjs (format: field-results.sample.json), or run
validate-race-draft.mjs instead - that one needs no dataset and covers the
anchors, the magnitudes and the whole route catalog.`)
  process.exit(1)
}

const { getRouteBySlug } = loadSharedModule('shared/utils/catalog.ts')
const { getWheelsets } = loadSharedModule('shared/utils/wheelsets.ts')
const { classifyBikeFrame } = loadSharedModule('shared/utils/classifyBikeFrame.ts')
const { simulateRoute } = loadSharedModule('shared/utils/physics/simulator.ts')
const { geometryForRouteLaps, prependWarmup } = loadSharedModule('shared/utils/physics/routeGeometry.ts')
const { racePowerScaleAtSpeed, RACE_DRAFT_SAVING } = loadSharedModule('shared/utils/physics/draft.ts')
const { bikeFrames } = await import('zwift-data')

// The doc's "typical" scenario: the median measured frame and wheelset. Not a
// hand-picked race bike - half a C/D field is not on one, and assuming a faster
// bike would credit the draft with speed the equipment produced.
const rawFrame = bikeFrames.find(f => f.name === 'Specialized Tarmac Pro')
const frame = classifyBikeFrame(rawFrame, 5)
const wheelset = getWheelsets().find(w => w.name === 'Zipp 353 NSW')
if (!frame || !wheelset) {
  console.error('spot-check-shipped-race-mode: the typical-equipment frame/wheelset is no longer in the catalog - update the scenario here and in analyze-field-draft.mjs together.')
  process.exit(1)
}

const median = (values) => {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  const middle = (sorted.length - 1) / 2
  return (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2
}

/** Same clustering as the analyzer: a rider is a bunch finisher if at least two others came to the line with them. */
function markBunchFinishes(riders) {
  const byCat = new Map()
  for (const rider of riders) {
    if (!byCat.has(rider.cat)) byCat.set(rider.cat, [])
    byCat.get(rider.cat).push(rider)
  }
  for (const group of byCat.values()) {
    group.sort((a, b) => a.timeSec - b.timeSec)
    let cluster = []
    const flush = () => {
      for (const rider of cluster) rider.bunch = cluster.length >= MIN_BUNCH_SIZE
      cluster = []
    }
    for (const rider of group) {
      const previous = cluster[cluster.length - 1]
      if (previous && rider.timeSec - previous.timeSec > GROUP_GAP_SEC) flush()
      cluster.push(rider)
    }
    flush()
  }
}

const dataset = JSON.parse(readFileSync(datasetPath, 'utf8'))
const pooledErrors = []
const rows = []

for (const [raceSlug, race] of Object.entries(dataset.races)) {
  if (onlyRace && raceSlug !== onlyRace) continue
  const counts = CONSTANT_RACES.has(raceSlug)
  if (!counts && !showAll && !onlyRace) continue

  const route = getRouteBySlug(race.routeSlug)
  if (!route) { console.error(`  skipped ${raceSlug}: route ${race.routeSlug} is not in the catalog`); continue }
  let geometry = geometryForRouteLaps(route, race.laps)
  // Same distance reconciliation as the analyzer: when the published event
  // distance is longer than route + lead-in, the difference is ridden as flat
  // tarmac ahead of the route.
  const extraM = (race.eventDistanceKm ?? 0) * 1000 - geometry.totalDistanceM
  if (extraM > 0) geometry = prependWarmup(geometry, extraM)

  const riders = race.riders.filter(rider => rider.weightKg)
  markBunchFinishes(riders)
  const bunch = riders.filter(rider => rider.bunch)
  if (bunch.length === 0) { rows.push({ raceSlug, counts, n: 0 }); continue }

  const errors = bunch.map((rider) => {
    const predictedSec = simulateRoute({
      rider: { weightKg: rider.weightKg, heightCm: rider.heightCm, powerW: rider.avgW },
      frame,
      wheelset,
      geometry,
      powerScaleAtSpeed: racePowerScaleAtSpeed
    }).elapsedSec
    return (predictedSec / rider.timeSec - 1) * 100
  })
  if (counts) pooledErrors.push(...errors)
  rows.push({
    raceSlug,
    counts,
    n: bunch.length,
    distanceKm: geometry.totalDistanceM / 1000,
    medianErrorPct: median(errors),
    maePct: errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length,
    within3Pct: (errors.filter(error => Math.abs(error) <= 3).length / errors.length) * 100
  })
}

console.log(`Shipped race mode (RACE_DRAFT_SAVING = ${(RACE_DRAFT_SAVING * 100).toFixed(0)}%) vs real bunch finishes, typical equipment`)
console.log('Positive median error = the app predicts SLOWER than the field actually rode.\n')
console.log('race                       n     km   median err     MAE   within 3%')
for (const row of rows) {
  if (row.n === 0) {
    console.log(`${row.raceSlug.padEnd(26)} ${String(row.n).padStart(3)}      -            -       -           -   (no bunch finish${row.counts ? '' : ', excluded from the constant'})`)
    continue
  }
  console.log(`${row.raceSlug.padEnd(26)} ${String(row.n).padStart(3)} ${row.distanceKm.toFixed(1).padStart(6)} `
    + `${`${row.medianErrorPct >= 0 ? '+' : ''}${row.medianErrorPct.toFixed(2)}%`.padStart(12)} ${`${row.maePct.toFixed(2)}%`.padStart(7)} ${`${row.within3Pct.toFixed(0)}%`.padStart(11)}`
    + (row.counts ? '' : '   (excluded from the constant)'))
}

if (pooledErrors.length === 0) {
  console.log('\nNo constant-setting race was in scope, so there is nothing to pool - rerun without --race, or with --all for the full picture.')
  process.exit(0)
}

const pooledMedian = median(pooledErrors)
const pooledMae = pooledErrors.reduce((sum, error) => sum + Math.abs(error), 0) / pooledErrors.length
const within3 = (pooledErrors.filter(error => Math.abs(error) <= 3).length / pooledErrors.length) * 100
console.log(`\nPooled over the constant-setting races: n=${pooledErrors.length}, median error ${pooledMedian >= 0 ? '+' : ''}${pooledMedian.toFixed(2)}%, MAE ${pooledMae.toFixed(2)}%, ${within3.toFixed(0)}% within 3%`)

if (Math.abs(pooledMedian) > POOLED_MEDIAN_TOLERANCE_PCT) {
  console.error(`\nspot-check-shipped-race-mode: pooled median error ${pooledMedian.toFixed(2)}% exceeds the +/-${POOLED_MEDIAN_TOLERANCE_PCT}% tolerance.`)
  console.error('Either the constant has drifted from the data (re-run analyze-field-draft.mjs and follow the >=1-point rule in README.md), or the power scale is no longer being applied the way the calibration assumed.')
  process.exit(1)
}
console.log('spot-check-shipped-race-mode: OK')
