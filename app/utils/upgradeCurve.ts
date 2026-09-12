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
