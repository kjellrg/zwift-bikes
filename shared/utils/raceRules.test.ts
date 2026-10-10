import { describe, expect, it } from 'vitest'
import { RACE_FORMAT_LABELS, raceFormatPhrase, type RaceFormat } from './events'
import { raceFormatRules } from './raceRules'
import { rideRulesForFormat } from './recommendQuery'

/**
 * Everything a page says about a Race format, in one wording (issues #224,
 * #318): the race page from its own race, a segment page from `?rules=`. A
 * rider following the link from one to the other must not be given two
 * accounts of the same rule, so the words are tested here rather than on
 * either page - and the race page's words are the ones every page uses.
 */
const rulesFor = (format: RaceFormat) => raceFormatRules(rideRulesForFormat(format))!

describe('raceFormatRules', () => {
  it('is nothing for a Ride told no format, which is not a race', () => {
    expect(raceFormatRules(rideRulesForFormat(undefined))).toBeUndefined()
    expect(raceFormatRules(undefined)).toBeUndefined()
  })

  it('names who bars TT frames, because Zwift and WTRL are different answers', () => {
    expect(rulesFor('points').ttBarredReason).toBe('Zwift disables TT frames for points races.')
    expect(rulesFor('scratch').ttBarredReason).toBe('Zwift disables TT frames for scratch races.')
    // WTRL's ban is a regulation, not the game disabling them - and drafting
    // being off is exactly what would otherwise argue FOR a TT bike.
    expect(rulesFor('rot').ttBarredReason).toBe('WTRL bans TT frames from a Race of Truth.')
    expect(rulesFor('ttt').ttBarredReason).toBeUndefined()
    expect(rulesFor('ttt').ttFramesBarred).toBe(false)
    expect(rulesFor('points').ttFramesBarred).toBe(true)
  })

  it('locks the draft in a Race of Truth only, and says why', () => {
    expect(rulesFor('rot').draftLockedReason).toBe('WTRL turns the draft off for a Race of Truth.')
    for (const format of ['points', 'scratch', 'ttt'] as const) expect(rulesFor(format).draftLockedReason).toBeUndefined()
  })

  it('leads the answer with the same sentences the Rider card gives as reasons', () => {
    expect(rulesFor('points').rulesLine).toBe('Zwift disables TT frames for points races.')
    expect(rulesFor('scratch').rulesLine).toBe('Zwift disables TT frames for scratch races.')
    expect(rulesFor('rot').rulesLine).toBe('WTRL bans TT frames from a Race of Truth. WTRL turns the draft off for a Race of Truth, so the time is for riding solo.')
    expect(rulesFor('ttt').rulesLine).toBe('Zwift enables TT frames – and gives them draft – for team time trials.')
  })

  it('says under the Fact row what the rule does to the ranking, in those sentences', () => {
    expect(rulesFor('points').alert).toBe('Zwift disables TT frames for points races, so they are excluded from the ranking below. Everything listed is a bike you can actually start on.')
    expect(rulesFor('rot').alert).toBe('WTRL bans TT frames from a Race of Truth, so this is raced on road bikes, and they are the only thing ranked below.')
    expect(rulesFor('ttt').alert).toBe('Zwift enables TT frames – and gives them draft – for team time trials, so they are included in the ranking below.')
    expect(rulesFor('rot').soloNote).toBe('WTRL turns the draft off for a Race of Truth, so the ranking is ridden solo; your saved draft setting still applies everywhere else.')
    expect(rulesFor('points').soloNote).toBeUndefined()
  })

  it('has one wording of the Race of Truth\'s two rules, whatever it is saying', () => {
    const rot = rulesFor('rot')
    const said = [rot.rulesLine, rot.alert, rot.soloNote, rot.ttBarredReason, rot.draftLockedReason].join(' ')
    expect(said.match(/WTRL bans TT frames from a Race of Truth/g)).toHaveLength(3)
    expect(said.match(/WTRL turns the draft off for a Race of Truth/g)).toHaveLength(3)
    expect(said).not.toMatch(/TT bikes|no draft|Drafting is off/i)
  })

  it('names the format for prose and for a label', () => {
    expect(rulesFor('points')).toMatchObject({ format: 'points', label: 'Points race', phrase: 'points race' })
    expect(rulesFor('rot')).toMatchObject({ label: 'Race of Truth', phrase: 'Race of Truth' })
  })

  it('says what a scoring segment\'s link carries', () => {
    expect(rulesFor('points').segmentLinkNote).toBe('The link carries this race\'s format, so that ranking is ridden as a points race too, with TT frames left out of it.')
    expect(rulesFor('rot').segmentLinkNote).toBe('The link carries this race\'s format, so that ranking is ridden as a Race of Truth too, with TT frames left out of it and no draft.')
    expect(rulesFor('ttt').segmentLinkNote).toBe('The link carries this race\'s format, so that ranking is ridden as a team time trial too.')
  })

  describe('the draft nudge, given the Applied draft mode', () => {
    const nudge = (format: RaceFormat, applied: 'solo' | 'race' | 'ttt') => raceFormatRules(rideRulesForFormat(format), applied)!.draftNudge

    it('points a team time trial at TTT draft mode', () => {
      expect(nudge('ttt', 'solo')).toEqual({
        text: 'This is a team time trial, but the ranking below is computed for a solo rider. TTT draft mode ranks bikes at your team\'s paceline speeds instead – and it can genuinely reorder the list.',
        action: 'Use TTT draft mode',
        mode: 'ttt'
      })
      expect(nudge('ttt', 'race')?.text).toContain('computed for a mass-start bunch.')
      expect(nudge('ttt', 'ttt')).toBeUndefined()
    })

    it('points a mass start at race draft mode', () => {
      expect(nudge('points', 'solo')).toEqual({
        text: 'This is a points race, but the ranking below is computed for a lone rider with no draft at all. Race draft mode adds the draft a typical mid-pack racer measurably gets, calibrated on thirteen real race fields.',
        action: 'Use race draft mode',
        mode: 'race'
      })
      expect(nudge('scratch', 'ttt')).toEqual({
        text: 'The ranking uses TTT draft mode, but this is a scratch race - the ranking below assumes paceline speeds this race won\'t be ridden at. Race draft mode models the mass-start bunch this actually is.',
        action: 'Use race draft mode',
        mode: 'race'
      })
      expect(nudge('points', 'race')).toBeUndefined()
    })

    it('has nothing to nudge towards in a format with no draft, or without the Applied draft mode', () => {
      expect(nudge('rot', 'solo')).toBeUndefined()
      expect(nudge('rot', 'ttt')).toBeUndefined()
      expect(rulesFor('points').draftNudge).toBeUndefined()
    })
  })
})

describe('raceFormatPhrase', () => {
  it('lowercases into prose, except the one format that is a proper name', () => {
    expect(raceFormatPhrase('points')).toBe('points race')
    expect(raceFormatPhrase('ttt')).toBe('team time trial')
    expect(raceFormatPhrase('rot')).toBe('Race of Truth')
    expect(RACE_FORMAT_LABELS.rot).toBe('Race of Truth')
  })
})
