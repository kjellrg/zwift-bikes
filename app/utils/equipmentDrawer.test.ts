import { describe, expect, it } from 'vitest'
import { equipmentDrawerView, openedEquipmentDrawerRecord, type EquipmentDrawerRecord } from './equipmentDrawer'
import type { AppliedRanking } from './recommendRequest'
import type { ComboScore, RouteWithMeta } from '../../shared/types/catalog'

const TARMAC = 3371227947
const CONCEPT = 2225644136

const combo = (frameId: number, wheels: string | undefined, finishTimeSec: number, category: 'standard' | 'tt' = 'standard') => ({
  frame: { id: frameId, category },
  wheelset: wheels ? { key: wheels } : undefined,
  finishTimeSec
} as ComboScore)

const HILLY = { slug: 'hilly-route', name: 'Hilly Route' } as RouteWithMeta
const ALPE = { slug: 'road-to-sky', name: 'Road to Sky' } as RouteWithMeta

const loadWheelOptions = async () => null

function ranking(combos: ComboScore[], overrides: Partial<AppliedRanking> = {}): AppliedRanking {
  return {
    combos,
    ride: { endpoint: '/api/recommend/hilly-route', laps: 1 },
    rider: {} as AppliedRanking['rider'],
    restrictions: {} as AppliedRanking['restrictions'],
    fastestTimeSec: combos[0]?.finishTimeSec,
    requestKey: 'laps=1',
    loadWheelOptions,
    course: HILLY,
    ...overrides
  }
}

/**
 * What the Equipment drawer is showing, derived from the record it holds and
 * the Applied Ranking on screen - the whole of the rule that used to be three
 * globals pushed at it by every ranking page.
 */
describe('equipmentDrawerView', () => {
  it('follows the row it was opened on when a Directed search shows two rows for one frame', () => {
    // The drawer is about the setup the rider clicked, not whichever row of
    // that frame the ranking happens to put first.
    const onZipp = combo(TARMAC, 'zipp-808', 1805)
    const onAlpinist = combo(TARMAC, 'roval-alpinist-clx', 1800)
    const record = openedEquipmentDrawerRecord(onZipp, ranking([onAlpinist, onZipp]))
    const refetched = [combo(TARMAC, 'roval-alpinist-clx', 1790), combo(TARMAC, 'zipp-808', 1795)]

    const view = equipmentDrawerView(record, ranking(refetched))
    expect(view.standing).toBe('ranked')
    expect(view.record.combo).toBe(refetched[1])
  })

  it('falls back to the frame\'s fastest row when a stage change hands it different wheels', () => {
    // A stage can change which wheelset is the frame's fastest, and the
    // drawer should then show the wheels the row now shows, title and all.
    const record = openedEquipmentDrawerRecord(combo(TARMAC, 'zipp-808', 1805), ranking([combo(TARMAC, 'zipp-808', 1805)]))
    const reranked = [combo(TARMAC, 'roval-alpinist-clx', 1780), combo(CONCEPT, undefined, 1790)]

    const view = equipmentDrawerView(record, ranking(reranked))
    expect(view.standing).toBe('ranked')
    expect(view.record.combo).toBe(reranked[0])
  })

  it('re-takes the ranking\'s own facts with the row, so the numbers cannot come from two rides', () => {
    const record = openedEquipmentDrawerRecord(combo(TARMAC, 'zipp-808', 1805), ranking([combo(TARMAC, 'zipp-808', 1805)]))
    const twoLaps = ranking([combo(CONCEPT, undefined, 3500), combo(TARMAC, 'zipp-808', 3600)], {
      ride: { endpoint: '/api/recommend/road-to-sky', laps: 2 },
      course: ALPE,
      requestKey: 'laps=2'
    })

    const view = equipmentDrawerView(record, twoLaps)
    expect(view.record).toMatchObject({ course: ALPE, laps: 2, requestKey: 'laps=2', fastestTimeSec: 3500 })
    expect(view.fastestTimeSec).toBe(3500)
  })

  it('hands back the very record it was given when nothing moved', () => {
    // The drawer writes the re-taken record back to the state the title reads
    // from, so a derivation that rebuilt the record every time would write on
    // every render for ever.
    const row = combo(TARMAC, 'zipp-808', 1805)
    const live = ranking([row])
    const record = openedEquipmentDrawerRecord(row, live)
    expect(equipmentDrawerView(record, live).record).toBe(record)
    expect(equipmentDrawerView(record, ranking([row])).record).toBe(record)
  })

  it('keeps the numbers it remembers when the bike drops off, and measures the gap against the live fastest', () => {
    // Nothing on the loaded rows is this bike any more, so there is nothing
    // to re-take - but the ranking it is behind has moved on, and the gap is
    // about the ranking on screen.
    const row = combo(TARMAC, 'zipp-808', 1805)
    const record = openedEquipmentDrawerRecord(row, ranking([combo(CONCEPT, undefined, 1800), row]))

    const view = equipmentDrawerView(record, ranking([combo(CONCEPT, undefined, 1700)]))
    expect(view.standing).toBe('dropped')
    expect(view.record).toBe(record)
    expect(view.fastestTimeSec).toBe(1700)
  })

  it('says a TT frame was barred rather than beaten, and leaves its own ride\'s numbers alone', () => {
    // Barred is absent from every list the pipeline can produce, so it looks
    // exactly like dropped - and a gap against a ranking the bike is not in
    // would be a number about nothing.
    const tt = combo(CONCEPT, 'zipp-super-9', 1700, 'tt')
    const record = openedEquipmentDrawerRecord(tt, ranking([tt]))

    const view = equipmentDrawerView(record, ranking([combo(TARMAC, 'zipp-808', 1900)], {
      ride: { endpoint: '/api/recommend/hilly-route', laps: 1, ttFramesAllowed: false }
    }))
    expect(view.standing).toBe('barred')
    expect(view.fastestTimeSec).toBe(1700)
  })

  it('still calls a road frame missing from a TT-barring ranking dropped', () => {
    const road = combo(TARMAC, 'zipp-808', 1900)
    const record = openedEquipmentDrawerRecord(road, ranking([road]))

    const view = equipmentDrawerView(record, ranking([combo(CONCEPT, undefined, 1800)], {
      ride: { endpoint: '/api/recommend/hilly-route', laps: 1, ttFramesAllowed: false }
    }))
    expect(view.standing).toBe('dropped')
  })

  it('claims nothing about a bike when there is no ranking on screen', () => {
    // A Discovery page, or the tick of a navigation between two ranking
    // pages: the record stands and no notice is shown.
    const row = combo(TARMAC, 'zipp-808', 1805)
    const record = openedEquipmentDrawerRecord(row, ranking([row]))

    const view = equipmentDrawerView(record, undefined)
    expect(view.standing).toBe('unknown')
    expect(view.record).toBe(record)
    expect(view.fastestTimeSec).toBe(1805)
  })
})

describe('openedEquipmentDrawerRecord', () => {
  it('takes the ride facts the row was ranked under, not the combo alone', () => {
    const row = combo(TARMAC, 'zipp-808', 1805)
    const record: EquipmentDrawerRecord = openedEquipmentDrawerRecord(row, ranking([combo(CONCEPT, undefined, 1800), row]))
    expect(record).toEqual({
      combo: row,
      course: HILLY,
      laps: 1,
      fastestTimeSec: 1800,
      requestKey: 'laps=1',
      loadWheelOptions
    })
  })

  it('holds the combo alone when it is opened with no ranking on screen', () => {
    const row = combo(TARMAC, 'zipp-808', 1805)
    expect(openedEquipmentDrawerRecord(row, undefined)).toEqual({ combo: row })
  })
})
