/**
 * The four routes a route page suggests next: the nearest in feel from the
 * same world - by climb ratio first, then distance - with event-only routes
 * and the route itself left out, since a rider cannot simply go and ride
 * one. A world too small to fill the four lends the rest of the slots to
 * any world, by the same measure, and those cards name their world.
 *
 * Deterministic (ties fall to the slug), so the prerendered set is the one
 * a visitor sees.
 */
export interface RelatedCandidate {
  slug: string
  world: string
  distance: number
  eventOnly: boolean
  terrain: { climbRatio: number }
}

export const RELATED_ROUTE_COUNT = 4

export function relatedRoutes<T extends RelatedCandidate>(target: RelatedCandidate, candidates: readonly T[], count = RELATED_ROUTE_COUNT): { route: T, otherWorld: boolean }[] {
  const nearness = (candidate: T) => [
    Math.abs(candidate.terrain.climbRatio - target.terrain.climbRatio),
    Math.abs(candidate.distance - target.distance)
  ] as const
  const byNearness = (a: T, b: T) => {
    const [ratioA, distanceA] = nearness(a)
    const [ratioB, distanceB] = nearness(b)
    return ratioA - ratioB || distanceA - distanceB || a.slug.localeCompare(b.slug)
  }
  const eligible = candidates.filter(candidate => candidate.slug !== target.slug && !candidate.eventOnly)
  const sameWorld = eligible.filter(candidate => candidate.world === target.world).sort(byNearness).slice(0, count)
  const others = eligible.filter(candidate => candidate.world !== target.world).sort(byNearness).slice(0, count - sameWorld.length)
  return [
    ...sameWorld.map(route => ({ route, otherWorld: false })),
    ...others.map(route => ({ route, otherWorld: true }))
  ]
}
