import { describe, expect, it } from 'vitest'
import { bikeFrontWheels, bikeRearWheels } from 'zwift-data'
import { getWheelsets } from '../utils/wheelsets'
import { classifyFrontWheel } from '../utils/classifyWheel'
import { solveWheelEquipmentDelta } from '../utils/physics/equipment'
import type { EquipmentPhysicsDelta } from '../types/catalog'
import { RENAMED_WHEELSET_KEYS, SUPPLEMENT_FRONT_WHEELS, SUPPLEMENT_REAR_WHEELS, WITHDRAWN_FRONT_WHEELS, WITHDRAWN_REAR_WHEELS, applyWheelSupplement, migrateWheelsetKeys } from './wheelSupplement'

describe('applyWheelSupplement', () => {
  const a = { id: 1, name: 'Brand A', imageName: 'Wheel_A' }
  const b = { id: 2, name: 'Brand B', imageName: 'Wheel_B' }

  it('renames in place on an id match, appends new ids, and drops a new id that reuses an upstream name', () => {
    const merged = applyWheelSupplement([a, b], [
      { id: 1, name: 'Brand A Renamed', imageName: 'Wheel_A' },
      { id: 9, name: 'Brand B', imageName: 'Wheel_B2' },
      { id: 3, name: 'Brand C', imageName: 'Wheel_C' }
    ], [])
    expect(merged.map(w => [w.id, w.name])).toEqual([[1, 'Brand A Renamed'], [2, 'Brand B'], [3, 'Brand C']])
  })

  it('drops a withdrawn id, so a later wheel can take its name', () => {
    const merged = applyWheelSupplement([a, b], [{ id: 7, name: 'Brand A', imageName: 'Wheel_A2026' }], [{ id: 1, name: 'Brand A' }])
    expect(merged.map(w => [w.id, w.name])).toEqual([[2, 'Brand B'], [7, 'Brand A']])
  })
})

/** The dictionary's records for the renamed wheels, as a future zwift-data release would ship them. */
const DICTIONARY_RENAMES = new Map<number, string>([
  [3400914270, 'Roval Rapide Sprint CLX'], [3517161569, 'Roval Rapide Sprint CLX'],
  [817265411, 'Princeton Mach TSV2/Blur Disc'], [3710951039, 'Princeton Mach TSV2/Blur Disc']
])
const renamedUpstream = <W extends { id: number, name: string }>(list: readonly W[]) =>
  list.map(w => DICTIONARY_RENAMES.has(w.id) ? { ...w, name: DICTIONARY_RENAMES.get(w.id)! } : w)

/** The physics a wheel carries is the solve of the sheet's own gaps for it. */
function expectPhysicsOf(physics: EquipmentPhysicsDelta | undefined, flatGapSec: number, climbGapSec: number, name: string) {
  const solved = solveWheelEquipmentDelta({ flatGapSec, climbGapSec })
  expect(physics?.cdaDeltaM2, name).toBeCloseTo(solved.cdaDeltaM2, 6)
  expect(physics?.bikeMassDeltaKg, name).toBeCloseTo(solved.bikeMassDeltaKg, 4)
}

describe('wheels the game renamed keep their measurement', () => {
  // Sheet values (ZwiftInsider 300 W, Zwift Carbon) - an independent source,
  // not the table the classifier reads.
  const measured = [
    { name: 'Roval Rapide Sprint CLX', flatGapSec: 43, climbGapSec: 6.7 },
    { name: 'Princeton Mach TSV2/Blur Disc', flatGapSec: 49.9, climbGapSec: -8.1 }
  ]

  for (const [label, front, rear] of [
    ['today\'s zwift-data', bikeFrontWheels, bikeRearWheels],
    ['zwift-data once it ships the dictionary\'s names', renamedUpstream(bikeFrontWheels), renamedUpstream(bikeRearWheels)]
  ] as const) {
    it(`under ${label}, each is one measured wheel under the game's name`, () => {
      const allFront = applyWheelSupplement(front, SUPPLEMENT_FRONT_WHEELS, WITHDRAWN_FRONT_WHEELS)
      const allRear = applyWheelSupplement(rear, SUPPLEMENT_REAR_WHEELS, WITHDRAWN_REAR_WHEELS)
      for (const { name, flatGapSec, climbGapSec } of measured) {
        expect(allFront.filter(w => w.name === name), name).toHaveLength(1)
        expect(allRear.filter(w => w.name === name), name).toHaveLength(1)
        const wheel = classifyFrontWheel(allFront.find(w => w.name === name)!)
        expect(wheel.confidence, name).toBe('measured')
        expectPhysicsOf(wheel.physics, flatGapSec, climbGapSec, name)
      }
      expect(allFront.some(w => w.name === 'Roval Sprint CLX' || w.name.startsWith('Princeton  Mach'))).toBe(false)
    })
  }

  it('the garage lists them under the new keys', () => {
    const keys = getWheelsets().map(w => w.key)
    expect(keys).toContain('Roval Rapide Sprint CLX')
    expect(keys).toContain('Princeton Mach TSV2/Blur Disc')
    expect(keys).not.toContain('Roval Sprint CLX')
  })
})

describe('the 2026 Shimano DURA-ACE wheels', () => {
  // The game removed the older revisions; the 2026 wheels carry the
  // DURA-ACE names (in-game check, 2026-10-07). Sheet values, 300 W.
  const expected = [
    ['Shimano DURA-ACE C36', 27.2, 10.8],
    ['Shimano DURA-ACE C50', 39.9, 10.6],
    ['Shimano DURA-ACE C60', 42.4, 8.7],
    ['Shimano DURA-ACE C99 + Disc', 52.4, -6.2]
  ] as const

  it('each name is one wheelset, the 2026 wheel, with its own measurement', () => {
    for (const [name, flatGapSec, climbGapSec] of expected) {
      const sets = getWheelsets().filter(w => w.name === name || w.name.startsWith(`${name} (`))
      expect(sets.map(w => w.key), name).toEqual([name])
      expect(sets[0]!.front.imageName, name).toMatch(/2026$/)
      expect(sets[0]!.confidence, name).toBe('measured')
      expectPhysicsOf(sets[0]!.physics, flatGapSec, climbGapSec, name)
    }
  })

  it('the old names are gone', () => {
    const keys = getWheelsets().map(w => w.key)
    for (const old of ['Shimano C36', 'Shimano C50', 'Shimano C60', 'Shimano C99/Disc']) expect(keys, old).not.toContain(old)
  })
})

describe('the update-1.123 discs the dictionary named on 2026-10-09 (#314)', () => {
  // Sheet values (ZwiftInsider 300 W, Zwift Carbon), as in the table before
  // the re-key - the measurement moves with the name, unchanged.
  const renamed = [
    { from: 'CADEX 4-Spoke/Disc', to: 'Cadex 4-Spoke/Disc', frontId: 3827121667, rearId: 3443883036, flatGapSec: 53.5, climbGapSec: -7.4 },
    { from: 'Black Inc THREE/ZERO', to: 'BlackInc Three/Zero', frontId: 1690454004, rearId: 2002469001, flatGapSec: 52.7, climbGapSec: -14.3 }
  ]

  it('each is one measured disc wheelset under the dictionary\'s name, on the same ids', () => {
    for (const { from, to, frontId, rearId, flatGapSec, climbGapSec } of renamed) {
      const sets = getWheelsets().filter(w => w.front.id === frontId)
      expect(sets.map(w => w.key), to).toEqual([to])
      expect(sets[0]!.rear.id, to).toBe(rearId)
      expect(sets[0]!.rear.category, to).toBe('disc')
      expect(sets[0]!.confidence, to).toBe('measured')
      expectPhysicsOf(sets[0]!.physics, flatGapSec, climbGapSec, to)
      expect(getWheelsets().some(w => w.key === from), from).toBe(false)
    }
  })

  it('a garage that held the old keys keeps both wheels under the new names', () => {
    expect(migrateWheelsetKeys({ 'CADEX 4-Spoke/Disc': true, 'Black Inc THREE/ZERO': true, 'Zipp 808': true })).toEqual({
      'Cadex 4-Spoke/Disc': true,
      'BlackInc Three/Zero': true,
      'Zipp 808': true
    })
  })
})

describe('a garage saved before the renames', () => {
  it('keeps every wheel, under the name the game now uses', () => {
    const saved = { 'Roval Sprint CLX': true, 'Princeton  Mach TSV2/Blur Disc\u00A0': true, 'Shimano C36': true, 'Shimano C99/Disc': true, 'Zipp 808': true } as const
    expect(migrateWheelsetKeys(saved)).toEqual({
      'Roval Rapide Sprint CLX': true,
      'Princeton Mach TSV2/Blur Disc': true,
      'Shimano DURA-ACE C36': true,
      'Shimano DURA-ACE C99 + Disc': true,
      'Zipp 808': true
    })
  })

  it('is unchanged when it holds no old key', () => {
    const current = { 'Zipp 808': true, 'Shimano DURA-ACE C50': true } as const
    expect(migrateWheelsetKeys(current)).toBe(current)
  })

  it('every new key is a wheelset the catalog has, and no old key is', () => {
    const keys = new Set(getWheelsets().map(w => w.key))
    for (const [from, to] of Object.entries(RENAMED_WHEELSET_KEYS)) {
      expect(keys.has(to), to).toBe(true)
      expect(keys.has(from), from).toBe(false)
    }
  })
})
