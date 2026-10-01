import { describe, expect, it } from 'vitest'
import { formatRaceDateRange, formatRaceDateShort } from './raceDates'

describe('formatRaceDateShort', () => {
  it('spells every month with three letters, September included', () => {
    expect(formatRaceDateShort('2026-09-22')).toBe('Tue 22 Sep')
    expect(formatRaceDateShort('2026-06-02')).toBe('Tue 2 Jun')
    expect(formatRaceDateShort('2026-12-01')).toBe('Tue 1 Dec')
  })
})

describe('formatRaceDateRange', () => {
  it('joins a same-month window with an en dash', () => {
    expect(formatRaceDateRange('2026-09-21', '2026-09-27')).toBe('21–27 Sep')
  })

  it('names both months across a month boundary, dash spaced', () => {
    expect(formatRaceDateRange('2026-09-28', '2026-10-04')).toBe('28 Sep – 4 Oct')
  })

  it('gives a single day its short date', () => {
    expect(formatRaceDateRange('2026-09-29')).toBe('Tue 29 Sep')
    expect(formatRaceDateRange('2026-09-29', '2026-09-29')).toBe('Tue 29 Sep')
  })
})
