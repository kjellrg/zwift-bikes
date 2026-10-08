import { describe, expect, it } from 'vitest'
import { bikeFrontWheels, bikeRearWheels } from 'zwift-data'
import { SUPPLEMENT_FRONT_WHEELS, SUPPLEMENT_REAR_WHEELS, WITHDRAWN_FRONT_WHEELS, WITHDRAWN_REAR_WHEELS, applyWheelSupplement } from '../data/wheelSupplement'
import { KNOWN_SHARED_FRAME_NAMES, KNOWN_SHARED_WHEEL_NAMES, findNameClashes } from './catalogNames'
import { getFrames } from './catalog'

describe('findNameClashes', () => {
  it('names every name two entries share, with both ids', () => {
    expect(findNameClashes([{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'A' }]))
      .toEqual([{ name: 'A', ids: [1, 3] }])
  })

  it('lets a name through that is known to be shared on purpose', () => {
    expect(findNameClashes([{ id: 1, name: 'A' }, { id: 3, name: 'A' }], new Set(['A']))).toEqual([])
  })
})

// zwift-data 2.1 ships both Shimano generations: the 2026 DURA-ACE records
// (the game dictionary's, fetched 2026-10-07) under the same names as the
// older revisions it still carries. `wheelSupplement.ts` withdraws the old
// ones by id; this is what happens without that.
describe('both Shimano generations arriving under one name', () => {
  const upstream = bikeFrontWheels

  it('is caught, naming each pair, when nothing withdraws the older revisions', () => {
    const clashes = findNameClashes(applyWheelSupplement(upstream, SUPPLEMENT_FRONT_WHEELS, []), KNOWN_SHARED_WHEEL_NAMES)
    expect(clashes).toEqual([
      { name: 'Shimano DURA-ACE C60', ids: [272842014, 3181958393] },
      { name: 'Shimano DURA-ACE C36', ids: [304842870, 3842759965] },
      { name: 'Shimano DURA-ACE C50', ids: [1742598126, 2489344011] }
    ])
  })

  it('leaves one wheel per name, the 2026 one, with the withdrawals the app ships', () => {
    const merged = applyWheelSupplement(upstream, SUPPLEMENT_FRONT_WHEELS, WITHDRAWN_FRONT_WHEELS)
    expect(findNameClashes(merged, KNOWN_SHARED_WHEEL_NAMES)).toEqual([])
    expect(merged.filter(w => w.name === 'Shimano DURA-ACE C36').map(w => w.id)).toEqual([3842759965])
  })
})

describe('the catalog the app ships', () => {
  it('has no two frames and no two wheels under one name, beyond the known ones', () => {
    expect(findNameClashes(getFrames(), KNOWN_SHARED_FRAME_NAMES)).toEqual([])
    expect(findNameClashes(applyWheelSupplement(bikeFrontWheels, SUPPLEMENT_FRONT_WHEELS, WITHDRAWN_FRONT_WHEELS), KNOWN_SHARED_WHEEL_NAMES)).toEqual([])
    expect(findNameClashes(applyWheelSupplement(bikeRearWheels, SUPPLEMENT_REAR_WHEELS, WITHDRAWN_REAR_WHEELS), KNOWN_SHARED_WHEEL_NAMES)).toEqual([])
  })
})
