/**
 * Frames and wheels are looked up by NAME in every speed-data, scheme and
 * physics table, so a name must mean one thing in the catalog: two records
 * under one name would both be ranked on one measurement, and the garage
 * would list two identical names. Zwift reuses names (the 2026 Shimano
 * DURA-ACE wheels arrived under the older revisions' names, issue #272), so
 * `scripts/validate-speed-data.mjs` runs `findNameClashes` over the merged
 * catalog and fails the build on any clash it does not already know about.
 */

/**
 * Names zwift-data ships twice on purpose, each pair one piece of equipment.
 * - "Zwift BigWheel": two frame records, both estimated funbikes with no
 *   name-keyed row; the garage holds frames by id, so both stay ownable.
 * - "Zwift Concept": the Tron's wheels in regular trim and in gold. Pairing
 *   tells them apart by imageName, the gold set takes a suffixed key
 *   (`getWheelsets`, issue #123), and both share the one measurement - a
 *   Colourway, which is right.
 */
export const KNOWN_SHARED_FRAME_NAMES: ReadonlySet<string> = new Set(['Zwift BigWheel'])
export const KNOWN_SHARED_WHEEL_NAMES: ReadonlySet<string> = new Set(['Zwift Concept'])

export interface NameClash {
  name: string
  /** Every id under the name, in catalog order. */
  ids: number[]
}

/** Every name more than one entry carries, except the ones `known` lets through. */
export function findNameClashes(entries: readonly { id: number, name: string }[], known: ReadonlySet<string> = new Set()): NameClash[] {
  const idsByName = new Map<string, number[]>()
  for (const { id, name } of entries) {
    const ids = idsByName.get(name)
    if (ids) ids.push(id)
    else idsByName.set(name, [id])
  }
  return [...idsByName].filter(([name, ids]) => ids.length > 1 && !known.has(name)).map(([name, ids]) => ({ name, ids }))
}
