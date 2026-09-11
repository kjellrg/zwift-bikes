import { describe, expect, it } from 'vitest'
import { GARAGE_FALLBACK_SCOPES, garageFallback, garageListStatus } from './garage'

describe('garageFallback', () => {
  it('names the four cases "my garage only" can be in', () => {
    expect(garageFallback({ frames: true, wheels: true })).toBe('full')
    expect(garageFallback({ frames: true, wheels: false })).toBe('framesOnly')
    expect(garageFallback({ frames: false, wheels: true })).toBe('wheelsOnly')
    expect(garageFallback({ frames: false, wheels: false })).toBe('empty')
  })

  it('says which half each case falls back on, in the words the filters show', () => {
    expect(GARAGE_FALLBACK_SCOPES.full).toBe('Your frames / your wheels')
    expect(GARAGE_FALLBACK_SCOPES.framesOnly).toBe('Your frames / all wheels')
    expect(GARAGE_FALLBACK_SCOPES.wheelsOnly).toBe('All frames / your wheels')
    expect(GARAGE_FALLBACK_SCOPES.empty).toBe('Garage empty - showing all equipment')
  })
})

describe('garageListStatus', () => {
  const list = { status: 'success' as const, ownedOnly: false, ownsCollection: false, visible: 12 }

  it('is loading until the first request has settled, idle included', () => {
    // `GarageContent`'s fetches are unawaited, so `status` starts at 'idle'
    // rather than going straight to a settled value.
    expect(garageListStatus({ ...list, status: 'idle', visible: 0 })).toBe('loading')
    expect(garageListStatus({ ...list, status: 'pending', visible: 0 })).toBe('loading')
  })

  it('reports a failed catalog fetch ahead of everything it emptied', () => {
    // A failed `useFetch` empties `data`, so every other case would otherwise
    // read the failure as "nothing matched".
    expect(garageListStatus({ ...list, status: 'error', visible: 0 })).toBe('failed')
    expect(garageListStatus({ ...list, status: 'error', ownedOnly: true, visible: 0 })).toBe('failed')
  })

  it('explains an empty collection before blaming the search for it', () => {
    expect(garageListStatus({ ...list, ownedOnly: true, ownsCollection: false, visible: 0 })).toBe('emptyCollection')
    expect(garageListStatus({ ...list, ownedOnly: false, ownsCollection: false, visible: 0 })).toBe('noMatch')
    expect(garageListStatus({ ...list, ownedOnly: true, ownsCollection: true, visible: 0 })).toBe('noMatch')
  })

  it('is the list itself once something is on screen', () => {
    expect(garageListStatus(list)).toBe('list')
    expect(garageListStatus({ ...list, ownedOnly: true, ownsCollection: true, visible: 3 })).toBe('list')
  })
})
