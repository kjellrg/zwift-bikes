import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { routes as packageRoutes, segments as packageSegments } from 'zwift-data'
import { checkSupplement, diffRoutes, diffSegments, diffStreams, isStale, pruneSupplement, serializeSupplement } from './extractCore.mjs'

const route = (id, slug, extra = {}) => ({
  id,
  name: slug.replace(/-/g, ' '),
  slug,
  world: 'watopia',
  distance: 10,
  elevation: 100,
  segments: ['hill'],
  segmentsOnRoute: [{ from: 1, to: 2, segment: 'hill' }],
  stravaSegmentId: 10,
  sports: ['cycling'],
  eventOnly: false,
  ...extra
})
const segment = (slug, extra = {}) => ({ name: slug, slug, world: 'watopia', type: 'segment', distance: 1, ...extra })
const track = n => ({ latlng: [[0, n], [0, n + 1]], distance: [0, 10], altitude: [0, 1] })

const base = [route(1, 'alpha'), route(2, 'bravo')]

describe('diffRoutes', () => {
  it('writes a route only the source has, in full, and nothing for one that is identical', () => {
    const added = route(3, 'charlie')
    expect(diffRoutes(base, [...base, added])).toEqual({ entries: [added], errors: [], skipped: [] })
  })

  it('leaves out a route that cannot be ridden by bike, and says so only for one the package lacks', () => {
    const run = route(4, 'delta-run', { sports: ['running'] })
    const shippedRun = route(5, 'echo-run', { sports: ['running'] })
    const result = diffRoutes([...base, shippedRun], [...base, shippedRun, run])
    expect(result.entries).toEqual([])
    expect(result.skipped).toEqual([run])
  })

  it('writes a changed allow-listed field as an override of just that field', () => {
    const result = diffRoutes(base, [base[0], route(2, 'bravo', { stravaSegmentId: 11, stravaSegmentUrl: 'https://www.strava.com/segments/11' })])
    expect(result.errors).toEqual([])
    expect(result.entries).toEqual([{ id: 2, override: { stravaSegmentId: 11, stravaSegmentUrl: 'https://www.strava.com/segments/11' } }])
  })

  it('writes only the elements a list gains', () => {
    const result = diffRoutes(base, [base[0], route(2, 'bravo', { segments: ['hill', 'peak'], segmentsOnRoute: [{ from: 1, to: 2, segment: 'hill' }, { from: 3, to: 4, segment: 'peak' }] })])
    expect(result.entries).toEqual([{ id: 2, override: { segments: ['peak'], segmentsOnRoute: [{ from: 3, to: 4, segment: 'peak' }] } }])
  })

  it('reports a list that loses an element and writes nothing for it', () => {
    const result = diffRoutes(base, [base[0], route(2, 'bravo', { segments: [], segmentsOnRoute: [] })])
    expect(result.entries).toEqual([])
    expect(result.errors).toHaveLength(2)
    expect(result.errors[0]).toContain('"segments" loses hill')
  })

  it('reports a field outside the allow-list and still writes the allowed ones', () => {
    const result = diffRoutes(base, [base[0], route(2, 'bravo', { distance: 12, name: 'Bravo Two' })])
    expect(result.entries).toEqual([{ id: 2, override: { name: 'Bravo Two' } }])
    expect(result.errors).toEqual([expect.stringContaining('"distance" differs')])
  })

  it('reports an allow-listed value the source dropped, and a route with no id', () => {
    const { stravaSegmentId, ...without } = route(2, 'bravo')
    const result = diffRoutes(base, [base[0], without, { ...route(0, 'noid'), id: undefined }])
    expect(result.entries).toEqual([])
    expect(result.errors).toEqual([expect.stringContaining('"stravaSegmentId" is gone'), expect.stringContaining('has no id')])
    expect(stravaSegmentId).toBe(10)
  })

  it('sorts by id, so a rerun gives the same file', () => {
    expect(diffRoutes(base, [route(9, 'zulu'), route(3, 'charlie')]).entries.map(entry => entry.id)).toEqual([3, 9])
  })
})

describe('diffSegments', () => {
  const segments = [segment('hill'), segment('peak', { stravaSegmentId: 5 })]

  it('writes new segments in full, sorted by slug, and corrections as overrides', () => {
    const result = diffSegments(segments, [segment('valley'), segment('hill'), segment('peak', { stravaSegmentId: 6 }), segment('ash')])
    expect(result.entries).toEqual([segment('ash'), { slug: 'peak', override: { stravaSegmentId: 6 } }, segment('valley')])
    expect(result.errors).toEqual([])
  })

  it('reports a field outside the allow-list', () => {
    const result = diffSegments(segments, [segment('hill', { distance: 2 })])
    expect(result.entries).toEqual([])
    expect(result.errors).toEqual([expect.stringContaining('segment hill: "distance" differs')])
  })
})

describe('diffStreams', () => {
  it('copies a track the package lacks, and a corrected record\'s track that differs, rounded as zwift-data rounds', () => {
    const result = diffStreams({
      slugs: ['new', 'fixed', 'same', 'other', 'none'],
      overrideSlugs: new Set(['fixed']),
      packageStreams: { fixed: track(1), same: track(2), other: track(3) },
      sourceStreams: { new: { latlng: [[1.23456789, 2]], distance: [1.26], altitude: [3.04] }, fixed: track(9), same: track(2), other: track(8) }
    })
    expect(result.copied).toEqual({ new: { latlng: [[1.234568, 2]], distance: [1.3], altitude: [3] }, fixed: track(9) })
    expect(result.differing).toEqual(['other'])
    expect(result.missing).toEqual(['none'])
  })
})

describe('serializeSupplement', () => {
  const empty = { source: 'abc', zwiftDataVersion: '2.1.0', routes: [], segments: [], streams: { routes: {}, segments: {} } }

  it('records no source for a file with nothing in it, and parses back to what was given', () => {
    const text = serializeSupplement({ ...empty, routes: [route(3, 'charlie')], streams: { routes: { charlie: track(1) }, segments: {} } })
    expect(JSON.parse(text.routes)).toEqual({ source: 'abc', zwiftDataVersion: '2.1.0', routes: [route(3, 'charlie')] })
    expect(JSON.parse(text.segments)).toEqual({ source: null, zwiftDataVersion: '2.1.0', segments: [] })
    expect(JSON.parse(text.streams)).toEqual({ source: 'abc', zwiftDataVersion: '2.1.0', routes: { charlie: track(1) }, segments: {} })
  })

  it('gives the same text for the same input', () => {
    const input = { ...empty, routes: [route(3, 'charlie')], streams: { routes: { b: track(1), a: track(2) }, segments: {} } }
    expect(serializeSupplement(input)).toEqual(serializeSupplement(structuredClone(input)))
    expect(Object.keys(JSON.parse(serializeSupplement(input).streams).routes)).toEqual(['a', 'b'])
  })
})

describe('checkSupplement and pruneSupplement', () => {
  const input = (over = {}) => ({
    packageRoutes: base,
    packageSegments: [segment('hill')],
    packageStreams: { routes: { alpha: track(1) }, segments: {} },
    routes: [],
    segments: [],
    streams: { routes: {}, segments: {} },
    hosts: [],
    stravaIds: [],
    routeSurfaceSlugs: new Set(),
    ...over
  })

  it('finds nothing wrong with an empty supplement, or a clean one', () => {
    expect(checkSupplement(input())).toEqual([])
    expect(checkSupplement(input({ routes: [route(3, 'charlie')], streams: { routes: { charlie: track(1) }, segments: {} }, routeSurfaceSlugs: new Set(['charlie']) }))).toEqual([])
  })

  it('names what the package now ships or matches as stale, and prune deletes exactly that', () => {
    const stale = input({
      routes: [route(1, 'alpha'), { id: 2, override: { stravaSegmentId: 10 } }, route(3, 'charlie')],
      segments: [segment('hill'), segment('valley')],
      streams: { routes: { alpha: track(1), charlie: track(5) }, segments: { valley: track(6) } },
      routeSurfaceSlugs: new Set(['charlie'])
    })
    const findings = checkSupplement(stale)
    expect(findings.map(f => `${f.identity}:${f.reason}`)).toEqual(['alpha (1):shipped', 'bravo (2):matched', 'hill:shipped', 'alpha:stream-shipped'])
    expect(findings.every(isStale)).toBe(true)
    const pruned = pruneSupplement({ ...stale, zwiftDataVersion: '2.1.0', source: 'abc' })
    expect(pruned.routes).toEqual([route(3, 'charlie')])
    expect(pruned.segments).toEqual([segment('valley')])
    expect(pruned.streams).toEqual({ routes: { charlie: track(5) }, segments: { valley: track(6) } })
    expect(checkSupplement({ ...stale, routes: pruned.routes, segments: pruned.segments, streams: pruned.streams })).toEqual([])
  })

  it('keeps a corrected record\'s track until the package has the same one', () => {
    const corrected = input({ routes: [{ id: 1, override: { stravaSegmentId: 11 } }], streams: { routes: { alpha: track(9) }, segments: {} } })
    expect(checkSupplement(corrected)).toEqual([])
    const matched = input({ routes: [{ id: 1, override: { stravaSegmentId: 11 } }], streams: { routes: { alpha: track(1) }, segments: {} } })
    expect(checkSupplement(matched).map(f => f.reason)).toEqual(['stream-shipped'])
  })

  it('reports what a person must fix, and prune leaves it alone', () => {
    const wrong = input({
      routes: [route(3, 'charlie'), route(4, 'delta', { segments: ['nowhere'], segmentsOnRoute: [] })],
      segments: [segment('peak', { name: 'hill' })],
      streams: { routes: { ghost: track(1) }, segments: {} },
      hosts: [{ segment: 'hill', route: 'charlie' }],
      stravaIds: [{ segment: 'peak', stravaSegmentId: 1 }]
    })
    const findings = checkSupplement(wrong)
    expect(findings.filter(f => !isStale(f)).map(f => `${f.identity}:${f.reason}`)).toEqual([
      'delta (4):unknown-segment',
      'peak:name-collision',
      'hill on charlie:hand-written',
      'ghost:stream-orphan',
      'charlie (3):no-surface',
      'delta (4):no-surface'
    ])
    expect(pruneSupplement({ ...wrong, zwiftDataVersion: '2.1.0', source: 'abc' }).routes).toEqual(wrong.routes)
  })
})

describe('supplement:extract', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const script = path.join(repoRoot, 'scripts/supplement/extract.mjs')
  const installed = createRequire(import.meta.url)('zwift-data/package.json').version
  const installedLib = path.join(path.dirname(createRequire(import.meta.url).resolve('zwift-data/package.json')), 'lib')
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'supplement-test-'))
  afterAll(() => rmSync(scratch, { recursive: true, force: true }))

  const run = (...args) => spawnSync('node', [script, ...args], { cwd: repoRoot, encoding: 'utf8' })
  const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' })

  /** A built clone: the installed package's data plus a new route, a new segment and a corrected Strava id, in a git repo. */
  function fixtureClone(name, { version = installed, lib = true } = {}) {
    const dir = path.join(scratch, name)
    mkdirSync(path.join(dir, 'lib/streams'), { recursive: true })
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'zwift-data', version, type: 'module' }))
    if (lib) {
      const dataUrl = pathToFileURL(path.join(installedLib, 'index.js')).href
      const streamsUrl = pathToFileURL(path.join(installedLib, 'streams/index.js')).href
      const first = packageRoutes[0]
      writeFileSync(path.join(dir, 'lib/index.js'), [
        `import * as base from ${JSON.stringify(dataUrl)}`,
        `export const routes = [{ ...base.routes[0], stravaSegmentId: 999 }, ...base.routes.slice(1), ${JSON.stringify(route(777000001, 'fixture-route', { world: first.world, segments: [packageSegments[0].slug], segmentsOnRoute: [] }))}, ${JSON.stringify(route(777000002, 'fixture-run', { sports: ['running'] }))}]`,
        `export const segments = [...base.segments, ${JSON.stringify(segment('fixture-segment'))}]`
      ].join('\n'))
      writeFileSync(path.join(dir, 'lib/streams/index.js'), [
        `import * as base from ${JSON.stringify(streamsUrl)}`,
        `export const routes = { ...base.routes, 'fixture-route': ${JSON.stringify(track(1))} }`,
        'export const segments = { ...base.segments }'
      ].join('\n'))
    }
    git(dir, 'init', '-q')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'fixture')
    return dir
  }

  /** A directory of empty supplement files, so a test never depends on what the repo has committed. */
  function freshOut(name) {
    const out = path.join(scratch, name)
    mkdirSync(out, { recursive: true })
    const head = { source: null, zwiftDataVersion: installed }
    writeFileSync(path.join(out, 'routes.generated.json'), JSON.stringify({ ...head, routes: [] }))
    writeFileSync(path.join(out, 'segments.generated.json'), JSON.stringify({ ...head, segments: [] }))
    writeFileSync(path.join(out, 'streams.generated.json'), JSON.stringify({ ...head, routes: {}, segments: {} }))
    return out
  }

  it('stops when the clone is not the installed version, and says to rebase it', () => {
    const result = run('--source', fixtureClone('old', { version: '0.0.1' }), '--out', freshOut('out-old'))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`the clone is zwift-data 0.0.1 and the installed package is ${installed}`)
    expect(result.stderr).toContain('Rebase the clone')
  })

  it('stops, without building anything, when the clone has no built lib', () => {
    const dir = fixtureClone('unbuilt', { lib: false })
    const result = run('--source', dir, '--out', freshOut('out-unbuilt'))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('has no built lib/')
  })

  it('writes only what the clone adds or corrects, the same text on every run, and leaves the clone as it was', () => {
    const dir = fixtureClone('good')
    const out = freshOut('out-good')
    const first = run('--source', dir, '--out', out)
    expect(first.status, first.stderr).toBe(0)
    expect(first.stdout).toContain('1 new, 1 corrected, 1 not for cycling left out (fixture-run)')

    const routes = JSON.parse(readFileSync(path.join(out, 'routes.generated.json'), 'utf8'))
    expect(routes.zwiftDataVersion).toBe(installed)
    expect(routes.source).toBe(git(dir, 'rev-parse', 'HEAD').stdout.trim())
    expect(routes.routes.map(entry => entry.id)).toEqual([packageRoutes[0].id, 777000001].sort((a, b) => a - b))
    expect(routes.routes.find(entry => entry.override)).toEqual({ id: packageRoutes[0].id, override: { stravaSegmentId: 999 } })
    expect(JSON.parse(readFileSync(path.join(out, 'segments.generated.json'), 'utf8')).segments).toEqual([segment('fixture-segment')])
    expect(Object.keys(JSON.parse(readFileSync(path.join(out, 'streams.generated.json'), 'utf8')).routes)).toEqual(['fixture-route'])

    const before = ['routes', 'segments', 'streams'].map(kind => readFileSync(path.join(out, `${kind}.generated.json`), 'utf8'))
    expect(run('--source', dir, '--out', out).status).toBe(0)
    expect(['routes', 'segments', 'streams'].map(kind => readFileSync(path.join(out, `${kind}.generated.json`), 'utf8'))).toEqual(before)
    expect(git(dir, 'status', '--porcelain').stdout).toBe('')
  })

  it('--check needs no clone: it fails on a route with no surface data, and on a stale entry until prune deletes it', () => {
    const out = freshOut('out-check')
    writeFileSync(path.join(out, 'routes.generated.json'), JSON.stringify({
      source: 'abc',
      zwiftDataVersion: installed,
      routes: [packageRoutes[0], route(777000001, 'fixture-route', { segments: [], segmentsOnRoute: [] })]
    }))
    const failing = run('--check', '--out', out)
    expect(failing.status).toBe(1)
    expect(failing.stderr).toContain(`${packageRoutes[0].slug} (${packageRoutes[0].id}): shipped`)
    expect(failing.stderr).toContain('run `npm run supplement:prune`')
    expect(failing.stderr).toContain('fixture-route (777000001): no-surface')

    const pruned = run('--prune', '--out', out)
    expect(pruned.status, pruned.stderr).toBe(0)
    expect(pruned.stdout).toContain('removed 1 routes')
    const remaining = JSON.parse(readFileSync(path.join(out, 'routes.generated.json'), 'utf8'))
    expect(remaining.routes.map(entry => entry.slug)).toEqual(['fixture-route'])
    expect(run('--check', '--out', out).stderr).not.toContain('shipped')
  })

  it('--prune on a supplement the package has caught up with leaves empty files at the installed version', () => {
    const out = freshOut('out-empty')
    writeFileSync(path.join(out, 'routes.generated.json'), JSON.stringify({ source: 'abc', zwiftDataVersion: '0.0.1', routes: [packageRoutes[0]] }))
    expect(run('--prune', '--out', out).status).toBe(0)
    expect(JSON.parse(readFileSync(path.join(out, 'routes.generated.json'), 'utf8'))).toEqual({ source: null, zwiftDataVersion: installed, routes: [] })
    expect(run('--check', '--out', out).status).toBe(0)
  })
})
