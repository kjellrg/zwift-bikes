import type { StandingsData } from '../../../shared/types/standings'
import { standingsData } from '../../utils/standings'

/**
 * The wheel Standings (see `CONTEXT.md`): every wheelset's gap to the
 * fastest wheels on each route's fastest road and TT frame that take wheels,
 * from the committed table - nothing is timed per request. The Wheels page
 * averages it over the routes a rider filters to, in the browser.
 */
export default defineEventHandler((): StandingsData => standingsData('wheels'))
