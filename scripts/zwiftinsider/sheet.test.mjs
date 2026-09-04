import { describe, expect, it } from 'vitest'
import { parseArgs, parseCsv, sheetGapSec } from './sheet.mjs'

describe('parseCsv', () => {
  it('splits plain rows and tolerates CRLF', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('keeps commas inside quoted fields (the sheet quotes prices like "1,250,000")', () => {
    expect(parseCsv('Bike,"1,250,000",300\n')).toEqual([['Bike', '1,250,000', '300']])
  })

  it('unescapes doubled quotes', () => {
    expect(parseCsv('"say ""hi""",x\n')).toEqual([['say "hi"', 'x']])
  })

  it('keeps a final row with no trailing newline and preserves empty fields', () => {
    expect(parseCsv('a,,c\nd,e,')).toEqual([['a', '', 'c'], ['d', 'e', '']])
  })
})

describe('sheetGapSec', () => {
  it('reproduces a printed sheet cell from its two speed cells', () => {
    // Zwift Carbon, 300 W, flat: Stage 5 24.7690 mph vs Stage 0 24.5877 mph,
    // printed "Stage 5 - Hour Time Gap" 26.5.
    expect(sheetGapSec(24.7690, 24.5877)).toBeCloseTo(26.5, 0)
    expect(Math.abs(sheetGapSec(24.7690, 24.5877) - 26.5)).toBeLessThan(0.2)
  })
})

describe('parseArgs', () => {
  it('reads flags and key=value pairs, ignoring positionals', () => {
    expect(parseArgs(['node', 'x.mjs', '--dry-run', '--csv=a,b.csv'])).toEqual({ 'dry-run': true, 'csv': 'a,b.csv' })
  })
})
