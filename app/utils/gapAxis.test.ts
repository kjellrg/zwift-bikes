import { describe, expect, it } from 'vitest'
import { gapAxisMax, gapAxisPosition, gapAxisTickLabel, gapAxisTicks } from './gapAxis'

describe('gapAxisMax', () => {
  it('rounds the largest gap up to a nice step', () => {
    expect(gapAxisMax(0.4)).toBe(1)
    expect(gapAxisMax(3.92)).toBe(5)
    expect(gapAxisMax(17.3)).toBe(20)
    expect(gapAxisMax(20)).toBe(20)
    expect(gapAxisMax(21)).toBe(30)
    expect(gapAxisMax(45)).toBe(60)
    expect(gapAxisMax(61)).toBe(120)
  })

  it('keeps a scale when there is no gap to hold', () => {
    expect(gapAxisMax(0)).toBe(1)
    expect(gapAxisMax(Number.NaN)).toBe(1)
  })

  it('rounds past the steps up to whole hours', () => {
    expect(gapAxisMax(3600)).toBe(3600)
    expect(gapAxisMax(3700)).toBe(7200)
  })
})

describe('gapAxisTicks and labels', () => {
  it('puts a gridline at each quarter of the scale', () => {
    expect(gapAxisTicks(20)).toEqual([0, 5, 10, 15, 20])
  })

  it('prints seconds below a minute and minutes from it', () => {
    expect(gapAxisTickLabel(0)).toBe('0 s')
    expect(gapAxisTickLabel(20)).toBe('20 s')
    expect(gapAxisTickLabel(120)).toBe('2 min')
  })
})

describe('gapAxisPosition', () => {
  it('plots a gap as a share of the scale', () => {
    expect(gapAxisPosition(5, 20)).toEqual({ position: 0.25, beyond: false })
    expect(gapAxisPosition(20, 20)).toEqual({ position: 1, beyond: false })
  })

  it('pins a gap past the scale to the edge and says so', () => {
    expect(gapAxisPosition(25, 20)).toEqual({ position: 1, beyond: true })
  })

  it('puts the leader at zero', () => {
    expect(gapAxisPosition(0, 20)).toEqual({ position: 0, beyond: false })
    expect(gapAxisPosition(-1, 20)).toEqual({ position: 0, beyond: false })
  })
})
