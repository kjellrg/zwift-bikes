import type { EventRaceWithRoute } from '../../shared/types/events'
import { formatCategoryGroup } from '#shared/utils/events'
import { formatDistance, formatElevation } from './labels'

/** One course line of a race row: which groups ride it (when that needs saying) and what it is. */
export interface RaceCourseLine {
  key: string
  /** The Category groups that ride it - absent when the race has one course, which needs no owner named. */
  label?: string
  /** `Innsbruckring, Innsbruck` */
  place: string
  /** `35.4 km / 309 m`, or whichever of the two is known - absent when neither is. */
  figures?: string
}

/**
 * A race row's course lines: one per distinct course, not one per Category
 * group. Where every group rides the same route over the same distance and
 * climbing there is one course to name, and repeating it under each group's
 * label would be three ways of saying the same thing. Groups that differ in
 * any of it get a line each, labelled - that split IS the news, and it is
 * why the lines are collapsed on what they actually show rather than on
 * `hasSplitCourses`: two groups can share a route and a lap count and still
 * be published at different distances, or the same distance with different
 * climbing.
 *
 * Each figure is the organiser's own first and this site's computed total
 * second, taken separately, so a rider reads the numbers they were told to
 * expect wherever they were told any.
 */
export function raceCourseLines(race: EventRaceWithRoute): RaceCourseLine[] {
  const byLine = new Map<string, { labels: string[], place: string, figures?: string }>()
  for (const group of race.categories) {
    const distanceKm = group.officialDistanceKm ?? group.computed?.distanceKm
    const elevationM = group.officialElevationM ?? group.computed?.elevationM
    const place = [group.routeName ?? group.route?.name ?? 'Route to come', group.route?.worldName].filter(Boolean).join(', ')
    const figures = [
      distanceKm ? formatDistance(distanceKm) : undefined,
      elevationM !== undefined ? formatElevation(elevationM) : undefined
    ].filter(Boolean).join(' / ') || undefined
    const key = `${place}#${figures ?? ''}`
    const entry = byLine.get(key) ?? { labels: [], place, figures }
    entry.labels.push(formatCategoryGroup(group))
    byLine.set(key, entry)
  }
  const lines = [...byLine.values()]
  return lines.map(line => ({
    key: line.labels.join(', '),
    label: lines.length > 1 ? line.labels.join(', ') : undefined,
    place: line.place,
    figures: line.figures
  }))
}
