import type { StandingsData } from '../../../shared/types/standings'
import { standingsData } from '../../utils/standings'

/**
 * The bike Standings (see `CONTEXT.md`): every road and TT frame's gap to
 * the fastest frame of its category on every route, from the committed table
 * - nothing is timed per request. The Bikes page averages it over the routes
 * a rider filters to, in the browser.
 */
export default defineEventHandler((): StandingsData => standingsData('bikes'))
