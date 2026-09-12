/**
 * Open/closed state for the about, garage, profile and report Overlays
 * (see `CONTEXT.md`), plus the click handlers that open them.
 *
 * `useState` rather than Nuxt UI's `useOverlay()`: the openers live in
 * deeply nested components (the header, `RideEquipmentFilters`,
 * `RideRiderSummary`) while the overlays themselves are mounted once in
 * `app.vue` with `v-model:open`, exactly like `AboutModal`. A shared piece
 * of global state is what lets those two ends meet without prop drilling,
 * and it matches the idiom the rest of the app's composables already use.
 *
 * The handlers carry the same modifier-key guard as `app.vue`'s About
 * opener: every call site keeps a real `href="/garage"` / `href="/profile"`
 * (both are still real routes), so cmd/ctrl/shift/alt-click and middle-click
 * open the page for real, while a plain left click shows the overlay instead
 * of navigating away. Plain `<a>` elements rather than `ULink`/`NuxtLink` at
 * those call sites: vue-router's own click handler would run before this
 * one, so `.prevent` on a NuxtLink wouldn't reliably stop the navigation.
 */
import type { ReportKind } from '../utils/report'
import type { ComboScore, RouteWithMeta } from '../../shared/types/catalog'

/** What a contextual "something look wrong here?" link prefills the report form with. */
export interface ReportSeed {
  kind: ReportKind
  /** Which frame, wheelset or route the link was next to. */
  item?: string
  /**
   * The APPLIED Ride the ranking above the link was computed for, already
   * worded by `formatRideLine`. The report's auto-context can read the page
   * URL and the stored filters on its own, but not the laps, power, draft
   * rule or TT rule a page fixed for one ranking - only the page knows those.
   */
  ride?: string
}

/**
 * What the bike-detail drawer shows: the combo a result card was rendered
 * from, plus the route context the card had, so the drawer can repeat the
 * card's "on this route" numbers without a request of its own.
 */
export interface BikeDetail {
  combo: ComboScore
  route?: RouteWithMeta
  fastestTimeSec?: number
  laps?: number
  /**
   * The page's per-frame drill-down (the same one behind a card's wheel
   * list), which returns this frame's combos under the live query whether
   * or not the frame ranks on a loaded page. The drawer uses it to refetch
   * its bike after a level change that dropped the bike off every loaded
   * page, where no card exists to sync from.
   */
  loadFrameCombos?: (frameId: number) => Promise<ComboScore[]>
  /**
   * The serialised query the page's results belong to
   * (`useRecommendRequest().serializedQuery`). The drawer's route upgrade
   * curve is keyed on it, so a lap, power or filter change can never leave a
   * curve up under a caption that describes the new ride - see
   * `upgradeCurveKey`.
   */
  requestKey?: string
}

export function useOverlays() {
  // About started out as a plain `ref` in `app.vue`, which was fine while the
  // header was its only opener. `AboutContent` now links to the report form,
  // and a link inside an overlay has to be able to close the overlay it's in - the
  // same reason Garage and Profile live here rather than in `app.vue`.
  const isAboutOpen = useState<boolean>('overlay-about-open', () => false)
  const isGarageOpen = useState<boolean>('overlay-garage-open', () => false)
  const isProfileOpen = useState<boolean>('overlay-profile-open', () => false)
  const isReportOpen = useState<boolean>('overlay-report-open', () => false)
  const reportSeed = useState<ReportSeed | undefined>('overlay-report-seed', () => undefined)
  // The drawer is opened from a button, not a link, so no modifier-key guard:
  // there is no page to open in a new tab.
  const isBikeDetailOpen = useState<boolean>('overlay-bike-detail-open', () => false)
  const bikeDetail = useState<BikeDetail | undefined>('overlay-bike-detail', () => undefined)
  // True while the drawer's bike is on none of the result pages the rider has
  // loaded - see `noteRankedFrames`.
  const bikeDetailDropped = useState<boolean>('overlay-bike-detail-dropped', () => false)
  // The fastest time on the loaded list, kept current for a dropped bike's
  // "behind the fastest" figure - its own snapshot of it predates the change.
  const rankedFastestTimeSec = useState<number | undefined>('overlay-ranked-fastest', () => undefined)
  // Whether the Ride those results were ranked for bars TT frames. A barred
  // frame is absent from every list the page can produce (the server drops it
  // before the ranked pool, the drill-down pool and the hidden-frames list
  // alike), so it reads as "dropped" without having been beaten by anything -
  // see the attribution branch in `BikeDetailContent`.
  const rankedRideBarsTtFrames = useState<boolean>('overlay-ranked-bars-tt', () => false)
  // True while the open overlay was opened from the mobile menu, which is
  // gone by the time the overlay closes - `app.vue` then sends focus to the
  // menu toggle instead of letting Reka return it to a detached entry. Set
  // by `app.vue`'s menu openers and reset when the overlay chain closes;
  // cleared here too by every opener that is not the menu, because those
  // openers are still on the page and Reka's own return is right.
  const returnsFocusToMenuToggle = useState<boolean>('overlay-returns-to-menu-toggle', () => false)

  function openBikeDetail(detail: BikeDetail) {
    bikeDetail.value = detail
    bikeDetailDropped.value = false
    isBikeDetailOpen.value = true
  }

  /**
   * Replaces what the open drawer shows when the card it was opened from
   * re-renders with a fresh combo for the same frame and wheels - after a
   * garage change (an upgrade stage set in the drawer itself, or on the
   * card) refetches the results. The drawer holds a snapshot of the combo,
   * not a live reference, so without this its finish time, gap, scores and
   * "scored at upgrade stage N" line kept the old stage's numbers until it
   * was closed and reopened. Matched on the frame alone: a stage change can
   * also change which wheelset is the frame's fastest, and the drawer should
   * then show the wheels the card now shows, title and all. A combo for a
   * different frame is ignored: that is another card's business.
   */
  function syncBikeDetail(detail: BikeDetail) {
    const current = bikeDetail.value
    if (!current || current.combo.frame.id !== detail.combo.frame.id) return
    bikeDetail.value = detail
  }

  /**
   * The results pages call this with their list whenever it changes. The
   * one case `syncBikeDetail` cannot cover is a bike that a level change
   * pushed off every loaded page: no card exists to sync from, so the drawer
   * would silently keep showing the old level's numbers. Marking it lets the
   * drawer say so instead, and say that the bike will not be listed once the
   * drawer closes. Cleared as soon as the bike is ranked again.
   *
   * `ride` is what the list was ranked for, so the drawer can tell a bike
   * that lost on pace from one that was never allowed to start: an open
   * drawer survives a client-side navigation, and a TT frame carried onto a
   * points race is absent from the ranking for a reason that has nothing to
   * do with how fast it is.
   */
  function noteRankedFrames(
    combos: readonly { frame: { id: number }, finishTimeSec?: number }[],
    ride?: { ttFramesAllowed?: boolean }
  ) {
    rankedFastestTimeSec.value = combos[0]?.finishTimeSec
    rankedRideBarsTtFrames.value = ride?.ttFramesAllowed === false
    const current = bikeDetail.value
    if (!current || !isBikeDetailOpen.value) return
    bikeDetailDropped.value = !combos.some(combo => combo.frame.id === current.combo.frame.id)
  }

  function openAbout(event: MouseEvent) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    returnsFocusToMenuToggle.value = false
    isAboutOpen.value = true
  }

  function openGarage(event: MouseEvent) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    returnsFocusToMenuToggle.value = false
    isGarageOpen.value = true
  }

  function openProfile(event: MouseEvent) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    returnsFocusToMenuToggle.value = false
    isProfileOpen.value = true
  }

  /**
   * `seed` is what separates the footer's generic "Report an issue" from a
   * result card's "this number looks wrong" - the latter arrives with the
   * bike already named. Cleared on a seedless open so a previous contextual
   * report can't bleed into an unrelated one.
   */
  function openReport(event: MouseEvent, seed?: ReportSeed) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    returnsFocusToMenuToggle.value = false
    reportSeed.value = seed
    isReportOpen.value = true
  }

  /**
   * Swaps the About overlay for the Report overlay, for the report link
   * inside `AboutContent`. Without this the link just navigated: `/report`
   * is a real route, so the rider was dropped on the page with About still
   * sitting over it.
   *
   * Closing About is deferred to `nextTick` rather than done in the same
   * tick, so only one overlay is ever mounted at a time - two overlapping
   * ones fight over focus trapping and the body scroll lock, and whichever
   * unmounts second can leave the page unscrollable.
   */
  function openReportFromAbout(event: MouseEvent) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    isAboutOpen.value = false
    nextTick(() => {
      reportSeed.value = undefined
      isReportOpen.value = true
    })
  }

  return {
    isAboutOpen,
    isGarageOpen,
    isProfileOpen,
    isReportOpen,
    reportSeed,
    isBikeDetailOpen,
    bikeDetail,
    bikeDetailDropped,
    rankedFastestTimeSec,
    rankedRideBarsTtFrames,
    openBikeDetail,
    syncBikeDetail,
    noteRankedFrames,
    openAbout,
    openGarage,
    openProfile,
    openReport,
    openReportFromAbout,
    returnsFocusToMenuToggle
  }
}
