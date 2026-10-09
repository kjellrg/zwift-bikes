import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ACCEPTED_GAPS, checkDictionary, formatReport, formatSchemeComparison } from './checkDictionary.mjs'

// A dictionary in the shape Zwift publishes it: `GameDictionary.<GROUP>[0].<ITEM>[].$`,
// every attribute a string.
function dictionaryOf({ frames = [], front = [], rear = [], routes = [], portals = [] } = {}) {
  const group = (item, records) => [{ [item]: records.map(r => ({ $: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)])) })) }]
  return {
    GameDictionary: {
      BIKEFRAMES: group('BIKEFRAME', frames),
      BIKEFRONTWHEELS: group('BIKEFRONTWHEEL', front),
      BIKEREARWHEELS: group('BIKEREARWHEEL', rear),
      ROUTES: group('ROUTE', routes),
      PORTAL_SEGMENTS: [{ PORTAL_SEGMENT: portals.map(hash => ({ $: { Hash: String(hash) } })) }]
    }
  }
}

function catalogOf(overrides = {}) {
  return {
    frames: [],
    frontWheels: [],
    rearWheels: [],
    withdrawnFrontWheels: [],
    withdrawnRearWheels: [],
    routes: [],
    eventLeadInOverrides: {},
    schemes: {},
    measuredFrameNames: new Set(),
    ...overrides
  }
}

const run = (dictionary, catalog, acceptedGaps = []) => formatReport(checkDictionary(dictionary, catalog, acceptedGaps))

// Lady Liberty as zwift-data 2.1 ships it (km) and as the dictionary has it (m).
const LADY_LIBERTY = { id: 5103974, name: 'Lady Liberty', slug: 'lady-liberty', eventOnly: false, distance: 12.361, leadInDistance: 0.28, leadInDistanceFreeRide: 0.694, leadInDistanceMeetups: 0.694 }
const ladyLibertyRecord = (changes = {}) => ({
  name: 'Lady Liberty', signature: 5103974, eventOnly: 0, distanceInMeters: '12361.2', leadinDistanceInMeters: '280.0',
  freeRideLeadinDistanceInMeters: '694.4215', meetupLeadinDistanceInMeters: '694.4215', ...changes
})

describe('routes', () => {
  it('a lead-in moved by 20 m is reported; one moved by 5 m is not', () => {
    const catalog = catalogOf({ routes: [LADY_LIBERTY] })
    const moved20 = run(dictionaryOf({ routes: [ladyLibertyRecord({ leadinDistanceInMeters: '300.0' })] }), catalog)
    expect(moved20.exitCode).toBe(1)
    expect(moved20.text).toMatch(/Lady Liberty.*lead-in.*280 m.*300 m/)

    const moved5 = run(dictionaryOf({ routes: [ladyLibertyRecord({ leadinDistanceInMeters: '285.0' })] }), catalog)
    expect(moved5.exitCode).toBe(0)
    expect(moved5.text).not.toMatch(/lead-in/)
  })
})

describe('event lead-in overrides, against the dictionary\'s figure', () => {
  // Urumaze's shape before zwift-data 2.1: event-only, with Zwift's figure short of the ridden one.
  const URUMAZE = { id: 3, name: 'Urumaze', slug: 'urumaze', eventOnly: true, distance: 41.6, leadInDistance: 0.085 }
  const record = leadIn => ({ name: 'Urumaze', signature: 3, eventOnly: 1, distanceInMeters: 41600, leadinDistanceInMeters: leadIn })
  const override = { distanceKm: 2.046, elevationM: 20, source: 'ZRacing published distance', checkedAt: '2026-09-01' }
  const catalog = catalogOf({ routes: [URUMAZE], eventLeadInOverrides: { urumaze: override } })

  it('an override the dictionary disagrees with by more than 10 m is listed beside the dictionary\'s figure, not failed', () => {
    const { text, exitCode } = run(dictionaryOf({ routes: [record(85.24)] }), catalog)
    expect(text).toMatch(/override.*Urumaze.*2046 m.*dictionary.*85 m/)
    expect(exitCode).toBe(0)
  })

  it('a dictionary that already carries the override\'s figure is accepted evidence: zwift-data lagging behind it is not a finding', () => {
    const { text, exitCode } = run(dictionaryOf({ routes: [record(2040)] }), catalog)
    expect(exitCode).toBe(0)
    expect(text).toMatch(/Urumaze.*85 m in zwift-data.*2040 m in the dictionary.*override/)
  })

  it('an override that zwift-data and the dictionary both agree with is reported for deletion', () => {
    const caughtUp = catalogOf({ routes: [{ ...URUMAZE, leadInDistance: 2.04 }], eventLeadInOverrides: { urumaze: override } })
    const { text, exitCode } = run(dictionaryOf({ routes: [record(2040)] }), caughtUp)
    expect(exitCode).toBe(1)
    expect(text).toMatch(/override.*Urumaze.*delete/)
  })

  it('an override for a slug no route has is reported', () => {
    const { exitCode, text } = run(dictionaryOf({ routes: [record(85.24)] }), catalogOf({ routes: [URUMAZE], eventLeadInOverrides: { 'no-such-route': override } }))
    expect(exitCode).toBe(1)
    expect(text).toMatch(/no-such-route/)
  })
})

describe('upgrade schemes', () => {
  // The 2026 Cervelo as the dictionary has it on 2026-10-09, on duration / high-end's lvId.
  const P5_2026 = { id: 1969226988, name: 'Cervelo P5 2026', modelYear: 2026, isTT: true }
  const p5Record = { name: 'Cervelo P5', signature: 1969226988, isTT: 1, modelYear: 2026, lvId: 405837660 }
  const renamedOnPurpose = [{ reason: 'kept name', findings: [{ kind: 'frame-rename', id: 1969226988, ours: 'Cervelo P5 2026', theirs: 'Cervelo P5' }] }]

  it('a measured frame on a known lvId with no scheme gets the exact line to add, and the run still passes', () => {
    const catalog = catalogOf({ frames: [P5_2026], measuredFrameNames: new Set([P5_2026.name]) })
    const { text, exitCode } = run(dictionaryOf({ frames: [p5Record] }), catalog, renamedOnPurpose)
    expect(text).toContain(`'Cervelo P5 2026': { axis: 'duration', tier: 'high' },  // lvId 405837660`)
    expect(exitCode).toBe(0)
  })

  it('a scheme that disagrees with the lvId is listed under its own heading and leaves the exit code at 0', () => {
    const catalog = catalogOf({ frames: [P5_2026], measuredFrameNames: new Set([P5_2026.name]), schemes: { 'Cervelo P5 2026': { axis: 'duration', tier: 'mid' } } })
    const { text, exitCode } = run(dictionaryOf({ frames: [p5Record] }), catalog, renamedOnPurpose)
    const heading = text.indexOf('Scheme disagreements')
    expect(heading).toBeGreaterThan(-1)
    expect(text.slice(heading)).toMatch(/Cervelo P5 2026.*duration \/ mid.*lvId 405837660.*duration \/ high/)
    expect(exitCode).toBe(0)
  })

  it('the full comparison sets every schemed frame beside its lvId\'s scheme, and says why one could not be read', () => {
    const hanzo = { id: 3719018442, name: 'Factor Hanzō', isTT: true, source: 'supplement' }
    const catalog = catalogOf({
      frames: [P5_2026, hanzo],
      schemes: { 'Cervelo P5 2026': { axis: 'duration', tier: 'mid' }, 'Factor Hanzō': { axis: 'duration', tier: 'high' } }
    })
    const placeholder = { name: 'Factor LOC_ENTITLEMENT_CYCLING_BIKE_FACTOR_HANZO_NAME', signature: 3719018442, isTT: 1, lvId: 4169711732 }
    const table = formatSchemeComparison(checkDictionary(dictionaryOf({ frames: [p5Record, placeholder] }), catalog, renamedOnPurpose))
    expect(table).toContain('| Cervelo P5 2026 | 1969226988 | duration / mid | 405837660 | duration / high | **no** |')
    expect(table).toContain('| Factor Hanzō | 3719018442 | duration / high | 4169711732 | not read: placeholder name | - |')
  })
})

describe('the supplement as it was before #314, against the 2026-10-09 dictionary', () => {
  // Verbatim BIKEFRAME records from the dictionary fetched 2026-10-09 (sha256
  // 7bb10a6b...), for the frames below only.
  const DICTIONARY = JSON.parse(readFileSync(new URL('./fixtures/gamedictionary-2026-10-09.frames-excerpt.json', import.meta.url), 'utf8'))
  const PROVISIONAL = 2 ** 32
  // zwift-data 2.1's records for these ids, with SUPPLEMENT_FRAMES as it stood
  // at 6feb487 merged over them: the four stand-ins replace placeholder
  // records, the Shiv Disc has no rename entry, and the 2026 Cervelo, the
  // V-PRi and the Aerium C:68X are on provisional ids.
  const PRE_314_FRAMES = [
    { id: 2460287610, name: 'Specialized Shiv Disc', modelYear: 2019, isTT: true },
    { id: 3932292289, name: 'Cervelo P5', modelYear: 2015, isTT: true },
    { id: 3719018442, name: 'Factor Hanzō', modelYear: 2026, isTT: true, source: 'supplement' },
    { id: 2124063579, name: 'Cannondale SuperSlice LAB71', modelYear: 2026, isTT: true, source: 'supplement' },
    { id: 244289700, name: 'Giant Trinity Advanced SL', modelYear: 2026, isTT: true, source: 'supplement' },
    { id: 3851032184, name: 'Liv Avow Advanced SL', modelYear: 2026, isTT: true, source: 'supplement' },
    { id: PROVISIONAL + 1, name: 'Cervelo P5 2026', modelYear: 2026, isTT: true, source: 'supplement', provisional: true },
    { id: PROVISIONAL + 2, name: 'Quintana Roo V-PRi', modelYear: 2026, isTT: true, source: 'supplement', provisional: true },
    { id: PROVISIONAL + 3, name: 'Cube Aerium C:68X', modelYear: 2026, isTT: true, source: 'supplement', provisional: true }
  ].map(f => ({ source: 'zwift-data', provisional: false, ...f }))
  const catalog = catalogOf({ frames: PRE_314_FRAMES })
  const result = gaps => checkDictionary(DICTIONARY, catalog, gaps)
  const kinds = findings => findings.map(f => [f.kind, f.id ?? f.name])

  it('reports the Shiv Disc rename', () => {
    const { failing } = result(ACCEPTED_GAPS)
    expect(failing).toContainEqual(expect.objectContaining({ kind: 'frame-rename', id: 2460287610, ours: 'Specialized Shiv Disc', theirs: 'Specialized S-Works Shiv Disc' }))
    expect(formatReport(result(ACCEPTED_GAPS)).exitCode).toBe(1)
  })

  it('reports the Cervelo P5 duplicate name as accepted while the accepted-gaps entry is there, and as a finding once it is removed', () => {
    const duplicate = expect.objectContaining({ kind: 'duplicate-name', group: 'frame', name: 'Cervelo P5', ids: [1969226988, 3932292289] })
    expect(result(ACCEPTED_GAPS).accepted.map(a => a.finding)).toContainEqual(duplicate)
    const withoutCervelo = ACCEPTED_GAPS.filter(gap => !gap.findings.some(f => f.name === 'Cervelo P5'))
    expect(withoutCervelo.length).toBe(ACCEPTED_GAPS.length - 1)
    expect(result(withoutCervelo).failing).toContainEqual(duplicate)
  })

  it('reports the rest of that day\'s drift too: the records the provisional frames now have', () => {
    expect(kinds(result(ACCEPTED_GAPS).failing)).toEqual(expect.arrayContaining([
      ['provisional-has-record', 'Cube Aerium C:68X'],
      ['frame-not-in-catalog', 1969226988],
      ['frame-not-in-catalog', 2475649027]
    ]))
  })
})

describe('the accepted-gaps list', () => {
  const hilltop = { name: 'Hilltop Hustle', signature: 3961473046, eventOnly: 0, sports: 1, distanceInMeters: 13633.9 }

  it('gives every entry a reason and at least one pattern', () => {
    for (const gap of ACCEPTED_GAPS) {
      expect(gap.reason.length, JSON.stringify(gap.findings)).toBeGreaterThan(20)
      expect(gap.findings.length).toBeGreaterThan(0)
    }
  })

  it('accepts a listed difference with its reason, and fails on the same record once it changes again', () => {
    const accepted = run(dictionaryOf({ routes: [hilltop] }), catalogOf(), ACCEPTED_GAPS)
    expect(accepted.exitCode).toBe(0)
    expect(accepted.text).toMatch(/Accepted gaps[\s\S]*Hilltop Hustle[\s\S]*accepted: zwift-data has only the run version/)

    const renamed = run(dictionaryOf({ routes: [{ ...hilltop, name: 'Hilltop Hustle Ride' }] }), catalogOf(), ACCEPTED_GAPS)
    expect(renamed.exitCode).toBe(1)
  })

  it('lists a pattern that no longer occurs, for deletion, without failing the run', () => {
    const { text, exitCode } = run(dictionaryOf(), catalogOf(), [{ reason: 'a gap long since closed', findings: [{ kind: 'route-not-in-catalog', id: 1, name: 'Gone' }] }])
    expect(exitCode).toBe(0)
    expect(text).toMatch(/no longer occur[\s\S]*route-not-in-catalog.*Gone/)
  })
})

describe('frames on a provisional id', () => {
  it('are listed as assigned by hand, not yet checked, which is not a finding', () => {
    const frame = { id: 2 ** 32 + 1, name: 'New TT Bike', isTT: true, source: 'supplement', provisional: true }
    const { text, exitCode } = run(dictionaryOf(), catalogOf({ frames: [frame], schemes: { 'New TT Bike': { axis: 'duration', tier: 'high' } } }))
    expect(text).toMatch(/Assigned by hand, not yet checked[\s\S]*New TT Bike.*duration \/ high/)
    expect(exitCode).toBe(0)
  })
})
