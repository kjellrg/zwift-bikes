import { describe, expect, it } from 'vitest'
import { buildRecommendationAnswer, type RecommendationAnswerInputs } from './recommendationAnswer'

const base: RecommendationAnswerInputs = {
  frameName: 'Specialized Tarmac SL9',
  wheelsetName: 'Shimano C99/Disc',
  finishTimeSec: 1062,
  distanceKm: 9.7,
  rideName: 'Watopia Hilly Route in Watopia',
  rider: { weightKg: 75, heightCm: 175, powerW: 225, draftMode: 'solo', tttRiders: 8, tttClimbWkg: undefined, category: 'standard' },
  laps: 1,
  verifiedOnly: true,
  includeHaloBikes: false,
  myBikesOnly: false,
  ownsFrames: false,
  ownsWheels: false,
  search: ''
}

describe('buildRecommendationAnswer', () => {
  it('names the equipment, the ride, the time and the speed in the summary', () => {
    const answer = buildRecommendationAnswer(base)
    expect(answer.summary).toBe('Our model puts Specialized Tarmac SL9 with Shimano C99/Disc fastest within the current filters for Watopia Hilly Route in Watopia: 17:42 (~32.9 km/h).')
  })

  it('spells out every assumption the time depends on', () => {
    const answer = buildRecommendationAnswer(base)
    expect(answer.assumptions).toBe('75 kg / 175 cm / 225 W / solo; 1 lap, including any lead-in once. Standard (Road); verified only; unowned Halo bikes excluded.')
    expect(answer.text).toBe(`${answer.summary} ${answer.assumptions}`)
  })

  it('omits the speed when the ride has no distance to divide by', () => {
    const answer = buildRecommendationAnswer({ ...base, distanceKm: undefined })
    expect(answer.summary).toMatch(/: 17:42\.$/)
  })

  it('describes a fixed-wheel frame by its frame alone', () => {
    const answer = buildRecommendationAnswer({ ...base, wheelsetName: undefined })
    expect(answer.summary).toMatch(/^Our model puts Specialized Tarmac SL9 fastest/)
  })

  it('names the garage pool by which collections the rider actually owns', () => {
    expect(buildRecommendationAnswer({ ...base, myBikesOnly: true, ownsFrames: true, ownsWheels: true }).summary)
      .toContain('fastest in your garage, within the current filters')
    expect(buildRecommendationAnswer({ ...base, myBikesOnly: true, ownsFrames: true }).summary)
      .toContain('fastest among your frames with all compatible wheels, within the current filters')
    expect(buildRecommendationAnswer({ ...base, myBikesOnly: true, ownsWheels: true }).summary)
      .toContain('fastest among all eligible frames with your wheels, within the current filters')
    // An empty garage falls back to the full catalog, and the answer must not claim otherwise.
    expect(buildRecommendationAnswer({ ...base, myBikesOnly: true }).summary)
      .toContain('fastest within the current filters')
  })

  it('quotes the applied rider, not the stored profile: the block it is handed is the whole rider side', () => {
    const applied = buildRecommendationAnswer({ ...base, rider: { ...base.rider, weightKg: 82, heightCm: 180, powerW: 900 } })
    expect(applied.assumptions).toMatch(/^82 kg \/ 180 cm \/ 900 W \/ solo;/)
  })

  it('states the draft model, including the paceline size and any team climb pace', () => {
    expect(buildRecommendationAnswer({ ...base, rider: { ...base.rider, draftMode: 'race' } }).assumptions).toContain('/ race drafting;')
    expect(buildRecommendationAnswer({ ...base, rider: { ...base.rider, draftMode: 'ttt', tttRiders: 6 } }).assumptions).toContain('/ TTT paceline (6 riders);')
    expect(buildRecommendationAnswer({ ...base, rider: { ...base.rider, draftMode: 'ttt', tttRiders: 6, tttClimbWkg: 3.25 } }).assumptions)
      .toContain('/ TTT paceline (6 riders, 3.3 W/kg team climb pace);')
  })

  it('pluralises laps and describes a segment ride by its timing scope', () => {
    expect(buildRecommendationAnswer({ ...base, laps: 3 }).assumptions).toContain('; 3 laps, including any lead-in once.')
    expect(buildRecommendationAnswer({ ...base, laps: undefined }).assumptions).toContain('; the timed segment, excluding warm-up.')
  })

  it('reflects the category, verification and Halo restrictions as applied', () => {
    const answer = buildRecommendationAnswer({ ...base, rider: { ...base.rider, category: 'all' }, verifiedOnly: false, includeHaloBikes: true })
    expect(answer.assumptions).toContain('all bike categories; includes estimates; Halo bikes included.')
  })

  it('treats a directed search as including Halo bikes, and names the term', () => {
    const answer = buildRecommendationAnswer({ ...base, search: ' Concept ' })
    expect(answer.assumptions).toContain('Halo bikes included; search: Concept.')
  })

  it('leads with the ride\'s own rules where it has any, in the one string a crawler reads', () => {
    const rules = 'TT bikes are disabled for this points race.'
    const answer = buildRecommendationAnswer({ ...base, rideRules: rules })
    expect(answer.summary).toBe(`${rules} ${buildRecommendationAnswer(base).summary}`)
    // One string, so the visible answer and the FAQ structured data carry the rule alike.
    expect(answer.text).toBe(`${answer.summary} ${answer.assumptions}`)
  })

  it('says nothing extra for a ride with no rules beyond physics', () => {
    expect(buildRecommendationAnswer({ ...base, rideRules: undefined }).summary)
      .toMatch(/^Our model puts /)
  })
})
