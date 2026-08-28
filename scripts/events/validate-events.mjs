#!/usr/bin/env node
// Validates the hand-curated racing calendar in shared/data/events/ against
// the real route catalog, and runs as the first step of `npm run build` (see
// package.json) - which is also what the husky pre-commit hook runs, so a bad
// entry is caught before it can be committed, let alone deployed.
//
// Why this exists: every field in a season file is typed in by hand from the
// organisers' schedules and ZwiftInsider's guides. The failure mode isn't a
// crash - it's a page that renders perfectly while being quietly wrong: a
// mistyped route slug silently 404s, and a wrong lap count produces a
// plausible-looking distance and a bike recommendation computed over the
// wrong geometry. Neither shows up in a typecheck.
//
// Schema-level validation (field types, powerup enum values, kebab-case
// slugs, ISO dates, cats-or-label on every group) happens before any of the
// checks below: `shared/utils/events.ts` zod-parses every season file at
// module init and throws with the season slug and JSON path - importing it
// here surfaces that as a build failure with a precise message.
//
// Errors (exit 1):
//   - a `routeSlug` that doesn't exist in zwift-data
//   - laps > 1 on a route that isn't lap-based (`route.lap === false`)
//   - a repeated race slug/path within a season
//   - a race date outside its round's published start/end dates, an
//     `endDate` before `date`, or one past the round's end
//   - a scoring segment `slug` with no segment page (the link would 404)
//   - published distance more than 5% off this site's own totals, UNLESS the
//     group's `curatorNote` documents the divergence (ZwiftInsider's ZRacing
//     figures include an event-pen lead-in and legitimately run ~2 km over
//     route + lead-in; an unexplained divergence is still treated as a
//     mistyped route or lap count)
//
// Warnings (exit 0):
//   - a race slug that deviates from its series' naming convention
//     (`round-{r}-week-{w}` for ZRL, `stage-{w}` for ZRacing) - demoted from
//     the old hard error since each series names races its own way
//   - published elevation more than 10% off this site's own totals (a known,
//     real divergence: across ZRL 2025/26 R4 one race's published elevation
//     ran ~86 m high while distances agreed to ~3%; both figures are shown on
//     the race page for exactly this reason)
//   - a documented >5% distance divergence (see above)
//   - a race with a route but no format or lap counts (stays unpublished)
//   - missing tactical note / sourceUrl on a publishable race

import { routes } from 'zwift-data'
// Shared TS modules can't be imported by plain node directly (extensionless,
// bundler-style imports) - reuse the esbuild loader the route-surface scripts
// already use for the same reason.
import { loadSharedModule } from '../route-surfaces/loadShared.mjs'

// `getAllSeasons` deliberately, not `getSeasons`: a hidden season is still
// validated. `hidden` retires a page, it isn't a way to smuggle broken data
// past the build.
let events
try {
  events = loadSharedModule('shared/utils/events.ts')
} catch (error) {
  // The zod parse at module init failed - its message already carries the
  // season slug and JSON path.
  console.error(`[events] error: ${error.message}`)
  process.exit(1)
}
const { getAllSeasons, isRacePublishable, raceEndDate } = events
const { getAllSegmentSummaries } = loadSharedModule('shared/utils/routeSegments.ts')
const { computeRouteTotals } = loadSharedModule('shared/utils/routeLaps.ts')
const { eventLeadIn } = loadSharedModule('shared/data/routeEventLeadIns.ts')

const DISTANCE_TOLERANCE = 0.05
const ELEVATION_TOLERANCE = 0.10

/** Per-series race slug conventions, checked as a warning - see the header. */
const SLUG_CONVENTIONS = {
  zrl: race => `round-${race.round}-week-${race.week}`,
  zracing: race => `stage-${race.week}`
}

// Routes as the SITE sees them, not as zwift-data ships them: a handful of
// event-only routes carry a wrong lead-in in Zwift's own game dictionary and
// are corrected in `shared/data/routeEventLeadIns.ts`. Reading the raw catalog
// here would make this validator warn about a divergence the site no longer
// has - and, worse, would keep warning after the fix, training the curator to
// ignore it. The published-distance check is only meaningful against the
// distance we actually show.
const routesBySlug = new Map(
  routes
    .filter(route => route.slug)
    .map(route => [route.slug, { ...route, ...eventLeadIn(route.slug, route.leadInDistance, route.leadInElevation) }])
)
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

const groupLabel = group => group.label ?? group.cats.join('/')

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

      const convention = SLUG_CONVENTIONS[season.seriesSlug]
      if (convention) {
        const expectedSlug = convention(race)
        if (race.slug !== expectedSlug) {
          warnings.push(`${where}: slug deviates from the ${season.seriesSlug} convention - expected "${expectedSlug}"`)
        }
      }
      if (race.round !== round.number) {
        errors.push(`${where}: race.round is ${race.round} but it sits in round ${round.number}`)
      }
      if (race.date < round.startDate || race.date > round.endDate) {
        errors.push(`${where}: date ${race.date} is outside round ${round.number} (${round.startDate} - ${round.endDate})`)
      }
      if (race.endDate !== undefined) {
        if (race.endDate < race.date) errors.push(`${where}: endDate ${race.endDate} is before date ${race.date}`)
        else if (race.endDate > round.endDate) errors.push(`${where}: endDate ${race.endDate} is past round ${round.number}'s end (${round.endDate})`)
      }

      if (!race.categories.length) {
        notes.push(`${where}: ${race.hidden || seasonHidden ? 'hidden' : 'unannounced (no routes yet)'} - not published`)
        if (race.hidden || seasonHidden) hiddenCount++
        continue
      }

      // Per category group, since A/B and C/D can be on different routes with
      // different laps and different published figures.
      for (const group of race.categories) {
        const cats = groupLabel(group)

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
        // computeRouteTotals clamps through clampLaps, which since the
        // MAX_TOTAL_DISTANCE_KM cap can return fewer laps than asked. An
        // event listing above the cap would render a ranking for a shorter
        // ride than the race - fail the build so the cap gets raised
        // deliberately instead of clamping silently.
        if (totals.laps !== group.laps) {
          errors.push(`${where}: ${cats} is set to ${group.laps} laps of "${route.slug}", but the recommend API caps this route at ${totals.laps} lap(s) `
            + `(total ride would exceed MAX_TOTAL_DISTANCE_KM - see shared/utils/routeLaps.ts)`)
        }
        if (group.officialDistanceKm !== undefined) {
          const diff = Math.abs(group.officialDistanceKm - totals.distanceKm) / group.officialDistanceKm
          if (diff > DISTANCE_TOLERANCE) {
            const message = `${where}: ${cats} published distance ${group.officialDistanceKm} km is ${(diff * 100).toFixed(1)}% off our ${totals.distanceKm.toFixed(1)} km `
              + `(${totals.laps} lap(s) of "${route.slug}") - check the route and lap count`
            // An unexplained divergence looks exactly like a wrong slug or
            // lap count; one the curator has documented (event-pen lead-in)
            // is a known fact of the listing, not a data error.
            if (group.curatorNote) warnings.push(`${message} (curatorNote present - documented divergence)`)
            else errors.push(message)
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

      // Every lettered pen should be accounted for exactly once - a rider
      // whose category is missing (or listed twice) has no answer on the
      // page. Score-range groups (`label`, empty `cats` - ZRacing) don't
      // partition A-D, so the check only applies to races that use pens.
      const seenCats = race.categories.flatMap(group => group.cats)
      const dupeCats = seenCats.filter((cat, i) => seenCats.indexOf(cat) !== i)
      if (dupeCats.length) errors.push(`${where}: category ${[...new Set(dupeCats)].join('/')} appears in more than one group`)
      if (seenCats.length) {
        for (const cat of ['A', 'B', 'C', 'D']) {
          if (!seenCats.includes(cat)) warnings.push(`${where}: no category group covers ${cat}`)
        }
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

      // A points-scored race with no scoring segments is worth a second look
      // at the source - it's what a missed column looks like too. Marking the
      // group `scoringSegmentsTbd` says "checked, not published yet" and
      // silences it. A Race of Truth scores the same way, so it counts here.
      if ((race.format === 'points' || race.format === 'rot') && !race.categories.some(g => g.falSegments?.length || g.ftsSegments?.length)) {
        const tbd = race.categories.every(g => g.scoringSegmentsTbd)
        if (!tbd) warnings.push(`${where}: ${race.format === 'rot' ? 'race of truth' : 'points race'} with no FAL/FTS segments and not marked scoringSegmentsTbd - confirm the source really lists none`)
        else notes.push(`${where}: scoring segments marked TBD - re-check the source`)
      }

      if (!race.note) warnings.push(`${where}: no tactical note - the page has nothing on it that a route page doesn't`)
      if (!race.sourceUrl) warnings.push(`${where}: no sourceUrl to attribute the race details to`)
    }
  }

  // Sorted per round rather than across the season: ZRacing rounds are
  // calendar months, ZRL rounds don't overlap either, so within-round order
  // is the invariant that catches a mistyped date.
  for (const round of season.rounds) {
    const dates = round.races.map(race => race.date)
    if (dates.some((date, i) => i > 0 && date <= dates[i - 1])) {
      errors.push(`${season.slug} round ${round.number}: race dates aren't in ascending calendar order`)
    }
    const ends = round.races.map(race => raceEndDate(race))
    if (round.races.some((race, i) => i > 0 && ends[i - 1] >= race.date)) {
      errors.push(`${season.slug} round ${round.number}: a race window overlaps the one before it`)
    }
  }
}

for (const note of notes) console.log(`[events]  note: ${note}`)
for (const warning of warnings) console.warn(`[events]  warn: ${warning}`)
for (const error of errors) console.error(`[events] error: ${error}`)

console.log(`[events] ${raceCount} race(s) checked, ${publishableCount} with a page, ${hiddenCount} hidden, ${errors.length} error(s), ${warnings.length} warning(s)`)

if (errors.length) process.exit(1)
