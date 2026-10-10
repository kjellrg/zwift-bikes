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
//   - a season without a `seriesTag` (the schema's), seasons of one series
//     with different tags, or two series with the same one - the events hub
//     tags every race row with it, so a tag has to say which series a row
//     belongs to
//
// Warnings (exit 0):
//   - a race slug that deviates from its series' naming convention
//     (`round-{r}-week-{w}` for ZRL, `{month}-stage-{w}` for ZRacing) - demoted from
//     the old hard error since each series names races its own way
//   - published figures that differ from this site's own totals by the race
//     page's own rule (`officialFiguresDiffer` in the race statement: 0.15 km
//     or 5 m), where the page prints both - a mistyped route or lap count
//     looks exactly like this, and so does a real divergence (ZwiftInsider's
//     ZRacing figures include an event-pen lead-in; ZRL has published an
//     elevation ~86 m high while the distances agreed), which the group's
//     `curatorNote` documents
//   - a race with a route but no format or lap counts (stays unpublished)
//   - missing tactical note / sourceUrl on a publishable race
//   - with `--notes` only: a tactical note whose claim about climbing versus
//     aerodynamics the physics contradicts (see check-race-notes.mjs; needs
//     TYPESAFE_API_KEY and the network, so the build never passes it)

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
const { officialFiguresDiffer } = loadSharedModule('shared/utils/rideStatement/race.ts')
const { eventLeadIn } = loadSharedModule('shared/data/routeEventLeadIns.ts')

// ZRacing rounds are calendar months, so a bare `stage-{w}` collides the
// moment a season covers a second one: August 2026's stage 1 and September's
// are different races on the same season page. Month-qualified from September
// 2026 onwards.
const MONTH_SLUGS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** Per-series race slug conventions, checked as a warning - see the header. */
const SLUG_CONVENTIONS = {
  zrl: race => `round-${race.round}-week-${race.week}`,
  zracing: race => `${MONTH_SLUGS[race.round - 1]}-stage-${race.week}`
}

// August 2026 shipped as `stage-{w}` before ZRacing had a second month, and
// those four URLs are indexed. Renaming them to match the convention would
// trade a warning here for four real 404s, so they are grandfathered instead.
const LEGACY_SLUG_ROUNDS = new Set(['zracing-2026/8'])

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
        if (race.slug !== expectedSlug && !LEGACY_SLUG_ROUNDS.has(`${season.slug}/${race.round}`)) {
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
        // The race page's own rule (`officialFiguresDiffer` in the race
        // statement): where the organiser's figures and ours differ by 0.15 km
        // or 5 m, the page prints both. Worth a look, because a mistyped
        // route or lap count looks exactly like this; a divergence the
        // curator has documented (an event-pen lead-in) is a known fact of
        // the listing.
        if (officialFiguresDiffer(group, totals)) {
          const published = [
            group.officialDistanceKm !== undefined ? `${group.officialDistanceKm} km` : undefined,
            group.officialElevationM !== undefined ? `${group.officialElevationM} m` : undefined
          ].filter(Boolean).join(' / ')
          warnings.push(
            `${where}: ${cats} published ${published} differs from our ${totals.distanceKm.toFixed(1)} km / ${Math.round(totals.elevationM)} m `
            + `(${totals.laps} lap(s) of "${route.slug}") - the race page shows both; check the route and lap count`
            + (group.curatorNote ? ' (curatorNote present - documented divergence)' : '')
          )
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

  // The rounds themselves: each window must be ordered, and rounds must not
  // overlap or run backwards - the per-race checks above only place a race
  // INSIDE its round, so a round whose own dates were mistyped passed them.
  for (const [i, round] of season.rounds.entries()) {
    if (round.endDate < round.startDate) errors.push(`${season.slug} round ${round.number}: endDate ${round.endDate} is before startDate ${round.startDate}`)
    const previous = season.rounds[i - 1]
    if (previous && round.startDate <= previous.endDate) {
      errors.push(`${season.slug} round ${round.number} (${round.startDate}) starts before round ${previous.number} ends (${previous.endDate})`)
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
    // Hidden races are retired entries (a reschedule keeps the old row,
    // hidden, next to its replacement), so only visible windows can overlap.
    const visible = round.races.filter(race => !race.hidden && !seasonHidden)
    const ends = visible.map(race => raceEndDate(race))
    if (visible.some((race, i) => i > 0 && ends[i - 1] >= race.date)) {
      errors.push(`${season.slug} round ${round.number}: a race window overlaps the one before it`)
    }
  }
}

// The short series tag the events hub sets in front of every race and names
// the covered series by. The schema requires one per season; what it can't
// see is the seasons side by side.
const tagsBySeries = new Map()
for (const season of getAllSeasons()) {
  tagsBySeries.set(season.seriesSlug, new Set([...(tagsBySeries.get(season.seriesSlug) ?? []), season.seriesTag]))
}
const seriesByTag = new Map()
for (const [series, tags] of tagsBySeries) {
  if (tags.size > 1) errors.push(`${series}: seasons disagree on the series tag (${[...tags].join(', ')}) - every season of a series carries the same one`)
  for (const tag of tags) {
    if (seriesByTag.has(tag)) errors.push(`${series}: series tag "${tag}" is already ${seriesByTag.get(tag)}'s - a hub row's tag has to say which series it is`)
    else seriesByTag.set(tag, series)
  }
}

if (process.argv.includes('--notes')) {
  const { checkRaceNotes } = await import('./check-race-notes.mjs')
  const checked = await checkRaceNotes(getAllSeasons())
  notes.push(...checked.notes)
  warnings.push(...checked.warnings)
}

for (const note of notes) console.log(`[events]  note: ${note}`)
for (const warning of warnings) console.warn(`[events]  warn: ${warning}`)
for (const error of errors) console.error(`[events] error: ${error}`)

console.log(`[events] ${raceCount} race(s) checked, ${publishableCount} with a page, ${hiddenCount} hidden, ${errors.length} error(s), ${warnings.length} warning(s)`)

if (errors.length) process.exit(1)
