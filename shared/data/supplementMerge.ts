import type { Route, Segment } from 'zwift-data'

/**
 * Routes and segments the `zwift-data` package does not have yet, or has with
 * a field out of date, merged into the package's own lists. The package is
 * always the base and always wins: a supplement entry is temporary, and goes
 * once a package release carries the same thing (`npm run supplement:prune`).
 *
 * Two kinds of entry (CONTEXT.md, Supplement):
 *
 * - An ADDITION is a whole route or segment. If the package already ships its
 *   identity, or has a different record with its slug or its name in the same
 *   world, the package's record stands and the entry is skipped.
 * - A CORRECTION changes allow-listed fields of a record the package has,
 *   stored as `{ id | slug, override: { ... } }`. A scalar replaces the
 *   package's value until the package matches it. The two lists (`segments`,
 *   `segmentsOnRoute`) only ever gain elements: a host or a placement the
 *   package has is never taken away (CONTEXT.md, Host route).
 *
 * Routes are identified by `id`, segments by `slug`. With no entries the
 * package's own array comes back untouched.
 */

/** A correction replaces these route fields... */
const ROUTE_SCALAR_FIELDS = ['name', 'stravaSegmentId', 'stravaSegmentUrl', 'leadInDistance', 'leadInElevation'] as const
/** ...and only adds to these. */
const ROUTE_LIST_FIELDS = ['segments', 'segmentsOnRoute'] as const
export const ROUTE_OVERRIDE_FIELDS = [...ROUTE_SCALAR_FIELDS, ...ROUTE_LIST_FIELDS] as const
export const SEGMENT_OVERRIDE_FIELDS = ['name', 'stravaSegmentId', 'stravaSegmentUrl'] as const

export type RouteOverride = Partial<Pick<Route, (typeof ROUTE_OVERRIDE_FIELDS)[number]>>
export type SegmentOverride = Partial<Pick<Segment, (typeof SEGMENT_OVERRIDE_FIELDS)[number]>>

export interface RouteOverrideEntry { id: number, override: RouteOverride }
export interface SegmentOverrideEntry { slug: string, override: SegmentOverride }
export type RouteSupplementEntry = Route | RouteOverrideEntry
export type SegmentSupplementEntry = Segment | SegmentOverrideEntry

/** The committed `shared/data/supplement/*.generated.json` files: entries plus where they came from. */
export interface RoutesSupplementFile {
  /** The commit the entries were extracted from, or null while there are none. */
  source: string | null
  zwiftDataVersion: string
  routes: RouteSupplementEntry[]
}
export interface SegmentsSupplementFile {
  source: string | null
  zwiftDataVersion: string
  segments: SegmentSupplementEntry[]
}

/** A correction of a record the package has, as opposed to an addition. */
export function isCorrection(entry: RouteSupplementEntry | SegmentSupplementEntry): entry is RouteOverrideEntry | SegmentOverrideEntry {
  return 'override' in entry
}

export function isRouteOverride(entry: RouteSupplementEntry): entry is RouteOverrideEntry {
  return isCorrection(entry)
}

export function isSegmentOverride(entry: SegmentSupplementEntry): entry is SegmentOverrideEntry {
  return isCorrection(entry)
}

/** One Placement's identity: a correction adds a placement only if the package lacks this key. */
export const placementKey = (placement: { from: number, to: number, segment: string }) => `${placement.segment}@${placement.from}-${placement.to}`
/** How a route is named in every finding and error: `slug (id)`. */
export const routeLabel = (route: { slug: string, id?: number }) => `${route.slug} (${route.id})`
const nameKey = (record: { name: string, world: string }) => `${record.world}/${record.name.trim().toLowerCase()}`

/**
 * The slug of the record an entry adds or corrects. A route correction names
 * its record by id, so it is looked up in the package; undefined when the
 * package has no route with that id.
 */
export function entrySlug(entry: RouteSupplementEntry | SegmentSupplementEntry, packageRoutes: ReadonlyArray<Route>): string | undefined {
  if (!isCorrection(entry) || 'slug' in entry) return entry.slug
  return packageRoutes.find(route => route.id === entry.id)?.slug
}

/** The package's route with the correction applied; the very same object when it changes nothing. */
export function overrideRoute(route: Route, override: RouteOverride): Route {
  let next = route
  for (const field of ROUTE_SCALAR_FIELDS) {
    const value = override[field]
    if (value !== undefined && value !== route[field]) next = { ...next, [field]: value }
  }
  const hosts = (override.segments ?? []).filter((slug, i, all) => !route.segments?.includes(slug) && all.indexOf(slug) === i)
  if (hosts.length) next = { ...next, segments: [...route.segments ?? [], ...hosts] }
  const have = new Set((route.segmentsOnRoute ?? []).map(placementKey))
  const placements = (override.segmentsOnRoute ?? []).filter(placement => !have.has(placementKey(placement)))
  if (placements.length) next = { ...next, segmentsOnRoute: [...route.segmentsOnRoute ?? [], ...placements].sort((a, b) => a.from - b.from) }
  return next
}

export function overrideSegment(segment: Segment, override: SegmentOverride): Segment {
  let next = segment
  for (const field of SEGMENT_OVERRIDE_FIELDS) {
    const value = override[field]
    if (value !== undefined && value !== segment[field]) next = { ...next, [field]: value }
  }
  return next
}

export function applyRouteSupplement(packageRoutes: ReadonlyArray<Route>, entries: ReadonlyArray<RouteSupplementEntry>): ReadonlyArray<Route> {
  if (!entries.length) return packageRoutes
  const overrides = new Map<number, RouteOverride[]>()
  for (const entry of entries) {
    if (isRouteOverride(entry)) overrides.set(entry.id, [...overrides.get(entry.id) ?? [], entry.override])
  }
  const merged = packageRoutes.map(route => (route.id === undefined ? route : (overrides.get(route.id) ?? []).reduce(overrideRoute, route)))

  const ids = new Set(packageRoutes.map(route => route.id))
  const slugs = new Set(packageRoutes.map(route => route.slug))
  const names = new Set(packageRoutes.map(nameKey))
  const added: Route[] = []
  for (const entry of entries) {
    if (isRouteOverride(entry) || ids.has(entry.id) || slugs.has(entry.slug) || names.has(nameKey(entry))) continue
    ids.add(entry.id)
    slugs.add(entry.slug)
    names.add(nameKey(entry))
    added.push(entry)
  }
  return [...merged, ...added]
}

export function applySegmentSupplement(packageSegments: ReadonlyArray<Segment>, entries: ReadonlyArray<SegmentSupplementEntry>): ReadonlyArray<Segment> {
  if (!entries.length) return packageSegments
  const overrides = new Map<string, SegmentOverride[]>()
  for (const entry of entries) {
    if (isSegmentOverride(entry)) overrides.set(entry.slug, [...overrides.get(entry.slug) ?? [], entry.override])
  }
  const merged = packageSegments.map(segment => (overrides.get(segment.slug) ?? []).reduce(overrideSegment, segment))

  const slugs = new Set(packageSegments.map(segment => segment.slug))
  const names = new Set(packageSegments.map(nameKey))
  const added: Segment[] = []
  for (const entry of entries) {
    if (isSegmentOverride(entry) || slugs.has(entry.slug) || names.has(nameKey(entry))) continue
    slugs.add(entry.slug)
    names.add(nameKey(entry))
    added.push(entry)
  }
  return [...merged, ...added]
}

export type SupplementFindingReason
  = 'shipped' // an addition the package now ships: stale, to be pruned
    | 'matched' // a correction the package's record now matches: stale, to be pruned
    | 'stream-shipped' // a track the package now has its own of: stale, to be pruned
    | 'no-record' // a correction of a record the package does not have
    | 'slug-collision' // an addition whose slug is another package record's
    | 'name-collision' // an addition whose name is another package record's, in the same world
    | 'duplicate' // the same identity twice in the supplement
    | 'unknown-segment' // a route names a segment neither the package nor the supplement has
    | 'no-id' // a route without an id cannot be matched to the package's
    | 'hand-written' // a hand-written supplement supplies the same thing: the generated one is kept, delete the hand-written one
    | 'stream-orphan' // a track no route or segment of the merged catalog has
    | 'no-surface' // a supplemented route with no route-surface data

export interface SupplementFinding {
  kind: 'route' | 'segment'
  /** The route's `slug (id)` (`routeLabel`), its bare id when the package has no such route, a segment's slug, or `segment on route` for a host. */
  identity: string
  reason: SupplementFindingReason
  detail: string
}

const STALE_REASONS: ReadonlySet<SupplementFindingReason> = new Set(['shipped', 'matched', 'stream-shipped'])

/** A finding `supplement:prune` deletes, because the package has caught up. Every other finding needs a person. */
export function isStaleFinding(finding: SupplementFinding): boolean {
  return STALE_REASONS.has(finding.reason)
}

export function routeSupplementFindings(
  packageRoutes: ReadonlyArray<Route>,
  entries: ReadonlyArray<RouteSupplementEntry>,
  knownSegmentSlugs: ReadonlySet<string>
): SupplementFinding[] {
  const findings: SupplementFinding[] = []
  const byId = new Map(packageRoutes.map(route => [route.id, route]))
  const bySlug = new Map(packageRoutes.map(route => [route.slug, route]))
  const byName = new Map(packageRoutes.map(route => [nameKey(route), route]))
  const seen = new Set<string>()
  const addedSlugs = new Set<string>()
  for (const entry of entries) {
    const identity = isRouteOverride(entry) ? String(entry.id) : routeLabel(entry)
    const key = `${isRouteOverride(entry) ? 'override' : 'addition'}:${entry.id}`
    if (seen.has(key)) findings.push({ kind: 'route', identity, reason: 'duplicate', detail: 'listed twice' })
    seen.add(key)
    if (isRouteOverride(entry)) {
      const record = byId.get(entry.id)
      if (!record) findings.push({ kind: 'route', identity, reason: 'no-record', detail: 'the package has no route with this id' })
      else if (overrideRoute(record, entry.override) === record) findings.push({ kind: 'route', identity: routeLabel(record), reason: 'matched', detail: 'the package now has these values' })
      continue
    }
    if (entry.id === undefined) findings.push({ kind: 'route', identity, reason: 'no-id', detail: 'a supplemented route needs the id Zwift gives it' })
    const shipped = byId.get(entry.id)
    const slugOwner = bySlug.get(entry.slug)
    const nameOwner = byName.get(nameKey(entry))
    if (shipped) findings.push({ kind: 'route', identity, reason: 'shipped', detail: `the package now ships route ${routeLabel(shipped)}` })
    else if (slugOwner) findings.push({ kind: 'route', identity, reason: 'slug-collision', detail: `the package's ${routeLabel(slugOwner)} has this slug` })
    else if (addedSlugs.has(entry.slug)) findings.push({ kind: 'route', identity, reason: 'slug-collision', detail: 'an earlier supplement route has this slug' })
    else if (nameOwner) findings.push({ kind: 'route', identity, reason: 'name-collision', detail: `the package's ${routeLabel(nameOwner)} has this name` })
    addedSlugs.add(entry.slug)
    for (const slug of [...entry.segments ?? [], ...(entry.segmentsOnRoute ?? []).map(p => p.segment)]) {
      if (!knownSegmentSlugs.has(slug)) findings.push({ kind: 'route', identity, reason: 'unknown-segment', detail: `names segment "${slug}", which no catalog has` })
    }
  }
  return findings
}

export function segmentSupplementFindings(packageSegments: ReadonlyArray<Segment>, entries: ReadonlyArray<SegmentSupplementEntry>): SupplementFinding[] {
  const findings: SupplementFinding[] = []
  const bySlug = new Map(packageSegments.map(segment => [segment.slug, segment]))
  const byName = new Map(packageSegments.map(segment => [nameKey(segment), segment]))
  const seen = new Set<string>()
  for (const entry of entries) {
    const key = `${isSegmentOverride(entry) ? 'override' : 'addition'}:${entry.slug}`
    if (seen.has(key)) findings.push({ kind: 'segment', identity: entry.slug, reason: 'duplicate', detail: 'listed twice' })
    seen.add(key)
    const record = bySlug.get(entry.slug)
    if (isSegmentOverride(entry)) {
      if (!record) findings.push({ kind: 'segment', identity: entry.slug, reason: 'no-record', detail: 'the package has no segment with this slug' })
      else if (overrideSegment(record, entry.override) === record) findings.push({ kind: 'segment', identity: entry.slug, reason: 'matched', detail: 'the package now has these values' })
      continue
    }
    const nameOwner = byName.get(nameKey(entry))
    if (record) findings.push({ kind: 'segment', identity: entry.slug, reason: 'shipped', detail: 'the package now ships this segment' })
    else if (nameOwner) findings.push({ kind: 'segment', identity: entry.slug, reason: 'name-collision', detail: `the package's "${nameOwner.slug}" has this name` })
  }
  return findings
}

/** The entries `supplement:prune` keeps: everything except what the package now ships or matches. */
export function pruneRouteEntries(packageRoutes: ReadonlyArray<Route>, entries: ReadonlyArray<RouteSupplementEntry>): RouteSupplementEntry[] {
  const byId = new Map(packageRoutes.map(route => [route.id, route]))
  return entries.filter((entry) => {
    const record = byId.get(entry.id)
    if (!isRouteOverride(entry)) return !record
    return !record || overrideRoute(record, entry.override) !== record
  })
}

export function pruneSegmentEntries(packageSegments: ReadonlyArray<Segment>, entries: ReadonlyArray<SegmentSupplementEntry>): SegmentSupplementEntry[] {
  const bySlug = new Map(packageSegments.map(segment => [segment.slug, segment]))
  return entries.filter((entry) => {
    const record = bySlug.get(entry.slug)
    if (!isSegmentOverride(entry)) return !record
    return !record || overrideSegment(record, entry.override) !== record
  })
}

/**
 * The same thing supplied twice: a Host route in `segmentHostSupplement.ts`
 * that a generated route also lists, or a Strava id in
 * `segmentStravaIdSupplement.ts` that a generated segment also carries. The
 * generated entry is the one heading upstream, so the hand-written one goes.
 */
export function handWrittenDuplicateFindings(input: {
  packageRoutes: ReadonlyArray<Route>
  routes: ReadonlyArray<RouteSupplementEntry>
  segments: ReadonlyArray<SegmentSupplementEntry>
  hosts: ReadonlyArray<{ segment: string, route: string }>
  stravaIds: ReadonlyArray<{ segment: string, stravaSegmentId: number }>
}): SupplementFinding[] {
  const findings: SupplementFinding[] = []
  const generatedHosts = new Set<string>()
  for (const entry of input.routes) {
    // A correction of a route the package lacks is reported as `no-record` already.
    const slug = entrySlug(entry, input.packageRoutes)
    if (slug === undefined) continue
    const hosts = isRouteOverride(entry) ? entry.override.segments : entry.segments
    for (const segment of hosts ?? []) generatedHosts.add(`${segment} on ${slug}`)
  }
  for (const host of input.hosts) {
    const pair = `${host.segment} on ${host.route}`
    if (generatedHosts.has(pair)) findings.push({ kind: 'route', identity: pair, reason: 'hand-written', detail: 'segmentHostSupplement.ts lists this host too - delete that entry' })
  }
  const generatedIds = new Set(input.segments.filter(entry => (isSegmentOverride(entry) ? entry.override.stravaSegmentId : entry.stravaSegmentId) !== undefined).map(entry => entry.slug))
  for (const hand of input.stravaIds) {
    if (generatedIds.has(hand.segment)) findings.push({ kind: 'segment', identity: hand.segment, reason: 'hand-written', detail: 'segmentStravaIdSupplement.ts gives this segment an id too - delete that entry' })
  }
  return findings
}
