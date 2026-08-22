import { describe, expect, it } from 'vitest'
import { clampTttClimbWkg, clampTttRiders, TTT_DEFAULT_RIDERS, TTT_MAX_RIDERS, TTT_MIN_RIDERS } from './draft'

describe('clampTttRiders', () => {
  it('rounds to whole riders and clamps to the supported range', () => {
    expect(clampTttRiders(4.4)).toBe(4)
    expect(clampTttRiders(4.6)).toBe(5)
    expect(clampTttRiders(TTT_MIN_RIDERS - 5)).toBe(TTT_MIN_RIDERS)
    expect(clampTttRiders(TTT_MAX_RIDERS + 5)).toBe(TTT_MAX_RIDERS)
  })

  it('falls back to the default team size on non-finite input', () => {
    expect(clampTttRiders(Number.NaN)).toBe(TTT_DEFAULT_RIDERS)
    expect(clampTttRiders(Number.POSITIVE_INFINITY)).toBe(TTT_DEFAULT_RIDERS)
  })
})

describe('clampTttClimbWkg', () => {
  it('treats unset/invalid/non-positive as "not set"', () => {
    expect(clampTttClimbWkg(undefined)).toBeUndefined()
    expect(clampTttClimbWkg(Number.NaN)).toBeUndefined()
    expect(clampTttClimbWkg(0)).toBeUndefined()
    expect(clampTttClimbWkg(-1)).toBeUndefined()
  })

  it('clamps to the supported range and snaps to the 0.1 the controls step in', () => {
    expect(clampTttClimbWkg(0.5)).toBe(2)
    expect(clampTttClimbWkg(99)).toBe(9)
    // The slider's binary-float accumulation must not leak into query strings.
    expect(clampTttClimbWkg(4.300000000000001)).toBe(4.3)
    expect(clampTttClimbWkg(3.14)).toBe(3.1)
  })
})
