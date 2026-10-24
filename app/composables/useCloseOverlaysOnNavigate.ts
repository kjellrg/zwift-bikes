import type { Ref } from 'vue'

/**
 * An Overlay covers the page, so a link in one has to take the rider off it:
 * the Overlay is mounted in `app.vue` and would otherwise stay open over the
 * route page. Closed once the navigation has landed, so the history entry the
 * Overlay pushed is not removed by a back() that would undo the navigation.
 */
export function useCloseOverlaysOnNavigate(open: Readonly<Ref<boolean>>) {
  const { closeOverlays } = useOverlays()
  const route = useRoute()
  watch(() => route.path, () => {
    if (open.value) closeOverlays()
  })
}
