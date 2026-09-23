import type { BikeCategory, BikeStyle, TerrainCategory, TerrainWeights } from '../../shared/types/catalog'
import type { WheelChoice } from '../../shared/types/rideNotes'
import type { DraftMode } from '../../shared/utils/physics/draft'
import { BIKE_STYLE_LABELS, formatGapSeconds, TERRAIN_LABELS } from './labels'

/**
 * The sentences under "Why this bike wins here", assembled from fixed
 * pieces rather than written: the Ride's terrain category and climb ratio,
 * what that terrain rewards, the winning frame, and what the applied draft
 * mode does to aero equipment. Every piece is a closed set of phrasings, so
 * the text can never claim more than the data says - and a judgement model
 * could later choose among the same fixed sentences without inventing one.
 *
 * What the terrain rewards is the aero-against-weight split of its terrain
 * weights, which come from its climbing alone: a guide to the ranking, not
 * how the finish times are simulated. So the text says what such a course
 * "usually" rewards and never what "decides the finish time" - the wording
 * a judgement model scored as faithful to that, where the old one was not
 * (#257).
 */
export interface RideWhyInputs {
  rideName: string
  category: TerrainCategory
  climbRatio: number
  weights: Pick<TerrainWeights, 'aero' | 'climb'>
  frameName: string
  frameStyle: BikeStyle | undefined
  /** A time-trial frame is named as one, whatever its style. */
  frameCategory: BikeCategory
  /** The draft mode the times were computed under. */
  draftMode: DraftMode
  /** Rank 1's finish time, which the Wheel close call is measured against. */
  finishTimeSec?: number
  /** Rank 1's own wheels against the other kind's fastest, from the recommend endpoint. */
  wheelChoice?: WheelChoice
}

/** Aerodynamics' share of the aero-versus-weight split, 0..1. */
export function aeroShare(weights: Pick<TerrainWeights, 'aero' | 'climb'>): number {
  const total = weights.aero + weights.climb
  return total > 0 ? weights.aero / total : 0.5
}

function rewardPhrase(share: number): string {
  if (share >= 0.8) return 'aerodynamics usually counts for far more than low weight'
  if (share >= 0.6) return 'aerodynamics usually counts for clearly more than low weight'
  if (share > 0.52) return 'aerodynamics usually counts for a little more than low weight'
  if (share >= 0.48) return 'aerodynamics usually counts for about as much as low weight'
  if (share > 0.4) return 'low weight usually counts for a little more than aerodynamics'
  if (share > 0.2) return 'low weight usually counts for clearly more than aerodynamics'
  return 'low weight usually counts for far more than aerodynamics'
}

/** Whether the winning frame's style is the one the terrain favours - said only when it is. */
function styleFits(style: BikeStyle | undefined, share: number): boolean {
  if (style === 'aero') return share > 0.52
  if (style === 'climb') return share < 0.48
  return style === 'allrounder' && share >= 0.4 && share <= 0.6
}

function frameSentence(inputs: RideWhyInputs, share: number): string | undefined {
  if (inputs.frameCategory === 'tt') return `The ${inputs.frameName} is a time-trial frame.`
  if (!inputs.frameStyle) return undefined
  const style = BIKE_STYLE_LABELS[inputs.frameStyle]
  const article = /^[aeiou]/.test(style) ? 'an' : 'a'
  const fit = styleFits(inputs.frameStyle, share) ? ', the kind of frame that terrain favours' : ''
  return `The ${inputs.frameName} is ${article} ${style} frame${fit}.`
}

/**
 * What the draft does to aero equipment. "About a third" is the race
 * model's `RACE_DRAFT_SAVING` - the test holds the two together - and it
 * shrinks on the climbs because the saving scales with speed. Riding solo
 * needs no sentence: the terrain one already describes it.
 */
const DRAFT_SENTENCES: Partial<Record<DraftMode, string>> = {
  race: 'In a race bunch the draft takes about a third of the air resistance off you on the flat, and less on the climbs, so aero equipment gains less here than riding alone.',
  ttt: 'In a team time trial you share the pulls, and aero equipment still counts most when you are on the front.'
}

/**
 * How close the two kinds of wheel have to finish, as a share of rank 1's
 * finish time, to be a close call. Measured on 2026-09-23 over 27 routes,
 * solo and race: 50 of the 54 rides fall inside it, which is the point - a
 * disc is rarely the clear win riders expect (issue #261).
 */
export const WHEEL_CLOSE_CALL_SHARE = 0.003

/**
 * The Wheel close call (see `CONTEXT.md`): rank 1's own wheels against the
 * other kind's fastest, when they finish within `WHEEL_CLOSE_CALL_SHARE` of
 * each other. The fact is the sentence; advice is added in one case only - a
 * disc winning a race on flat terrain, where its extra weight rarely costs
 * the bunch. A race with climbing leaves the climbs to the Climb trade, which
 * has numbers for them; solo and TTT times are what decide those rides. Every
 * wording here was scored with a judgement model for faithfulness to the
 * simulation, which never says where on the course time is won, so no
 * sentence may claim it.
 */
function wheelCloseCallSentence(inputs: RideWhyInputs): string | undefined {
  const { wheelChoice: choice, finishTimeSec } = inputs
  if (!choice || !finishTimeSec || choice.gapSec > finishTimeSec * WHEEL_CLOSE_CALL_SHARE) return undefined
  const kg = `${Math.abs(choice.massDeltaKg).toFixed(2)} kg`
  const weight = Math.abs(choice.massDeltaKg) < 0.005
    ? ''
    : choice.massDeltaKg > 0 ? `, but ${kg} heavier` : ` here, and ${kg} lighter`
  const fact = `Disc or regular wheels is a close call: the ${choice.own.wheelsetName} is ${formatGapSeconds(choice.gapSec)} faster than the ${choice.other.wheelsetName}${weight}.`
  if (inputs.draftMode === 'race' && inputs.category === 'flat' && choice.own.kind === 'disc' && choice.massDeltaKg > 0) {
    return `${fact} With this little climbing, the extra weight rarely costs you the group, so the disc is the pick as long as you stay in the draft, as these times assume.`
  }
  return fact
}

export function whyThisWins(inputs: RideWhyInputs): string {
  const share = aeroShare(inputs.weights)
  const terrain = TERRAIN_LABELS[inputs.category].toLowerCase()
  return [
    `${inputs.rideName} is ${terrain}, with ${inputs.climbRatio.toFixed(1)} m of climbing per kilometre, the kind of course where ${rewardPhrase(share)}.`,
    frameSentence(inputs, share),
    DRAFT_SENTENCES[inputs.draftMode],
    wheelCloseCallSentence(inputs)
  ].filter(Boolean).join(' ')
}
