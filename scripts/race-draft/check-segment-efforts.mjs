#!/usr/bin/env node
// Runs the shipped model against the local segment-effort set: for each
// recorded effort, simulate exactly the lap the Strava segment covers, at that
// rider's own average power over it, and report how far the prediction lands
// from the time they actually rode.
//
//   node scripts/race-draft/check-segment-efforts.mjs
//   node scripts/race-draft/check-segment-efforts.mjs --route 2919739330
//
// What makes this different from spot-check-shipped-race-mode.mjs: there is no
// distance to argue about. That script has to assume a ridden distance (route
// + lead-in, or whatever the organiser published) and a whole field's worth of
// equipment; this one takes a distance measured by the segment itself and one
// rider's own power over exactly that stretch. When the two disagree, this is
// the one to believe - see docs §5, "What sand turned out not to be", where a
// missing 2 km of event lead-in looked exactly like a 6% surface penalty.
//
// Two things it still cannot pin down, and both are reported as a band rather
// than hidden: the rider's bike and wheels (unknown, so every effort is run
// across stock/typical/fast) and the draft they sat in (a race effort is
// compared against race mode's field-calibrated saving, which is itself
// calibrated - so a race effort tests the draft model and the route model
// together, while a solo effort tests the route model alone).
//
// Needs the LOCAL-ONLY dataset - see README.md, "Where the data lives".
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSharedModule } from '../route-surfaces/loadShared.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const onlyRoute = args.includes('--route') ? args[args.indexOf('--route') + 1] : undefined

const datasetPath = path.join(__dirname, 'segment-efforts.json')
if (!existsSync(datasetPath)) {
  console.error(`check-segment-efforts: ${datasetPath} not found.

The segment-effort set is LOCAL-ONLY and never committed. Build it with
add-segment-effort.mjs (format: segment-efforts.sample.json):

  STRAVA_ACCESS_TOKEN=xxx node scripts/race-draft/add-segment-effort.mjs \\
    --activity <id> --weight <kg> --height <cm> --draft race \\
    --append ./scripts/race-draft/segment-efforts.json`)
  process.exit(1)
}

const { getRouteBySlug } = loadSharedModule('shared/utils/catalog.ts')
const { getWheelsets } = loadSharedModule('shared/utils/wheelsets.ts')
const { classifyBikeFrame } = loadSharedModule('shared/utils/classifyBikeFrame.ts')
const { simulateRoute } = loadSharedModule('shared/utils/physics/simulator.ts')
const { geometryForRouteLaps } = loadSharedModule('shared/utils/physics/routeGeometry.ts')
const { racePowerScaleAtSpeed, tttPowerScaleAtSpeed } = loadSharedModule('shared/utils/physics/draft.ts')
const { bikeFrames } = await import('zwift-data')

/** Same three setups the field analysis uses, so the two reports are comparable. */
const SCENARIOS = [
  { key: 'stock', frame: 'Zwift Carbon', wheels: 'Zwift 32mm Carbon' },
  { key: 'typical', frame: 'Specialized Tarmac Pro', wheels: 'Zipp 353 NSW' },
  { key: 'fast', frame: 'Cervelo S5', wheels: 'DTSwiss ARC 1100 DICUT 85/Disc' }
]
const FRAME_LEVEL = 5
/** Beyond this the model and reality disagree about something real, not about equipment. Matches the ~2.7% MAE floor the field races sit at, with room for the equipment band. */
const TOLERANCE_PCT = 4

const equipment = SCENARIOS.map((scenario) => {
  const raw = bikeFrames.find(f => f.name === scenario.frame)
  const wheelset = getWheelsets().find(w => w.name === scenario.wheels)
  if (!raw || !wheelset) {
    console.error(`check-segment-efforts: scenario ${scenario.key} names equipment that is no longer in the catalog - update SCENARIOS here and in analyze-field-draft.mjs together.`)
    process.exit(1)
  }
  return { ...scenario, frame: classifyBikeFrame(raw, FRAME_LEVEL), wheelset }
})

/**
 * The Strava segment covers the route's LAP, so the comparison has to be
 * against the lap alone.
 *
 * Built by asking for the route with NO lead-in, rather than by trimming the
 * lead-in off a full geometry. Trimming looks equivalent and is not:
 * `geometryForRouteLaps` feeds the lead-in from `splitMeasuredProfile`, which
 * carves the lead-in's shape out of the *lap's* measured profile - the profile
 * is the lap's own Strava segment, and there is no measured data for the
 * lead-in at all. So a trimmed geometry hands back a lap that is missing its
 * first `leadInDistance` of real terrain, stretched to full length. At the 85 m
 * `zwift-data` used to report for these routes that was invisible; at the
 * corrected 2.06 km it silently removed 13 m of climbing from Mech Isle
 * Mayhem's lap and made the model 1.4% too fast.
 */
function lapOnlyGeometry(route) {
  return geometryForRouteLaps({ ...route, leadInDistance: 0, leadInElevation: 0 }, 1)
}

const powerScaleFor = draft => draft === 'race' ? racePowerScaleAtSpeed : draft === 'ttt' ? tttPowerScaleAtSpeed : undefined

const dataset = JSON.parse(readFileSync(datasetPath, 'utf8'))
const efforts = dataset.efforts.filter(effort => !onlyRoute || effort.routeSlug === onlyRoute)
if (efforts.length === 0) {
  console.error(`check-segment-efforts: no efforts${onlyRoute ? ` on ${onlyRoute}` : ''} in the set.`)
  process.exit(1)
}

const format = sec => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`
console.log('Shipped model vs real segment efforts - exact distance, no lead-in, no event pen.')
console.log('Positive error = the model predicts SLOWER than the rider actually rode.\n')
console.log('route                       km    draft   actual        predicted    error    equipment')

const errors = []
for (const effort of efforts) {
  const route = getRouteBySlug(effort.routeSlug)
  if (!route) {
    console.error(`  skipped ${effort.routeSlug}: not in the catalog - re-key the effort or drop it`)
    continue
  }

  const geometry = lapOnlyGeometry(route)
  const rider = { weightKg: effort.weightKg, heightCm: effort.heightCm, powerW: effort.avgW }
  const powerScaleAtSpeed = powerScaleFor(effort.draft)

  // When the rider told us what they actually rode, use it: that turns the
  // effort from a band across three guessed setups into a point prediction,
  // and the equipment band is the widest remaining uncertainty in this file
  // (~5 points end to end). Worth asking for every time.
  let known
  if (effort.frame && effort.wheels) {
    const rawFrame = bikeFrames.find(f => f.name === effort.frame)
    const wheelset = getWheelsets().find(w => w.name === effort.wheels)
    if (!rawFrame || !wheelset) {
      console.error(`  ${effort.routeSlug}: equipment ${JSON.stringify(effort.frame)} / ${JSON.stringify(effort.wheels)} is no longer in the catalog - falling back to the scenario band`)
    } else {
      known = { frame: classifyBikeFrame(rawFrame, effort.frameLevel ?? FRAME_LEVEL), wheelset, level: effort.frameLevel ?? FRAME_LEVEL }
    }
  }

  const predicted = equipment.map(scenario => ({
    key: scenario.key,
    sec: simulateRoute({ rider, frame: scenario.frame, wheelset: scenario.wheelset, geometry, powerScaleAtSpeed }).elapsedSec
  }))
  const headlineSec = known
    ? simulateRoute({ rider, frame: known.frame, wheelset: known.wheelset, geometry, powerScaleAtSpeed }).elapsedSec
    : predicted.find(p => p.key === 'typical').sec
  const errorPct = (headlineSec / effort.elapsedSec - 1) * 100
  const band = predicted.map(p => (p.sec / effort.elapsedSec - 1) * 100)
  errors.push(errorPct)

  console.log(
    `${route.name.slice(0, 24).padEnd(24)} ${(geometry.totalDistanceM / 1000).toFixed(2).padStart(6)} ${effort.draft.padStart(6)} `
    + `${format(effort.elapsedSec).padStart(8)} ${format(headlineSec).padStart(18)} ${`${errorPct >= 0 ? '+' : ''}${errorPct.toFixed(2)}%`.padStart(9)}`
    + `    ${known ? `actual equipment, level ${known.level}` : `${Math.min(...band).toFixed(1)}% to ${Math.max(...band).toFixed(1)}% (assumed)`}`
  )
}

if (errors.length === 0) process.exit(1)
const sorted = [...errors].sort((a, b) => a - b)
const middle = (sorted.length - 1) / 2
const median = (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2
const worst = errors.reduce((max, error) => Math.max(max, Math.abs(error)), 0)
console.log(`\n${errors.length} effort${errors.length === 1 ? '' : 's'}: median error ${median >= 0 ? '+' : ''}${median.toFixed(2)}%, worst ${worst.toFixed(2)}%`)

if (worst > TOLERANCE_PCT) {
  console.error(`\ncheck-segment-efforts: an effort is more than ${TOLERANCE_PCT}% out. With the distance measured rather than assumed, that is the route model or the draft model being wrong - not a lead-in.`)
  process.exit(1)
}
console.log('check-segment-efforts: OK')
