import type { Route, Segment } from 'zwift-data'
import { routes as packageRoutes, segments as packageSegments } from 'zwift-data'
import routesFile from './supplement/routes.generated.json'
import segmentsFile from './supplement/segments.generated.json'
import type { RoutesSupplementFile, SegmentsSupplementFile } from './supplementMerge'
import { applyRouteSupplement, applySegmentSupplement } from './supplementMerge'

/**
 * Where the catalog's routes and segments come from: the one place that reads
 * them from the `zwift-data` package, so everything else - the app, the
 * server and the scripts - sees the same lists. A lint rule
 * (`no-restricted-imports`, eslint.config.mjs) keeps it that way.
 *
 * The lists are the package's plus `shared/data/supplement/routes.generated.json`
 * and `segments.generated.json`: what is live in Zwift before a package
 * release has it, written by `npm run supplement:extract` and deleted by
 * `npm run supplement:prune` once the package catches up (docs/supplements.md).
 * The package wins wherever the two meet, and with no supplement entries the
 * result is the package's own arrays.
 *
 * The supplement's tracks (`streams.generated.json`) are not read here - they
 * are far too large for the app, and only the scripts need them
 * (`scripts/supplement/streams.mjs`).
 */
let cachedRoutes: ReadonlyArray<Route> | undefined
let cachedSegments: ReadonlyArray<Segment> | undefined

export function getRoutes(): ReadonlyArray<Route> {
  cachedRoutes ??= applyRouteSupplement(packageRoutes, (routesFile as RoutesSupplementFile).routes)
  return cachedRoutes
}

export function getSegments(): ReadonlyArray<Segment> {
  cachedSegments ??= applySegmentSupplement(packageSegments, (segmentsFile as SegmentsSupplementFile).segments)
  return cachedSegments
}

let packageHostsById: Map<number | undefined, ReadonlyArray<string>> | undefined

/**
 * The Host routes a generated correction added to a route the package has, in
 * the order it added them; none for a route the package lacks, whose hosts
 * are all its own. `getRoutesWithMeta` uses this to keep the order decision
 * the supplement follows: the package's hosts, then the hand-written ones
 * (`segmentHostSupplement.ts`), then the generated ones.
 */
export function generatedHostsFor(route: Pick<Route, 'id' | 'segments'>): string[] {
  packageHostsById ??= new Map(packageRoutes.map(packageRoute => [packageRoute.id, packageRoute.segments ?? []]))
  const own = packageHostsById.get(route.id)
  return own ? (route.segments ?? []).filter(slug => !own.includes(slug)) : []
}
