#!/usr/bin/env node
// Adds one distance-exact validation record to the local segment-effort set.
//
// WHY THIS EXISTS, and why it is better than a race result for anything where
// the distance is in question:
//
// A ZwiftPower finish time measures a ride whose length we have to infer -
// route + lead-in, unless the organiser published something else. That
// inference is where the sand investigation went wrong (docs §5, "What sand
// turned out not to be"): Urumaze and Mech Isle Mayhem both carry an 85 m
// event lead-in in zwift-data, both actually ride roughly 2 km more than that,
// and the missing distance showed up in the model as a 5-6% surface penalty
// that does not exist.
//
// A Strava segment effort has none of that ambiguity. The segment IS the
// route's lap: it starts and ends at fixed points, so no event pen can inflate
// it and no post-finish riding can either (the trap in using an activity's
// total distance - Zwift keeps recording after the line). One effort gives an
// exact distance, an exact time and the rider's own average power over that
// exact stretch, which is a stronger test than a whole field whose distance is
// a guess.
//
// Two ways in:
//
//   # From your own Strava activity - reads every effort on it and keeps the
//   # ones that are a Zwift route segment.
//   STRAVA_ACCESS_TOKEN=xxx node scripts/race-draft/add-segment-effort.mjs \
//     --activity 19755431353 --weight 79 --height 180 --draft race \
//     --append ./scripts/race-draft/segment-efforts.json
//
//   # From numbers someone reports to you (no API access needed).
//   node scripts/race-draft/add-segment-effort.mjs \
//     --route 4092230492 --sec 1642 --watts 265 --weight 79 --height 180 \
//     --draft race --append ./scripts/race-draft/segment-efforts.json
//
// Token setup is the same as scripts/route-surfaces/compute-route-surfaces.mjs
// (an API app of your own, OAuth for your own account, scope activity:read).
//
// Nothing identifying is stored: no athlete, no activity title, no activity id.
// A record is a route, a distance, a time, a power and the rider's weight and
// height, which is all the physics consumes. Same rule as field-results.json,
// and segment-efforts.json is gitignored for the same reason.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { routes } from 'zwift-data'
import generatedSurfaces from '../../shared/data/routeSurfaces.generated.json' with { type: 'json' }

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = name => args.includes(name)
const value = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

const activityId = value('--activity')
const routeSlug = value('--route')
const appendPath = value('--append')
const force = flag('--force')
const weightKg = Number(value('--weight'))
const heightCm = Number(value('--height'))
const draft = value('--draft') ?? 'race'
const note = value('--note')
const date = value('--date')

if (!activityId && !routeSlug) {
  console.error('add-segment-effort: pass either --activity <strava id> or --route <slug> with --sec/--watts. See the usage block at the top of this file.')
  process.exit(2)
}
// Height is required rather than defaulted because CdA scales with it: over a
// plausible 172-188 cm range the predicted time on a 27-minute lap moves by
// ~2.3%, which is the same size as the effects these records are meant to
// measure. A default would quietly become the answer.
if (!(weightKg > 30 && weightKg < 200)) {
  console.error('add-segment-effort: --weight (kg) is required and must be plausible.')
  process.exit(2)
}
if (!(heightCm > 100 && heightCm < 230)) {
  console.error('add-segment-effort: --height (cm) is required and must be plausible - CdA scales with it, and guessing it moves the result as much as the thing being measured.')
  process.exit(2)
}
if (!['race', 'solo', 'ttt'].includes(draft)) {
  console.error(`add-segment-effort: --draft must be race, solo or ttt (got ${JSON.stringify(draft)}). A drafted effort compared against the solo model is not a measurement of anything.`)
  process.exit(2)
}

/**
 * Strava segment id -> route slug. Built from BOTH sources on purpose:
 * `zwift-data` is authoritative when it carries the id, but a handful of
 * routes (the event-only ones especially) have surface data generated from a
 * segment id that the installed zwift-data no longer exposes. Dropping those
 * would silently ignore efforts on exactly the routes this tool exists for.
 */
const segmentToRoute = new Map()
for (const route of routes) {
  if (route.stravaSegmentId) segmentToRoute.set(route.stravaSegmentId, route.slug)
}
for (const [slug, surface] of Object.entries(generatedSurfaces)) {
  if (surface.stravaSegmentId && !segmentToRoute.has(surface.stravaSegmentId)) segmentToRoute.set(surface.stravaSegmentId, slug)
}

function routeFor(slug) {
  const route = routes.find(r => r.slug === slug)
  if (!route) {
    console.error(`add-segment-effort: ${slug} is not a route in the catalog. Find the current slug with: node scripts/events/find-route.mjs <name>`)
    process.exit(1)
  }
  return route
}

/** `mm:ss`, `h:mm:ss` or plain seconds -> seconds. */
function parseSec(token) {
  if (token === undefined) return undefined
  if (!token.includes(':')) return Number(token)
  const parts = token.split(':').map(Number)
  if (parts.some(p => !Number.isFinite(p))) return undefined
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1]
}

async function fromStrava(id) {
  const token = process.env.STRAVA_ACCESS_TOKEN
  if (!token) {
    console.error('add-segment-effort: --activity needs STRAVA_ACCESS_TOKEN - see the comment at the top of this file.')
    process.exit(2)
  }
  const url = `https://www.strava.com/api/v3/activities/${id}?include_all_efforts=true`
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) {
    console.error(`add-segment-effort: Strava API ${response.status} for activity ${id}: ${await response.text()}`)
    process.exit(1)
  }
  const body = await response.json()
  const efforts = body.segment_efforts ?? []

  const records = []
  for (const effort of efforts) {
    const slug = segmentToRoute.get(effort.segment?.id)
    if (!slug) continue // a sprint/KOM segment, not a route lap
    if (effort.average_watts === undefined) {
      console.error(`  skipped ${slug}: the effort has no average power, and a time without a power is not a measurement`)
      continue
    }
    records.push({
      routeSlug: slug,
      segmentDistanceM: Math.round(effort.distance),
      elapsedSec: effort.elapsed_time,
      avgW: Math.round(effort.average_watts),
      // Strava's activity start date, day only - surface and Crr behaviour
      // ship with game patches, so a record with no date cannot be told apart
      // from a model error later.
      date: date ?? body.start_date_local?.slice(0, 10)
    })
  }
  return records
}

const records = activityId
  ? await fromStrava(activityId)
  : [{
      routeSlug,
      elapsedSec: parseSec(value('--sec')),
      avgW: Number(value('--watts')),
      segmentDistanceM: value('--segment-m') === undefined ? undefined : Number(value('--segment-m')),
      date
    }]

if (records.length === 0) {
  console.error('add-segment-effort: no route-lap segment efforts found on that activity. Sprint and KOM segments are ignored - only a segment that IS a route lap gives an exact distance.')
  process.exit(1)
}

const problems = []
const out = []
for (const record of records) {
  const route = routeFor(record.routeSlug)
  if (!(record.elapsedSec > 0)) problems.push(`${record.routeSlug}: no usable elapsed time`)
  if (!(record.avgW >= 40 && record.avgW <= 2000)) problems.push(`${record.routeSlug}: average power ${record.avgW} W is outside a plausible range`)

  // The effort must actually cover the lap. Strava's GPS-measured segment
  // length and zwift-data's official route distance differ by a few tenths of
  // a percent normally; anything more means this is a different segment that
  // happens to share an id, or a partial effort, and comparing it against a
  // full-lap simulation would be nonsense.
  const lapM = route.distance * 1000
  if (record.segmentDistanceM !== undefined) {
    const deltaPct = (record.segmentDistanceM / lapM - 1) * 100
    if (Math.abs(deltaPct) > 2) problems.push(`${record.routeSlug}: segment is ${record.segmentDistanceM} m but the route lap is ${Math.round(lapM)} m (${deltaPct.toFixed(1)}%) - not a full-lap effort`)
  }

  out.push({
    routeSlug: record.routeSlug,
    routeName: route.name,
    segmentDistanceM: record.segmentDistanceM ?? Math.round(lapM),
    elapsedSec: record.elapsedSec,
    avgW: record.avgW,
    weightKg,
    heightCm,
    draft,
    ...(record.date ? { date: record.date } : {}),
    ...(note ? { note } : {})
  })
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`  ERROR: ${problem}`)
  console.error('\nNothing was written.')
  process.exit(1)
}

const speed = record => (record.segmentDistanceM / 1000) / (record.elapsedSec / 3600)
for (const record of out) {
  console.log(`${record.routeName}: ${(record.segmentDistanceM / 1000).toFixed(2)} km in ${Math.floor(record.elapsedSec / 60)}:${String(record.elapsedSec % 60).padStart(2, '0')} at ${record.avgW} W (${speed(record).toFixed(1)} km/h, ${record.draft})`)
}

if (!appendPath) {
  console.log(`\n${JSON.stringify(out, null, 1)}`)
  process.exit(0)
}

const resolved = path.resolve(appendPath)
const existing = existsSync(resolved)
  ? JSON.parse(readFileSync(resolved, 'utf8'))
  : { source: 'Strava segment efforts on Zwift route laps - exact distance, exact time, no lead-in.', privacy: 'No athlete, activity title or activity id is stored. See add-segment-effort.mjs.', efforts: [] }

for (const record of out) {
  const duplicate = existing.efforts.find(e => e.routeSlug === record.routeSlug && e.elapsedSec === record.elapsedSec && e.avgW === record.avgW)
  if (duplicate && !force) {
    console.error(`\nadd-segment-effort: an identical effort on ${record.routeSlug} is already in ${appendPath}. Pass --force to add it anyway.`)
    process.exit(1)
  }
  existing.efforts.push(record)
}
writeFileSync(resolved, JSON.stringify(existing, null, 1))
console.log(`\nadd-segment-effort: appended ${out.length} effort${out.length === 1 ? '' : 's'} to ${appendPath} (${existing.efforts.length} total). Check them with: node scripts/race-draft/check-segment-efforts.mjs`)
