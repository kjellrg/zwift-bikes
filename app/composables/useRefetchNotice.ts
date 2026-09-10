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
 * because something outside the browser has been hammering the API); a 503
 * is the site-flags kill switch (server/middleware/site-flags-gate.ts) and
 * shows that gate's own wording with no retry - its Retry-After is minutes,
 * not seconds, and "maintenance" reads very differently from "failed"; any
 * other failure, or a retry that fails again, gets a toast saying the shown
 * results are the previous ones.
 */

/** The parts of Nuxt's fetch error this composable reads, structurally. */
interface RefetchError {
  statusCode?: number
  response?: { headers?: { get?: (name: string) => string | null } }
  /** The error response body - `unknown` to stay assignable from
   * `NuxtError<unknown>`; h3's `createError` message is narrowed out at use. */
  data?: unknown
}

/** The parts of a Nuxt UI toast these notices set. */
interface RefetchToast {
  title: string
  description: string
  color: 'warning'
  icon: string
}

/** What the watcher should do about one failed refetch. */
interface RefetchNotice {
  toast: RefetchToast
  /** Set only for the one automatic retry a 429 earns. */
  retryInSec?: number
}

/** What the episode so far allows: whether the 429 retry is spent, and how long since the last toast. */
interface RefetchNoticeState {
  autoRetried: boolean
  msSinceLastToast: number
}

/** One notice per burst - rapid control changes while the API is unhappy should not stack a toast per failed request. */
const TOAST_QUIET_MS = 5000

/** The `message` h3's `createError` put in the error body, if one survived. */
function bodyMessage(err: RefetchError): string | undefined {
  const message = (err.data as { message?: unknown } | null | undefined)?.message
  return typeof message === 'string' && message ? message : undefined
}

/**
 * The rule behind the toasts, separated from the watcher that applies it so
 * it can be exercised without a browser: which notice one failed refetch
 * earns, given what the episode has already shown. `undefined` means say
 * nothing.
 */
export function refetchNotice(err: RefetchError, state: RefetchNoticeState): RefetchNotice | undefined {
  if (err.statusCode === 429 && !state.autoRetried) {
    // The retry is the point of this branch, so it is never quieted: a burst
    // that ends in a throttle still has to end in a request that succeeds.
    const headerSec = Number(err.response?.headers?.get?.('retry-after'))
    const retryInSec = Number.isFinite(headerSec) && headerSec > 0 ? Math.min(30, headerSec) : 2
    return {
      retryInSec,
      toast: {
        title: 'Too many requests',
        description: `Showing the previous results - retrying in ${retryInSec}s.`,
        color: 'warning',
        icon: 'i-lucide-timer'
      }
    }
  }
  if (state.msSinceLastToast < TOAST_QUIET_MS) return undefined
  if (err.statusCode === 503) {
    return {
      toast: {
        title: 'Calculations are paused',
        description: `${bodyMessage(err) ?? 'Temporarily unavailable for maintenance.'} The results shown are the previous ones.`,
        color: 'warning',
        icon: 'i-lucide-wrench'
      }
    }
  }
  return {
    toast: {
      title: 'Couldn\'t update the results',
      description: 'Showing the previous ones - try again in a moment.',
      color: 'warning',
      icon: 'i-lucide-refresh-cw-off'
    }
  }
}

export function useRefetchNotice(
  error: Ref<RefetchError | null | undefined>,
  status: Ref<'idle' | 'pending' | 'success' | 'error'>,
  refresh: () => unknown
) {
  const toast = useToast()
  let autoRetried = false
  let lastToastMs = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  // The retry window can outlive the page (Retry-After runs up to 30s);
  // refreshing a departed page's data is a wasted request against a
  // still-throttled API.
  onScopeDispose(() => clearTimeout(retryTimer))

  // A successful refetch ends the episode: the next 429 earns a fresh retry,
  // and a still-pending retry from the failed one is no longer needed.
  watch(status, (value) => {
    if (value !== 'success') return
    autoRetried = false
    clearTimeout(retryTimer)
  })

  watch(error, (err) => {
    if (!err || !import.meta.client) return
    const now = Date.now()
    const notice = refetchNotice(err, { autoRetried, msSinceLastToast: now - lastToastMs })
    if (!notice) return
    lastToastMs = now
    toast.add(notice.toast)
    if (notice.retryInSec === undefined) return
    autoRetried = true
    clearTimeout(retryTimer)
    retryTimer = setTimeout(() => void refresh(), notice.retryInSec * 1000 + 250)
  })
}
