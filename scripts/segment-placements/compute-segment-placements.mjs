#!/usr/bin/env node
// Places every segment Host route that zwift-data has not placed, by matching
// the segment's recorded track to the route's - both from `zwift-data/streams`
// (latlng/distance for 338 routes and the 90 segments with a Strava id) - and
// writes shared/data/segmentPlacements.generated.json: every placement, and
// every host it could not place with the reason (held, a missing track, a
// ride-relative route, or the matching rule that failed, with its numbers).
// `getRoutesWithMeta` merges the placements into each route's
// `segmentsOnRoute`; a pair zwift-data has placed is never re-placed (#273).
//
// The matching rules live in shared/utils/segmentMatching.ts and the host
// list (zwift-data's membership, shared/data/segmentHostSupplement.ts and its
// held list) in shared/utils/segmentHostPlacement.ts. The calibration test in
// segmentHostPlacement.test.ts is the matcher's proof, and the same file
// fails when the committed output is not what this script writes.
//
// Makes no network calls and needs no token. Re-run (and commit the diff)
// after a zwift-data upgrade or a change to the supplement:
//
//   npm run segment-placements:compute

import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as streams from 'zwift-data/streams'
import { loadSharedModule } from '../route-surfaces/loadShared.mjs'

const { placeSegmentHosts } = loadSharedModule('shared/utils/segmentHostPlacement.ts')

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outPath = path.join(repoRoot, 'shared/data/segmentPlacements.generated.json')

const result = placeSegmentHosts(streams)
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`)

const placedPairs = new Set(Object.entries(result.placements).flatMap(([route, list]) => list.map(p => `${p.segment} on ${route}`)))
const reasons = Object.entries(Object.groupBy(result.unplaced, u => u.reason)).map(([reason, list]) => `${reason} ${list.length}`).join(', ')
console.log(`Placed ${placedPairs.size} hosts (${Object.values(result.placements).flat().length} passes); ${result.unplaced.length} unplaced (${reasons}).`)
console.log(`Wrote ${path.relative(repoRoot, outPath)}`)
