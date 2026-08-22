import { describe, expect, it } from 'vitest'
import { formatDuration, formatDurationGap } from './duration'

describe('formatDuration', () => {
  it('formats sub-hour times as m:ss and longer times as h:mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(61)).toBe('1:01')
    expect(formatDuration(573)).toBe('9:33')
    expect(formatDuration(3661)).toBe('1:01:01')
    expect(formatDuration(4472)).toBe('1:14:32')
  })

  it('rounds to whole seconds, carrying across unit boundaries', () => {
    expect(formatDuration(59.6)).toBe('1:00')
    expect(formatDuration(3599.5)).toBe('1:00:00')
  })
})

describe('formatDurationGap', () => {
  it('keeps hundredths below a minute and whole seconds from a minute up (issue #61)', () => {
    expect(formatDurationGap(5.212)).toBe('+5.21s')
    expect(formatDurationGap(59.99)).toBe('+59.99s')
    expect(formatDurationGap(83)).toBe('+1:23')
  })

  it('reports a gap that quantises to zero as the zero label, not a phantom +0.00s', () => {
    expect(formatDurationGap(0)).toBe('fastest')
    expect(formatDurationGap(0.004)).toBe('fastest')
    expect(formatDurationGap(-3)).toBe('fastest')
    expect(formatDurationGap(0, '—')).toBe('—')
  })

  it('switches to m:ss exactly where the displayed value would reach a minute', () => {
    expect(formatDurationGap(59.996)).toBe('+1:00')
  })
})
