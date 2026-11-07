import type { StandingsData } from '../../../shared/types/standings'
import { standingsData, standingsProfileFromQuery } from '../../utils/standings'

/**
 * The bike Standings (see `CONTEXT.md`): every road and TT frame's gap to
 * the fastest frame of its category on every route, from the committed table
 * - nothing is timed per request. The Bikes page averages it over the routes
 * a rider filters to, in the browser. `?rider=race` answers for the race
 * rider instead of the default one.
 */
export default defineEventHandler((event): StandingsData => standingsData('bikes', standingsProfileFromQuery(getQuery(event).rider)))
