import type { BikeStyle, TerrainCategory, TerrainWeights } from '../../shared/types/catalog'
import { BIKE_STYLE_LABELS, TERRAIN_LABELS } from './labels'

/**
 * The one sentence under "Why this bike wins here", assembled from fixed
 * pieces rather than written: the Ride's terrain category and climb ratio,
 * how the model splits aerodynamics against weight on it, and the winning
 * frame's style. Every piece is a closed set of phrasings, so the sentence
 * can never claim more than the data says - and a judgement model could
 * later choose among the same fixed sentences without inventing one.
 */
export interface RideWhyInputs {
  rideName: string
  category: TerrainCategory
  climbRatio: number
  weights: Pick<TerrainWeights, 'aero' | 'climb'>
  frameName: string
  frameStyle: BikeStyle | undefined
}

/** Aerodynamics' share of the aero-versus-weight split, 0..1. */
export function aeroShare(weights: Pick<TerrainWeights, 'aero' | 'climb'>): number {
  const total = weights.aero + weights.climb
  return total > 0 ? weights.aero / total : 0.5
}

function weightingPhrase(share: number): string {
  if (share >= 0.8) return 'aerodynamics decide almost all of the finish time and weight very little'
  if (share >= 0.6) return 'aerodynamics count for clearly more than weight'
  if (share > 0.52) return 'aerodynamics count for a little more than weight'
  if (share >= 0.48) return 'aerodynamics and weight count about equally'
  if (share > 0.4) return 'weight on the climbs counts for a little more than aerodynamics'
  if (share > 0.2) return 'weight on the climbs counts for clearly more than aerodynamics'
  return 'weight on the climbs decides almost all of the finish time'
}

/** Whether the winning frame's style is the one the weighting favours - said only when it is. */
function styleFits(style: BikeStyle | undefined, share: number): boolean {
  if (style === 'aero') return share > 0.52
  if (style === 'climb') return share < 0.48
  return style === 'allrounder' && share >= 0.4 && share <= 0.6
}

export function whyThisWins(inputs: RideWhyInputs): string {
  const share = aeroShare(inputs.weights)
  const terrain = TERRAIN_LABELS[inputs.category].toLowerCase()
  const first = `${inputs.rideName} is ${terrain}, with ${inputs.climbRatio.toFixed(1)} m of climbing per kilometre, so ${weightingPhrase(share)}.`
  if (!inputs.frameStyle) return first
  const style = BIKE_STYLE_LABELS[inputs.frameStyle]
  const article = /^[aeiou]/.test(style) ? 'an' : 'a'
  const fit = styleFits(inputs.frameStyle, share) ? ', the kind of frame that weighting favours' : ''
  return `${first} The ${inputs.frameName} is ${article} ${style} frame${fit}.`
}
