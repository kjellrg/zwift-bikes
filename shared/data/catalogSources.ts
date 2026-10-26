import type { Route, Segment } from 'zwift-data'
import { routes as packageRoutes, segments as packageSegments } from 'zwift-data'

/**
 * Where the catalog's routes and segments come from: the one place that reads
 * them from the `zwift-data` package, so everything else - the app, the
 * server and the scripts - sees the same lists. A lint rule
 * (`no-restricted-imports`, eslint.config.mjs) keeps it that way.
 */
export function getRoutes(): ReadonlyArray<Route> {
  return packageRoutes
}

export function getSegments(): ReadonlyArray<Segment> {
  return packageSegments
}
