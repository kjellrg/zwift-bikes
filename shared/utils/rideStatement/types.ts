import type { BikeCategory } from '../../types/catalog'
import type { RaceFormatRules } from '../raceRules'
import type { RideFact, SurfaceSplit } from '../rideFacts'

/**
 * The one thing a Ride statement takes from a Ranking: rank 1's setup, as the
 * answer names it, and the category the ranking was drawn from - for the
 * meta description alone. Absent with no ranking.
 */
export interface RideStatementAnswer {
  setup: string
  category: BikeCategory | 'all'
}

/** One crumb above a page's heading; `to` where it links. */
export interface RideHeadingCrumb {
  label: string
  to?: string
}

/** One step of the breadcrumb trail the structured data carries, first crumb first. */
export interface RideTrailItem {
  name: string
  item: string
}

/**
 * What every Ranking page says about its Ride on its own (see **Ride
 * statement** in `CONTEXT.md`), whatever kind of course it rides. The page
 * renders it, the markdown twin renders it, and `useRankingPage` puts its
 * name, question, trail and report subject where they go.
 */
export interface RideStatementBase {
  /** "Watopia Hilly Route in Watopia", "the Alpe du Zwift climb in Watopia" - the name the answer gives the Ride. */
  rideName: string
  /** The question the page's title asks: the answer's heading and the FAQ entry's question. */
  question: string
  title: string
  /** The meta description - the one part that names rank 1, when there is a ranking. */
  description: string
  ogTitle: string
  ogDescription: string
  /** The page's heading and the crumbs above it. */
  heading: { name: string, crumbs: RideHeadingCrumb[] }
  /** The structured data's trail; undefined where the page ranks nothing to answer for. */
  breadcrumbs: RideTrailItem[] | undefined
  /** What a report filed from the page is about. */
  reportItem: string
  /** What the report line leads with where the URL does not say it; a route has none. */
  reportSubject: string | undefined
  /** The Fact row's cells (see **Fact row**). */
  facts: RideFact[]
  /** The Fact row's surface cell; absent for a course with no surface mix. */
  surface: SurfaceSplit | undefined
  /** The Race format rules, wherever the Ride carries a format. */
  rules: RaceFormatRules | undefined
}
