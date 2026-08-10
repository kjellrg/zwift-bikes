#!/usr/bin/env node
// Computes real per-route surface data (% tarmac/gravel/cobbles/etc., AND
// exactly where each surface occurs along the route) for every zwift-data
// route, the same way zwiftmap.com does it: fetch the route's real GPS trace
// from Strava (via `route.stravaSegmentId`, which zwift-data already
// provides) and classify each point against the hand-mapped world surface
// polygons vendored in shared/data/zwiftmapSurfacePolygons.json (see
// extract-surface-polygons.mjs and /THIRD_PARTY_NOTICES.md). Position data
// (`segments`) lets the dynamic physics model use the real surface at each
// point instead of one blended value for the whole route.
//
// The same Strava request also fetches the route's real `altitude` stream
// (index-aligned with `distance`) and simplifies it into `elevationProfile` -
// see shared/utils/elevationGeometry.ts. This replaces the dynamic physics
// model's synthetic named-climb/rolling-lap elevation approximation
// (shared/utils/physics/routeGeometry.ts) with the route's actual measured
// shape wherever it's available.
//
// Writes shared/data/routeSurfaces.generated.json.
//
// Requires a Strava API access token with activity/segment read access:
//   1. Create an API app at https://www.strava.com/settings/api
//   2. Complete the OAuth flow for your own account (scope: read) to get an
//      access token - see https://developers.strava.com/docs/getting-started/#oauth
//   3. STRAVA_ACCESS_TOKEN=xxx node scripts/route-surfaces/compute-route-surfaces.mjs
//
// Re-run this (and commit the diff) whenever zwift-data adds new routes, or
// periodically to catch Zwift road-surface changes. Safe to interrupt and
// resume - already-computed routes in the existing output file are skipped
// unless --force is passed. Paced to stay under Strava's ~100 req/15min rate
// limit; on a 429 it backs off and retries rather than failing the run.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { routes } from 'zwift-data'
import { loadSharedModule } from './loadShared.mjs'

const { computeSurfaceProfile } = loadSharedModule('shared/utils/surfaceGeometry.ts')
const { computeElevationProfile } = loadSharedModule('shared/utils/elevationGeometry.ts')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const outPath = path.join(repoRoot, 'shared/data/routeSurfaces.generated.json')

const token = process.env.STRAVA_ACCESS_TOKEN
if (!token) {
  console.error('Missing STRAVA_ACCESS_TOKEN - see the comment at the top of this script for setup.')
  process.exit(1)
}

const force = process.argv.includes('--force')
const requestDelayMs = 9_500 // ~1 req/9.5s, comfortably under Strava's 100 req/15min

const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf-8')) : {}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchStreams(stravaSegmentId) {
  // `altitude` is the third (and last) stream type Strava's segment streams
  // endpoint supports, alongside `latlng`/`distance` - same request, no extra
  // rate-limit cost.
  const url = `https://www.strava.com/api/v3/segments/${stravaSegmentId}/streams?keys=latlng,distance,altitude&key_by_type=true`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })

  if (res.status === 429) {
    const retryAfterSec = Number(res.headers.get('Retry-After')) || 60
    console.log(`  rate limited, waiting ${retryAfterSec}s...`)
    await sleep(retryAfterSec * 1000)
    return fetchStreams(stravaSegmentId)
  }
  if (!res.ok) throw new Error(`Strava API ${res.status}: ${await res.text()}`)

  const body = await res.json()
  const latlng = body.latlng?.data
  const distance = body.distance?.data
  const altitude = body.altitude?.data
  if (!latlng || !distance) throw new Error('Response missing latlng/distance stream')
  // A small number of segments lack an altitude stream - don't fail the
  // whole route over it, just skip the elevation profile for those.
  return { latlng, distance, altitude }
}

const routesToProcess = routes.filter(r => r.slug && r.stravaSegmentId && (force || !existing[r.slug]))
console.log(`${routesToProcess.length} routes to process (${routes.length - routesToProcess.length} already done or skippable)\n`)

const results = { ...existing }
let done = 0
for (const route of routesToProcess) {
  process.stdout.write(`[${++done}/${routesToProcess.length}] ${route.world}/${route.slug}... `)
  try {
    const { latlng, distance, altitude } = await fetchStreams(route.stravaSegmentId)
    const { composition, segments } = computeSurfaceProfile(route.world, latlng, distance)
    const elevationProfile = altitude ? computeElevationProfile(distance, altitude) : undefined
    results[route.slug] = {
      composition,
      segments,
      ...(elevationProfile ? { elevationProfile } : {}),
      generatedAt: new Date().toISOString(),
      stravaSegmentId: route.stravaSegmentId
    }
    const elevationNote = elevationProfile ? `, ${elevationProfile.length} elevation points` : ', no altitude stream'
    console.log(Object.entries(composition).map(([k, v]) => `${k} ${v.toFixed(1)}%`).join(', '), `(${segments.length} segments${elevationNote})`)
  } catch (err) {
    console.log(`FAILED: ${err.message}`)
  }

  writeFileSync(outPath, JSON.stringify(results, null, 1))
  if (done < routesToProcess.length) await sleep(requestDelayMs)
}

console.log(`\nWrote ${outPath} (${Object.keys(results).length} routes total)`)
