import { describe, expect, it } from 'vitest'
import { segmentGrade, wedgeScale, wedgeShape } from './segmentWedge'

const climb = (lengthKm: number, avgGradePercent: number, measuredAvgGradePercent?: number) => ({ lengthKm, avgGradePercent, measuredAvgGradePercent })

describe('wedgeScale', () => {
  it('is the longest climb and the steepest average grade on the page', () => {
    expect(wedgeScale([climb(19, 7), climb(1.2, 12), climb(5, 4)])).toEqual({ maxLengthKm: 19, maxGradePercent: 12 })
  })

  it('prefers a measured grade, as every display surface does', () => {
    expect(segmentGrade(climb(1, 6.6, 4.3))).toBe(4.3)
    expect(wedgeScale([climb(1, 6.6, 4.3)]).maxGradePercent).toBe(4.3)
  })

  it('is empty with nothing listed', () => {
    expect(wedgeScale([])).toEqual({ maxLengthKm: 0, maxGradePercent: 0 })
  })
})

describe('wedgeShape', () => {
  const scale = { maxLengthKm: 20, maxGradePercent: 10 }

  it('is linear in grade and the square root of length', () => {
    expect(wedgeShape(climb(5, 5), scale)).toEqual({ width: 0.5, height: 0.5 })
    expect(wedgeShape(climb(20, 10), scale)).toEqual({ width: 1, height: 1 })
  })

  it('keeps a short climb readable beside the longest', () => {
    expect(wedgeShape(climb(0.9, 5), { maxLengthKm: 19, maxGradePercent: 10 }).width).toBeGreaterThan(0.2)
    expect(wedgeShape(climb(0.01, 5), scale).width).toBe(0.12)
  })

  it('gives a flat climb no height, and an empty scale no size', () => {
    expect(wedgeShape(climb(4, 0), scale).height).toBe(0)
    expect(wedgeShape(climb(4, 5), { maxLengthKm: 0, maxGradePercent: 0 })).toEqual({ width: 0, height: 0 })
  })
})
