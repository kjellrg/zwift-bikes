/**
 * The back gesture dismisses an Overlay (#239).
 *
 * On a phone in portrait an Overlay fills the viewport and reads as a page,
 * so back is the first gesture a rider reaches for. Opening one pushes a
 * history entry for the *same* URL - the address bar never changes, no Shared
 * view value is written and nothing reads the query back into state - and the
 * pop that entry produces is what closes the Overlay, leaving the rider on the
 * page they were on. Android's hardware back, iOS's edge-swipe and the desktop
 * back button are all the same `popstate` here, which is deliberate: the rule
 * is site-wide rather than conditional on viewport width, because entries
 * pushed under one rule and popped under another desync on a rotation.
 *
 * The entry belongs to the whole chain, not to one Overlay - see
 * `isOverlayVisible`, which is what this watches. A menu that opens an
 * Overlay, or an About that becomes a Report, is one entry and one back press.
 *
 * A client plugin rather than a composable call: `pushState` is client-only,
 * while the openers are server-rendered, and the watcher and the listener want
 * to exist exactly once for the life of the app.
 */

/**
 * Marks the entry an open Overlay pushed, so a pop can tell it from a real
 * page entry. `vue-router` merges `history.state` into the entry it replaces
 * when the rider navigates on from here, so the mark survives a navigation
 * and is still there when back returns to it.
 */
const OVERLAY_ENTRY = 'zwiftBikesOverlay'

export default defineNuxtPlugin(() => {
  const { isOverlayVisible, closeOverlays } = useOverlays()

  /**
   * Whether the entry the rider is standing on right now is one an Overlay
   * pushed. Read from `history.state` every time rather than remembered:
   * a client-side navigation moves the rider off the entry without a pop, and
   * a remembered flag would still say they were standing on it - which is how
   * closing the mobile menu on the navigation its own entry made would send
   * the rider straight back to the page they had just left.
   *
   * It can also be true with nothing open: a reload leaves the mark behind
   * while the Overlay itself is gone. That entry is reused rather than stacked
   * on, so back still closes what the rider opens on it.
   */
  const onOverlayEntry = () => window.history.state?.[OVERLAY_ENTRY] === true

  function pushOverlayEntry() {
    // The same URL the rider is already on. `position` is `vue-router`'s own
    // bookkeeping, carried forward as a real push would so that a later
    // navigation from this entry, and the pop back to it, still count the
    // stack the way the router expects.
    const state = { ...window.history.state, position: (window.history.state?.position ?? 0) + 1, [OVERLAY_ENTRY]: true }
    window.history.pushState(state, '', window.location.href)
  }

  /**
   * Set while our own `history.back()` is in flight. Without it the pop that
   * removes the entry would be read as the rider's back gesture, and a chain
   * opened between the two would be closed by it.
   */
  let removingOwnEntry = false

  watch(isOverlayVisible, (visible) => {
    if (visible) {
      if (!onOverlayEntry()) pushOverlayEntry()
      return
    }
    // Esc, the close control, the backdrop or a swipe: the Overlay closed
    // itself, so it takes its entry with it. Leaving the entry would make a
    // later back press a gesture that visibly does nothing - worse than the
    // bug this fixes. A chain that closed because the page under it navigated
    // away has nothing here to remove: its entry is no longer the rider's, and
    // pressing back would only undo their navigation.
    if (!onOverlayEntry()) return
    removingOwnEntry = true
    window.history.back()
  })

  window.addEventListener('popstate', () => {
    if (removingOwnEntry) {
      removingOwnEntry = false
      // A chain opened in the gap between our `back()` and this pop reused an
      // entry that has just gone, so it needs one of its own.
      if (isOverlayVisible.value) pushOverlayEntry()
      return
    }
    // Landing on an Overlay's entry keeps whatever is open: a rider who
    // opened an Overlay and then navigated is standing above that entry, and
    // their first back press lands back on it with the Overlay still up. It is
    // the press that leaves the entry which closes the chain, so the two
    // actions are retraced in order.
    if (onOverlayEntry()) return
    if (isOverlayVisible.value) closeOverlays()
  })
})
