/**
 * Today, as the ISO date (UTC) the events pages decide what has been run by
 * (`hasBeenRun`). Two clocks, one after the other:
 *
 * - While the page renders on the server it is the server's day - for a
 *   prerendered page, the build's - so the served HTML already leaves out
 *   whatever ended before it, and a crawler or a first paint never sees it.
 *   It travels in the payload, so hydration renders exactly what was served.
 * - Once mounted it is the rider's own clock, which removes anything that
 *   ended since the build. The build is at most a day old, so the page moves
 *   at most once, and usually not at all.
 *
 * The rider's clock is taken as it is rather than never earlier than the
 * build's: a clock set a day behind shows a race the build had dropped, which
 * is harmless, and it is what lets a browser test pin the date after load
 * whatever day the server thinks it is.
 *
 * One state for the whole visit, and every mount re-reads the clock, so a tab
 * left open past midnight catches up on its next page.
 */
export function useToday() {
  const today = useState('events-today', renderDay)
  onMounted(() => {
    today.value = isoDay(new Date())
  })
  return today
}

/**
 * The day the page renders on. On the dev server `EVENTS_TODAY` (an ISO date)
 * pins it, which is how the browser journeys hold the server to the same
 * calendar day whatever the real date is: `playwright.config.ts` passes it to
 * the dev server it starts. `import.meta.dev` is false in a production build,
 * so the branch is compiled out there and no deployed environment can set it.
 */
function renderDay(): string {
  if (import.meta.dev && import.meta.server && process.env.EVENTS_TODAY) {
    const pinned = process.env.EVENTS_TODAY
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pinned)) throw new Error(`EVENTS_TODAY must be an ISO date (YYYY-MM-DD), got "${pinned}"`)
    return pinned
  }
  return isoDay(new Date())
}
