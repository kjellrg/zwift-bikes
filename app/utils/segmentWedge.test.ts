import { describe, expect, it } from 'vitest'
import { climbDrawing, climbRises, segmentGrade, wedgeScale } from './segmentWedge'

const ramp = (lengthKm: number, avgGradePercent: number, measuredAvgGradePercent?: number) => ({ lengthKm, avgGradePercent, measuredAvgGradePercent })
const profiled = (lengthKm: number, profileM: number[]) => ({ lengthKm, avgGradePercent: 0, profileM })

describe('climbRises', () => {
  it('reads a measured profile as rise over length', () => {
    expect(climbRises(profiled(1, [0, 50, 40, 100]))).toEqual([0, 0.05, 0.04, 0.1])
  })

  it('draws a climb with no profile as a ramp at its grade, preferring the measured one', () => {
    expect(climbRises(ramp(2, 6.6, 4.3))).toEqual([0, 0.043])
    expect(segmentGrade(ramp(2, 6.6, 4.3))).toBe(4.3)
  })

  it('never draws below the climb\'s start', () => {
    expect(climbRises(profiled(1, [0, -5, 20]))).toEqual([0, 0, 0.02])
  })
})

describe('wedgeScale and climbDrawing', () => {
  it('scales every climb to the steepest point listed', () => {
    const climbs = [profiled(1, [0, 100]), ramp(4, 5)]
    expect(wedgeScale(climbs)).toEqual({ maxRise: 0.1 })
    expect(climbDrawing(climbs[0]!, { maxRise: 0.1 })).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }])
    expect(climbDrawing(climbs[1]!, { maxRise: 0.1 })).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0.5 }])
  })

  it('keeps every climb the same width whatever its length', () => {
    const scale = { maxRise: 0.1 }
    const widths = [ramp(0.9, 5), ramp(19, 5), profiled(3, [0, 10, 30])].map(climb => climbDrawing(climb, scale).at(-1)!.x)
    expect(new Set(widths).size).toBe(1)
  })

  it('is flat with nothing listed', () => {
    expect(wedgeScale([])).toEqual({ maxRise: 0 })
    expect(climbDrawing(ramp(1, 5), { maxRise: 0 }).every(point => point.y === 0)).toBe(true)
  })
})
