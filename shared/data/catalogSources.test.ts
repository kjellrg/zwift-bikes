import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { routes, segments } from 'zwift-data'
import { getRoutes, getSegments } from './catalogSources'
import type { RoutesSupplementFile, SegmentsSupplementFile } from './supplementMerge'
import { applyRouteSupplement, applySegmentSupplement, routeSupplementFindings, segmentSupplementFindings } from './supplementMerge'
import routesFile from './supplement/routes.generated.json'
import segmentsFile from './supplement/segments.generated.json'

const routeEntries = (routesFile as RoutesSupplementFile).routes
const segmentEntries = (segmentsFile as SegmentsSupplementFile).segments

describe('catalogSources', () => {
  it('is the package\'s routes and segments exactly when the supplement has no entries', () => {
    expect(applyRouteSupplement(routes, [])).toBe(routes)
    expect(applySegmentSupplement(segments, [])).toBe(segments)
  })

  it('keeps every package route and segment, in the package\'s order, ahead of the supplement\'s', () => {
    expect(getRoutes().slice(0, routes.length).map(r => r.id)).toEqual(routes.map(r => r.id))
    expect(getSegments().slice(0, segments.length).map(s => s.slug)).toEqual(segments.map(s => s.slug))
  })

  it('adds no more than the supplement files carry', () => {
    expect(getRoutes().length - routes.length).toBeLessThanOrEqual(routeEntries.length)
    expect(getSegments().length - segments.length).toBeLessThanOrEqual(segmentEntries.length)
  })

  it('has supplement files that merge cleanly - a stale or colliding entry is named by `npm run supplement:prune` or fixed by hand', () => {
    const known = new Set(getSegments().map(s => s.slug))
    expect(routeSupplementFindings(routes, routeEntries, known)).toEqual([])
    expect(segmentSupplementFindings(segments, segmentEntries)).toEqual([])
  })

  it('keeps the supplement\'s tracks out of the app: only scripts read streams.generated.json', () => {
    const root = path.resolve(__dirname, '../..')
    const sources = ['app', 'server', 'shared'].flatMap(dir => readdirSync(path.join(root, dir), { recursive: true, encoding: 'utf8' })
      .filter(file => /\.(ts|vue|mjs)$/.test(file) && !/\.test\./.test(file))
      .map(file => path.join(root, dir, file)))
    expect(sources.filter(file => /from\s+['"][^'"]*streams\.generated/.test(readFileSync(file, 'utf8')))).toEqual([])
  })
})
