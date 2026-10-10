import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { RouteWithMeta } from '../types/catalog'
import { expandClimbsForLaps, expandSprintsForLaps } from './routeOccurrences'

// A hand-built route rather than one from the catalog: the point of this
// module is that the pages can expand climbs and sprints from the fetched
// route object alone, so the test must not need zwift-data or the measured
// surface data either.
const route = {
  slug: 'fixture',
  distance: 10,
  leadInDistance: 2,
  terrain: {
    climbs: [
      { name: 'Lead-in hill', slug: 'lead-in-hill', fromKm: 0.5, toKm: 1.5, lengthKm: 1, elevationM: 50, avgGradePercent: 5, perLap: false },
      { name: 'Lap KOM', slug: 'lap-kom', fromKm: 4, toKm: 6, lengthKm: 2, elevationM: 100, avgGradePercent: 5, perLap: true }
    ],
    sprints: [
      { name: 'Lap sprint', slug: 'lap-sprint', type: 'sprint' as const, fromKm: 8, toKm: 8.3, lengthKm: 0.3, elevationM: 0, avgGradePercent: 0, perLap: true }
    ]
  }
} as unknown as RouteWithMeta

describe('expandClimbsForLaps / expandSprintsForLaps', () => {
  it('repeats per-lap items once per lap, offset by the lead-in, and keeps lead-in items once', () => {
    const climbs = expandClimbsForLaps(route, 3)
    expect(climbs.map(c => [c.slug, c.rideFromKm, c.lapNumber])).toEqual([
      ['lead-in-hill', 0.5, undefined],
      ['lap-kom', 6, 1],
      ['lap-kom', 16, 2],
      ['lap-kom', 26, 3]
    ])
  })

  it('does not label the lap on a single-lap ride', () => {
    const sprints = expandSprintsForLaps(route, 1)
    expect(sprints).toHaveLength(1)
    expect(sprints[0]!.rideFromKm).toBe(10)
    expect(sprints[0]!.lapNumber).toBeUndefined()
  })

  it('clamps an occurrence to the finish and drops one that starts past it', () => {
    const overhanging = {
      ...route,
      terrain: {
        climbs: [
          { name: 'Finish climb', slug: 'finish-climb', fromKm: 9, toKm: 10.4, lengthKm: 1.4, elevationM: 70, avgGradePercent: 5, perLap: true },
          { name: 'Beyond', slug: 'beyond', fromKm: 10.2, toKm: 10.5, lengthKm: 0.3, elevationM: 15, avgGradePercent: 5, perLap: true }
        ],
        sprints: []
      }
    } as unknown as RouteWithMeta
    const climbs = expandClimbsForLaps(overhanging, 2)
    // Lap 1's overhang is the next lap's road, so only the last lap is cut at the line.
    expect(climbs.map(c => [c.slug, c.rideFromKm, c.rideToKm, c.lapNumber])).toEqual([
      ['finish-climb', 11, 12.4, 1],
      ['beyond', 12.2, 12.5, 1],
      ['finish-climb', 21, 22, 2]
    ])
  })

  it('treats a fractional or sub-1 lap count as whole laps, never zero', () => {
    expect(expandSprintsForLaps(route, 2.9)).toHaveLength(2)
    expect(expandSprintsForLaps(route, 0)).toHaveLength(1)
  })
})

describe('routeOccurrences.ts stays a leaf module', () => {
  // The route and race pages run these functions in the browser, so every
  // value import here ships to every visitor. Issue #151 was exactly this
  // chain growing a 1.77 MB chunk; `scripts/check-client-bundle.mjs` catches
  // the built result, this catches the source at unit-test time.
  it('has type-only imports', () => {
    const source = readFileSync(new URL('./routeOccurrences.ts', import.meta.url), 'utf8')
    const imports = source.split('\n').filter(line => /^import\b/.test(line))
    expect(imports.length).toBeGreaterThan(0)
    expect(imports.filter(line => !line.startsWith('import type '))).toEqual([])
  })
})
