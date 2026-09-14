import type { ComboScore, RouteWithMeta } from '../../shared/types/catalog'
import type { AppliedRanking, LoadWheelAlternatives } from './recommendRequest'
import { comboKey } from './comparison'

/**
 * What the Equipment drawer holds: one setup, plus the ride facts its numbers
 * were computed under - see **Equipment drawer** in `CONTEXT.md`.
 *
 * A record rather than a live reference into the Ranking, because the drawer
 * outlives the ranking it was opened from: a stage change can push its bike
 * off every loaded row, and a client-side navigation can carry it onto a ride
 * its bike is not allowed to start on. What it remembers is the last ranking
 * it found its bike in, which is the only ranking its numbers are true of.
 *
 * Everything but the combo is absent when the drawer was opened with no
 * ranking on screen, which no rider gesture reaches today - every opener is a
 * ranked row.
 */
export interface EquipmentDrawerRecord {
  combo: ComboScore
  /** The course the time was computed over - the km/h and the curve's caption divide this by it. */
  course?: RouteWithMeta
  laps?: number
  /** The ranking's fastest time as it stood when this record was taken. */
  fastestTimeSec?: number
  /** The request the numbers came out of, which the route upgrade curve is keyed on - see `upgradeCurveKey`. */
  requestKey?: string
  /**
   * The drill-down that ranking's page hands out, for the upgrade curve and
   * for a dropped bike's refetch. It answers under whatever that page has
   * accepted rather than under this record - see `AppliedRanking`, and note
   * that a record which outlives its page keeps asking the page it came
   * from, which is why a barred bike is never refetched at all.
   */
  loadWheelOptions?: LoadWheelAlternatives
}

/**
 * Where the drawer's setup stands in the Applied Ranking on screen.
 *
 * `barred` and `dropped` look identical from the outside - the bike is on no
 * row the page can produce - but they are opposite facts about it, and only
 * one of them is about how fast it is. A barred frame is absent because the
 * Ride outlaws it: the server drops it before the ranked pool, the drill-down
 * pool and the hidden-frames list alike.
 *
 * The drawer can be over such a ride at all because it outlives a
 * client-side navigation: a TT frame opened on a route page is still open on
 * the points race the rider clicks through to, where it is not slow but
 * illegal, and every number the drawer holds is still true of the page it
 * was opened from.
 *
 * `unknown` is no ranking at all, where nothing can be claimed either way.
 */
export type EquipmentDrawerStanding = 'ranked' | 'dropped' | 'barred' | 'unknown'

export interface EquipmentDrawerView {
  /**
   * The record to show and to remember. The same object that came in unless
   * the live Ranking had something newer, so the drawer can write it straight
   * back to the state its title reads from without writing on every render.
   */
  record: EquipmentDrawerRecord
  standing: EquipmentDrawerStanding
  /** What the drawer's gap is measured against - see `equipmentDrawerView`. */
  fastestTimeSec: number | undefined
}

/** The record a row opens the drawer with: the setup it clicked, under the Ranking it belongs to. */
export function openedEquipmentDrawerRecord(combo: ComboScore, ranking: AppliedRanking | undefined): EquipmentDrawerRecord {
  return ranking ? { combo, ...rideFacts(ranking) } : { combo }
}

/**
 * What the drawer is showing: its own record, kept current from the Applied
 * Ranking on screen for as long as that ranking still contains its bike.
 *
 * The match is the exact setup first and the frame's fastest row second. Both
 * halves are load-bearing: a Directed search can put two rows up for one
 * frame, and the drawer belongs to the row the rider clicked; while a stage
 * change can hand the frame different wheels, and the drawer should then show
 * the wheels the row now shows, title and all.
 *
 * When the bike is on no loaded row the record stands, because the numbers it
 * remembers were true of a ranking that existed - but the gap is measured
 * against the LIVE fastest time, which is what it now trails. The exception
 * is a barred bike: it is not in that ranking at all, its own time is for
 * another ride entirely, and subtracting the two would be a number about
 * nothing.
 */
export function equipmentDrawerView(
  record: EquipmentDrawerRecord,
  ranking: AppliedRanking | undefined
): EquipmentDrawerView {
  if (!ranking) return { record, standing: 'unknown', fastestTimeSec: record.fastestTimeSec }

  const row = rankedRow(ranking.combos, record.combo)
  if (row) {
    const current = retake(record, row, ranking)
    return { record: current, standing: 'ranked', fastestTimeSec: current.fastestTimeSec }
  }

  if (ranking.ride?.ttFramesAllowed === false && record.combo.frame.category === 'tt') {
    return { record, standing: 'barred', fastestTimeSec: record.fastestTimeSec }
  }
  return { record, standing: 'dropped', fastestTimeSec: ranking.fastestTimeSec ?? record.fastestTimeSec }
}

/** The combos are ranked fastest first, so the first row for a frame is its fastest. */
function rankedRow(combos: readonly ComboScore[], combo: ComboScore): ComboScore | undefined {
  const key = comboKey(combo)
  return combos.find(candidate => comboKey(candidate) === key)
    ?? combos.find(candidate => candidate.frame.id === combo.frame.id)
}

function rideFacts(ranking: AppliedRanking) {
  return {
    course: ranking.course,
    laps: ranking.ride?.laps,
    fastestTimeSec: ranking.fastestTimeSec,
    requestKey: ranking.requestKey,
    loadWheelOptions: ranking.loadWheelOptions
  }
}

function retake(record: EquipmentDrawerRecord, row: ComboScore, ranking: AppliedRanking): EquipmentDrawerRecord {
  const next = { combo: row, ...rideFacts(ranking) }
  const unchanged = (Object.keys(next) as (keyof EquipmentDrawerRecord)[]).every(key => record[key] === next[key])
  return unchanged ? record : next
}
