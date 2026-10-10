/**
 * Numbers as every page and twin prints them. Here rather than in
 * `app/utils/labels.ts`, where they used to live, because the Ride statement
 * (`shared/utils/rideStatement`) writes its Fact row with them and the
 * markdown twins are rendered on the server, which cannot import from `app/`.
 */

export function formatGrade(percent: number): string {
  return `${percent.toFixed(1)}%`
}

/** Formats a percentage to at most 1 decimal place, e.g. `28.3%` (not `28.349543535634534%`). */
export function formatPercent(percent: number): string {
  return `${percent.toFixed(1)}%`
}

export function formatDistance(km: number): string {
  return `${km.toFixed(1)} km`
}

export function formatElevation(m: number): string {
  return `${Math.round(m)} m`
}
