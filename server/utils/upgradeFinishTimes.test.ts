import { describe, expect, it } from 'vitest'
import type { ClassifiedBikeFrame, ComboScore } from '../../shared/types/catalog'
import { getFrames } from '../../shared/utils/catalog'
import { classifyBikeFrame } from '../../shared/utils/classifyBikeFrame'
import { upgradeFinishTimesSec } from './upgradeFinishTimes'

const measuredFrame = getFrames().find(frame => frame.upgradeCurve)!
const unmeasuredFrame = getFrames().find(frame => !frame.upgradeCurve)!

function comboFor(frame: ClassifiedBikeFrame, finishTimeSec: number | undefined): ComboScore {
  return { frame, score: 50, breakdown: { aero: 50, climb: 50, gravel: 50, cobble: 50 }, finishTimeSec }
}

describe('upgradeFinishTimesSec', () => {
  it('returns one simulated time per upgrade stage', () => {
    const combo = comboFor(classifyBikeFrame(measuredFrame, 3), 1800)
    const times = upgradeFinishTimesSec(combo, () => 1234)
    expect(times).toHaveLength(6)
  })

  it('takes the rider\'s current stage from the combo instead of simulating it again', () => {
    // The curve is drawn beside the finish time the drawer prints. Passing
    // through that exact number has to be structural, not a coincidence of
    // two identical simulations - and it saves an integration.
    const combo = comboFor(classifyBikeFrame(measuredFrame, 3), 1800)
    const simulatedStages: number[] = []
    const times = upgradeFinishTimesSec(combo, (frame) => {
      simulatedStages.push(frame.level)
      return 1000 + frame.level
    })
    expect(times![3]).toBe(1800)
    expect(simulatedStages).toEqual([0, 1, 2, 4, 5])
  })

  it('classifies each stage from the catalog\'s own entry, never from the already-upgraded frame', () => {
    // `combo.frame` is already at the rider's stage; re-classifying that would
    // compound one upgrade onto another.
    const combo = comboFor(classifyBikeFrame(measuredFrame, 5), 1800)
    const seen: { level: number, aero: number }[] = []
    upgradeFinishTimesSec(combo, (frame) => {
      seen.push({ level: frame.level, aero: frame.scores.aero })
      return 1000
    })
    for (const { level, aero } of seen) {
      expect(aero, `stage ${level}`).toBe(classifyBikeFrame(measuredFrame, level).scores.aero)
    }
  })

  it('draws nothing for a frame with no per-stage data, where upgrading changes nothing', () => {
    expect(upgradeFinishTimesSec(comboFor(unmeasuredFrame, 1800), () => 1000)).toBeUndefined()
  })

  it('draws nothing without a rider profile, where there is no finish time to anchor to', () => {
    expect(upgradeFinishTimesSec(comboFor(classifyBikeFrame(measuredFrame, 3), undefined), () => 1000)).toBeUndefined()
  })
})
