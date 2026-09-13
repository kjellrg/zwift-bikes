/**
 * Open/closed state for the about, garage, profile and report Overlays
 * (see `CONTEXT.md`), plus the click handlers that open them - and, since
 * #239, the mobile menu's state and the one close path that dismisses
 * whichever of them is up, which is what the back gesture and a dismissing
 * swipe both call.
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
import type { ComboScore } from '../../shared/types/catalog'
import type { EquipmentDrawerRecord } from '../utils/equipmentDrawer'

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

export function useOverlays() {
  // The Ranking on screen, which the drawer is opened under. `app.vue` mounts
  // the drawer once, far from any ranking page, so this is read rather than
  // passed - see `useAppliedRankingSlot`.
  const appliedRanking = useAppliedRankingSlot()
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
  // The Equipment drawer's record: the setup it was opened with and the ride
  // facts it was opened under - see `EquipmentDrawerRecord`. It is re-taken
  // from the Applied Ranking on screen for as long as that ranking contains
  // its bike, which `BikeDetailSlideover` does; nothing pushes at it.
  const bikeDetail = useState<EquipmentDrawerRecord | undefined>('overlay-bike-detail', () => undefined)
  // True while the open overlay was opened from the mobile menu, which is
  // gone by the time the overlay closes - `app.vue` then sends focus to the
  // menu toggle instead of letting Reka return it to a detached entry. Set
  // by `app.vue`'s menu openers and reset when the overlay chain closes;
  // cleared here too by every opener that is not the menu, because those
  // openers are still on the page and Reka's own return is right.
  const returnsFocusToMenuToggle = useState<boolean>('overlay-returns-to-menu-toggle', () => false)
  // The mobile menu. Not an Overlay - it is navigation, not content - but it
  // follows the same dismissal rule (#239), so its state lives here beside
  // the Overlays' rather than in `app.vue`, where the history mechanism
  // could not see it. `UHeader`'s toggle still owns flipping it.
  const isMenuOpen = useState<boolean>('overlay-menu-open', () => false)
  // True for the one tick a chain spends with nothing mounted, while an
  // Overlay hands over to another (`openReportFromAbout`). The gap is a swap,
  // not a close: without this the history mechanism would read it as the
  // chain ending, drop the chain's entry and push a second one for the
  // Overlay arriving, leaving the rider two back presses from the page.
  const isSwappingOverlays = useState<boolean>('overlay-swapping', () => false)

  /**
   * Whether anything a back gesture should dismiss is on screen: any of the
   * five Overlays, the mobile menu, or a hand-over between two of them
   * mid-flight. One value, deliberately - the history entry (#239) belongs to
   * the chain rather than to whichever Overlay is mounted right now, so a menu
   * that opens an Overlay, or an About that becomes a Report, is one entry and
   * one back press.
   */
  const isOverlayVisible = computed(() => isAboutOpen.value
    || isGarageOpen.value
    || isProfileOpen.value
    || isReportOpen.value
    || isBikeDetailOpen.value
    || isMenuOpen.value
    || isSwappingOverlays.value)

  /**
   * Closes the whole chain - what the back gesture and a dismissing swipe
   * both do (#239). It closes everything rather than the one Overlay that is
   * up because neither gesture knows which one that is, and only one is ever
   * open anyway (see `CONTEXT.md`); calling it with nothing open is a no-op.
   */
  function closeOverlays() {
    isAboutOpen.value = false
    isGarageOpen.value = false
    isProfileOpen.value = false
    isReportOpen.value = false
    isBikeDetailOpen.value = false
    isMenuOpen.value = false
    isSwappingOverlays.value = false
  }

  /**
   * Opens the drawer on one ranked setup. The combo alone is what a row
   * knows about the drawer: everything else the drawer needs is the Applied
   * Ranking that row belongs to, which is on screen and reads itself.
   */
  function openBikeDetail(combo: ComboScore) {
    bikeDetail.value = openedEquipmentDrawerRecord(combo, appliedRanking.value)
    isBikeDetailOpen.value = true
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
   *
   * `isSwappingOverlays` holds the chain open across that tick, so the swap
   * keeps the one history entry About pushed instead of closing it and
   * pushing a second (#239).
   */
  function openReportFromAbout(event: MouseEvent) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    isSwappingOverlays.value = true
    isAboutOpen.value = false
    nextTick(() => {
      // Unless the chain was dismissed while the swap was in the air, in
      // which case there is nothing left to hand over to.
      if (!isSwappingOverlays.value) return
      reportSeed.value = undefined
      isReportOpen.value = true
      isSwappingOverlays.value = false
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
    openBikeDetail,
    openAbout,
    openGarage,
    openProfile,
    openReport,
    openReportFromAbout,
    returnsFocusToMenuToggle,
    isMenuOpen,
    isOverlayVisible,
    closeOverlays
  }
}
