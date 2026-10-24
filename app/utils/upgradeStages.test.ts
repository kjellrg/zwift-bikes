import { describe, expect, it } from 'vitest'
import { STAGE_CHARTS, type UpgradeAxis, type UpgradeTier } from '#shared/data/frameUpgradeSchemes'
import { stageSteps, stageUpgrades } from './upgradeStages'

describe('stageUpgrades', () => {
  it('names what each of the five stages upgrades, by tier', () => {
    expect(stageUpgrades({ axis: 'distance', tier: 'entry' })).toEqual(['Aero', 'Weight', 'Drivetrain', 'Drops', 'XP'])
    expect(stageUpgrades({ axis: 'distance', tier: 'mid' })).toEqual(['Aero', 'Weight', 'Drivetrain', 'Aero', 'Drops'])
    expect(stageUpgrades({ axis: 'elevation', tier: 'high' })).toEqual(['Aero', 'Weight', 'Drivetrain', 'Aero', 'Weight'])
  })

  it('swaps the last two stages only for high-end duration frames', () => {
    expect(stageUpgrades({ axis: 'duration', tier: 'high' })).toEqual(['Aero', 'Weight', 'Drivetrain', 'Weight', 'Aero'])
    expect(stageUpgrades({ axis: 'duration', tier: 'mid' })).toEqual(['Aero', 'Weight', 'Drivetrain', 'Aero', 'Drops'])
  })
})

describe('stageUpgrades against the published charts', () => {
  it.each(Object.entries(STAGE_CHARTS))('%s: an aero stage helps the flat more, a weight stage the climb more', (key, chart) => {
    const [axis, tier] = key.split('-') as [UpgradeAxis, UpgradeTier]
    const labels = stageUpgrades({ axis, tier })
    const flat = stageSteps([0, ...chart.flat])
    const climb = stageSteps([0, ...chart.climb])
    labels.forEach((label, index) => {
      if (label === 'Aero') expect(flat[index]).toBeGreaterThan(climb[index]!)
      if (label === 'Weight') expect(climb[index]).toBeGreaterThan(flat[index]!)
    })
  })
})

describe('stageSteps', () => {
  it('turns cumulative gains into what each stage adds', () => {
    expect(stageSteps([0, 5, 8, 20, 20, 22])).toEqual([5, 3, 12, 0, 2])
  })
})
