/**
 * The Ranking's shared seconds axis: every row plots a dot at its gap to the
 * fastest, on one scale that is set once per Applied Ranking (see
 * `RideRanking`). The scale is the first page's largest gap rounded up to a
 * nice step, so the header reads `0 s … 20 s` rather than `0 s … 17.3 s`.
 */

const NICE_STEPS_SEC = [1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1200, 1800, 3600]

/** The smallest nice scale that holds `largestGapSec`; a one-second scale when there is no gap to hold. */
export function gapAxisMax(largestGapSec: number): number {
  if (!(largestGapSec > 0)) return NICE_STEPS_SEC[0]!
  const step = NICE_STEPS_SEC.find(candidate => candidate >= largestGapSec)
  return step ?? Math.ceil(largestGapSec / 3600) * 3600
}

/** The gridlines: the scale in quarters, `0` and the scale itself included. */
export function gapAxisTicks(max: number): number[] {
  return [0, 0.25, 0.5, 0.75, 1].map(fraction => fraction * max)
}

/** A tick as the column header prints it: `0 s`, `20 s`, `2 min`. */
export function gapAxisTickLabel(seconds: number): string {
  return seconds >= 60 ? `${seconds / 60} min` : `${seconds} s`
}

/**
 * Where a gap sits on the axis: 0..1 of the scale, and whether it is past it.
 * A row past the scale (one a later page brought in) is pinned to the right
 * edge and drawn as an open marker; its gap number carries the value.
 */
export function gapAxisPosition(gapSec: number, max: number): { position: number, beyond: boolean } {
  if (!(max > 0) || gapSec <= 0) return { position: 0, beyond: false }
  return { position: Math.min(1, gapSec / max), beyond: gapSec > max }
}
