import { describe, expect, it } from 'vitest'
import { segmentGrade, wedgeHeight, wedgeScale } from './segmentWedge'

const climb = (avgGradePercent: number, measuredAvgGradePercent?: number) => ({ avgGradePercent, measuredAvgGradePercent })

describe('wedgeScale', () => {
  it('is the steepest average grade on the page', () => {
    expect(wedgeScale([climb(7), climb(12), climb(4)])).toEqual({ maxGradePercent: 12 })
  })

  it('prefers a measured grade, as every display surface does', () => {
    expect(segmentGrade(climb(6.6, 4.3))).toBe(4.3)
    expect(wedgeScale([climb(6.6, 4.3)]).maxGradePercent).toBe(4.3)
  })

  it('is empty with nothing listed', () => {
    expect(wedgeScale([])).toEqual({ maxGradePercent: 0 })
  })
})

describe('wedgeHeight', () => {
  const scale = { maxGradePercent: 10 }

  it('is linear in grade', () => {
    expect(wedgeHeight(climb(5), scale)).toBe(0.5)
    expect(wedgeHeight(climb(10), scale)).toBe(1)
  })

  it('gives a flat climb no height, and an empty scale none either', () => {
    expect(wedgeHeight(climb(0), scale)).toBe(0)
    expect(wedgeHeight(climb(5), { maxGradePercent: 0 })).toBe(0)
  })
})
