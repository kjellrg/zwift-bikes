import { comboKey } from './comparison'

/**
 * What an "On this route" upgrade curve was computed for: the bike, and the
 * request that ranked it.
 *
 * The bike half is `comboKey` - a level change can hand a frame different
 * wheels, and the curve is the fastest wheelset's. The request half is the
 * drawer's whole reason for existing: the curve comes out of the page's
 * per-frame drill-down under the Applied Ranking's request, so laps, power,
 * weight, draft mode, the garage and the filters all move it as soon as a
 * ranking computed from them is accepted, while the caption beside it
 * renders from live state. Keyed on the frame and wheels alone, a lap or
 * power change left a caption reading "2 laps ... at 320 W" over a curve
 * simulated for one lap at 225.
 *
 * The serialised query is used whole rather than the few fields that look
 * relevant: a hand-kept list of them is exactly the copy that goes stale
 * when a query field is added, which is what the request module was built to
 * end. The cost is that a garage change refetches a curve it need not - five
 * route integrations beside the full page reload the same press already
 * triggers.
 *
 * Only equality is meaningful; nothing parses this back out.
 */
export function upgradeCurveKey(
  combo: { frame: { id: number }, wheelset?: { key: string } },
  requestKey: string | undefined
): string {
  return `${comboKey(combo)}@${requestKey ?? ''}`
}

/**
 * How an upgrade curve is drawn, kept in one place for the two charts that
 * draw one: the drawer's sparklines (`UpgradeSparkline`) and the Ranking
 * row's flat-and-climb chart (`UpgradeCurveChart`). Both plot gains over
 * stage 0 - "what does upgrading do", not "how does this bike compare" - on
 * a range that never starts above 0 or spans less than one unit, so a flat
 * curve reads as flat instead of as noise stretched to the top.
 */
export function upgradeGains(values: readonly number[]): number[] {
  return values.map(value => value - (values[0] ?? 0))
}

export interface UpgradeGainRange {
  min: number
  max: number
}

/** The vertical range for one or more gain series drawn on one scale. */
export function upgradeGainRange(...series: readonly (readonly number[])[]): UpgradeGainRange {
  const all = series.flat()
  return { min: Math.min(0, ...all), max: Math.max(1, ...all) }
}

/** A stage's x in a chart `width` wide, padded `pad` at each side, for `stages` evenly spaced stages. */
export function upgradeStageX(stage: number, stages: number, width: number, pad: number): number {
  return pad + stage * ((width - pad * 2) / Math.max(1, stages - 1))
}

/** A gain's y in a chart `height` tall, padded `pad` top and bottom - SVG coordinates, so up is smaller. */
export function upgradeGainY(gain: number, range: UpgradeGainRange, height: number, pad: number): number {
  return height - pad - ((gain - range.min) / (range.max - range.min)) * (height - pad * 2)
}
