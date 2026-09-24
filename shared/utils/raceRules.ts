import { draftingAllowed, raceFormatPhrase, ttBikesAllowed, type RaceFormat } from './events'

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
 * Its own module rather than a few more lines in `events.ts`, because it is
 * wording, not calendar data. In `shared/` because the markdown race
 * document leads its answer with the same line as the page, through
 * `buildRecommendationAnswer`, and server code cannot import from `app/`.
 */
export function rideRulesLine(format: RaceFormat): string {
  const tt = ttBikesAllowed(format)
    ? 'TT bikes are allowed in this team time trial'
    : format === 'rot'
      ? 'WTRL bans TT bikes from its Race of Truth'
      : `TT bikes are disabled for this ${raceFormatPhrase(format)}`
  return `${tt}${draftingAllowed(format) ? '' : ', and WTRL turns drafting off, so the time is for riding solo'}.`
}
