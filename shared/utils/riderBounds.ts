/**
 * What counts as a usable rider profile, everywhere a profile enters the
 * system: the API's query schemas 400 outside these bounds
 * (`server/utils/apiQuerySchemas.ts`), the MCP server's `parseRiderProfile`
 * rejects with them by name, and `useRiderProfile` clamps its persisted
 * values into them on load so a stored profile can never produce a request
 * the API refuses. One definition, so the three can't drift.
 *
 * The bounds are strictly wider than anything the site's own controls can
 * produce (weight slider 40-130, height 100-220, FTP-derived wkg <= 10) -
 * they exist to reject nonsense like `weightKg=1e9`, not to police
 * realistic riders.
 */
export const RIDER_BOUNDS = {
  weightKg: { min: 30, max: 200 },
  heightCm: { min: 100, max: 220 },
  wkg: { min: 0.3, max: 15 }
} as const

export function clampRiderWkg(value: number): number {
  return Math.min(RIDER_BOUNDS.wkg.max, Math.max(RIDER_BOUNDS.wkg.min, value))
}
