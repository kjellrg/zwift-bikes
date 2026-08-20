/**
 * Surfaces a failed client-side results refetch instead of silently keeping
 * stale numbers on screen. The recommend pages render whatever `data` last
 * held, so when a browser-side refresh (a slider move, a garage edit) fails,
 * nothing on the page hints that the results no longer match the controls.
 *
 * Server-rendered loads can't land here - SSR fetches are internal and exempt
 * from the API's rate limiting (see server/middleware/rate-limit.ts) - so an
 * error in this watcher is always a live browser talking to the API. A 429
 * gets one automatic retry after the server's `Retry-After` window (the
 * bucket refills quickly, and the rider's own IP is usually only throttled
 * because something outside the browser has been hammering the API); any
 * other failure, or a retry that fails again, gets a toast saying the shown
 * results are the previous ones.
 */

/** The parts of Nuxt's fetch error this composable reads, structurally. */
interface RefetchError {
  statusCode?: number
  response?: { headers?: { get?: (name: string) => string | null } }
}

export function useRefetchNotice(
  error: Ref<RefetchError | null | undefined>,
  status: Ref<'idle' | 'pending' | 'success' | 'error'>,
  refresh: () => unknown
) {
  const toast = useToast()
  let autoRetried = false
  let lastToastMs = 0

  // A successful refetch ends the episode: the next 429 earns a fresh retry.
  watch(status, (value) => {
    if (value === 'success') autoRetried = false
  })

  watch(error, (err) => {
    if (!err || !import.meta.client) return
    const now = Date.now()
    if (err.statusCode === 429 && !autoRetried) {
      autoRetried = true
      const headerSec = Number(err.response?.headers?.get?.('retry-after'))
      const retrySec = Number.isFinite(headerSec) && headerSec > 0 ? Math.min(30, headerSec) : 2
      toast.add({
        title: 'Too many requests',
        description: `Showing the previous results - retrying in ${retrySec}s.`,
        color: 'warning',
        icon: 'i-lucide-timer'
      })
      setTimeout(() => void refresh(), retrySec * 1000 + 250)
      lastToastMs = now
      return
    }
    // One notice per burst - rapid control changes while the API is unhappy
    // should not stack a toast per failed request.
    if (now - lastToastMs < 5000) return
    lastToastMs = now
    toast.add({
      title: 'Couldn\'t update the results',
      description: 'Showing the previous ones - try again in a moment.',
      color: 'warning',
      icon: 'i-lucide-refresh-cw-off'
    })
  })
}
