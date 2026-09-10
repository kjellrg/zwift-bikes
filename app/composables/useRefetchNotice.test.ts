import { describe, expect, it } from 'vitest'
import { refetchNotice } from './useRefetchNotice'

/**
 * The rules behind the failed-refetch toasts (issue #204). The composable
 * itself is watcher plumbing over Nuxt UI's `useToast`; what a rider actually
 * sees - which wording, and whether the request is retried once - is this
 * pure decision, so that is where the coverage goes.
 */

/** A fetch error shaped the way `$fetch` rejects, with only the headers the rule reads. */
function fetchError(statusCode: number, options: { retryAfter?: string, message?: string } = {}) {
  return {
    statusCode,
    response: { headers: { get: (name: string) => (name === 'retry-after' ? options.retryAfter ?? null : null) } },
    data: options.message === undefined ? undefined : { message: options.message }
  }
}

const fresh = { autoRetried: false, msSinceLastToast: Number.POSITIVE_INFINITY }

describe('refetchNotice', () => {
  it('retries a 429 once, after the window the server asked for', () => {
    const notice = refetchNotice(fetchError(429, { retryAfter: '5' }), fresh)
    expect(notice?.retryInSec).toBe(5)
    expect(notice?.toast.title).toBe('Too many requests')
    expect(notice?.toast.description).toContain('retrying in 5s')
  })

  it('caps a long Retry-After at 30s and falls back to 2s when the header is unusable', () => {
    expect(refetchNotice(fetchError(429, { retryAfter: '600' }), fresh)?.retryInSec).toBe(30)
    expect(refetchNotice(fetchError(429, { retryAfter: 'Wed, 21 Oct 2026 07:28:00 GMT' }), fresh)?.retryInSec).toBe(2)
    expect(refetchNotice(fetchError(429), fresh)?.retryInSec).toBe(2)
  })

  it('speaks once about a burst, but never quiets the retry itself', () => {
    const busy = { autoRetried: false, msSinceLastToast: 1200 }
    expect(refetchNotice(fetchError(500), busy)).toBeUndefined()
    expect(refetchNotice(fetchError(503), busy)).toBeUndefined()
    expect(refetchNotice(fetchError(429, { retryAfter: '3' }), busy)?.retryInSec).toBe(3)
  })

  it('tells a rider the results are stale when the retry fails too', () => {
    const notice = refetchNotice(fetchError(429), { autoRetried: true, msSinceLastToast: Number.POSITIVE_INFINITY })
    expect(notice?.retryInSec).toBeUndefined()
    expect(notice?.toast.title).toBe('Couldn\'t update the results')
    expect(notice?.toast.description).toContain('Showing the previous ones')
  })

  it('reads the kill switch\'s own wording for a 503, and never retries it', () => {
    const gated = refetchNotice(fetchError(503, { message: 'Recommendations are off while we fix the model.' }), fresh)
    expect(gated?.retryInSec).toBeUndefined()
    expect(gated?.toast.title).toBe('Calculations are paused')
    expect(gated?.toast.description).toBe('Recommendations are off while we fix the model. The results shown are the previous ones.')

    // A gate that shipped no message still has to say something.
    expect(refetchNotice(fetchError(503), fresh)?.toast.description).toBe('Temporarily unavailable for maintenance. The results shown are the previous ones.')
  })

  it('falls back to the generic failure for anything else, including a request that never reached the API', () => {
    expect(refetchNotice(fetchError(500), fresh)?.toast.title).toBe('Couldn\'t update the results')
    expect(refetchNotice({}, fresh)?.toast.title).toBe('Couldn\'t update the results')
  })
})
