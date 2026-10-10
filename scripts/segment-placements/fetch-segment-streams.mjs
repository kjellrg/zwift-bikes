#!/usr/bin/env node
// Fetches the Strava streams (latlng, distance, altitude) for every segment
// in shared/data/segmentStravaIdSupplement.ts - the Strava ids found by hand
// for segments zwift-data has no id or track for - and writes them, rounded as
// zwift-data/streams rounds its own, to shared/data/segmentStreams.supplement.json,
// keyed by Strava id (#274). That file is committed, so the placement
// generator and CI read the tracks from it and never need a token; this
// script is the only thing that talks to Strava, and only when a human runs it.
//
// After each id it prints the fetched length against the length expected of
// it - the record's, or the entry's measured length where the game's label is
// known wrong - and the length check's verdict
// (shared/utils/segmentSupplementStreams.ts). A track
// that fails is stored anyway: the generator rejects it reproducibly, and a
// human decides whether the id belongs to the other direction (Downtown
// Dolphin's Prime - see the supplement's header) or is wrong.
//
// Requires a Strava API access token with read access:
//   1. Create an API app at https://www.strava.com/settings/api
//   2. Complete the OAuth flow for your own account (scope: read) to get an
//      access token - see https://developers.strava.com/docs/getting-started/#oauth
//   3. STRAVA_ACCESS_TOKEN=xxx npm run segment-streams:fetch
//
// Safe to interrupt and resume: the file is written after every id, and ids
// already in it are skipped unless --force is passed. Paced to stay under
// Strava's ~100 req/15min rate limit; on a 429 it backs off and retries
// rather than failing the run. To refetch specific ids only, pass --only with
// one or more ids - implies --force for exactly those and touches nothing else:
//
//   STRAVA_ACCESS_TOKEN=xxx npm run segment-streams:fetch -- --only 38170270
//
// Then place the new tracks and commit both files:
//
//   npm run segment-placements:compute

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { segments } from 'zwift-data'
import * as streams from 'zwift-data/streams'
import { loadSharedModule } from '../route-surfaces/loadShared.mjs'
import { roundStravaStreams } from './roundStreams.mjs'

const { SUPPLEMENT_SEGMENT_STRAVA_IDS, supplementIdsThePackageShips } = loadSharedModule('shared/data/segmentStravaIdSupplement.ts')
const { expectedSupplementLengthM, supplementTrackLengthMismatch } = loadSharedModule('shared/utils/segmentSupplementStreams.ts')

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outPath = path.join(repoRoot, 'shared/data/segmentStreams.supplement.json')

const token = process.env.STRAVA_ACCESS_TOKEN
if (!token) {
  console.error('Missing STRAVA_ACCESS_TOKEN - see the comment at the top of this script for setup.')
  process.exit(1)
}

const force = process.argv.includes('--force')
const onlyIds = new Set(process.argv.flatMap((arg, i) => (arg === '--only' && process.argv[i + 1] ? [process.argv[i + 1]] : [])))
const requestDelayMs = 9_500 // ~1 req/9.5s, comfortably under Strava's 100 req/15min

const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf-8')) : {}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchStreams(stravaSegmentId) {
  const url = `https://www.strava.com/api/v3/segments/${stravaSegmentId}/streams?keys=latlng,distance,altitude&key_by_type=true`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })

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
  if (!latlng || !distance) throw new Error('Response missing latlng/distance stream')
  return { latlng, distance, altitude: body.altitude?.data }
}

/** One id per entry, its three streams on a line each, so a refetch diffs as a few lines. */
function serialize(results) {
  const ids = Object.keys(results).sort((a, b) => Number(a) - Number(b))
  if (!ids.length) return '{}\n'
  const entries = ids.map(id => `  ${JSON.stringify(id)}: {\n${Object.entries(results[id]).map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n')}\n  }`)
  return `{\n${entries.join(',\n')}\n}\n`
}

// The package wins: an entry zwift-data now has an id or a track for is to be
// deleted, not fetched (segmentStravaIdSupplement.test.ts names it too).
const shipped = new Set(supplementIdsThePackageShips(segments, Object.keys(streams.segments)).map(entry => entry.segment))
for (const slug of shipped) console.warn(`WARNING: zwift-data now has an id or a track for ${slug} - delete its entry from segmentStravaIdSupplement.ts instead of fetching it.`)

const toFetch = SUPPLEMENT_SEGMENT_STRAVA_IDS.filter(entry => !shipped.has(entry.segment)
  && (onlyIds.size > 0 ? onlyIds.has(String(entry.stravaSegmentId)) : (force || !existing[entry.stravaSegmentId])))
console.log(`${toFetch.length} Strava segments to fetch (${SUPPLEMENT_SEGMENT_STRAVA_IDS.length - toFetch.length} already fetched or skipped)\n`)

// A typoed --only id would otherwise just silently fetch nothing.
for (const id of onlyIds) {
  if (!toFetch.some(entry => String(entry.stravaSegmentId) === id)) {
    console.warn(`WARNING: --only ${id} matches no entry in segmentStravaIdSupplement.ts that zwift-data still lacks.`)
  }
}

const today = new Date().toISOString().slice(0, 10)
const results = { ...existing }
let done = 0
for (const entry of toFetch) {
  const { segment, stravaSegmentId } = entry
  process.stdout.write(`[${++done}/${toFetch.length}] ${segment} (Strava ${stravaSegmentId})... `)
  try {
    const track = roundStravaStreams(await fetchStreams(stravaSegmentId))
    results[stravaSegmentId] = { ...track, fetchedAt: today }
    const fetchedM = Math.round(track.distance.at(-1) - track.distance[0])
    const expectedM = expectedSupplementLengthM(entry)
    const mismatch = supplementTrackLengthMismatch(track, expectedM)
    console.log(`${fetchedM} m against the ${Math.round(expectedM)} m expected${entry.measuredLengthM ? ' (the entry\'s measured length, not the game\'s label)' : ''} - ${mismatch ? `LENGTH CHECK FAILS (${mismatch}); stored, but the generator will not place it` : 'length check passes'}${track.altitude.length ? '' : ', no altitude stream'}`)
  } catch (err) {
    console.log(`FAILED: ${err.message}`)
  }

  writeFileSync(outPath, serialize(results))
  if (done < toFetch.length) await sleep(requestDelayMs)
}

console.log(`\nWrote ${path.relative(repoRoot, outPath)} (${Object.keys(results).length} Strava segments total)`)
console.log('Next: npm run segment-placements:compute')
