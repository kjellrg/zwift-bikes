#!/usr/bin/env node
// Fuzzy-searches zwift-data for the route (or, with --segments, the segment
// catalog for the scoring-segment) slugs a season file needs:
//
//   npm run events:find-route -- "makuri"
//   npm run events:find-route -- --segments "sprint"
//
// Prints exactly the fields a curator needs to fill a category group: the
// slug to copy, the real name (which cross-checks the published one), the
// distance/elevation the official figures should roughly agree with, the
// lead-in, and whether the route is lap-based (laps > 1 is only legal then).

import { routes } from 'zwift-data'
import { loadSharedModule } from '../route-surfaces/loadShared.mjs'

const args = process.argv.slice(2)
const segmentsMode = args.includes('--segments')
const term = args.filter(arg => arg !== '--segments').join(' ').trim().toLowerCase()

if (!term) {
  console.error('usage: npm run events:find-route -- [--segments] "<name fragment>"')
  process.exit(1)
}

const matches = value => value && value.toLowerCase().includes(term)

if (segmentsMode) {
  const { getAllSegmentSummaries } = loadSharedModule('shared/utils/routeSegments.ts')
  const found = getAllSegmentSummaries().filter(segment => matches(segment.name) || matches(segment.slug))
  if (!found.length) {
    console.log(`no segment pages match "${term}"`)
    process.exit(0)
  }
  for (const segment of found) {
    console.log(`${segment.slug}  |  ${segment.name}  |  ${segment.type}  |  ${segment.lengthKm} km  |  ${segment.worldName}  |  placement: ${segment.placement}`)
  }
  console.log(`\n${found.length} segment page(s). Every slug above is safe to use in falSegments/ftsSegments - the validator 404-checks them anyway.`)
} else {
  const found = routes.filter(route => route.slug && (matches(route.name) || matches(route.slug) || matches(route.world)))
  if (!found.length) {
    console.log(`no zwift-data routes match "${term}"`)
    process.exit(0)
  }
  for (const route of found) {
    const lead = route.leadInDistance ? ` + ${route.leadInDistance} km lead-in` : ''
    console.log(`${route.slug}  |  ${route.name}  |  ${route.world}  |  ${route.distance} km${lead}  |  ${route.elevation} m  |  ${route.lap ? 'lap route' : 'point-to-point (laps must be 1)'}`)
  }
  console.log(`\n${found.length} route(s). Copy the first column into \`routeSlug\`; keep the organiser's own course name in \`routeName\`.`)
}
