import type { RaceFormat } from '#shared/utils/events'
import { draftingAllowed, ttBikesAllowed } from '#shared/utils/events'
import { raceFormatPhrase } from './labels'

/**
 * What a Race format means for the bike, ahead of the recommendation and
 * inside the one string the FAQ structured data carries - see `rideRules` on
 * `buildRecommendationAnswer`.
 *
 * Who does the disabling differs and it matters to a rider reading the rules:
 * Zwift itself blocks TT frames in points and scratch races, whereas WTRL bans
 * them by regulation in a Race of Truth - where drafting being off would
 * otherwise be the TT bike's whole argument, so a rider is owed the reason
 * rather than just the verdict.
 *
 * One wording for every page that can be told a format (issue #224): a race
 * page reads it off its own race, a segment page off `?rules=`, and a rider
 * following the link from one to the other must not be given two accounts of
 * the same rule. The rules themselves come from `ttBikesAllowed` /
 * `draftingAllowed`, never from a second reading of the format here.
 *
 * Its own module rather than a few more lines in `labels.ts`, for one reason:
 * it is the only piece of wording that needs the rules and not just the
 * vocabulary, so it is the only one that imports `shared/utils/events` as a
 * value - and that module validates the whole season calendar at import. In
 * `labels.ts`, which practically every page reaches, that would put the
 * calendar in every bundle. `RACE_FORMAT_LABELS` and `raceFormatPhrase` stay
 * there, where their events dependency is types only.
 */
export function rideRulesLine(format: RaceFormat): string {
  const tt = ttBikesAllowed(format)
    ? 'TT bikes are allowed in this team time trial'
    : format === 'rot'
      ? 'WTRL bans TT bikes from its Race of Truth'
      : `TT bikes are disabled for this ${raceFormatPhrase(format)}`
  return `${tt}${draftingAllowed(format) ? '' : ', and WTRL turns drafting off, so the time below is ridden solo'}.`
}
