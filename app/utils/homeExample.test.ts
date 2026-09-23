import { describe, expect, it } from 'vitest'
import { CURATED_EXAMPLE_ROUTES, curatedExampleRoute, exampleRiderLabel } from './homeExample'

describe('curatedExampleRoute', () => {
  it('walks the curated eight one day at a time, the same for everyone on a date', () => {
    const week = ['2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30'].map(curatedExampleRoute)
    expect(new Set(week)).toEqual(new Set(CURATED_EXAMPLE_ROUTES))
    expect(curatedExampleRoute('2026-10-01')).toBe(week[0])
    expect(curatedExampleRoute('2026-09-23')).toBe(week[0])
  })
})

describe('exampleRiderLabel', () => {
  it('says whose numbers the time is for', () => {
    expect(exampleRiderLabel({ weightKg: 75, powerW: 225 }, false)).toBe('For the default rider, 75 kg at 225 W')
    expect(exampleRiderLabel({ weightKg: 68, powerW: 260 }, true)).toBe('For you, 68 kg at 260 W')
  })
})
