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
  const today = useState('events-today', () => isoDay(new Date()))
  onMounted(() => {
    today.value = isoDay(new Date())
  })
  return today
}
