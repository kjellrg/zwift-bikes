import { toPublicSiteFlags } from '../../shared/utils/siteFlags'
import { getSiteFlags } from '../utils/siteFlags'

/**
 * The client-facing slice of the runtime site flags (`useSiteFlags` fetches
 * this once per visit, on mount). Public by construction - only fields the
 * browser renders from; the kill switches stay server-side.
 *
 * `max-age=60` matches the KV read path's own staleness budget, so browsers
 * revisiting within a minute skip the request entirely without widening the
 * "flags change may take up to a minute" contract.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'public, max-age=60')
  return toPublicSiteFlags(await getSiteFlags(event))
})
