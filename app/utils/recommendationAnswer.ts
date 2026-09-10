import { formatDuration } from '#shared/utils/duration'
import { BIKE_CATEGORY_LABELS, formatSpeedKmh } from './labels'
import type { AppliedRiderInputs } from './recommendRequest'

/**
 * Everything the visible best-bike answer depends on, read off the APPLIED
 * results and stored state by `useRecommendationAnswer` and handed over as
 * plain values so the wording can be tested without Nuxt. The rider side is
 * one `AppliedRiderInputs` block on purpose: the answer explains a time, so
 * every rider value in it must be one the time was computed from, and a
 * caller cannot hand over a live slider value without building a fake
 * snapshot to carry it.
 */
export interface RecommendationAnswerInputs {
  frameName: string
  /** Absent for a fixed-wheel frame, which is then named by its frame alone. */
  wheelsetName?: string
  finishTimeSec: number
  /** The distance the time covers, for the average speed; a segment page that has none simply omits the speed. */
  distanceKm?: number
  /** "Watopia Hilly Route in Watopia" - the ride as the page titles it. */
  rideName: string
  /** The rider the results on screen were computed for - `useRecommendRequest().appliedInputs`. */
  rider: AppliedRiderInputs
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
  /** The one-sentence answer: equipment, pool, ride, time. */
  summary: string
  /** The rider values and restrictions the time depends on, as a second smaller line. */
  assumptions: string
  /** Both together - what the FAQ structured data carries, so a crawler reads exactly the visible answer. */
  text: string
}

/**
 * The visible best-bike answer and its structured-data twin, built from one
 * set of inputs so they can never disagree. Every restriction that narrowed
 * the pool is stated, because "fastest" is only true inside it: the garage
 * fallbacks (frames only, wheels only, or none - the server ranks the whole
 * catalog when the garage is empty), the category, verified-only, and the
 * Halo rule - which a directed search bypasses server-side, so a search term
 * flips the Halo clause too.
 */
export function buildRecommendationAnswer(inputs: RecommendationAnswerInputs): RecommendationAnswer {
  const equipment = inputs.wheelsetName ? `${inputs.frameName} with ${inputs.wheelsetName}` : inputs.frameName
  const pool = inputs.myBikesOnly && inputs.ownsFrames && inputs.ownsWheels
    ? 'in your garage, within the current filters'
    : inputs.myBikesOnly && inputs.ownsFrames
      ? 'among your frames with all compatible wheels, within the current filters'
      : inputs.myBikesOnly && inputs.ownsWheels
        ? 'among all eligible frames with your wheels, within the current filters'
        : 'within the current filters'
  const speed = inputs.distanceKm ? ` (~${formatSpeedKmh(inputs.distanceKm, inputs.finishTimeSec)})` : ''
  const summary = `Our model puts ${equipment} fastest ${pool} for ${inputs.rideName}: ${formatDuration(inputs.finishTimeSec)}${speed}.`

  const rider = inputs.rider
  const mode = rider.draftMode === 'ttt'
    ? `TTT paceline (${rider.tttRiders} riders${rider.tttClimbWkg ? `, ${rider.tttClimbWkg.toFixed(1)} W/kg team climb pace` : ''})`
    : rider.draftMode === 'race' ? 'race drafting' : 'solo'
  const scope = inputs.laps !== undefined
    ? `${inputs.laps} lap${inputs.laps === 1 ? '' : 's'}, including any lead-in once`
    : 'the timed segment, excluding warm-up'
  const category = rider.category === 'all' ? 'all bike categories' : BIKE_CATEGORY_LABELS[rider.category]
  const search = inputs.search.trim()
  const halo = inputs.includeHaloBikes || search ? 'Halo bikes included' : 'unowned Halo bikes excluded'
  const assumptions = `${rider.weightKg} kg / ${rider.heightCm} cm / ${rider.powerW} W / ${mode}; ${scope}. ${category}; ${inputs.verifiedOnly ? 'verified only' : 'includes estimates'}; ${halo}${search ? `; search: ${search}` : ''}.`

  return { summary, assumptions, text: `${summary} ${assumptions}` }
}
