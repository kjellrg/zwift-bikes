import type { StandingsProfile } from '../types/standings'
import { DEFAULT_RIDER_INPUTS, type RiderInputs } from './recommendQuery'

/**
 * The riders the Standings are timed for (see **Standings** in `CONTEXT.md`),
 * one committed table each: the default rider every page is prerendered with,
 * and a stronger one in a race bunch. Both feed `scripts/standings/compute-standings.mjs`
 * and the test that re-ranks a route against the table.
 */
export const STANDINGS_RIDERS: Readonly<Record<StandingsProfile, Readonly<RiderInputs>>> = Object.freeze({
  default: DEFAULT_RIDER_INPUTS,
  race: Object.freeze({ ...DEFAULT_RIDER_INPUTS, weightKg: 80, powerW: 280, draftMode: 'race' })
})
