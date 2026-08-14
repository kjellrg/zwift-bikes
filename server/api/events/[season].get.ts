import { getRouteBySlug } from '../../../shared/utils/catalog'
import { getSeasonBySlug } from '../../../shared/utils/events'
import { computeRouteTotals } from '../../../shared/utils/routeLaps'
import type { EventRaceCategoryWithRoute, EventSeasonWithRoutes } from '../../../shared/types/events'

/**
 * A season's calendar with every category group joined to its route.
 *
 * The join lives here rather than in `shared/utils/events.ts` so the calendar
 * module can stay a leaf - route data reaches the client as a narrow
 * `EventRaceRoute`, never as the surface/elevation dataset behind it.
 */
export default defineEventHandler((event): EventSeasonWithRoutes => {
  const slug = getRouterParam(event, 'season')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing season slug' })

  const season = getSeasonBySlug(slug)
  if (!season) throw createError({ statusCode: 404, statusMessage: `Season "${slug}" not found` })

  return {
    ...season,
    rounds: season.rounds.map(round => ({
      ...round,
      // Hidden races are dropped here rather than in the page, so a retired
      // race never reaches the client at all - not even as a row the template
      // then decides not to draw. (A hidden *season* never gets this far:
      // `getSeasonBySlug` doesn't return one, so the handler 404s above.)
      races: round.races.filter(race => !race.hidden).map(race => ({
        ...race,
        categories: race.categories.map((group): EventRaceCategoryWithRoute => {
          // No slug at all while a round is unannounced, or when the group
          // races an unlisted route (`routeName` carries it instead). A slug
          // that's set but doesn't resolve is a data error, and
          // `scripts/validate-events.mjs` fails the build on it rather than
          // letting this 500 at request time.
          const route = group.routeSlug ? getRouteBySlug(group.routeSlug) : undefined
          if (!route) return { ...group }

          const totals = computeRouteTotals(route, group.laps)
          return {
            ...group,
            // Not `toRouteSummary` - see `EventRaceRoute`. A calendar row shows
            // a name, a world and a distance; the summary would also ship the
            // route's full elevation profile and surface segments.
            route: {
              slug: route.slug,
              name: route.name,
              world: route.world,
              worldName: route.worldName,
              distance: route.distance,
              elevation: route.elevation
            },
            computed: {
              laps: totals.laps,
              distanceKm: totals.distanceKm,
              elevationM: totals.elevationM
            }
          }
        })
      }))
    }))
  }
})
