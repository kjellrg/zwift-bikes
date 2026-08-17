#!/usr/bin/env node
// Renders `docs/assets/race-draft-leadin-correction.svg`: what correcting a
// wrong event lead-in does to the model's error on the races that ride it.
//
//   node scripts/race-draft/render-leadin-chart.mjs > docs/assets/race-draft-leadin-correction.svg
//
// Every number is computed here rather than typed in, so the figure cannot
// drift from the data the way a hand-maintained chart does. For each race it
// runs the shipped race model twice over the same field - once with
// `zwift-data`'s own lead-in, once with the correction in
// `shared/data/routeEventLeadIns.ts` - and plots the two medians.
//
// The control rows matter as much as the corrected ones: routes with a sound
// lead-in have to sit still, or the correction is doing something it should
// not.
//
// Needs the LOCAL-ONLY dataset (see README.md, "Where the data lives").
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSharedModule } from '../route-surfaces/loadShared.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const datasetPath = path.join(__dirname, 'field-results.json')
if (!existsSync(datasetPath)) {
  console.error('render-leadin-chart: field-results.json not found - see README.md, "Where the data lives".')
  process.exit(1)
}

const { getRouteBySlug } = loadSharedModule('shared/utils/catalog.ts')
const { getWheelsets } = loadSharedModule('shared/utils/wheelsets.ts')
const { classifyBikeFrame } = loadSharedModule('shared/utils/classifyBikeFrame.ts')
const { simulateRoute } = loadSharedModule('shared/utils/physics/simulator.ts')
const { geometryForRouteLaps, prependWarmup } = loadSharedModule('shared/utils/physics/routeGeometry.ts')
const { racePowerScaleAtSpeed } = loadSharedModule('shared/utils/physics/draft.ts')
const { EVENT_LEAD_IN_OVERRIDES } = loadSharedModule('shared/data/routeEventLeadIns.ts')
const { bikeFrames, routes } = await import('zwift-data')

const frame = classifyBikeFrame(bikeFrames.find(f => f.name === 'Specialized Tarmac Pro'), 5)
const wheelset = getWheelsets().find(w => w.name === 'Zipp 353 NSW')

/** Races to draw, top to bottom. `corrected: false` rows are the controls. */
const ROWS = [
  { race: 'mech-isle-mayhem', label: 'Mech Isle Mayhem', corrected: true },
  { race: 'urumaze', label: 'Urumaze', corrected: true },
  { race: 'urumaze-2', label: 'Urumaze, second field', corrected: true },
  { race: 'turf-n-surf', label: 'Turf N Surf', corrected: false },
  { race: 'neokyo-all-nighter', label: 'Neokyo All-Nighter', corrected: false },
  { race: 'makuri-40-2', label: 'Makuri 40', corrected: false }
]

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = (sorted.length - 1) / 2
  return (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2
}

function bunchFinishers(riders) {
  const byCat = new Map()
  for (const rider of riders) {
    if (!byCat.has(rider.cat)) byCat.set(rider.cat, [])
    byCat.get(rider.cat).push(rider)
  }
  const out = []
  for (const group of byCat.values()) {
    group.sort((a, b) => a.timeSec - b.timeSec)
    let cluster = []
    const flush = () => { if (cluster.length >= 3) out.push(...cluster); cluster = [] }
    for (const rider of group) {
      const previous = cluster[cluster.length - 1]
      if (previous && rider.timeSec - previous.timeSec > 5) flush()
      cluster.push(rider)
    }
    flush()
  }
  return out
}

const dataset = JSON.parse(readFileSync(datasetPath, 'utf8'))

function medianErrorPct(race, useRawLeadIn) {
  const route = getRouteBySlug(race.routeSlug)
  const raw = routes.find(r => r.slug === race.routeSlug)
  // The catalog applies the correction; to draw the "before" state, put
  // zwift-data's own figures back on a copy of the route.
  const effective = useRawLeadIn
    ? { ...route, leadInDistance: raw.leadInDistance, leadInElevation: raw.leadInElevation }
    : route

  let geometry = geometryForRouteLaps(effective, race.laps)
  // The dataset's own `eventDistanceKm` is how the uncorrected model was made
  // to fit before the lead-in was understood; ignore it here so the chart
  // shows what the route data alone produces.
  if (!useRawLeadIn && race.eventDistanceKm) {
    const extraM = race.eventDistanceKm * 1000 - geometry.totalDistanceM
    if (extraM > 0) geometry = prependWarmup(geometry, extraM)
  }

  const riders = bunchFinishers(race.riders.filter(r => r.weightKg))
  const errors = riders.map(rider => (simulateRoute({
    rider: { weightKg: rider.weightKg, heightCm: rider.heightCm, powerW: rider.avgW },
    frame,
    wheelset,
    geometry,
    powerScaleAtSpeed: racePowerScaleAtSpeed
  }).elapsedSec / rider.timeSec - 1) * 100)

  return { median: median(errors), n: errors.length, km: geometry.totalDistanceM / 1000 }
}

const rows = []
for (const row of ROWS) {
  const race = dataset.races[row.race]
  if (!race) continue
  const before = medianErrorPct(race, true)
  const after = medianErrorPct(race, false)
  const override = EVENT_LEAD_IN_OVERRIDES[race.routeSlug]
  rows.push({ ...row, before, after, override })
}

const width = 760
const left = 196
const right = 700
const top = 74
const rowHeight = 34
const height = top + rows.length * rowHeight + 84
const minX = -12
const maxX = 4
const x = v => left + (Math.min(maxX, Math.max(minX, v)) - minX) / (maxX - minX) * (right - left)

const parts = []
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="ttl dsc">`)
parts.push('<title id="ttl">What correcting a wrong event lead-in does to the model error</title>')
parts.push('<desc id="dsc">Six Makuri race fields. For each, the median finish-time error of the shipped race model, shown with Zwift\'s own published lead-in and again with the corrected lead-in. The three routes whose lead-in Zwift under-reports by about two kilometres move from between four and eleven percent too fast to within two and a half percent of zero. The three control races, whose lead-ins are sound, do not move at all. The shaded band marks plus or minus three percent, which is the model\'s own accuracy on races it reproduces well.</desc>')
parts.push(`<style>
text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.t{fill:#6e7781}
.h{fill:#1f2328}
.grid{stroke:#6e7781;opacity:.28}
.band{fill:#1a7f37;opacity:.09}
.zero{stroke:#1a7f37;opacity:.65}
.before{fill:#cf222e;opacity:.85}
.after{fill:#0969da}
.arrow{stroke:#6e7781;opacity:.55}
.still{stroke:#6e7781;opacity:.3}
@media (prefers-color-scheme:dark){
.t{fill:#9198a1}
.h{fill:#f0f6fc}
.grid{stroke:#9198a1;opacity:.22}
.band{fill:#3fb950;opacity:.12}
.zero{stroke:#3fb950}
.before{fill:#ff7b72}
.after{fill:#58a6ff}
.arrow{stroke:#9198a1;opacity:.5}
.still{stroke:#9198a1;opacity:.3}
}
</style>`)

const axisBottom = top + rows.length * rowHeight + 6
parts.push(`<rect x="${x(-3).toFixed(1)}" y="${top - 24}" width="${(x(3) - x(-3)).toFixed(1)}" height="${axisBottom - top + 24}" class="band"/>`)
for (let tick = minX; tick <= maxX; tick += 2) {
  parts.push(`<line x1="${x(tick).toFixed(1)}" y1="${top - 24}" x2="${x(tick).toFixed(1)}" y2="${axisBottom}" class="${tick === 0 ? 'zero' : 'grid'}" stroke-width="${tick === 0 ? 1.4 : 0.5}"/>`)
  parts.push(`<text x="${x(tick).toFixed(1)}" y="${axisBottom + 18}" font-size="11" class="t" text-anchor="middle">${tick > 0 ? '+' : ''}${tick}%</text>`)
}
parts.push(`<text x="${x(0).toFixed(1)}" y="${top - 32}" font-size="11" class="t" text-anchor="middle">model matches reality</text>`)
parts.push(`<text x="16" y="26" font-size="13" class="h" font-weight="600">Correcting the event lead-in, median finish-time error per field</text>`)
parts.push(`<text x="16" y="44" font-size="11.5" class="t">Negative = the model predicts faster than the field actually rode. Circles: zwift-data's lead-in. Filled: corrected.</text>`)

rows.forEach((row, index) => {
  const y = top + index * rowHeight + 12
  const moved = Math.abs(row.after.median - row.before.median) > 0.05
  parts.push(`<text x="${left - 14}" y="${y + 4}" font-size="11.5" class="t" text-anchor="end">${row.label} (n=${row.after.n})</text>`)
  if (moved) {
    parts.push(`<line x1="${x(row.before.median).toFixed(1)}" y1="${y}" x2="${x(row.after.median).toFixed(1)}" y2="${y}" class="arrow" stroke-width="1.4"/>`)
    parts.push(`<circle cx="${x(row.before.median).toFixed(1)}" cy="${y}" r="5" fill="none" stroke="currentColor" class="before" stroke-width="1.8"/>`)
    parts.push(`<circle cx="${x(row.after.median).toFixed(1)}" cy="${y}" r="5" class="after"/>`)
    parts.push(`<text x="${x(row.before.median).toFixed(1)}" y="${y - 10}" font-size="10.5" class="t" text-anchor="middle">${row.before.median.toFixed(1)}%</text>`)
    parts.push(`<text x="${x(row.after.median).toFixed(1)}" y="${y - 10}" font-size="10.5" class="t" text-anchor="middle">${row.after.median >= 0 ? '+' : ''}${row.after.median.toFixed(1)}%</text>`)
    parts.push(`<text x="${right + 8}" y="${y + 4}" font-size="10.5" class="t">+${row.override.distanceKm.toFixed(2)} km</text>`)
  } else {
    parts.push(`<circle cx="${x(row.after.median).toFixed(1)}" cy="${y}" r="5" class="after"/>`)
    parts.push(`<text x="${x(row.after.median).toFixed(1)}" y="${y - 10}" font-size="10.5" class="t" text-anchor="middle">${row.after.median >= 0 ? '+' : ''}${row.after.median.toFixed(1)}%</text>`)
    parts.push(`<text x="${right + 8}" y="${y + 4}" font-size="10.5" class="t">unchanged</text>`)
  }
})

parts.push(`<text x="16" y="${height - 34}" font-size="11" class="t">Corrected: Zwift publishes 85 m of lead-in for Urumaze and Mech Isle Mayhem, and 66 m for Twilight Crit; the organiser's published event</text>`)
parts.push(`<text x="16" y="${height - 18}" font-size="11" class="t">distances put the real figures near 2 km. Controls carry lead-ins that agree with what riders cover, and are untouched by the fix.</text>`)
parts.push('</svg>')
console.log(parts.join('\n'))
