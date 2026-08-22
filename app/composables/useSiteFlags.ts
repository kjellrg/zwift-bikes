import type { PublicSiteFlags, SiteMotd } from '#shared/utils/siteFlags'
import { DEFAULT_PUBLIC_SITE_FLAGS, isMotdActive } from '#shared/utils/siteFlags'

const DISMISSED_MOTD_KEY = 'zwift-bikes:dismissed-motd'

/**
 * The client half of the runtime site flags (`docs/site-flags.md`): fetched
 * once per visit from `/api/site-flags`, never during render. Every page that
 * matters here is prerendered, so the flags CAN'T be in the served HTML -
 * the server-rendered markup and the first client render both show the
 * defaults (no MOTD, everything visible), and the real flags apply as a
 * post-mount update. Same hydration discipline as `usePreferences`.
 *
 * Hiding here is presentation only - the authoritative gate is
 * `server/middleware/site-flags-gate.ts`, which closes a hidden section's
 * data endpoints regardless of what the client renders.
 *
 * The MOTD dismissal is the one persisted piece of user state, following the
 * localStorage pattern of the other composables: it stores the dismissed
 * message's id, so a NEW message (new id) reappears even for riders who
 * dismissed the old one.
 */
export function useSiteFlags() {
  const flags = useState<PublicSiteFlags>('site-flags', () => DEFAULT_PUBLIC_SITE_FLAGS)
  const dismissedMotdId = useState<string | null>('site-flags-dismissed-motd', () => null)
  const isLoaded = useState<boolean>('site-flags-loaded', () => false)

  /** Idempotent; every interested mount calls it, only the first fetches. */
  async function load() {
    if (!import.meta.client || isLoaded.value) return
    isLoaded.value = true
    try {
      dismissedMotdId.value = localStorage.getItem(DISMISSED_MOTD_KEY)
    } catch {
      // Storage can be unavailable (private mode); dismissal just won't stick.
    }
    try {
      flags.value = await $fetch<PublicSiteFlags>('/api/site-flags')
    } catch {
      // Flags are never worth an error surface: on any failure the site
      // simply behaves as if none were set.
    }
  }

  /**
   * Expiry is re-checked here as well as in the server projection: the
   * response may be browser-cached (max-age=60) past the expiry moment.
   */
  const activeMotd = computed<SiteMotd | null>(() => {
    const motd = flags.value.motd
    if (!motd || !isMotdActive(motd)) return null
    if (motd.dismissible && dismissedMotdId.value === motd.id) return null
    return motd
  })

  function dismissMotd() {
    const motd = activeMotd.value
    if (!motd?.dismissible) return
    dismissedMotdId.value = motd.id
    try {
      localStorage.setItem(DISMISSED_MOTD_KEY, motd.id)
    } catch {
      // Best effort - an undismissable-again banner beats a crash.
    }
  }

  const eventsVisible = computed(() => flags.value.sections.events.mode !== 'hidden')
  const eventsNotice = computed(() => flags.value.sections.events.notice)

  return { load, activeMotd, dismissMotd, eventsVisible, eventsNotice }
}
