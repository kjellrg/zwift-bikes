/**
 * What counts as a usable rider profile, everywhere a profile enters the
 * system: the API's query schemas 400 outside these bounds
 * (`server/utils/apiQuerySchemas.ts`), the MCP server's `parseRiderProfile`
 * rejects with them by name, and `useRiderProfile` clamps its persisted
 * values into them on load so a stored profile can never produce a request
 * the API refuses. One definition, so the three can't drift.
 *
 * The bounds are strictly wider than anything the site's own controls can
 * produce (weight slider 40-130, height 100-220, power slider 100-1500 W) -
 * they exist to reject nonsense like `weightKg=1e9`, not to police
 * realistic riders.
 *
 * `wkg` survives for two callers only: the MCP server's external contract
 * (riders state their power in W/kg there) and the deprecated `wkg` query
 * alias the recommend schemas still accept. `powerW` is its image across the
 * weight bounds (0.3 x 30 = 9, 15 x 200 = 3000), so any wkg -> watts
 * conversion those callers produce can never land outside `powerW`.
 */
export const RIDER_BOUNDS = {
  weightKg: { min: 30, max: 200 },
  heightCm: { min: 100, max: 220 },
  wkg: { min: 0.3, max: 15 },
  powerW: { min: 9, max: 3000 }
} as const

/**
 * The power sliders' own ranges, in watts. Sprint segments get a wider range
 * (and their own persisted value - see `useRiderProfile`): a sprint effort is
 * a different physical quantity from race-pace power, and dragging one must
 * never move the other.
 */
export const POWER_W_RANGE = { min: 100, max: 500, step: 5 } as const
export const SPRINT_POWER_W_RANGE = { min: 100, max: 1500, step: 10 } as const

/** Same watts as the old default of 3.0 W/kg at the 75 kg default weight. */
export const DEFAULT_POWER_W = 225
/**
 * ~8 W/kg at the default weight - a modest human sprint. Deliberately not
 * seeded from `DEFAULT_POWER_W`: ranking a sprint at race-pace watts would
 * make the sprint page's first render meaningless.
 */
export const DEFAULT_SPRINT_POWER_W = 600

export function clampPowerW(value: number): number {
  return Math.min(POWER_W_RANGE.max, Math.max(POWER_W_RANGE.min, Math.round(value)))
}

export function clampSprintPowerW(value: number): number {
  return Math.min(SPRINT_POWER_W_RANGE.max, Math.max(SPRINT_POWER_W_RANGE.min, Math.round(value)))
}

/**
 * Resolves the persisted rider power from a `zwift-bikes:rider-profile`
 * localStorage payload, migrating pre-watt payloads that stored `wkg`
 * instead. An explicit `powerW` always wins; a legacy `wkg` converts at the
 * (already-loaded) rider weight. Returns undefined when the payload carries
 * neither, leaving the caller's default in place.
 */
export function storedPowerW(parsed: Record<string, unknown>, weightKg: number): number | undefined {
  if (typeof parsed.powerW === 'number') return clampPowerW(parsed.powerW)
  if (typeof parsed.wkg === 'number') return clampPowerW(Math.round(parsed.wkg * weightKg))
  return undefined
}
