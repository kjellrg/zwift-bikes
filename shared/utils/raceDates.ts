/**
 * How a race's days are written out, wherever one is: the events pages, and
 * the markdown twin of a race page, which has to name a run race's date and
 * its season's next race in the page's own words (see `runRaceNotice`). Here
 * rather than in `app/utils/labels.ts`, where they used to live, because
 * server code cannot import from `app/` - the reason `formatDuration` moved to
 * `shared/utils/duration.ts`.
 *
 * Locale and time zone are pinned rather than left to the runtime: these
 * pages are prerendered, so a build machine formatting in one locale and a
 * browser formatting in another produces a hydration mismatch. UTC also
 * keeps the ISO date in the calendar data from sliding a day either way.
 *
 * Nothing here may import `shared/utils/catalog`: the events pages import
 * these client-side, beside the events module (see its leaf-module rule).
 */

/** Race day, e.g. `Tuesday 22 September 2026`. */
export function formatRaceDate(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  })
}

/** Compact race day for dense listings, e.g. `Tue 22 Sep`. */
export function formatRaceDateShort(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC'
  })
}

/**
 * A race window for week-long stages (ZRacing), e.g. `10-16 Aug` or
 * `31 Aug - 6 Sep` across a month boundary. Single-day races just get their
 * short date. Same pinned-locale/UTC rules as `formatRaceDate`.
 */
export function formatRaceDateRange(isoDate: string, isoEndDate?: string): string {
  if (!isoEndDate || isoEndDate === isoDate) return formatRaceDateShort(isoDate)
  const from = new Date(`${isoDate}T12:00:00Z`)
  const to = new Date(`${isoEndDate}T12:00:00Z`)
  const sameMonth = from.getUTCMonth() === to.getUTCMonth() && from.getUTCFullYear() === to.getUTCFullYear()
  const day = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'UTC' })
  const dayMonth = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return sameMonth ? `${day(from)}-${dayMonth(to)}` : `${dayMonth(from)} - ${dayMonth(to)}`
}
