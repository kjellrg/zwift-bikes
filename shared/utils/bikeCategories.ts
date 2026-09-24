import type { BikeCategory } from '../types/catalog'

/**
 * A bike category as a control or a table names it. Lives in `shared/`
 * rather than `app/utils/labels.ts` because the Recommendation's answer is
 * built here too, for the markdown documents as well as the pages, and
 * server code cannot import from `app/`.
 */
export const BIKE_CATEGORY_LABELS: Record<BikeCategory, string> = {
  standard: 'Standard (Road)',
  tt: 'Time Trial',
  gravel: 'Gravel',
  handbike: 'Hand Cycle',
  funbike: 'Fun Bike'
}

/**
 * The same categories as a sentence says them - "the fastest road setup",
 * "where TT bikes are allowed" - for readers who never saw the control.
 */
export const BIKE_CATEGORY_WORDS: Record<BikeCategory, string> = {
  standard: 'road',
  tt: 'TT',
  gravel: 'gravel',
  handbike: 'hand cycle',
  funbike: 'fun bike'
}
