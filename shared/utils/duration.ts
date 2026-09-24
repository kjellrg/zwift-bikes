/**
 * Finish-time formatting, shared by the rider-facing pages and the MCP tools
 * so the two can never disagree about how a time or a gap reads. Moved here
 * from `app/utils/labels.ts`, which server code can't import.
 */

/**
 * An absolute finish time, e.g. `1:14:32` or `9:33`. Rounded to whole seconds
 * on purpose: hundredths of a second on a ride over an hour long are noise,
 * and the precision that actually matters between two combos shows up in the
 * gap (see `formatDurationDelta`), not in the absolute.
 */
export function formatDuration(seconds: number): string {
  const totalSeconds = Math.round(seconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const secs = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

/**
 * Formats a time gap vs. the fastest combo on the route, e.g. `+5.21s` or
 * `+1:23`. Sub-minute gaps keep two decimals on purpose: closely matched
 * combos are routinely separated by fractions of a second, and rounding those
 * to whole seconds collapsed genuinely different combos onto an identical
 * label, making the ranking look arbitrary (issue #61). From a minute up,
 * hundredths are noise, so the `m:ss` form rounds to whole seconds as before.
 *
 * Returns the bare gap; the rider-facing pages append " slower" themselves
 * (see `formatDurationDelta` in `app/utils/labels.ts`), while a table column
 * wants it unadorned. `zeroLabel` is what a gap that quantises to zero
 * renders as - the pages say `fastest`, a table says `—`.
 */
export function formatDurationGap(seconds: number, zeroLabel = 'fastest'): string {
  // Quantise to the precision we actually display first, so a gap that renders
  // as `+0.00s` is reported as the zero label rather than as a phantom gap.
  const hundredths = Math.round(seconds * 100)
  if (hundredths <= 0) return zeroLabel
  if (hundredths < 60 * 100) return `+${(hundredths / 100).toFixed(2)}s`
  const totalSeconds = Math.round(seconds)
  const minutes = Math.floor(totalSeconds / 60)
  const secs = totalSeconds % 60
  return `+${minutes}:${secs.toString().padStart(2, '0')}`
}

/**
 * A gap between two setups as a sentence says it - `0.33 s`, `4.1 s`, `22 s`,
 * `1:05` - with as many decimals as the gap needs to be told apart from
 * nothing and no more, since a sentence is read, not compared down a column.
 * A real gap too small to show in hundredths reads `less than 0.01 s`, never
 * `0.00 s`, which would claim a tie that is not there.
 */
export function formatGapSeconds(seconds: number): string {
  const magnitude = Math.abs(seconds)
  if (magnitude > 0 && magnitude < 0.005) return 'less than 0.01 s'
  if (magnitude >= 59.5) return formatDuration(magnitude)
  return `${magnitude < 1 ? magnitude.toFixed(2) : magnitude < 10 ? magnitude.toFixed(1) : Math.round(magnitude)} s`
}

/** Formats an average speed (route distance in km over a finish time in seconds), e.g. `32.4 km/h`. */
export function formatSpeedKmh(distanceKm: number, seconds: number): string {
  if (seconds <= 0) return '-'
  const kmh = distanceKm / (seconds / 3600)
  return `${kmh.toFixed(1)} km/h`
}
