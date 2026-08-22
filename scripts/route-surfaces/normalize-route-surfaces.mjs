#!/usr/bin/env node
// One-off/idempotent migration: normalizes every entry of
// shared/data/routeSurfaces.generated.json to the lap-relative convention
// (issue #126) using the pure transform in normalize.mjs. No Strava calls -
// the committed data retains full along-trace positions, so this is offline
// arithmetic against zwift-data's official distances. Entries already
// lap-aligned (the overwhelming majority) come out byte-identical; entries
// keyed to a slug zwift-data doesn't know are left untouched and reported.
//
//   node scripts/route-surfaces/normalize-route-surfaces.mjs
//
// compute-route-surfaces.mjs applies the same transform to every fresh
// fetch, so a regeneration cannot reintroduce mixed alignment.

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { routes } from 'zwift-data'
import { loadSharedModule } from './loadShared.mjs'
import { normalizeRouteSurfaceEntry } from './normalize.mjs'

const { eventLeadIn } = loadSharedModule('shared/data/routeEventLeadIns.ts')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outPath = path.resolve(__dirname, '../../shared/data/routeSurfaces.generated.json')

const data = JSON.parse(readFileSync(outPath, 'utf-8'))
const routeBySlug = new Map(routes.map(r => [r.slug, r]))

const byClassification = {}
const results = {}
for (const [slug, entry] of Object.entries(data)) {
  const route = routeBySlug.get(slug)
  if (!route) {
    results[slug] = entry
    ;(byClassification['unknown-slug'] ??= []).push(slug)
    continue
  }
  // The effective lead-in consumers see - event overrides included - so the
  // split lands where `geometryForRouteLaps` will actually cut the ride.
  const leadInKm = eventLeadIn(slug, route.leadInDistance, route.leadInElevation).leadInDistance ?? 0
  const { entry: normalized, classification, profileDropped } = normalizeRouteSurfaceEntry(entry, route.distance, leadInKm, route.elevation)
  results[slug] = normalized
  ;(byClassification[classification] ??= []).push(slug)
  if (profileDropped) (byClassification['flat-profile-dropped'] ??= []).push(slug)
}

writeFileSync(outPath, JSON.stringify(results, null, 1))

for (const [classification, slugs] of Object.entries(byClassification)) {
  const detail = ['ride-split', 'ambiguous', 'unknown-slug', 'flat-profile-dropped'].includes(classification) ? `: ${slugs.join(', ')}` : ''
  console.log(`${classification}: ${slugs.length}${detail}`)
}
