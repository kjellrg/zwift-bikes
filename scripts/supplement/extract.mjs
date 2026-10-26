#!/usr/bin/env node
// Routes, segments and their tracks that are live in Zwift before the
// installed `zwift-data` package has them, kept in shared/data/supplement/ until
// a package release catches up (docs/supplements.md has the whole flow).
//
//   npm run supplement:extract -- --source ../zwift-data   # write the supplement from a built clone
//   npm run supplement:extract -- --check                  # fail on anything stale or wrong; writes nothing
//   npm run supplement:prune                               # delete what the installed package now ships
//
// EXTRACT compares the clone's built `lib/` (routes, segments and their
// streams) with the installed package and writes the differences. It only
// READS the clone: it never builds, edits, commits to or opens anything on it.
// Both must be the same version, so everything that differs is the clone's own
// work - otherwise rebase the clone onto the installed version first. The
// three files are rewritten whole, so an entry the package now ships drops out
// on its own. A difference the supplement may not carry (a field outside the
// allow-list, a removed list element) is printed, left out, and makes the run
// exit 1 after the files are written. Frames and wheels are not touched, and
// nor is a route that cannot be ridden by bike.
//
// CHECK needs no clone, so `npm run validate` never waits on one. It fails,
// naming each entry, when the package now ships or matches an entry (run
// `supplement:prune`), when an entry collides with or repeats something, or
// when a supplemented route has no route-surface data.
//
// PRUNE needs no clone either: it deletes exactly what CHECK calls stale.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as packageData from 'zwift-data'
import * as packageStreams from 'zwift-data/streams'
import { loadSharedModule } from '../route-surfaces/loadShared.mjs'
import { checkSupplement, diffRoutes, diffSegments, diffStreams, isStale, pruneSupplement, serializeSupplement } from './extractCore.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// `--out` points the three files elsewhere, for the tests.
const dir = process.argv.includes('--out') ? path.resolve(process.argv[process.argv.indexOf('--out') + 1]) : path.join(repoRoot, 'shared/data/supplement')
const files = { routes: path.join(dir, 'routes.generated.json'), segments: path.join(dir, 'segments.generated.json'), streams: path.join(dir, 'streams.generated.json') }

const args = process.argv.slice(2)
const flag = name => args.includes(`--${name}`)
const option = (name) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? undefined : args[index + 1]
}

const installedVersion = createRequire(import.meta.url)('zwift-data/package.json').version
const read = file => JSON.parse(readFileSync(file, 'utf-8'))
const committed = { routes: read(files.routes), segments: read(files.segments), streams: read(files.streams) }

function write(next, { source, zwiftDataVersion }) {
  const text = serializeSupplement({ source, zwiftDataVersion, ...next })
  for (const kind of ['routes', 'segments', 'streams']) {
    if (!existsSync(files[kind]) || readFileSync(files[kind], 'utf-8') !== text[kind]) writeFileSync(files[kind], text[kind])
  }
}

function checkInput() {
  return {
    packageRoutes: packageData.routes,
    packageSegments: packageData.segments,
    packageStreams: { routes: packageStreams.routes, segments: packageStreams.segments },
    routes: committed.routes.routes,
    segments: committed.segments.segments,
    streams: { routes: committed.streams.routes, segments: committed.streams.segments },
    hosts: loadSharedModule('shared/data/segmentHostSupplement.ts').SUPPLEMENT_SEGMENT_HOSTS,
    stravaIds: loadSharedModule('shared/data/segmentStravaIdSupplement.ts').SUPPLEMENT_SEGMENT_STRAVA_IDS,
    routeSurfaceSlugs: new Set(Object.keys(read(path.join(repoRoot, 'shared/data/routeSurfaces.generated.json'))))
  }
}

const describeFinding = finding => `  ${finding.kind} ${finding.identity}: ${finding.reason} - ${finding.detail}`

if (flag('check')) {
  const findings = checkSupplement(checkInput())
  const entries = committed.routes.routes.length + committed.segments.segments.length
  if (!findings.length) {
    console.log(`supplement: OK (${committed.routes.routes.length} routes, ${committed.segments.segments.length} segments, installed zwift-data ${installedVersion})`)
    process.exit(0)
  }
  const stale = findings.filter(isStale)
  const other = findings.filter(finding => !isStale(finding))
  console.error(`supplement: ${findings.length} problem(s) in ${entries} entries (installed zwift-data ${installedVersion})`)
  if (stale.length) {
    console.error(`\nThe installed package now has these - run \`npm run supplement:prune\` to delete them:\n${stale.map(describeFinding).join('\n')}`)
  }
  if (other.length) {
    console.error(`\nThese need a fix by hand:\n${other.map(describeFinding).join('\n')}`)
  }
  process.exit(1)
}

if (flag('prune')) {
  const input = checkInput()
  const next = pruneSupplement({ ...input, zwiftDataVersion: installedVersion, source: committed.routes.source })
  const before = { routes: input.routes.length, segments: input.segments.length, routeTracks: Object.keys(input.streams.routes).length, segmentTracks: Object.keys(input.streams.segments).length }
  const emptied = !next.routes.length && !next.segments.length && !Object.keys(next.streams.routes).length && !Object.keys(next.streams.segments).length
  // A source and version that no longer describe anything are not kept: an empty supplement carries the installed version.
  const keepProvenance = emptied ? { source: null, zwiftDataVersion: installedVersion } : { source: committed.routes.source ?? committed.segments.source ?? committed.streams.source, zwiftDataVersion: committed.routes.zwiftDataVersion }
  write(next, keepProvenance)
  console.log(`supplement:prune removed ${before.routes - next.routes.length} routes, ${before.segments - next.segments.length} segments, ${before.routeTracks - Object.keys(next.streams.routes).length} route tracks and ${before.segmentTracks - Object.keys(next.streams.segments).length} segment tracks; ${next.routes.length} routes and ${next.segments.length} segments remain.`)
  process.exit(0)
}

// EXTRACT
const sourceDir = path.resolve(repoRoot, option('source') ?? '../zwift-data')
const sourceVersion = existsSync(path.join(sourceDir, 'package.json')) ? read(path.join(sourceDir, 'package.json')).version : undefined
if (!sourceVersion) {
  console.error(`supplement:extract: no package.json in ${sourceDir} - pass the clone with --source <dir>.`)
  process.exit(1)
}
if (sourceVersion !== installedVersion) {
  console.error(`supplement:extract: the clone is zwift-data ${sourceVersion} and the installed package is ${installedVersion}. Rebase the clone onto ${installedVersion} first, so everything that differs is the clone's own work.`)
  process.exit(1)
}
if (!existsSync(path.join(sourceDir, 'lib/index.js')) || !existsSync(path.join(sourceDir, 'lib/streams/index.js'))) {
  console.error(`supplement:extract: ${sourceDir} has no built lib/. Build it there yourself - this script only reads the clone and never builds it.`)
  process.exit(1)
}

const gitInSource = (...gitArgs) => execFileSync('git', ['-C', sourceDir, ...gitArgs], { encoding: 'utf8' }).trim()
const commit = gitInSource('rev-parse', 'HEAD')
const uncommitted = gitInSource('status', '--porcelain').length > 0
const source = uncommitted ? `${commit}+uncommitted` : commit
if (uncommitted) console.warn(`WARNING: ${sourceDir} has uncommitted changes, so the commit above does not say what was extracted; commit them first.`)

const sourceData = await import(pathToFileURL(path.join(sourceDir, 'lib/index.js')).href)
const sourceStreams = await import(pathToFileURL(path.join(sourceDir, 'lib/streams/index.js')).href)

const routes = diffRoutes(packageData.routes, sourceData.routes)
const segments = diffSegments(packageData.segments, sourceData.segments)
const { applyRouteSupplement, applySegmentSupplement } = loadSharedModule('shared/data/supplementMerge.ts')
const mergedRoutes = applyRouteSupplement(packageData.routes, routes.entries)
const mergedSegments = applySegmentSupplement(packageData.segments, segments.entries)
const overrideSlugs = (entries, packageRecords) => new Set(entries.filter(entry => 'override' in entry).map(entry => entry.slug ?? packageRecords.find(record => record.id === entry.id)?.slug))
const routeTracks = diffStreams({ slugs: mergedRoutes.map(route => route.slug), overrideSlugs: overrideSlugs(routes.entries, packageData.routes), packageStreams: packageStreams.routes, sourceStreams: sourceStreams.routes })
const segmentTracks = diffStreams({ slugs: mergedSegments.map(segment => segment.slug), overrideSlugs: overrideSlugs(segments.entries, packageData.segments), packageStreams: packageStreams.segments, sourceStreams: sourceStreams.segments })

// A new route or segment with no track in the clone cannot be placed or measured.
const entryRouteSlugs = new Set(routes.entries.filter(entry => !('override' in entry)).map(entry => entry.slug))
const entrySegmentSlugs = new Set(segments.entries.filter(entry => !('override' in entry)).map(entry => entry.slug))
const noTrack = [
  ...routeTracks.missing.filter(slug => entryRouteSlugs.has(slug)).map(slug => `route ${slug}`),
  ...segmentTracks.missing.filter(slug => entrySegmentSlugs.has(slug)).map(slug => `segment ${slug}`)
]

write({ routes: routes.entries, segments: segments.entries, streams: { routes: routeTracks.copied, segments: segmentTracks.copied } }, { source, zwiftDataVersion: installedVersion })

const count = (entries, additions) => entries.filter(entry => ('override' in entry) !== additions).length
console.log(`supplement:extract from ${sourceDir} (zwift-data ${sourceVersion}, ${source})`)
console.log(`  routes:   ${count(routes.entries, true)} new, ${count(routes.entries, false)} corrected${routes.skipped.length ? `, ${routes.skipped.length} not for cycling left out (${routes.skipped.map(route => route.slug).join(', ')})` : ''}`)
console.log(`  segments: ${count(segments.entries, true)} new, ${count(segments.entries, false)} corrected`)
console.log(`  tracks:   ${Object.keys(routeTracks.copied).length} routes, ${Object.keys(segmentTracks.copied).length} segments`)
const differing = [...routeTracks.differing.map(slug => `route ${slug}`), ...segmentTracks.differing.map(slug => `segment ${slug}`)]
if (differing.length) console.log(`  the clone's track differs from the package's for ${differing.join(', ')}; the package's stands, so it is not copied`)
if (noTrack.length) console.log(`  no track in the clone for ${noTrack.join(', ')}`)
const errors = [...routes.errors, ...segments.errors]
if (errors.length) {
  console.error(`\n${errors.length} difference(s) a supplement cannot carry, left out:\n${errors.map(error => `  ${error}`).join('\n')}`)
  process.exit(1)
}
console.log('Next: compute the derived data for new routes (docs/supplements.md), then `npm run validate`.')
