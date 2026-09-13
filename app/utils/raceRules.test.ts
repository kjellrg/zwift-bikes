import { describe, expect, it } from 'vitest'
import { RACE_FORMAT_LABELS, raceFormatPhrase } from './labels'
import { rideRulesLine } from './raceRules'

/**
 * The one wording every page that can be told a Race format reads its rules
 * off (issue #224): the race page from its own race, a segment page from
 * `?rules=`. A rider following the link from one to the other must not be
 * given two accounts of the same rule, so the words are tested here rather
 * than on either page.
 */
describe('rideRulesLine', () => {
  it('names who bars TT bikes, because Zwift and WTRL are different answers', () => {
    expect(rideRulesLine('points')).toBe('TT bikes are disabled for this points race.')
    expect(rideRulesLine('scratch')).toBe('TT bikes are disabled for this scratch race.')
    // WTRL's ban is a regulation, not the game disabling them - and drafting
    // being off is exactly what would otherwise argue FOR a TT bike.
    expect(rideRulesLine('rot')).toBe('WTRL bans TT bikes from its Race of Truth, and WTRL turns drafting off, so the time below is ridden solo.')
    expect(rideRulesLine('ttt')).toBe('TT bikes are allowed in this team time trial.')
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
