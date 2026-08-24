import { describe, expect, it } from 'vitest'
import { clampPowerW, clampSprintPowerW, storedPowerW } from './riderBounds'

describe('power clamps', () => {
  it('clamps into the normal slider range and rounds to whole watts', () => {
    expect(clampPowerW(99)).toBe(100)
    expect(clampPowerW(501)).toBe(500)
    expect(clampPowerW(250.4)).toBe(250)
    expect(clampPowerW(250)).toBe(250)
  })

  it('clamps into the sprint slider range', () => {
    expect(clampSprintPowerW(99)).toBe(100)
    expect(clampSprintPowerW(1501)).toBe(1500)
    expect(clampSprintPowerW(600)).toBe(600)
  })
})

describe('storedPowerW migration', () => {
  it('prefers an explicit powerW, even when a legacy wkg is also present', () => {
    expect(storedPowerW({ powerW: 250 }, 75)).toBe(250)
    expect(storedPowerW({ powerW: 250, wkg: 3 }, 75)).toBe(250)
  })

  it('converts a legacy wkg payload at the rider weight', () => {
    expect(storedPowerW({ wkg: 3 }, 75)).toBe(225)
    expect(storedPowerW({ wkg: 3.5 }, 80)).toBe(280)
  })

  it('clamps both forms into the normal slider range', () => {
    // Old slider max (6.9 W/kg) at the old weight max lands well above 500 W.
    expect(storedPowerW({ wkg: 6.9 }, 130)).toBe(500)
    expect(storedPowerW({ powerW: 9999 }, 75)).toBe(500)
  })

  it('returns undefined when the payload carries neither field', () => {
    expect(storedPowerW({}, 75)).toBeUndefined()
    expect(storedPowerW({ wkg: 'high' }, 75)).toBeUndefined()
    expect(storedPowerW({ powerW: null }, 75)).toBeUndefined()
  })
})
