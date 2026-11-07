import type { StandingsData } from '../../../shared/types/standings'
import { standingsData, standingsProfileFromQuery } from '../../utils/standings'

/**
 * The wheel Standings (see `CONTEXT.md`): every wheelset's gap to the
 * fastest wheels on each route's fastest road and TT frame that take wheels,
 * from the committed table - nothing is timed per request. The Wheels page
 * averages it over the routes a rider filters to, in the browser. `?rider=race`
 * answers for the race rider instead of the default one.
 */
export default defineEventHandler((event): StandingsData => standingsData('wheels', standingsProfileFromQuery(getQuery(event).rider)))
