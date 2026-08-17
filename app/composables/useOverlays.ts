/**
 * Open/closed state for the about, garage, profile and report modals, plus
 * the click handlers that open them.
 *
 * `useState` rather than Nuxt UI's `useOverlay()`: the openers live in
 * deeply nested components (the header, `BikeFilterControls`,
 * `RiderProfileControls`) while the modals themselves are mounted once in
 * `app.vue` with `v-model:open`, exactly like `AboutModal`. A shared piece
 * of global state is what lets those two ends meet without prop drilling,
 * and it matches the idiom the rest of the app's composables already use.
 *
 * The handlers carry the same modifier-key guard as `app.vue`'s About
 * opener: every call site keeps a real `href="/garage"` / `href="/profile"`
 * (both are still real routes), so cmd/ctrl/shift/alt-click and middle-click
 * open the page for real, while a plain left click shows the modal instead
 * of navigating away. Plain `<a>` elements rather than `ULink`/`NuxtLink` at
 * those call sites: vue-router's own click handler would run before this
 * one, so `.prevent` on a NuxtLink wouldn't reliably stop the navigation.
 */
import type { ReportKind } from '../utils/report'

/** What a contextual "something look wrong here?" link prefills the report form with. */
export interface ReportSeed {
  kind: ReportKind
  /** Which frame, wheelset or route the link was next to. */
  item?: string
}

export function useOverlays() {
  // About started out as a plain `ref` in `app.vue`, which was fine while the
  // header was its only opener. `AboutContent` now links to the report form,
  // and a link inside a modal has to be able to close the modal it's in - the
  // same reason Garage and Profile live here rather than in `app.vue`.
  const isAboutOpen = useState<boolean>('overlay-about-open', () => false)
  const isGarageOpen = useState<boolean>('overlay-garage-open', () => false)
  const isProfileOpen = useState<boolean>('overlay-profile-open', () => false)
  const isReportOpen = useState<boolean>('overlay-report-open', () => false)
  const reportSeed = useState<ReportSeed | undefined>('overlay-report-seed', () => undefined)

  function openAbout(event: MouseEvent) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    isAboutOpen.value = true
  }

  function openGarage(event: MouseEvent) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    isGarageOpen.value = true
  }

  function openProfile(event: MouseEvent) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
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
    reportSeed.value = seed
    isReportOpen.value = true
  }

  /**
   * Swaps the About modal for the Report modal, for the report link inside
   * `AboutContent`. Without this the link just navigated: `/report` is a real
   * route, so the rider was dropped on the page with the About dialog still
   * sitting over it.
   *
   * Closing About is deferred to `nextTick` rather than done in the same
   * tick, so only one dialog is ever mounted at a time - two overlapping
   * dialogs fight over focus trapping and the body scroll lock, and whichever
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
    openAbout,
    openGarage,
    openProfile,
    openReport,
    openReportFromAbout
  }
}
