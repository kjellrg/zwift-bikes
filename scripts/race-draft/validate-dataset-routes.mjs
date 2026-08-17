// Every race in the local calibration dataset must name a route the catalog
// still resolves. Shared by analyze-field-draft.mjs and
// spot-check-shipped-race-mode.mjs so neither can drift from the other.
//
// This exists because of a real failure, not a hypothetical one. The dataset
// carried Makuri Madness stage 1 as `"routeSlug": "mech-isle-mayhem"`, which
// zwift-data does not use - its slug for that route is the bare numeric id
// `2919739330`. The spot-check printed one "skipped" line and went on to pool
// and PASS without it, and the analyzer threw mid-run with a bare `Unknown
// route:` and no indication that the fix is a re-key rather than a missing
// route. A race can leave the calibration set for a documented reason; it must
// never leave because a slug rotted.
//
// The same rot hits `shared/data/routeSurfaces.generated.json`, whose keys are
// route slugs too - compute-route-surfaces.mjs warns about orphaned keys for
// exactly this reason. zwift-data replacing a numeric id with a readable slug
// (or the reverse) breaks both at once.

/**
 * @param {{races: Record<string, {routeSlug: string, label?: string}>}} dataset
 * @param {(slug: string) => unknown} getRouteBySlug
 * @param {string} scriptName Prefix for the error message, e.g. 'analyze-field-draft'.
 */
export function assertDatasetRoutesResolve(dataset, getRouteBySlug, scriptName) {
  const unresolved = Object.entries(dataset.races ?? {})
    .filter(([, race]) => !getRouteBySlug(race.routeSlug))
    .map(([raceSlug, race]) => ({ raceSlug, routeSlug: race.routeSlug }))

  if (unresolved.length === 0) return

  console.error(`${scriptName}: ${unresolved.length} race${unresolved.length === 1 ? '' : 's'} in field-results.json name${unresolved.length === 1 ? 's' : ''} a route the catalog cannot resolve:\n`)
  for (const { raceSlug, routeSlug } of unresolved) {
    console.error(`  ${raceSlug}: routeSlug "${routeSlug}"`)
  }
  console.error(`
Usually zwift-data renamed the route's slug - most often swapping a readable
name for a bare numeric route id, or the reverse. Find the current slug with

  node scripts/events/find-route.mjs <name>

and re-key the race (keeping its riders), or delete the race if the route is
gone for good. Do not leave it unresolved: these scripts refuse to run rather
than quietly calibrate on a smaller set of races than the report claims.`)
  process.exit(1)
}
