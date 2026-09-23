import type { BikeCategory, BikeStyle, TerrainCategory, TerrainWeights } from '../../shared/types/catalog'
import type { DraftMode } from '../../shared/utils/physics/draft'
import { BIKE_STYLE_LABELS, TERRAIN_LABELS } from './labels'

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

export function whyThisWins(inputs: RideWhyInputs): string {
  const share = aeroShare(inputs.weights)
  const terrain = TERRAIN_LABELS[inputs.category].toLowerCase()
  return [
    `${inputs.rideName} is ${terrain}, with ${inputs.climbRatio.toFixed(1)} m of climbing per kilometre, the kind of course where ${rewardPhrase(share)}.`,
    frameSentence(inputs, share),
    DRAFT_SENTENCES[inputs.draftMode]
  ].filter(Boolean).join(' ')
}
