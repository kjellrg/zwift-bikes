#!/usr/bin/env node
// Measures how much draft a mass-start Zwift race actually gave its riders,
// from published field results (`field-results.json`).
//
// The idea: ZwiftPower publishes, for every finisher, the two things the
// physics needs on both sides of the equation - what they PUT IN (average
// power, weight, height) and what they GOT OUT (finish time over a known
// route). Simulating the same rider solo on the same geometry gives the power
// the route would have demanded with no draft at all. The gap between the two
// is the draft, expressed the way `draft.ts` expresses it: a fraction of power
// saved at flat-TTT speed, scaled along the route by `draftSavingsSpeedScale`.
//
// So for each rider we solve for the ONE number race mode would need as its
// default - the flat-speed expected saving `s` such that simulating them with
//
//     powerScale(v) = 1 / (1 - s * draftSavingsSpeedScale(v))
//
// reproduces their real finish time. A field of 358 riders becomes 358
// independent estimates of that constant, which is what makes this a
// calibration rather than an anecdote.
//
// What it CANNOT see, and why the output is a band rather than a number:
//   - Equipment. ZwiftPower does not publish frame or wheels, so the same
//     finish time implies less draft on a fast bike than on a slow one. Every
//     figure is therefore reported for three setups spanning the plausible
//     field (see EQUIPMENT_SCENARIOS).
//   - Where the rider sat. There is no position data, only the aggregate.
//   - Pacing. Average power is the mechanically correct input (it is the
//     actual mean of the power stream); normalised power is a physiological
//     construct that runs 5-15% higher and is reported only to show how much
//     it biases the answer downward.
//
// Usage:
//   node scripts/race-draft/analyze-field-draft.mjs [--json] [--dt 0.2]
//     --json           per-rider records instead of the report
//     --dt <sec>       simulator timestep (0.1 matches the app; 0.2 is the
//                      default here and moves the pooled median by <0.2 pt)
//     --tarmac         force every surface to tarmac (bounds how much of the
//                      answer rests on the route's surface data)
//     --race <slug>    restrict to one race
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSharedModule } from '../route-surfaces/loadShared.mjs'
import { assertDatasetRoutesResolve } from './validate-dataset-routes.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const asJson = args.includes('--json')
const dtSec = Number(args[args.indexOf('--dt') + 1]) || 0.2
const forceTarmac = args.includes('--tarmac')
const onlyRace = args.includes('--race') ? args[args.indexOf('--race') + 1] : undefined

const { getRouteBySlug } = loadSharedModule('shared/utils/catalog.ts')
const { getWheelsets } = loadSharedModule('shared/utils/wheelsets.ts')
const { classifyBikeFrame } = loadSharedModule('shared/utils/classifyBikeFrame.ts')
const { simulateRoute } = loadSharedModule('shared/utils/physics/simulator.ts')
const { geometryForRouteLaps, prependWarmup } = loadSharedModule('shared/utils/physics/routeGeometry.ts')
const { draftSavingsSpeedScale } = loadSharedModule('shared/utils/physics/draft.ts')
const { bikeFrames } = await import('zwift-data')

// Three setups spanning what a real field rides, all fully upgraded (level 5,
// what the site assumes for a frame the rider hasn't declared). "typical" is
// the median measured frame and median measured wheelset - deliberately not a
// hand-picked race bike, since half the riders in a C/D field are not on one.
// `gravel` exists because a road wheelset is the wrong assumption on a
// loose-surface route: on Jungle Circuit (97% dirt) a gravel wheelset is 6.6%
// faster than a road one at the same power, so assuming road wheels would
// credit the draft with speed the tyres actually produced. Use it for any race
// whose `looseSurfaceShare` makes gravel the faster choice - which is what an
// informed racer would have been riding. On Yumezi Grit (35% dirt, 60% tarmac)
// gravel is 2.4% *slower*, so that race stays on the road scenarios.
const EQUIPMENT_SCENARIOS = {
  stock: { frame: 'Zwift Carbon', wheels: 'Zwift 32mm Carbon' },
  typical: { frame: 'Specialized Tarmac Pro', wheels: 'Zipp 353 NSW' },
  fast: { frame: 'Cervelo S5', wheels: 'DTSwiss ARC 1100 DICUT 85/Disc' },
  gravel: { frame: 'Specialized Tarmac Pro', wheels: 'Zipp ZIPP 303 XPLR SW' }
}
const FRAME_LEVEL = 5

/** Finishers within this many seconds of each other rode to the line together. */
const GROUP_GAP_SEC = 5
/** A cluster this size or larger is a bunch finish; anything smaller is a rider who was on their own. */
const MIN_BUNCH_SIZE = 3

function buildEquipment(scenario) {
  const rawFrame = bikeFrames.find(f => f.name === scenario.frame)
  if (!rawFrame) throw new Error(`Unknown frame: ${scenario.frame}`)
  const frame = classifyBikeFrame(rawFrame, FRAME_LEVEL)
  const wheelset = getWheelsets().find(w => w.name === scenario.wheels)
  if (!wheelset) throw new Error(`Unknown wheelset: ${scenario.wheels}`)
  return { frame, wheelset }
}

function buildGeometry(race) {
  const route = getRouteBySlug(race.routeSlug)
  if (!route) throw new Error(`Unknown route: ${race.routeSlug}`)
  let geometry = geometryForRouteLaps(route, race.laps)
  const extraM = (race.eventDistanceKm ?? 0) * 1000 - geometry.totalDistanceM
  if (extraM > 0) geometry = prependWarmup(geometry, extraM)
  if (forceTarmac) geometry = { ...geometry, surfaceSegments: geometry.surfaceSegments.map(s => ({ ...s, surface: 'tarmac' })) }
  return geometry
}

function simulateSec(geometry, equipment, rider, saving) {
  const result = simulateRoute({
    rider,
    frame: equipment.frame,
    wheelset: equipment.wheelset,
    geometry,
    dtSec,
    powerScaleAtSpeed: saving === 0 ? undefined : v => 1 / (1 - saving * draftSavingsSpeedScale(v))
  })
  return result.elapsedSec
}

/**
 * The flat-speed draft saving that reproduces `targetSec`. Monotone in
 * `saving` (more draft is never slower), so plain bisection converges; the
 * bounds are wide enough to bracket a rider who finished SLOWER than a lone
 * rider at the same power - which is what being dropped and chasing looks
 * like from the outside, and is reported as a negative saving rather than
 * clamped away.
 */
function solveSaving(geometry, equipment, rider, targetSec) {
  let low = -0.35
  let high = 0.6
  if (simulateSec(geometry, equipment, rider, low) < targetSec) return { saving: low, bracketed: false }
  if (simulateSec(geometry, equipment, rider, high) > targetSec) return { saving: high, bracketed: false }
  for (let i = 0; i < 16; i++) {
    const mid = (low + high) / 2
    if (simulateSec(geometry, equipment, rider, mid) > targetSec) low = mid
    else high = mid
  }
  return { saving: (low + high) / 2, bracketed: true }
}

/** Marks each rider as finishing in a bunch or alone, by clustering finish times within a category. */
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

function quantile(sorted, q) {
  if (sorted.length === 0) return NaN
  const index = (sorted.length - 1) * q
  const low = Math.floor(index)
  const high = Math.ceil(index)
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low)
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mean = sorted.reduce((sum, v) => sum + v, 0) / (sorted.length || 1)
  return { n: sorted.length, mean, median: quantile(sorted, 0.5), p25: quantile(sorted, 0.25), p75: quantile(sorted, 0.75) }
}

function correlation(xs, ys) {
  const n = xs.length
  if (n < 3) return NaN
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  return sxy / Math.sqrt(sxx * syy)
}

/** Least-squares slope and intercept of `ys` on `xs`. */
function regress(xs, ys) {
  const n = xs.length
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
  }
  const slope = sxy / sxx
  return { slope, intercept: my - slope * mx }
}

const datasetPath = path.join(__dirname, 'field-results.json')
if (!existsSync(datasetPath)) {
  console.error(`analyze-field-draft: ${datasetPath} not found.

The per-rider dataset is LOCAL-ONLY and deliberately never committed (it is in
.gitignore). Build it from ZwiftPower result pastes:

  node scripts/race-draft/parse-zwiftpower-paste.mjs --slug <slug> --label "<name>" \\
    --route <route-slug> --laps 1 --event-km <km> --append ./scripts/race-draft/field-results.json < paste.txt

The exact format the analyzer reads is documented by
scripts/race-draft/field-results.sample.json, and the rules about which races
may be added are in scripts/race-draft/README.md.

Only the aggregate results travel: docs/race-drafting.md §5 keeps every summary
statistic and chart from this dataset.`)
  process.exit(1)
}
const dataset = JSON.parse(readFileSync(datasetPath, 'utf8'))
// Up front, over EVERY race - including ones this run filters out with
// --race - so a rotted slug is reported the same way whatever is in scope.
assertDatasetRoutesResolve(dataset, getRouteBySlug, 'analyze-field-draft')
const equipment = Object.fromEntries(Object.entries(EQUIPMENT_SCENARIOS).map(([key, scenario]) => [key, buildEquipment(scenario)]))
const results = []

/** Candidate values for race mode's one default, scored on how well each reproduces real finish times. */
const CANDIDATE_SAVINGS = [0.267, 0.30, 0.32, 0.34]

for (const [raceSlug, race] of Object.entries(dataset.races)) {
  if (onlyRace && raceSlug !== onlyRace) continue
  const geometry = buildGeometry(race)
  const riders = race.riders.filter(r => r.weightKg)
  markBunchFinishes(riders)
  for (const rider of riders) {
    const record = {
      race: raceSlug,
      cat: rider.cat,
      pos: rider.pos,
      timeSec: rider.timeSec,
      bunch: !!rider.bunch,
      weightKg: rider.weightKg,
      heightCm: rider.heightCm,
      avgW: rider.avgW,
      npW: rider.npW,
      vi: rider.npW ? rider.npW / rider.avgW : undefined,
      speedKph: geometry.totalDistanceM / rider.timeSec * 3.6,
      distanceKm: geometry.totalDistanceM / 1000,
      saving: {},
      soloSec: {},
      /** Predicted-minus-actual finish time, as a fraction, for each candidate default (typical equipment). */
      timeErrorAt: {}
    }
    for (const [key, kit] of Object.entries(equipment)) {
      const riderPhysics = { weightKg: rider.weightKg, heightCm: rider.heightCm, powerW: rider.avgW }
      record.soloSec[key] = simulateSec(geometry, kit, riderPhysics, 0)
      record.saving[key] = solveSaving(geometry, kit, riderPhysics, rider.timeSec).saving
      if (key === 'typical') {
        // A handful of published rows have no normalised power at all.
        if (rider.npW) record.savingFromNp = solveSaving(geometry, kit, { ...riderPhysics, powerW: rider.npW }, rider.timeSec).saving
        for (const candidate of CANDIDATE_SAVINGS) {
          record.timeErrorAt[candidate] = simulateSec(geometry, kit, riderPhysics, candidate) / rider.timeSec - 1
        }
      }
    }
    results.push(record)
  }
}

if (asJson) {
  process.stdout.write(JSON.stringify({ dtSec, scenarios: EQUIPMENT_SCENARIOS, results }, null, 1))
  process.exit(0)
}

const pct = v => `${(v * 100).toFixed(1)}%`
const bunch = results.filter(r => r.bunch)

console.log(`Riders analysed: ${results.length} (${bunch.length} finished in a bunch), dt=${dtSec}s`)
console.log(`Equipment scenarios: ${Object.entries(EQUIPMENT_SCENARIOS).map(([k, v]) => `${k}=${v.frame} + ${v.wheels}`).join(' | ')}\n`)

console.log('Implied flat-speed draft saving, bunch finishers only, by race and category')
console.log('race                  cat   n   speed   stock  typical    fast   (median)')
for (const raceSlug of Object.keys(dataset.races)) {
  for (const cat of ['A', 'B', 'C', 'D', 'E']) {
    const rows = bunch.filter(r => r.race === raceSlug && r.cat === cat)
    if (rows.length === 0) continue
    const speed = rows.reduce((sum, r) => sum + r.speedKph, 0) / rows.length
    const cells = ['stock', 'typical', 'fast'].map(key => pct(stats(rows.map(r => r.saving[key])).median).padStart(7)).join(' ')
    console.log(`${raceSlug.padEnd(20)} ${cat}  ${String(rows.length).padStart(3)}  ${speed.toFixed(1).padStart(5)}  ${cells}`)
  }
}

console.log('\nAll bunch finishers pooled')
for (const key of ['stock', 'typical', 'fast']) {
  const s = stats(bunch.map(r => r.saving[key]))
  console.log(`  ${key.padEnd(8)} median ${pct(s.median)}  mean ${pct(s.mean)}  IQR ${pct(s.p25)}-${pct(s.p75)}  n=${s.n}`)
}
const npStats = stats(bunch.map(r => r.savingFromNp).filter(v => Number.isFinite(v)))
console.log(`  typical, but with normalised power as the input: median ${pct(npStats.median)}`)

console.log('\nEveryone who finished, including riders dropped from their group')
for (const key of ['stock', 'typical', 'fast']) {
  const s = stats(results.map(r => r.saving[key]))
  console.log(`  ${key.padEnd(8)} median ${pct(s.median)}  mean ${pct(s.mean)}  IQR ${pct(s.p25)}-${pct(s.p75)}  n=${s.n}`)
}
const alone = results.filter(r => !r.bunch)
console.log(`  riders finishing alone (${alone.length}): median ${pct(stats(alone.map(r => r.saving.typical)).median)}`)

console.log('\nDoes the implied saving depend on how variable the rider\'s power was? (surge term)')
for (const scope of [{ label: 'all bunch finishers', rows: bunch }, ...['A', 'B', 'C', 'D'].map(cat => ({ label: `cat ${cat} bunch`, rows: bunch.filter(r => r.cat === cat) }))]) {
  const withVi = scope.rows.filter(r => Number.isFinite(r.vi))
  const xs = withVi.map(r => r.vi)
  const ys = withVi.map(r => r.saving.typical)
  if (xs.length < 5) continue
  const { slope, intercept } = regress(xs, ys)
  console.log(`  ${scope.label.padEnd(20)} n=${String(xs.length).padStart(3)}  r=${correlation(xs, ys).toFixed(2)}  saving = ${pct(intercept)} ${slope < 0 ? '-' : '+'} ${pct(Math.abs(slope))} per unit VI  -> at VI 1.10: ${pct(intercept + slope * 1.1)}`)
}

console.log('\nBias checks - implied saving should NOT depend on these if the rider model is right')
for (const [label, get] of [['weight (kg)', r => r.weightKg], ['height (cm)', r => r.heightCm], ['power (W)', r => r.avgW]]) {
  const xs = bunch.map(get)
  const ys = bunch.map(r => r.saving.typical)
  console.log(`  vs ${label.padEnd(12)} r=${correlation(xs, ys).toFixed(2)}`)
}

console.log('\nHow well one fixed default reproduces real finish times (typical equipment)')
console.log('  saving   bunch: median err   MAE   within 3%      all finishers: median err   MAE')
for (const candidate of CANDIDATE_SAVINGS) {
  const bunchErrors = bunch.map(r => r.timeErrorAt[candidate])
  const allErrors = results.map(r => r.timeErrorAt[candidate])
  const within = bunchErrors.filter(e => Math.abs(e) <= 0.03).length / bunchErrors.length
  const mae = xs => xs.reduce((sum, v) => sum + Math.abs(v), 0) / xs.length
  console.log(`  ${pct(candidate).padStart(6)}         ${pct(stats(bunchErrors).median).padStart(7)}  ${pct(mae(bunchErrors)).padStart(6)}  ${pct(within).padStart(6)}                    ${pct(stats(allErrors).median).padStart(7)}  ${pct(mae(allErrors)).padStart(6)}`)
}

console.log('\nPer-race summary (bunch finishers, typical equipment)')
for (const [raceSlug, race] of Object.entries(dataset.races)) {
  const rows = bunch.filter(r => r.race === raceSlug)
  const s = stats(rows.map(r => r.saving.typical))
  const vi = stats(rows.map(r => r.vi).filter(v => Number.isFinite(v)))
  console.log(`  ${raceSlug.padEnd(20)} ${race.distanceNote ? '' : ''}n=${String(s.n).padStart(3)}  ${rows[0]?.distanceKm.toFixed(2)} km  median saving ${pct(s.median)}  median VI ${vi.median.toFixed(3)}`)
}
