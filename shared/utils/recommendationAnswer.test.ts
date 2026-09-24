import { describe, expect, it } from 'vitest'
import type { ComboScore } from '../types/catalog'
import { buildRecommendationAnswer, type RecommendationAnswerInputs } from './recommendationAnswer'

/**
 * A ranked setup as the builder reads it. The physics are what decide
 * whether two setups on one time are the same bike under two names, so each
 * fixture carries its own - see `twin` below.
 */
function combo(frameName: string, wheelsetName: string | undefined, finishTimeSec: number, cdaDeltaM2 = 0): ComboScore {
  return {
    frame: {
      id: frameName.length,
      name: frameName,
      category: 'standard',
      hasFixedWheels: wheelsetName === undefined,
      physics: { cdaDeltaM2, bikeMassDeltaKg: 0, crrDelta: 0 }
    },
    wheelset: wheelsetName === undefined
      ? undefined
      : { key: wheelsetName, name: wheelsetName, rear: { category: 'aero' }, crrClass: 'road', physics: { cdaDeltaM2: 0, bikeMassDeltaKg: 0, crrDelta: 0 } },
    finishTimeSec
  } as unknown as ComboScore
}

const rank1 = combo('Specialized Tarmac SL9', 'Shimano C99/Disc', 1062)
const runnerUp = combo('Canyon Aeroad 2024', 'Zipp 858/Super9', 1062.33, 0.001)

const base: RecommendationAnswerInputs = {
  ranking: [rank1, runnerUp],
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
  it('says who predicts it, for which rider, in which pool, and how close the runner-up is', () => {
    expect(buildRecommendationAnswer(base)!.summary).toBe(
      'ZwiftBikes predicts the Specialized Tarmac SL9 with Shimano C99/Disc is the best bike and wheels for Watopia Hilly Route in Watopia: '
      + 'the fastest road setup for a 75 kg rider at 225 W, finishing in 17:42 (~32.9 km/h). '
      + 'The Canyon Aeroad 2024 with Zipp 858/Super9 is 0.33 s behind.'
    )
  })

  it('says "tied" only when the gap is exactly zero', () => {
    const tied = combo('Canyon Aeroad 2024', 'Zipp 858/Super9', 1062, 0.001)
    expect(buildRecommendationAnswer({ ...base, ranking: [rank1, tied] })!.summary)
      .toMatch(/ The Canyon Aeroad 2024 with Zipp 858\/Super9 is tied with it\.$/)
    // A hundredth that rounds away is still a gap, and is said as one.
    const nearly = combo('Canyon Aeroad 2024', 'Zipp 858/Super9', 1062.003, 0.001)
    expect(buildRecommendationAnswer({ ...base, ranking: [rank1, nearly] })!.summary)
      .toMatch(/ The Canyon Aeroad 2024 with Zipp 858\/Super9 is less than 0\.01 s behind\.$/)
  })

  it('calls a tie between setups with the same physics identical, not a coincidence', () => {
    // The two Canyon Aeroads (#266): one bike under two names, so one time.
    const twin = combo('Canyon Aeroad CFR Alpecin Premier-Tech', 'Shimano C99/Disc', 1062)
    expect(buildRecommendationAnswer({ ...base, ranking: [rank1, twin] })!.summary)
      .toMatch(/ The Canyon Aeroad CFR Alpecin Premier-Tech with Shimano C99\/Disc is identical to it in the model, and tied with it\.$/)
  })

  it('names no runner-up when the Ranking has a single row', () => {
    const summary = buildRecommendationAnswer({ ...base, ranking: [rank1] })!.summary
    expect(summary).toMatch(/finishing in 17:42 \(~32\.9 km\/h\)\.$/)
    expect(summary).not.toMatch(/behind|tied/)
  })

  it('has no answer without a timed rank 1', () => {
    expect(buildRecommendationAnswer({ ...base, ranking: [] })).toBeUndefined()
    expect(buildRecommendationAnswer({ ...base, ranking: [{ ...rank1, finishTimeSec: undefined }] })).toBeUndefined()
  })

  it('names the category only when it narrowed the pool, in plain words', () => {
    const pool = (category: RecommendationAnswerInputs['rider']['category']) =>
      buildRecommendationAnswer({ ...base, rider: { ...base.rider, category } })!.summary
    expect(pool('standard')).toContain(': the fastest road setup for a 75 kg rider')
    expect(pool('tt')).toContain(': the fastest TT setup for a 75 kg rider')
    expect(pool('gravel')).toContain(': the fastest gravel setup for a 75 kg rider')
    expect(pool('all')).toContain(': the fastest setup for a 75 kg rider')
  })

  it('says every Garage pool in plain words, and never "current filters"', () => {
    const garage = (owns: Partial<RecommendationAnswerInputs>) =>
      buildRecommendationAnswer({ ...base, myBikesOnly: true, ...owns })!.summary
    expect(garage({ ownsFrames: true, ownsWheels: true }))
      .toContain('the fastest road setup among the bikes and wheels in your garage, for a 75 kg rider')
    expect(garage({ ownsFrames: true }))
      .toContain('the fastest road setup among the bikes in your garage, on any wheels that fit them, for a 75 kg rider')
    expect(garage({ ownsWheels: true }))
      .toContain('the fastest road setup on the wheels in your garage, for a 75 kg rider')
    // An empty garage falls back to the whole catalog, and the answer must not claim otherwise.
    expect(garage({})).toContain('the fastest road setup for a 75 kg rider')
    for (const summary of [garage({ ownsFrames: true, ownsWheels: true }), garage({ ownsFrames: true }), garage({ ownsWheels: true }), garage({})]) {
      expect(summary).not.toMatch(/current filters|Our model/)
    }
  })

  it('names a directed search, which is what the pool was drawn from', () => {
    expect(buildRecommendationAnswer({ ...base, search: ' Aeroad ' })!.summary)
      .toContain('the fastest road setup matching "Aeroad", for a 75 kg rider')
  })

  it('quotes the applied rider, sprint power and all, with the article the number is read with', () => {
    expect(buildRecommendationAnswer({ ...base, rider: { ...base.rider, weightKg: 82, powerW: 900 } })!.summary)
      .toContain('for an 82 kg rider at 900 W,')
  })

  it('adds the faster setup the category left out, with the same gap as the note under the answer', () => {
    const summary = buildRecommendationAnswer({
      ...base,
      fastestOverall: { frameName: 'Canyon Speedmax CFR', wheelsetName: 'DT Swiss ARC 1100 Disc', category: 'tt', reason: 'category', deltaSec: 82.4 }
    })!.summary
    expect(summary).toMatch(/ is 0\.33 s behind\. Where TT bikes are allowed, the Canyon Speedmax CFR with DT Swiss ARC 1100 Disc is 1:22 quicker\.$/)
  })

  it('does not make a legal TT bike sound conditional where the Ride\'s own rules allow it', () => {
    // A team time trial allows TT frames while the rider's category stays road.
    expect(buildRecommendationAnswer({
      ...base,
      rideRules: 'TT bikes are allowed in this team time trial.',
      fastestOverall: { frameName: 'Canyon Speedmax CFR', category: 'tt', reason: 'category', deltaSec: 82.4 }
    })!.summary).toMatch(/ On a TT bike, the Canyon Speedmax CFR is 1:22 quicker\.$/)
  })

  it('adds the faster Halo setup the Halo rule left out', () => {
    expect(buildRecommendationAnswer({
      ...base,
      fastestOverall: { frameName: 'Zwift Concept Z1', category: 'standard', reason: 'halo', deltaSec: 12.2 }
    })!.summary).toMatch(/ With Halo bikes included, the Zwift Concept Z1 is 12 s quicker\.$/)
  })

  it('names another category when that is what the pool left out', () => {
    expect(buildRecommendationAnswer({
      ...base,
      rider: { ...base.rider, category: 'gravel' },
      fastestOverall: { frameName: 'Specialized Tarmac SL8', wheelsetName: 'Zipp 404', category: 'standard', reason: 'category', deltaSec: 4.12 }
    })!.summary).toMatch(/ Across all bike categories, the Specialized Tarmac SL8 with Zipp 404 is 4\.1 s quicker\.$/)
  })

  it('carries no left-out clause when nothing faster was left out', () => {
    expect(buildRecommendationAnswer(base)!.summary).not.toMatch(/quicker/)
  })

  it('omits the speed when the ride has no distance to divide by', () => {
    expect(buildRecommendationAnswer({ ...base, ranking: [rank1], distanceKm: undefined })!.summary).toMatch(/finishing in 17:42\.$/)
  })

  it('describes a fixed-wheel frame by its frame alone', () => {
    const fixed = combo('Zwift Concept Z1', undefined, 1062)
    expect(buildRecommendationAnswer({ ...base, ranking: [fixed] })!.summary)
      .toMatch(/^ZwiftBikes predicts the Zwift Concept Z1 is the best bike and wheels for /)
  })

  it('leads with the ride\'s own rules where it has any, in the one string a crawler reads', () => {
    const rules = 'TT bikes are disabled for this points race.'
    const answer = buildRecommendationAnswer({ ...base, rideRules: rules })!
    expect(answer.summary).toBe(`${rules} ${buildRecommendationAnswer(base)!.summary}`)
    expect(answer.text).toBe(`${answer.summary} ${answer.assumptions}`)
  })
})

describe('the assumptions line', () => {
  it('spells out every assumption the time depends on', () => {
    const answer = buildRecommendationAnswer(base)!
    expect(answer.assumptions).toBe('75 kg / 175 cm / 225 W / solo; 1 lap, including any lead-in once. Standard (Road); verified only; unowned Halo bikes excluded.')
    expect(answer.text).toBe(`${answer.summary} ${answer.assumptions}`)
  })

  it('states the draft model, including the paceline size and any team climb pace', () => {
    const assumptions = (rider: Partial<RecommendationAnswerInputs['rider']>) =>
      buildRecommendationAnswer({ ...base, rider: { ...base.rider, ...rider } })!.assumptions
    expect(assumptions({ draftMode: 'race' })).toContain('/ race drafting;')
    expect(assumptions({ draftMode: 'ttt', tttRiders: 6 })).toContain('/ TTT paceline (6 riders);')
    expect(assumptions({ draftMode: 'ttt', tttRiders: 6, tttClimbWkg: 3.25 })).toContain('/ TTT paceline (6 riders, 3.3 W/kg team climb pace);')
  })

  it('pluralises laps and describes a segment ride by its timing scope', () => {
    expect(buildRecommendationAnswer({ ...base, laps: 3 })!.assumptions).toContain('; 3 laps, including any lead-in once.')
    expect(buildRecommendationAnswer({ ...base, laps: undefined })!.assumptions).toContain('; the timed segment, excluding warm-up.')
  })

  it('reflects the category, verification and Halo restrictions as applied', () => {
    const answer = buildRecommendationAnswer({ ...base, rider: { ...base.rider, category: 'all' }, verifiedOnly: false, includeHaloBikes: true })!
    expect(answer.assumptions).toContain('all bike categories; includes estimates; Halo bikes included.')
  })

  it('treats a directed search as including Halo bikes, and names the term', () => {
    expect(buildRecommendationAnswer({ ...base, search: ' Concept ' })!.assumptions).toContain('Halo bikes included; search: Concept.')
  })
})
