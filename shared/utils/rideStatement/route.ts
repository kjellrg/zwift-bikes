import type { RouteWithMeta } from '../../types/catalog'
import { TERRAIN_LABELS } from '../courseLabels'
import { rideDescription } from '../rideDescription'
import { climbCountFact, distanceLabel, namedClimbCounts, surfaceCoverageNote, surfaceSplit } from '../rideFacts'
import { computeRouteTotals } from '../routeLaps'
import { formatDistance, formatElevation } from '../units'
import type { RideStatementAnswer, RideStatementBase } from './types'

export interface RouteStatementInputs {
  route: RouteWithMeta
  /** The lap count the rider has picked - what the Fact row describes. */
  laps: number
  /** The public site URL the trail is built on. */
  siteUrl: string
  answer?: RideStatementAnswer
}

export interface RouteStatement extends RideStatementBase {
  kind: 'route'
  /** Beneath the Fact row, where the surfaces are not mapped. */
  coverageNote: string | undefined
  /** The share card's own text, beside rank 1 and the Silhouette (`RouteCard`). */
  shareCard: { props: { title: string, world: string, distance: string, elevation: string }, alt: string }
}

/**
 * A route page's Ride statement. The head, the share card and the twin quote
 * one lap with the lead-in once - the lap count a clean link ranks, and so
 * the one the prerendered page and its card are for; the Fact row follows the
 * lap count picked, like the Course hero.
 */
export function routeStatement({ route, laps, siteUrl, answer }: RouteStatementInputs): RouteStatement {
  const { name, worldName: world } = route
  const oneLap = computeRouteTotals(route, 1)
  const totals = computeRouteTotals(route, laps)
  const climbs = climbCountFact(namedClimbCounts(route.terrain))
  return {
    kind: 'route',
    rideName: `${name} in ${world}`,
    question: `What's the fastest bike for ${name}?`,
    // Titles and the H1 carry the phrase riders search for; "best bike" leads
    // the description, which then names rank 1 - see `rideDescription`.
    title: `Fastest bike for ${name} in ${world} | ZwiftBikes`,
    description: rideDescription({
      ride: name,
      world,
      stats: `${formatDistance(oneLap.distanceKm)}, ${formatElevation(oneLap.elevationM)} of climbing`,
      setup: answer?.setup,
      category: answer?.category ?? 'all'
    }),
    ogTitle: `Fastest bike for ${name}`,
    ogDescription: `Every Zwift frame and wheelset ranked by finish time on ${name} in ${world} – ${formatDistance(oneLap.distanceKm)} with ${formatElevation(oneLap.elevationM)} of climbing.`,
    heading: {
      name,
      crumbs: [
        { label: 'All routes', to: '/' },
        { label: world },
        { label: TERRAIN_LABELS[route.terrain.category] },
        ...(route.eventOnly ? [{ label: 'Event only' }] : [])
      ]
    },
    // A route sits directly under the home page.
    breadcrumbs: [
      { name: 'Home', item: siteUrl },
      { name, item: `${siteUrl}/routes/${route.slug}` }
    ],
    reportItem: name,
    reportSubject: undefined,
    facts: [
      { value: formatDistance(totals.distanceKm), label: route.lap || totals.leadInDistanceKm > 0 ? distanceLabel({ laps, leadInKm: totals.leadInDistanceKm }) : 'distance' },
      { value: formatElevation(totals.elevationM), label: 'of climbing' },
      { value: `${route.terrain.climbRatio.toFixed(1)} m/km`, label: 'climb ratio' },
      ...(climbs ? [climbs] : [])
    ],
    surface: surfaceSplit(route.surface.composition),
    rules: undefined,
    coverageNote: surfaceCoverageNote(route.surface),
    shareCard: {
      props: { title: name, world, distance: formatDistance(oneLap.distanceKm), elevation: formatElevation(oneLap.elevationM) },
      alt: `Fastest bike for ${name} in ${world}: the route's profile and its fastest bike and wheel setup`
    }
  }
}
