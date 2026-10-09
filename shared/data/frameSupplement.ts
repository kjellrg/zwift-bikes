import type { BikeFrame } from 'zwift-data'

/**
 * Frames that are live in Zwift but haven't shipped in the `zwift-data` npm
 * package yet - the frame twin of `wheelSupplement.ts`. Same lifecycle:
 * `applyFrameSupplement` merges these into the catalog and an upstream
 * release that includes the frame wins automatically, at which point
 * `scripts/validate-speed-data.mjs` fails the build naming the entry to
 * delete (and the key to re-spell, if upstream's name differs).
 *
 * Where it differs from the wheel supplement is what "copied verbatim from
 * the game dictionary" can mean for a frame, because Zwift ships a frame's
 * dictionary record in stages:
 *
 * - **id / isTT / modelYear** are verbatim from the dictionary wherever it
 *   has a record for the frame.
 * - **name** is the dictionary's only when the dictionary has a real one.
 *   For update 1.123's frames it has either a localization placeholder
 *   (`Factor LOC_ENTITLEMENT_CYCLING_BIKE_FACTOR_HANZO_NAME`) or no record
 *   at all, so the name here is ZwiftInsider's spelling (its sheet and the
 *   article at https://zwiftinsider.com/update-1-123-166757/), the only
 *   published human name - a PROVISIONAL key, chosen deliberately over
 *   hiding a measured frame until Zwift localizes it. The dictionary is
 *   the authority once it speaks: `npm run supplement:check` fetches it and
 *   reports every entry whose id now carries a real name (or, for the
 *   provisional ids below, whose name now has a record), and the entry is
 *   then re-keyed to the dictionary's spelling.
 * - **id** is provisional for frames with no dictionary record at all:
 *   `PROVISIONAL_FRAME_ID_BASE + n`. Zwift's ids are 32-bit signatures, so
 *   anything at or above 2^32 can never collide with a real one, and
 *   `isProvisionalFrameId` tells the validator and the check script which
 *   entries still need their real id. Garages key frames by id, so a rider
 *   who adds one of these loses that garage entry when the real id lands -
 *   accepted. (A wheel rename, by contrast, carries the garage over through
 *   `RENAMED_WHEELSET_KEYS` in `wheelSupplement.ts`.)
 *
 * Speed data for update 1.123's seven TT frames is measured (ZwiftInsider's
 * 300 W bot tests, sheet fetched 2026-10-06) and lives in
 * `TT_FRAME_SPEED_DATA` under these exact names. A frame nobody has measured
 * can be supplemented too (the Wilier Filante SLR ID2 We Ride Paris was,
 * until zwift-data 2.1 shipped it): it ranks as estimated, and its upgrade
 * scheme is marked `derived`.
 *
 * The same list can also carry RENAMES: a frame the package already ships
 * under an older name that the dictionary has since changed (the Specialized
 * S-Works Tarmac SL9 and the Canyon Aeroad CFR - CANYON//SRAM were, until
 * zwift-data 2.1 caught up). The entry keeps the frame's id - which is what
 * garages, the `owned` query and the wheel drill-down key on, so a rider's
 * garage entry survives the rename untouched - and only the name moves,
 * with the speed-data and scheme tables re-keyed in the same commit. The
 * dictionary is the authority on what the game calls a bike;
 * `supplement:check` proves each rename is still what it says. The entry is
 * deleted once the package catches up (the validator says so).
 */

/** First id that can never be a real Zwift signature (those are uint32). */
export const PROVISIONAL_FRAME_ID_BASE = 2 ** 32

export function isProvisionalFrameId(id: number): boolean {
  return id >= PROVISIONAL_FRAME_ID_BASE
}

/**
 * A frame that shipped before its localized string carries the raw
 * dictionary key as its name (`Factor LOC_ENTITLEMENT_CYCLING_BIKE_FACTOR_HANZO_NAME`,
 * id 3719018442, in zwift-data 2.1). It is an upstream gap, not a bike the
 * catalog can describe - `getFrames()` drops such names, and the merge below
 * lets a supplement entry stand in for one.
 */
export const UNLOCALIZED_FRAME_NAME = /\bLOC_[A-Z0-9_]+_NAME\b/

export const SUPPLEMENT_FRAMES: BikeFrame[] = [
  // zwift-data 2.1 ships these four under placeholder names; the dictionary
  // has named them since (id/name/isTT/modelYear verbatim).
  { id: 3719018442, name: 'Factor Hanzō', modelYear: 2026, isTT: true },
  { id: 2124063579, name: 'Cannondale SuperSlice LAB71', modelYear: 2026, isTT: true },
  { id: 244289700, name: 'Giant Trinity Advanced SL', modelYear: 2026, isTT: true },
  { id: 3851032184, name: 'Liv Avow Advanced SL', modelYear: 2026, isTT: true },
  // Rename: zwift-data 2.1 still ships id 2460287610 as "Specialized Shiv
  // Disc"; the dictionary renamed it on 2026-10-09, the name ZwiftInsider
  // re-tested it under in update 1.123.
  { id: 2460287610, name: 'Specialized S-Works Shiv Disc', modelYear: 2019, isTT: true },
  // Not in zwift-data 2.1 at all. They had provisional ids until the
  // dictionary gave them records on 2026-10-09 (id/isTT/modelYear verbatim).
  // The new Quintana Roo takes the dictionary's spelling, brand run together
  // like the old "QuintanaRoo Roo V-PR".
  { id: 2475649027, name: 'QuintanaRoo V-PRI', modelYear: 2026, isTT: true },
  { id: 2389526374, name: 'Cube Aerium C:68X', modelYear: 2026, isTT: true },
  // The one entry whose name does NOT follow the dictionary. The dictionary
  // calls this frame plain "Cervelo P5", which is also the name of the 2015
  // bike (3932292289) - and name is the key of every speed-data and scheme
  // table, so the two would share one row. The 2015 bike keeps the plain
  // name, so nothing measured or owned for it moves; this one keeps its
  // year. `supplement:check` accepts the difference for this id only.
  { id: 1969226988, name: 'Cervelo P5 2026', modelYear: 2026, isTT: true }
]

/**
 * Merges the supplement into the upstream catalog. An id is one frame: a
 * supplement entry sharing an upstream id REPLACES that record in place
 * (a placeholder stand-in or a rename - either way the entry's name is the
 * one the game shows, and the id the garage holds is unchanged). An entry
 * whose id is new is appended, unless its name already belongs to a
 * different upstream frame - name is the key of every speed-data and
 * scheme table, so that entry would attach the wrong data, and upstream
 * wins. The validator reports both the override and the collision.
 */
export function applyFrameSupplement(upstream: readonly BikeFrame[], supplement: readonly BikeFrame[]): BikeFrame[] {
  const overrides = new Map(supplement.map(f => [f.id, f]))
  const upstreamIds = new Set(upstream.map(f => f.id))
  const upstreamNames = new Set(upstream.map(f => f.name))
  return [
    ...upstream.map(f => overrides.get(f.id) ?? f),
    ...supplement.filter(f => !upstreamIds.has(f.id) && !upstreamNames.has(f.name))
  ]
}
