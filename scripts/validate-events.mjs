#!/usr/bin/env node
// Validates the hand-curated racing calendar in shared/data/events/ against
// the real route catalog, and runs as the first step of `npm run build` (see
// package.json) - which is also what the husky pre-commit hook runs, so a bad
// entry is caught before it can be committed, let alone deployed.
//
// Why this exists: every field in a season file is typed in by hand from
// WTRL's schedule and ZwiftInsider's round guides. The failure mode isn't a
// crash - it's a page that renders perfectly while being quietly wrong: a
// mistyped route slug silently 404s, and a wrong lap count produces a
// plausible-looking distance and a bike recommendation computed over the
// wrong geometry. Neither shows up in a typecheck.
//
// Errors (exit 1):
//   - a `routeSlug` that doesn't exist in zwift-data
//   - laps > 1 on a route that isn't lap-based (`route.lap === false`)
//   - a race slug that doesn't match its own round/week numbers, or repeats
//   - a race date outside its round's published start/end dates
//   - published distance more than 5% off this site's own totals
//
// Warnings (exit 0):
//   - published elevation more than 10% off this site's own totals. This is a
//     known, real divergence rather than a data-entry mistake: measured across
//     ZRL 2025/26 Round 4, distances agreed to within ~3% but Double Span
//     Spin's published elevation ran ~86 m (>20%) above the route data. Both
//     numbers are shown on the race page for exactly this reason - the physics
//     always runs on the route data, never on the published figure.
//   - a race with a route but no format or lap counts, which stays unpublished

import { routes } from 'zwift-data'
// Shared TS modules can't be imported by plain node directly (extensionless,
// bundler-style imports) - reuse the esbuild loader the route-surface scripts
// already use for the same reason.
import { loadSharedModule } from './route-surfaces/loadShared.mjs'

// `getAllSeasons` deliberately, not `getSeasons`: a hidden season is still
// validated. `hidden` retires a page, it isn't a way to smuggle broken data
// past the build.
const { getAllSeasons, getSeasonRaces, isRacePublishable } = loadSharedModule('shared/utils/events.ts')
const { getAllSegmentSummaries } = loadSharedModule('shared/utils/routeSegments.ts')
const { computeRouteTotals } = loadSharedModule('shared/utils/routeLaps.ts')

const DISTANCE_TOLERANCE = 0.05
const ELEVATION_TOLERANCE = 0.10

const routesBySlug = new Map(routes.filter(route => route.slug).map(route => [route.slug, route]))
// The segments this site actually has pages for - a scoring segment can only
// carry a `slug` if it's in here, or the race page renders a link to a 404.
const segmentPages = new Map(getAllSegmentSummaries().map(segment => [segment.slug, segment]))
const segmentPageByName = new Map([...segmentPages.values()].map(segment => [segment.name.toLowerCase().replace(/[^a-z0-9]/g, ''), segment]))

const errors = []
const warnings = []
const notes = []

let raceCount = 0
let publishableCount = 0
let hiddenCount = 0
const seenPaths = new Set()

for (const season of getAllSeasons()) {
  const seenSlugs = new Set()
  // A hidden season retires every race under it, so they're counted as hidden
  // rather than as pages - the summary line shouldn't claim a page exists for
  // a URL that 404s.
  const seasonHidden = Boolean(season.hidden)
  if (seasonHidden) notes.push(`${season.slug}: season is hidden - no hub card, no season page, no race pages`)

  for (const round of season.rounds) {
    for (const race of round.races) {
      raceCount++
      const where = `${season.slug}/${race.slug}`

      if (seenSlugs.has(race.slug)) errors.push(`${where}: duplicate race slug within the season`)
      seenSlugs.add(race.slug)

      const path = `/events/${season.slug}/${race.slug}`
      if (seenPaths.has(path)) errors.push(`${where}: duplicate race path ${path}`)
      seenPaths.add(path)

      const expectedSlug = `round-${race.round}-week-${race.week}`
      if (race.slug !== expectedSlug) {
        errors.push(`${where}: slug doesn't match its round/week - expected "${expectedSlug}"`)
      }
      if (race.round !== round.number) {
        errors.push(`${where}: race.round is ${race.round} but it sits in round ${round.number}`)
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(race.date)) {
        errors.push(`${where}: date "${race.date}" isn't an ISO YYYY-MM-DD date`)
      } else if (race.date < round.startDate || race.date > round.endDate) {
        errors.push(`${where}: date ${race.date} is outside round ${round.number} (${round.startDate} - ${round.endDate})`)
      }

      if (!race.categories.length) {
        notes.push(`${where}: ${race.hidden || seasonHidden ? 'hidden' : 'unannounced (no routes yet)'} - not published`)
        if (race.hidden || seasonHidden) hiddenCount++
        continue
      }

      // Per category group, since A/B and C/D can be on different routes with
      // different laps and different published figures.
      for (const group of race.categories) {
        const cats = group.cats.join('/')
        if (!group.cats.length) errors.push(`${where}: a category group lists no categories`)
        if (group.laps < 1) errors.push(`${where}: ${cats} has an invalid lap count (${group.laps})`)

        if (!group.routeSlug) {
          // Legitimate for an unlisted "exclusive" route, but then it has to
          // at least say what it's called, or the page has nothing to show.
          if (!group.routeName) errors.push(`${where}: ${cats} has neither a routeSlug nor a routeName`)
          continue
        }

        const route = routesBySlug.get(group.routeSlug)
        if (!route) {
          errors.push(`${where}: ${cats} routeSlug "${group.routeSlug}" doesn't exist in zwift-data`)
          continue
        }
        // A slug that resolves to a route with a quite different name is the
        // signature of a mis-mapping - it will render perfectly and be wrong.
        // Compared loosely, since punctuation and casing legitimately differ.
        if (group.routeName) {
          const norm = value => value.toLowerCase().replace(/[^a-z0-9]/g, '')
          if (norm(group.routeName) !== norm(route.name)) {
            warnings.push(`${where}: ${cats} is published as "${group.routeName}" but slug "${group.routeSlug}" is "${route.name}" - confirm the mapping`)
          }
        } else {
          warnings.push(`${where}: ${cats} has no routeName, so nothing cross-checks the slug mapping`)
        }

        for (const [kind, list] of [['FAL', group.falSegments], ['FTS', group.ftsSegments]]) {
          for (const scoring of list ?? []) {
            if (!scoring.name) {
              errors.push(`${where}: ${cats} has a ${kind} scoring segment with no name`)
              continue
            }
            if (scoring.slug && !segmentPages.has(scoring.slug)) {
              errors.push(`${where}: ${cats} ${kind} segment "${scoring.name}" has slug "${scoring.slug}", which has no segment page - the race page would link to a 404`)
            }
            // The other direction: a segment that has since gained a page
            // should get its link, and nothing else would ever tell us.
            if (!scoring.slug) {
              const match = segmentPageByName.get(scoring.name.toLowerCase().replace(/[^a-z0-9]/g, '').replace('fwd', ''))
              if (match) notes.push(`${where}: ${cats} ${kind} segment "${scoring.name}" now has a page (${match.slug}) - add the slug to link it`)
            }
          }
        }

        if (group.laps > 1 && !route.lap) {
          errors.push(`${where}: ${cats} is set to ${group.laps} laps, but "${route.slug}" is a point-to-point route that can only be ridden once`)
        }

        if (race.hidden || seasonHidden || !isRacePublishable(race)) continue

        const totals = computeRouteTotals(route, group.laps)
        if (group.officialDistanceKm !== undefined) {
          const diff = Math.abs(group.officialDistanceKm - totals.distanceKm) / group.officialDistanceKm
          if (diff > DISTANCE_TOLERANCE) {
            errors.push(
              `${where}: ${cats} published distance ${group.officialDistanceKm} km is ${(diff * 100).toFixed(1)}% off our ${totals.distanceKm.toFixed(1)} km `
              + `(${totals.laps} lap(s) of "${route.slug}") - check the route and lap count`
            )
          }
        }
        if (group.officialElevationM !== undefined && group.officialElevationM > 0) {
          const diff = Math.abs(group.officialElevationM - totals.elevationM) / group.officialElevationM
          if (diff > ELEVATION_TOLERANCE) {
            warnings.push(
              `${where}: ${cats} published elevation ${group.officialElevationM} m is ${(diff * 100).toFixed(1)}% off our ${Math.round(totals.elevationM)} m `
              + '- expected for some routes, but worth confirming the lap count'
            )
          }
        }
      }

      // Every category should be accounted for exactly once - a rider whose
      // category is missing (or listed twice) has no answer on the page.
      const seenCats = race.categories.flatMap(group => group.cats)
      const dupeCats = seenCats.filter((cat, i) => seenCats.indexOf(cat) !== i)
      if (dupeCats.length) errors.push(`${where}: category ${[...new Set(dupeCats)].join('/')} appears in more than one group`)
      for (const cat of ['A', 'B', 'C', 'D']) {
        if (!seenCats.includes(cat)) warnings.push(`${where}: no category group covers ${cat}`)
      }

      if (race.hidden || seasonHidden) {
        hiddenCount++
        // No per-race note when the whole season is hidden - the season-level
        // note above already says it, once instead of two dozen times.
        if (race.hidden) notes.push(`${where}: hidden - retired, not published`)
        continue
      }

      if (!isRacePublishable(race)) {
        notes.push(`${where}: has categories but ${!race.format ? 'no format' : 'no resolvable route'} - not published`)
        continue
      }
      publishableCount++

      // A points race with no scoring segments is worth a second look at the
      // source - it's what a missed column looks like too. Marking the group
      // `scoringSegmentsTbd` says "checked, not published yet" and silences it.
      if (race.format === 'points' && !race.categories.some(g => g.falSegments?.length || g.ftsSegments?.length)) {
        const tbd = race.categories.every(g => g.scoringSegmentsTbd)
        if (!tbd) warnings.push(`${where}: points race with no FAL/FTS segments and not marked scoringSegmentsTbd - confirm the source really lists none`)
        else notes.push(`${where}: scoring segments marked TBD - re-check the source`)
      }

      if (!race.note) warnings.push(`${where}: no tactical note - the page has nothing on it that a route page doesn't`)
      if (!race.sourceUrl) warnings.push(`${where}: no sourceUrl to attribute the race details to`)
    }
  }

  const dates = getSeasonRaces(season).map(race => race.date)
  if (dates.some((date, i) => i > 0 && date <= dates[i - 1])) {
    errors.push(`${season.slug}: race dates aren't in ascending calendar order`)
  }
}

for (const note of notes) console.log(`[events]  note: ${note}`)
for (const warning of warnings) console.warn(`[events]  warn: ${warning}`)
for (const error of errors) console.error(`[events] error: ${error}`)

console.log(`[events] ${raceCount} race(s) checked, ${publishableCount} with a page, ${hiddenCount} hidden, ${errors.length} error(s), ${warnings.length} warning(s)`)

if (errors.length) process.exit(1)
