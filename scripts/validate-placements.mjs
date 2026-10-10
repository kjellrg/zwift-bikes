#!/usr/bin/env node
// Proves every climb and sprint placement lies within its route's official
// length, and runs in `npm run validate` (so in the build and the pre-commit
// hook).
//
// Placements enter the domain model in official km (`placementsInOfficialKm`
// in `shared/utils/routeTerrain.ts`, issue #319): zwift-data's
// `segmentsOnRoute` and the track-matched placements beside them are
// measured on the route's community trace, rescaled at ingest by the factor
// the lap's measured surfaces are, and clamped to the lap. Every reader - the
// simulator's known-climb geometry, the lap expansion behind the Course
// hero's bands and the Climb times, the segment slices - then rides them as
// they are, so a placement past the line would be road nobody rides.
//
// Errors (exit 1), per route in the assembled catalog:
//   - a lap placement (`perLap`) starting before the lap or ending past its
//     official distance
//   - a lead-in placement starting before the ride or ending past the
//     official lead-in
//   - a placement whose end is not after its start, or a non-finite one
import { loadSharedModule } from './route-surfaces/loadShared.mjs'

const { getRoutesWithMeta } = loadSharedModule('shared/utils/catalog.ts')

const routes = getRoutesWithMeta()
const errors = []
let checked = 0
for (const route of routes) {
  const placements = [
    ...route.terrain.climbs.map(climb => ({ ...climb, type: 'climb' })),
    ...route.terrain.sprints
  ]
  for (const placement of placements) {
    checked++
    const where = `${route.slug}: ${placement.type} "${placement.slug}" at km ${placement.fromKm}-${placement.toKm}`
    const limitKm = placement.perLap ? route.distance : (route.leadInDistance ?? 0)
    const span = placement.perLap ? `the ${route.distance} km lap` : `the ${route.leadInDistance ?? 0} km lead-in`
    if (!Number.isFinite(placement.fromKm) || !Number.isFinite(placement.toKm)) errors.push(`${where} is not a finite position`)
    else if (placement.toKm <= placement.fromKm) errors.push(`${where} ends before it starts`)
    else if (placement.fromKm < 0 || placement.toKm > limitKm) errors.push(`${where} lies outside ${span}`)
  }
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`)
  console.error(`validate-placements: ${errors.length} placement(s) outside their route's official length`)
  process.exit(1)
}
console.log(`validate-placements: OK (${checked} placements on ${routes.length} routes, each within its lap or lead-in)`)
