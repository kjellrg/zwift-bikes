import { describe, expect, it } from 'vitest'
import { classifyFrontWheel } from './classifyWheel'
import { getWheelsets, INTEGRATED_ONLY_WHEELS } from './wheelsets'
import { precomputedWheelDelta } from '../data/equipmentPhysics'

const classify = (name: string) => classifyFrontWheel({ id: 999999, name, imageName: 'test' })

describe('name-based wheel classification', () => {
  it('reads literal rim depth from the name', () => {
    expect(classify('Testbrand C24').category).toBe('climb') // < 35mm
    expect(classify('Testbrand C50').category).toBe('allrounder') // 35-64mm
    expect(classify('Testbrand C88').category).toBe('aero') // >= 65mm
  })

  it('uses the known-depth table for model families whose numbers are not literal mm', () => {
    // Zipp 202 is a ~32mm climbing wheel, not a 202mm one.
    expect(classify('Testbrand 202').category).toBe('climb')
    expect(classify('Testbrand 808').category).toBe('aero')
  })

  it('parses Enve SES x.y naming as depth x10', () => {
    expect(classify('Testbrand SES 2.3').category).toBe('climb') // 30mm
    expect(classify('Testbrand SES 7.8').category).toBe('aero') // 80mm
  })

  it('flags gravel, disc and novelty wheels by name', () => {
    expect(classify('Testbrand XPLR').category).toBe('gravel')
    expect(classify('Testbrand Disc').category).toBe('disc')
    expect(classify('BMX Bandit').category).toBe('allrounder')
  })
})

describe('Crr class and off-road scores (Zwift\'s published values)', () => {
  it('road-class wheels get the best cobble score and the worst gravel score', () => {
    const wheel = classify('Testbrand C50')
    expect(wheel.crrClass).toBe('road')
    expect(wheel.scores.cobble).toBe(96)
    expect(wheel.scores.gravel).toBe(8)
  })

  it('gravel-class wheels get the best gravel score but a mid cobble score', () => {
    const wheel = classify('Testbrand XPLR')
    expect(wheel.crrClass).toBe('gravel')
    expect(wheel.scores.gravel).toBe(96)
    expect(wheel.scores.cobble).toBe(40)
  })

  it('the Zwift Mountain wheel is the only mountain-class wheel', () => {
    const mountain = getWheelsets().filter(w => w.crrClass === 'mountain')
    expect(mountain.map(w => w.name)).toEqual(['Zwift Mountain'])
  })
})

describe('measured vs estimated wheels', () => {
  it('a measured wheel carries solved physics; an estimated one does not', () => {
    const measured = getWheelsets().filter(w => w.confidence === 'measured')
    const estimated = getWheelsets().filter(w => w.confidence === 'estimated')
    expect(measured.length).toBeGreaterThan(0)
    expect(estimated.length).toBeGreaterThan(0)
    for (const w of measured) expect(w.physics, w.name).toBeDefined()
    for (const w of estimated) expect(w.physics, w.name).toBeUndefined()
  })

  it('no estimated wheel outranks the best measured wheel (being unmeasured must never be an advantage)', () => {
    // Issue #70: an estimated preset above the measured distribution made
    // unknown wheels beat real data precisely because they were guesses.
    const all = getWheelsets()
    const maxMeasuredAero = Math.max(...all.filter(w => w.confidence === 'measured').map(w => w.scores.aero))
    const maxMeasuredClimb = Math.max(...all.filter(w => w.confidence === 'measured').map(w => w.scores.climb))
    for (const w of all.filter(w => w.confidence === 'estimated')) {
      expect(w.scores.aero, `${w.name} aero`).toBeLessThan(maxMeasuredAero)
      expect(w.scores.climb, `${w.name} climb`).toBeLessThan(maxMeasuredClimb)
    }
  })
})

describe('wheelset assembly', () => {
  it('produces unique keys, except the known upstream "Zwift Concept" name collision', () => {
    // zwift-data lists TWO wheels named "Zwift Concept" (regular
    // Wheel_ZwiftConcept and gold Wheel_ZwiftConceptGold ids), so the
    // name-keyed pairing in `getWheelsets` currently emits two wheelsets with
    // the same key - a real, known latent defect this test documents rather
    // than hides. Any NEW duplicate still fails here.
    const keys = getWheelsets().map(w => w.key)
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index)
    expect(duplicates).toEqual(['Zwift Concept'])
  })

  it('never offers integrated-only wheels as swappable wheelsets (issue #87)', () => {
    for (const wheelset of getWheelsets()) {
      expect(INTEGRATED_ONLY_WHEELS.has(wheelset.front.name)).toBe(false)
      expect(INTEGRATED_ONLY_WHEELS.has(wheelset.rear.name)).toBe(false)
    }
  })

  it('every wheelset\'s Crr class matches its front wheel\'s', () => {
    for (const wheelset of getWheelsets()) expect(wheelset.crrClass).toBe(wheelset.front.crrClass)
  })

  it('takes a rear-only set\'s numbers from the rear wheel alone (issue #150)', () => {
    // A `WHEEL_SPEED_DATA` row measures the complete assembled set, so the
    // rear's row already covers the front it ships with - averaging in the
    // standalone front's row halves the disc's measured character. Guards
    // the next rear-only wheel zwift-data ships, not just this one.
    const set = getWheelsets().find(w => w.key === 'Zipp 808/Super9')!
    expect(set.rear.name).toBe('Zipp 808/Super9')
    expect(set.front.name).toBe('Zipp 808')
    expect(set.physics).toEqual(precomputedWheelDelta('Zipp 808/Super9'))
    expect(set.scores).toEqual(set.rear.scores)
    expect(set.confidence).toBe(set.rear.confidence)
    expect(set.name).toBe('Zipp 808/Super9')
  })
})
