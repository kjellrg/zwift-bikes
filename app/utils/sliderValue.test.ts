import { describe, expect, it } from 'vitest'
import { sliderValue } from './sliderValue'

describe('sliderValue', () => {
  it('passes a single-thumb value through', () => {
    expect(sliderValue(82, 75)).toBe(82)
  })

  it('reads the first thumb of a range slider', () => {
    expect(sliderValue([82, 90], 75)).toBe(82)
  })

  it('keeps the value the control already shows when the slider reports nothing', () => {
    expect(sliderValue(undefined, 75)).toBe(75)
    expect(sliderValue([], 75)).toBe(75)
  })
})
