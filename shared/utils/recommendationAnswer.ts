import type { BikeCategory, ComboScore } from '../types/catalog'
import { BIKE_CATEGORY_LABELS, BIKE_CATEGORY_WORDS } from './bikeCategories'
import { formatDuration, formatGapSeconds, formatSpeedKmh } from './duration'
import type { DraftMode } from './physics/draft'
import { comboPhysicsKey } from './physics/simulatedOrdering'

/**
 * The rider the time was computed for. The same shape as the pages'
 * `AppliedRiderInputs`, restated here because `shared/` cannot import from
 * `app/`: the answer explains a time, so every rider value in it must be
 * one the time was computed from.
 */
export interface AnswerRider {
  weightKg: number
  heightCm: number
  /** The power the ride was ridden at - sprint power on a sprint segment. */
  powerW: number
  draftMode: DraftMode
  tttRiders: number
  tttClimbWkg: number | undefined
  /** `all` where no category narrowed the pool. */
  category: BikeCategory | 'all'
}

/**
 * The quickest setup the pool's category or Halo rule left out - the
 * endpoints' `fastestOverall`, which the note under the answer shows too.
 * The server never offers a TT frame on a Ride that bars them, so the clause
 * this becomes cannot appear on those race pages.
 */
export interface LeftOutSetup {
  frameName: string
  wheelsetName?: string
  category: BikeCategory
  reason: 'category' | 'halo'
  /** How much quicker than rank 1; absent when there is no rank 1. */
  deltaSec?: number
}

/** A ranked setup, as much of one as the answer names. */
export type AnswerCombo = Pick<ComboScore, 'frame' | 'wheelset' | 'finishTimeSec'>

/**
 * Everything the Recommendation's answer depends on, handed over as plain
 * values by the pages (`useRecommendationAnswer`) and by the markdown
 * documents, so the wording can be tested once and neither surface can say
 * something the other does not.
 */
export interface RecommendationAnswerInputs {
  /** The Ranking's head, fastest first: rank 1 is the answer, rank 2 its runner-up. */
  ranking: readonly AnswerCombo[]
  /** The distance the time covers, for the average speed; a ride without one omits the speed. */
  distanceKm?: number
  /** "Watopia Hilly Route in Watopia" - the ride as the page titles it. */
  rideName: string
  /**
   * The Ride's own equipment and drafting regulations, as one sentence ahead
   * of the answer - "TT bikes are disabled for this points race, and WTRL
   * turns drafting off, so the time is for riding solo." Absent on a route
   * or a segment, which have no rules beyond physics. It leads rather than
   * follows because a rider deciding what to start on needs to know what is
   * legal before they are told what is fastest.
   */
  rideRules?: string
  /** The faster setup the category or Halo rule left out, if any. */
  fastestOverall?: LeftOutSetup
  rider: AnswerRider
  /** The applied lap count on a route; `undefined` on a segment, which is ridden once from its timed start. */
  laps?: number
  verifiedOnly: boolean
  includeHaloBikes: boolean
  myBikesOnly: boolean
  ownsFrames: boolean
  ownsWheels: boolean
  /** The settled search term, which is what the ranking was fetched for. */
  search: string
}

export interface RecommendationAnswer {
  /** The answer: the Ride's rules where it has any, then the verdict and what it was measured against. */
  summary: string
  /** The rider values and restrictions the time depends on, as a second smaller line. */
  assumptions: string
  /** Both together - what the FAQ structured data carries, so a crawler reads exactly the visible answer. */
  text: string
}

/** A setup as the answer, the page description and the note under the answer name it: the frame alone when its wheels are fixed. */
export function namedSetup(frameName: string, wheelsetName?: string): string {
  return wheelsetName ? `${frameName} with ${wheelsetName}` : frameName
}

/** `namedSetup` for a ranked combo. */
export function setupName(combo: Pick<ComboScore, 'frame' | 'wheelset'>): string {
  return namedSetup(combo.frame.name, combo.wheelset?.name)
}

/**
 * What narrowed the pool beyond the category, as the rest of the phrase
 * "the fastest road setup ..." - the Garage fallback (see CONTEXT.md), which
 * a rider who cannot see it will blame the ranking for, and a directed
 * search. An empty garage ranks the whole catalog and adds nothing. The
 * trailing comma closes the clause before the rider.
 */
function poolPhrase(inputs: RecommendationAnswerInputs, search: string): string {
  const garage = inputs.myBikesOnly && inputs.ownsFrames && inputs.ownsWheels
    ? ' among the bikes and wheels in your garage'
    : inputs.myBikesOnly && inputs.ownsFrames
      ? ' among the bikes in your garage, on any wheels that fit them'
      : inputs.myBikesOnly && inputs.ownsWheels
        ? ' on the wheels in your garage'
        : ''
  const matching = search ? ` matching "${search}"` : ''
  return garage || matching ? `${garage}${matching},` : ''
}

/** "a 75 kg rider", "an 82 kg rider": the article goes with how the number is read aloud. */
function article(value: number): string {
  const rounded = Math.round(value)
  return /^8/.test(String(rounded)) || rounded === 11 || rounded === 18 ? 'an' : 'a'
}

/**
 * How far behind rank 2 is. No close-call threshold: on the default query
 * rank 2 is within 0.3% on 326 of 335 routes, so tie wording on a share
 * would say "tied" almost everywhere and mean nothing. "Tied" is kept for a
 * gap of exactly zero, and a tie between setups the simulator cannot tell
 * apart (a re-skin, the two Canyon Aeroads - #266) says why.
 */
function runnerUpSentence(best: AnswerCombo, bestSec: number, second: AnswerCombo): string | undefined {
  if (second.finishTimeSec === undefined) return undefined
  const gapSec = second.finishTimeSec - bestSec
  const name = setupName(second)
  if (gapSec === 0) {
    return comboPhysicsKey(best) === comboPhysicsKey(second)
      ? `The ${name} is identical to it in the model, and tied with it.`
      : `The ${name} is tied with it.`
  }
  return `The ${name} is ${formatGapSeconds(gapSec)} behind.`
}

/**
 * One clause for the faster setup the pool left out, from the same fact and
 * the same gap formatting as the note under the answer
 * (`FastestOverallNote`), so the two cannot disagree.
 */
function leftOutSentence(setup: LeftOutSetup, rideHasRules: boolean): string | undefined {
  if (setup.deltaSec === undefined) return undefined
  // A TT bike reaches this clause on a Ride with rules only where the rules
  // allow one - the server drops TT frames from the pool where they are
  // barred - so there the rider's category, not legality, left it out.
  const tt = rideHasRules ? 'On a TT bike' : 'Where TT bikes are allowed'
  const where = setup.reason === 'halo'
    ? 'With Halo bikes included'
    : setup.category === 'tt' ? tt : 'Across all bike categories'
  return `${where}, the ${namedSetup(setup.frameName, setup.wheelsetName)} is ${formatGapSeconds(setup.deltaSec)} quicker.`
}

/**
 * The Recommendation as a sentence that still reads correctly when it is
 * quoted somewhere else - a search snippet, the FAQ structured data, the
 * markdown twin, an AI answer citing the page (issue #267). So it names its
 * source, the rider the time is for, the one restriction that changes the
 * answer, and the runner-up with its gap, because rank 2 is usually less
 * than a second behind and "fastest" alone would overstate the margin.
 * Everything else that narrowed the pool is stated in `assumptions`.
 */
export function buildRecommendationAnswer(inputs: RecommendationAnswerInputs): RecommendationAnswer | undefined {
  const [best, second] = inputs.ranking
  if (!best || best.finishTimeSec === undefined) return undefined
  const rider = inputs.rider

  const setup = rider.category === 'all' ? 'setup' : `${BIKE_CATEGORY_WORDS[rider.category]} setup`
  const search = inputs.search.trim()
  const speed = inputs.distanceKm ? ` (~${formatSpeedKmh(inputs.distanceKm, best.finishTimeSec)})` : ''
  // "Best bike and wheels" once, here and in the page description: the
  // phrase riders search for beside "fastest bike", which the title and H1
  // carry. It is search wording, not a name for the Recommendation.
  const sentences = [
    `ZwiftBikes predicts the ${setupName(best)} is the best bike and wheels for ${inputs.rideName}: `
    + `the fastest ${setup}${poolPhrase(inputs, search)} for ${article(rider.weightKg)} ${rider.weightKg} kg rider at ${rider.powerW} W, `
    + `finishing in ${formatDuration(best.finishTimeSec)}${speed}.`
  ]
  if (second) {
    const runnerUp = runnerUpSentence(best, best.finishTimeSec, second)
    if (runnerUp) sentences.push(runnerUp)
  }
  const leftOut = inputs.fastestOverall && leftOutSentence(inputs.fastestOverall, Boolean(inputs.rideRules))
  if (leftOut) sentences.push(leftOut)
  const verdict = sentences.join(' ')
  const summary = inputs.rideRules ? `${inputs.rideRules} ${verdict}` : verdict

  const mode = rider.draftMode === 'ttt'
    ? `TTT paceline (${rider.tttRiders} riders${rider.tttClimbWkg ? `, ${rider.tttClimbWkg.toFixed(1)} W/kg team climb pace` : ''})`
    : rider.draftMode === 'race' ? 'race drafting' : 'solo'
  const scope = inputs.laps !== undefined
    ? `${inputs.laps} lap${inputs.laps === 1 ? '' : 's'}, including any lead-in once`
    : 'the timed segment, excluding warm-up'
  const category = rider.category === 'all' ? 'all bike categories' : BIKE_CATEGORY_LABELS[rider.category]
  const halo = inputs.includeHaloBikes || search ? 'Halo bikes included' : 'unowned Halo bikes excluded'
  const assumptions = `${rider.weightKg} kg / ${rider.heightCm} cm / ${rider.powerW} W / ${mode}; ${scope}. ${category}; ${inputs.verifiedOnly ? 'verified only' : 'includes estimates'}; ${halo}${search ? `; search: ${search}` : ''}.`

  return { summary, assumptions, text: `${summary} ${assumptions}` }
}
