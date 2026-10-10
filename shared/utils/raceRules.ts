import { RACE_FORMAT_LABELS, raceFormatPhrase, type RaceFormat } from './events'
import type { DraftMode } from './physics/draft'
import type { Ride } from './recommendQuery'

/**
 * The nudge towards the draft mode a Race format is actually raced in, when
 * the Applied draft mode contradicts it: a points race ranked at TTT paceline
 * speeds, or a TTT ranked solo, genuinely reorders the fastest-bike list. A
 * nudge and never a silent change - the draft mode is a stored preference,
 * and only the button's action switches it.
 */
export interface DraftNudge {
  text: string
  action: string
  mode: Extract<DraftMode, 'race' | 'ttt'>
}

/**
 * Everything a page says about the Race format its Ride is ridden under (see
 * **Race format** and **Ride statement** in `CONTEXT.md`), in one wording.
 */
export interface RaceFormatRules {
  format: RaceFormat
  /** "Points race", as a crumb or a share card names it. */
  label: string
  /** "points race", "Race of Truth" - the format mid-sentence. */
  phrase: string
  /** Whether TT frames may not be started on - the chips' hidden TT category. */
  ttFramesBarred: boolean
  /** Why TT frames are barred, when they are: the Rider card's `ttBarred`. */
  ttBarredReason: string | undefined
  /** Why there is no draft, when there is none: the Rider card's `draftLocked`. */
  draftLockedReason: string | undefined
  /** What leads the answer and the FAQ answer - see `rideRules` on `buildRecommendationAnswer`. */
  rulesLine: string
  /** What the TT rule does to the ranking, as the race page's Fact row notes it. */
  alert: string
  /** What the missing draft does to the ranking, when there is none. */
  soloNote: string | undefined
  /** What a scoring segment's link carries to the segment page (`?rules=`). */
  segmentLinkNote: string
  /** The nudge towards the format's own draft mode, given an Applied draft mode that contradicts it. */
  draftNudge: DraftNudge | undefined
}

/**
 * The rules a Ride's Race format fixes, worded once for every page that can
 * be told a format (issues #224, #318): a race page reads it off its own
 * race, a segment page off `?rules=`, and a rider following the link from
 * one to the other must not be given two accounts of the same rule. The
 * race page's words are the ones kept.
 *
 * Who does the barring differs and it matters to a rider reading the rules:
 * Zwift itself disables TT frames in points and scratch races, whereas WTRL
 * bans them by regulation from a Race of Truth - where drafting being off
 * would otherwise be the TT bike's whole argument, so a rider is owed the
 * reason rather than just the verdict.
 *
 * Read off the Ride, which carries the format and the two rules
 * `rideRulesForFormat` derived from it; the format only says who and what to
 * call it. No format is no race, and then there is nothing to say. The
 * nudge needs the Applied draft mode, which only a ranking has; without it
 * there is none.
 *
 * In `shared/` because the markdown twins state the same rules as their
 * pages, and server code cannot import from `app/`. The MCP tools keep their
 * own header (`formatRaceFormatAssumption`), written for a model.
 */
export function raceFormatRules(
  ride: Pick<Ride, 'raceFormat' | 'ttFramesAllowed' | 'draftingAllowed'> | undefined,
  appliedDraftMode?: DraftMode
): RaceFormatRules | undefined {
  const format = ride?.raceFormat
  if (!format) return undefined
  const phrase = raceFormatPhrase(format)
  const ttFramesBarred = ride.ttFramesAllowed === false
  const draftOff = ride.draftingAllowed === false

  // The clauses every sentence below is built from, so each rule is worded once.
  const ttClause = !ttFramesBarred
    ? `Zwift enables TT frames – and gives them draft – for ${phrase}s`
    : format === 'rot' ? `WTRL bans TT frames from a ${phrase}` : `Zwift disables TT frames for ${phrase}s`
  const draftClause = draftOff ? `WTRL turns the draft off for a ${phrase}` : undefined

  const alert = !ttFramesBarred
    ? `${ttClause}, so they are included in the ranking below.`
    : draftOff
      ? `${ttClause}, so this is raced on road bikes, and they are the only thing ranked below.`
      : `${ttClause}, so they are excluded from the ranking below. Everything listed is a bike you can actually start on.`
  const linkTail = !ttFramesBarred ? '' : draftOff ? ', with TT frames left out of it and no draft' : ', with TT frames left out of it'

  return {
    format,
    label: RACE_FORMAT_LABELS[format],
    phrase,
    ttFramesBarred,
    ttBarredReason: ttFramesBarred ? `${ttClause}.` : undefined,
    draftLockedReason: draftClause && `${draftClause}.`,
    rulesLine: `${ttClause}.${draftClause ? ` ${draftClause}, so the time is for riding solo.` : ''}`,
    alert,
    soloNote: draftClause && `${draftClause}, so the ranking is ridden solo; your saved draft setting still applies everywhere else.`,
    segmentLinkNote: `The link carries this race's format, so that ranking is ridden as a ${phrase} too${linkTail}.`,
    draftNudge: draftOff || !appliedDraftMode ? undefined : draftNudge(format, phrase, appliedDraftMode)
  }
}

/**
 * A team time trial is raced in a paceline; every other format with a draft
 * is a mass start, so race draft mode is the honest default there - both for
 * a rider who left TTT on and for one still on solo, whose predicted time is
 * then minutes off what a bunch actually does.
 */
function draftNudge(format: RaceFormat, phrase: string, applied: DraftMode): DraftNudge | undefined {
  if (format === 'ttt') {
    if (applied === 'ttt') return undefined
    return {
      text: `This is a ${phrase}, but the ranking below is computed for ${applied === 'race' ? 'a mass-start bunch' : 'a solo rider'}. TTT draft mode ranks bikes at your team's paceline speeds instead – and it can genuinely reorder the list.`,
      action: 'Use TTT draft mode',
      mode: 'ttt'
    }
  }
  if (applied === 'race') return undefined
  return {
    text: applied === 'ttt'
      ? `The ranking uses TTT draft mode, but this is a ${phrase} - the ranking below assumes paceline speeds this race won't be ridden at. Race draft mode models the mass-start bunch this actually is.`
      : `This is a ${phrase}, but the ranking below is computed for a lone rider with no draft at all. Race draft mode adds the draft a typical mid-pack racer measurably gets, calibrated on thirteen real race fields.`,
    action: 'Use race draft mode',
    mode: 'race'
  }
}
