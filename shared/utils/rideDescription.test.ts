import { describe, expect, it } from 'vitest'
import { rideDescription } from './rideDescription'

const tempusFugit = {
  ride: 'Tempus Fugit',
  world: 'Watopia',
  stats: '19.6 km, 32 m of climbing',
  setup: 'Cervelo S5 with Zipp 808',
  category: 'standard' as const
}

describe('rideDescription', () => {
  it('leads with the search phrase and follows with the Recommendation, without a time', () => {
    expect(rideDescription(tempusFugit)).toBe(
      'The best bike and wheels for Tempus Fugit in Watopia (19.6 km, 32 m of climbing): ZwiftBikes predicts the Cervelo S5 with Zipp 808, fastest on road bikes.'
    )
  })

  it('names the category the pool was drawn from', () => {
    expect(rideDescription({ ...tempusFugit, category: 'tt' })).toMatch(/, fastest on TT bikes\.$/)
    expect(rideDescription({ ...tempusFugit, category: 'all' })).toMatch(/, fastest in every bike category\.$/)
  })

  it('cuts "in {world}" first past 160 characters', () => {
    expect(rideDescription({ ...tempusFugit, setup: 'Cervelo S5 with Shimano C99/Disc' })).toBe(
      'The best bike and wheels for Tempus Fugit (19.6 km, 32 m of climbing): ZwiftBikes predicts the Cervelo S5 with Shimano C99/Disc, fastest on road bikes.'
    )
  })

  it('cuts the stats next, and never the setup name', () => {
    const rosier = { ride: 'the Col du Rosier climb', world: 'France', stats: '7.5 km at 4.3%, 324 m of climbing', category: 'standard' as const }
    expect(rideDescription({ ...rosier, setup: 'Specialized Aethos with Lightweight Meilenstein' })).toBe(
      'The best bike and wheels for the Col du Rosier climb: ZwiftBikes predicts the Specialized Aethos with Lightweight Meilenstein, fastest on road bikes.'
    )
    // Past every cut, the setup name still stands whole.
    const setup = 'Specialized S-Works Tarmac SL8 Limited Edition Colourway with Princeton CarbonWorks Wake 6560 Disc'
    expect(rideDescription({ ...rosier, setup })).toContain(`predicts the ${setup}.`)
  })

  it('drops the category clause last, so a long ride and setup still fit', () => {
    // 182 characters with every other cut made - a real route and its rank 1.
    const description = rideDescription({
      ride: '2022 Cycling Esports World Championships Route',
      world: 'New York',
      stats: '28.2 km, 285 m of climbing',
      setup: 'Specialized Tarmac SL9 with SwissSide HADRON Ultimate 650',
      category: 'standard'
    })
    expect(description).toBe('The best bike and wheels for 2022 Cycling Esports World Championships Route: ZwiftBikes predicts the Specialized Tarmac SL9 with SwissSide HADRON Ultimate 650.')
    expect(description.length).toBeLessThanOrEqual(160)
  })

  it('falls back to the search phrase and the stats when there is no ranking to name', () => {
    expect(rideDescription({ ...tempusFugit, setup: undefined }))
      .toBe('The best bike and wheels for Tempus Fugit in Watopia (19.6 km, 32 m of climbing), ranked by predicted finish time for your weight and power.')
  })
})
