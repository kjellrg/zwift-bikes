import type { RaceStatement } from './race'
import type { RouteStatement } from './route'
import type { SegmentStatement } from './segment'

/**
 * The Ride statement (see **Ride statement** in `CONTEXT.md`): what a Ranking
 * page says about its Ride on its own, before and regardless of any Ranking -
 * its name, question, title and descriptions, share-card text, Fact row and
 * notes, breadcrumb trail, and on a race page the race's own facts - with the
 * Race format rules wherever the Ride carries a format.
 *
 * One builder per course kind, each plain data out from the live Ride and its
 * course, so a page and its markdown twin read one statement and what one
 * says the other says. In `shared/` because the twin is rendered on the
 * server, which cannot import from `app/`. The only ranking input is an
 * optional answer - rank 1's setup and category - for the meta description.
 *
 * Not here: the Course hero (its own drawing of the Ride), the TTT line (it
 * describes one ranked setup) and the row of upcoming races (it depends on
 * the day, client-side).
 */
export type RideStatement = RouteStatement | SegmentStatement | RaceStatement

export { officialFiguresDiffer, raceRide, raceStatement, scoringRows } from './race'
export type { RaceGroupCourse, RaceStatement, RaceStatementInputs, RaceWithFormat, ScoringRow } from './race'
export { routeStatement } from './route'
export type { RouteStatement, RouteStatementInputs } from './route'
export { segmentStatement } from './segment'
export type { SegmentStatement, SegmentStatementInputs } from './segment'
export type { RideHeadingCrumb, RideStatementAnswer, RideStatementBase, RideTrailItem } from './types'
