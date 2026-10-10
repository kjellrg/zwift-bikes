import { describe, expect, it } from 'vitest'
import { worldCountLine, worldStatement } from './worldStatement'

describe('worldCountLine', () => {
  it('counts the routes, then the climbs and sprints together', () => {
    expect(worldCountLine({ routes: 110, climbs: 12, sprints: 16 })).toBe('110 routes, 28 climbs and sprints')
  })

  it('names the one kind of segment a world has, singular at one', () => {
    expect(worldCountLine({ routes: 1, climbs: 1, sprints: 0 })).toBe('1 route, 1 climb')
    expect(worldCountLine({ routes: 2, climbs: 0, sprints: 2 })).toBe('2 routes, 2 sprints')
  })

  it('leaves the segments out of a world that has none', () => {
    expect(worldCountLine({ routes: 7, climbs: 0, sprints: 0 })).toBe('7 routes')
  })
})

describe('worldStatement', () => {
  it('states the page once, for its head, its H1 and its twin', () => {
    const statement = worldStatement({ name: 'Watopia', routes: 110, climbs: 12, sprints: 16 })
    expect(statement.heading).toBe('Every Zwift route in Watopia')
    expect(statement.title).toBe('Watopia routes, ranked by bike | ZwiftBikes')
    expect(statement.description).toContain('– 110 routes, 28 climbs and sprints –')
  })
})
