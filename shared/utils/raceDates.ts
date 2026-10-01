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

/**
 * Three-letter months, fixed. en-GB's `month: 'short'` is `Sept` for September
 * on current ICU builds and `Sep` on older ones, which would put two spellings
 * on one site between a build machine and a browser; the table is one.
 */
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `22 Sep`: the day and its three-letter month. */
function dayMonth(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]}`
}

/** Compact race day for dense listings, e.g. `Tue 22 Sep`. */
export function formatRaceDateShort(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00Z`)
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
  return `${weekday} ${dayMonth(date)}`
}

/**
 * A race window for week-long stages (ZRacing), e.g. `10–16 Aug` or
 * `28 Sep – 4 Oct` across a month boundary, with an en dash. Single-day races
 * just get their short date. Same pinned-locale/UTC rules as `formatRaceDate`.
 */
export function formatRaceDateRange(isoDate: string, isoEndDate?: string): string {
  if (!isoEndDate || isoEndDate === isoDate) return formatRaceDateShort(isoDate)
  const from = new Date(`${isoDate}T12:00:00Z`)
  const to = new Date(`${isoEndDate}T12:00:00Z`)
  const sameMonth = from.getUTCMonth() === to.getUTCMonth() && from.getUTCFullYear() === to.getUTCFullYear()
  return sameMonth ? `${from.getUTCDate()}–${dayMonth(to)}` : `${dayMonth(from)} – ${dayMonth(to)}`
}
