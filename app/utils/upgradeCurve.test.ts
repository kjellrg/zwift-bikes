import { describe, expect, it } from 'vitest'
import { upgradeCurveKey, upgradeGainRange, upgradeGains, upgradeGainY, upgradeStageX } from './upgradeCurve'

const TARMAC = { frame: { id: 3371227947 }, wheelset: { key: 'roval-alpinist-clx' } }
const TARMAC_ON_ZIPP = { frame: { id: 3371227947 }, wheelset: { key: 'zipp-808' } }
const CONCEPT = { frame: { id: 2225644136 } }

/**
 * The identity of an "On this route" upgrade curve. Only equality is the
 * contract - the drawer holds one key and refetches when it stops matching -
 * so these assert what must and must not collide, never the string's shape.
 */
describe('upgradeCurveKey', () => {
  it('is stable for the same bike under the same request', () => {
    expect(upgradeCurveKey(TARMAC, 'laps=1&powerW=225')).toBe(upgradeCurveKey(TARMAC, 'laps=1&powerW=225'))
  })

  it('changes when the request does, so a curve cannot outlive the ride it was computed for', () => {
    // The bug this key exists for: laps and power move the curve, and the
    // caption beside it reads them live.
    expect(upgradeCurveKey(TARMAC, 'laps=1&powerW=225')).not.toBe(upgradeCurveKey(TARMAC, 'laps=2&powerW=225'))
    expect(upgradeCurveKey(TARMAC, 'laps=1&powerW=225')).not.toBe(upgradeCurveKey(TARMAC, 'laps=1&powerW=320'))
  })

  it('changes when the frame or its wheels do', () => {
    expect(upgradeCurveKey(TARMAC, 'q')).not.toBe(upgradeCurveKey(TARMAC_ON_ZIPP, 'q'))
    expect(upgradeCurveKey(TARMAC, 'q')).not.toBe(upgradeCurveKey(CONCEPT, 'q'))
  })

  it('keys a fixed-wheel frame without inventing a wheelset', () => {
    expect(upgradeCurveKey(CONCEPT, 'q')).toBe(upgradeCurveKey({ frame: { id: CONCEPT.frame.id } }, 'q'))
    expect(upgradeCurveKey(CONCEPT, 'q')).not.toBe(upgradeCurveKey(CONCEPT, 'other'))
  })

  it('still separates bikes when no request is known', () => {
    // A card outside a request page passes nothing; the key must still tell
    // two bikes apart rather than collapsing them onto one curve.
    expect(upgradeCurveKey(TARMAC, undefined)).not.toBe(upgradeCurveKey(CONCEPT, undefined))
    expect(upgradeCurveKey(TARMAC, undefined)).not.toBe(upgradeCurveKey(TARMAC, 'q'))
  })
})

describe('upgrade curve drawing', () => {
  it('draws gains over stage 0, not the curve against the reference bike', () => {
    expect(upgradeGains([-40, -35, -30, -28, -26, -25])).toEqual([0, 5, 10, 12, 14, 15])
  })

  it('never starts the range above 0 or spans less than one unit, and covers every series drawn on it', () => {
    expect(upgradeGainRange([0, 0.2, 0.4])).toEqual({ min: 0, max: 1 })
    expect(upgradeGainRange([0, 5, 15], [0, -2, 3])).toEqual({ min: -2, max: 15 })
  })

  it('spaces the stages evenly inside the padding and puts larger gains higher', () => {
    expect([0, 5].map(stage => upgradeStageX(stage, 6, 240, 6))).toEqual([6, 234])
    const range = { min: 0, max: 10 }
    expect(upgradeGainY(0, range, 64, 6)).toBe(58)
    expect(upgradeGainY(10, range, 64, 6)).toBe(6)
  })
})
