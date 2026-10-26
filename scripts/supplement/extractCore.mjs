// The comparison behind `npm run supplement:extract` (see extract.mjs, which
// loads the packages and writes the files). Pure: it takes the installed
// package's routes and segments and the source's, as plain objects, and says
// what the supplement should carry and what it cannot.
//
//   - A route or segment only the source has is an ADDITION, written in full.
//   - One both have, with an allow-listed field that differs, is a CORRECTION
//     of just those fields (`{ id | slug, override }`). `segments` and
//     `segmentsOnRoute` only ever gain elements: one the source drops is an
//     error, never written.
//   - A differing field outside the allow-list is an error, never written.
//   - A new route that cannot be ridden by bike (running only) is left out:
//     the catalog drops it anyway (#324). A route the package has is compared
//     whatever its sports, so a change to one is still reported.
import { loadSharedModule } from '../route-surfaces/loadShared.mjs'
import { roundStravaStreams } from '../segment-placements/roundStreams.mjs'

const {
  ROUTE_OVERRIDE_FIELDS,
  SEGMENT_OVERRIDE_FIELDS,
  applyRouteSupplement,
  applySegmentSupplement,
  entrySlug,
  handWrittenDuplicateFindings,
  isCorrection,
  isRouteOverride,
  isStaleFinding,
  placementKey,
  pruneRouteEntries,
  pruneSegmentEntries,
  routeLabel,
  routeSupplementFindings,
  segmentSupplementFindings
} = loadSharedModule('shared/data/supplementMerge.ts')

export { isCorrection, isStaleFinding }

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const LIST_KEYS = { segments: slug => slug, segmentsOnRoute: placementKey }

/**
 * @param {Record<string, any>} packageRecord
 * @param {Record<string, any>} sourceRecord
 * @param {readonly string[]} allowed
 * @param {string} label  Names the record in an error.
 * @returns {{ override: Record<string, any>, errors: string[] }}
 */
function diffRecord(packageRecord, sourceRecord, allowed, label) {
  const override = {}
  const errors = []
  for (const field of new Set([...Object.keys(packageRecord), ...Object.keys(sourceRecord)])) {
    if (same(packageRecord[field], sourceRecord[field])) continue
    if (!allowed.includes(field)) {
      errors.push(`${label}: "${field}" differs (package ${JSON.stringify(packageRecord[field])}, source ${JSON.stringify(sourceRecord[field])}) and is not a field a supplement may change - not written`)
    } else if (field in LIST_KEYS) {
      const key = LIST_KEYS[field]
      const have = new Set((packageRecord[field] ?? []).map(key))
      const kept = new Set((sourceRecord[field] ?? []).map(key))
      const removed = [...have].filter(k => !kept.has(k))
      if (removed.length) errors.push(`${label}: "${field}" loses ${removed.join(', ')} - a supplement only adds, so nothing is written for it`)
      const added = (sourceRecord[field] ?? []).filter(element => !have.has(key(element)))
      if (added.length && !removed.length) override[field] = added
    } else if (sourceRecord[field] === undefined) {
      errors.push(`${label}: "${field}" is gone from the source (package ${JSON.stringify(packageRecord[field])}) - a supplement cannot remove a value, so nothing is written for it`)
    } else {
      override[field] = sourceRecord[field]
    }
  }
  return { override, errors }
}

/**
 * @param {ReadonlyArray<Record<string, any>>} packageRoutes
 * @param {ReadonlyArray<Record<string, any>>} sourceRoutes
 */
export function diffRoutes(packageRoutes, sourceRoutes) {
  const byId = new Map(packageRoutes.map(route => [route.id, route]))
  const entries = []
  const errors = []
  const skipped = []
  for (const route of sourceRoutes) {
    if (route.id === undefined) {
      errors.push(`route ${routeLabel(route)}: has no id, so it cannot be matched to the package's - not written`)
      continue
    }
    const shipped = byId.get(route.id)
    if (!shipped) {
      if (route.sports?.includes('cycling')) entries.push(route)
      else skipped.push(route)
      continue
    }
    const { override, errors: problems } = diffRecord(shipped, route, ROUTE_OVERRIDE_FIELDS, `route ${routeLabel(route)}`)
    errors.push(...problems)
    if (Object.keys(override).length) entries.push({ id: route.id, override })
  }
  return { entries: entries.sort((a, b) => a.id - b.id), errors, skipped }
}

/**
 * @param {ReadonlyArray<Record<string, any>>} packageSegments
 * @param {ReadonlyArray<Record<string, any>>} sourceSegments
 */
export function diffSegments(packageSegments, sourceSegments) {
  const bySlug = new Map(packageSegments.map(segment => [segment.slug, segment]))
  const entries = []
  const errors = []
  for (const segment of sourceSegments) {
    const shipped = bySlug.get(segment.slug)
    if (!shipped) {
      entries.push(segment)
      continue
    }
    const { override, errors: problems } = diffRecord(shipped, segment, SEGMENT_OVERRIDE_FIELDS, `segment ${segment.slug}`)
    errors.push(...problems)
    if (Object.keys(override).length) entries.push({ slug: segment.slug, override })
  }
  return { entries: entries.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)), errors }
}

/**
 * The tracks to copy, for the records the supplement's merged catalog holds
 * (`slugs`): the source's where the package has none, and where the entry
 * corrects a record (`correctedSlugs`) and the source's track differs from
 * the package's - a correction wins until the package matches it, tracks
 * included (a corrected Strava id comes with its own track). Any other track
 * the package has stands, so one that differs is only counted.
 *
 * @param {{ slugs: Iterable<string>, correctedSlugs: ReadonlySet<string>, packageStreams: Record<string, any>, sourceStreams: Record<string, any> }} input
 */
export function diffStreams({ slugs, correctedSlugs, packageStreams, sourceStreams }) {
  const copied = {}
  const missing = []
  const differing = []
  for (const slug of [...new Set(slugs)].sort()) {
    const sourceStream = sourceStreams[slug]
    if (packageStreams[slug]) {
      if (sourceStream && !same(packageStreams[slug], sourceStream)) {
        if (correctedSlugs.has(slug)) copied[slug] = roundStravaStreams(sourceStream)
        else differing.push(slug)
      }
    } else if (sourceStream) {
      copied[slug] = roundStravaStreams(sourceStream)
    } else {
      missing.push(slug)
    }
  }
  return { copied, missing, differing }
}

/** One stream per entry, its three tracks on a line each, so a rerun diffs as a few lines. */
function serializeStreams(streams) {
  const slugs = Object.keys(streams).sort()
  if (!slugs.length) return '{}'
  const entries = slugs.map(slug => `    ${JSON.stringify(slug)}: {\n${Object.entries(streams[slug]).map(([key, value]) => `      ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n')}\n    }`)
  return `{\n${entries.join(',\n')}\n  }`
}

/** The three files' text. `source` is the commit the entries came from, or null when there are none. */
export function serializeSupplement({ source, zwiftDataVersion, routes, segments, streams }) {
  const head = { source: routes.length ? source : null, zwiftDataVersion }
  return {
    routes: `${JSON.stringify({ ...head, routes }, null, 2)}\n`,
    segments: `${JSON.stringify({ ...head, source: segments.length ? source : null, segments }, null, 2)}\n`,
    streams: `{\n  "source": ${JSON.stringify(Object.keys(streams.routes).length + Object.keys(streams.segments).length ? source : null)},\n  "zwiftDataVersion": ${JSON.stringify(zwiftDataVersion)},\n  "routes": ${serializeStreams(streams.routes)},\n  "segments": ${serializeStreams(streams.segments)}\n}\n`
  }
}

/**
 * The slugs of the records the entries add or correct (`onlyCorrections` for
 * just the corrected ones). Route corrections are named by id, so
 * `packageRoutes` resolves them; segment entries carry their slug.
 *
 * @param {ReadonlyArray<any>} entries
 * @param {ReadonlyArray<any>} packageRoutes
 */
export function entrySlugs(entries, packageRoutes, { onlyCorrections = false } = {}) {
  return new Set(entries.filter(entry => !onlyCorrections || isCorrection(entry)).map(entry => entrySlug(entry, packageRoutes)).filter(Boolean))
}

/**
 * A committed track the package has made redundant: the package has its own
 * for the slug and either it is the same one, or no entry of the supplement
 * still corrects the record. A track for a corrected record that differs from
 * the package's is the correction, and stays until the package matches it.
 */
function trackIsStale(track, packageTrack, hasEntry) {
  return Boolean(packageTrack) && (!hasEntry || same(track, packageTrack))
}

/**
 * Everything wrong with the committed supplement, as findings
 * `{ kind, identity, reason, detail }`: what the installed package now ships
 * or matches (stale), what collides, names a missing segment, repeats a
 * hand-written supplement or has no track left to its name, and a supplemented
 * route with no route-surface data (it would rank on a guess).
 *
 * @param {{
 *   packageRoutes: ReadonlyArray<any>, packageSegments: ReadonlyArray<any>,
 *   packageStreams: { routes: Record<string, any>, segments: Record<string, any> },
 *   routes: any[], segments: any[], streams: { routes: Record<string, any>, segments: Record<string, any> },
 *   hosts: ReadonlyArray<any>, stravaIds: ReadonlyArray<any>, routeSurfaceSlugs: ReadonlySet<string>
 * }} input
 */
export function checkSupplement(input) {
  const mergedRoutes = applyRouteSupplement(input.packageRoutes, input.routes)
  const mergedSegments = applySegmentSupplement(input.packageSegments, input.segments)
  const findings = [
    ...routeSupplementFindings(input.packageRoutes, input.routes, new Set(mergedSegments.map(segment => segment.slug))),
    ...segmentSupplementFindings(input.packageSegments, input.segments),
    ...handWrittenDuplicateFindings({ packageRoutes: input.packageRoutes, routes: input.routes, segments: input.segments, hosts: input.hosts, stravaIds: input.stravaIds })
  ]
  for (const [kind, merged, tracks, packageTracks, withEntry] of [
    ['route', mergedRoutes, input.streams.routes, input.packageStreams.routes, entrySlugs(input.routes, input.packageRoutes)],
    ['segment', mergedSegments, input.streams.segments, input.packageStreams.segments, entrySlugs(input.segments, input.packageRoutes)]
  ]) {
    const known = new Set(merged.map(record => record.slug))
    for (const slug of Object.keys(tracks)) {
      if (!known.has(slug)) findings.push({ kind, identity: slug, reason: 'stream-orphan', detail: `no ${kind} has this slug` })
      else if (trackIsStale(tracks[slug], packageTracks[slug], withEntry.has(slug))) findings.push({ kind, identity: slug, reason: 'stream-shipped', detail: 'the package has its own track for it now' })
    }
  }
  const packageIds = new Set(input.packageRoutes.map(route => route.id))
  for (const route of input.routes) {
    if (isRouteOverride(route) || packageIds.has(route.id) || !route.sports?.includes('cycling')) continue
    if (!input.routeSurfaceSlugs.has(route.slug)) {
      findings.push({ kind: 'route', identity: routeLabel(route), reason: 'no-surface', detail: 'no entry in routeSurfaces.generated.json - run `node scripts/route-surfaces/compute-route-surfaces.mjs --from-streams --only <slug>` and commit it with the route' })
    }
  }
  return findings
}

/**
 * What the committed files hold once everything stale is deleted: the
 * additions the package now ships, the corrections it now matches, and the
 * tracks it now has its own of.
 *
 * @param {Parameters<typeof checkSupplement>[0] & { zwiftDataVersion: string, source: string | null }} input
 */
export function pruneSupplement(input) {
  const routes = pruneRouteEntries(input.packageRoutes, input.routes)
  const segments = pruneSegmentEntries(input.packageSegments, input.segments)
  const known = {
    routes: new Set(applyRouteSupplement(input.packageRoutes, routes).map(record => record.slug)),
    segments: new Set(applySegmentSupplement(input.packageSegments, segments).map(record => record.slug))
  }
  const entries = { routes: entrySlugs(routes, input.packageRoutes), segments: entrySlugs(segments, input.packageRoutes) }
  const keep = kind => Object.fromEntries(Object.entries(input.streams[kind]).filter(([slug, track]) => known[kind].has(slug) && !trackIsStale(track, input.packageStreams[kind][slug], entries[kind].has(slug))))
  return { routes, segments, streams: { routes: keep('routes'), segments: keep('segments') } }
}
