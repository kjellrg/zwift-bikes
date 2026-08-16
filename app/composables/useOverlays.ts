/**
 * Open/closed state for the garage and profile modals, plus the click
 * handlers that open them.
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
export function useOverlays() {
  const isGarageOpen = useState<boolean>('overlay-garage-open', () => false)
  const isProfileOpen = useState<boolean>('overlay-profile-open', () => false)

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

  return { isGarageOpen, isProfileOpen, openGarage, openProfile }
}
