import type { BikeFrontWheel, BikeRearWheel } from 'zwift-data'

/**
 * Wheels that are live in Zwift's game dictionary
 * (https://www.zwift.com/zwift-web-pages/gamedictionary) but haven't shipped
 * in the `zwift-data` npm package yet. The dictionary is the exact file
 * zwift-data is generated from (its daily update workflow reads only that
 * URL), so entries here carry the real ids/names/imageNames the eventual
 * zwift-data release will ship - copied verbatim, never invented.
 *
 * Lifecycle: `applyWheelSupplement` merges these into the catalog, skipping
 * any entry whose name or id already exists upstream - so a zwift-data
 * release that includes the wheel wins automatically and never produces a
 * duplicate. Once that happens, `scripts/validate-speed-data.mjs` fails the
 * build naming the now-redundant entry, and the fix is deleting it here.
 *
 * The 2026 Shimano wheels below are NOT the "Shimano DURA-ACE C36/C50/C60"
 * already in the catalog - those are the older revisions, which Zwift left
 * untouched (same names, same ids). ZwiftInsider's sheet spells the new
 * wheels "Shimano DURA-ACE C36" etc. and retitles the old ones
 * "... C36 2025" / "... C50 2021" / "... C60 2019"; the game's own names
 * for the new revisions drop "DURA-ACE" entirely (the usual sheet-vs-game
 * spelling divergence - the imageNames' "2026" suffix confirms which is
 * which). Source: game dictionary + https://zwiftinsider.com/shimano-wheels-2026/,
 * both fetched 2026-08-21.
 */
export const SUPPLEMENT_FRONT_WHEELS: BikeFrontWheel[] = [
  { id: 3842759965, name: 'Shimano C36', imageName: 'Wheel_ShimanoDuraAceC362026' },
  { id: 2489344011, name: 'Shimano C50', imageName: 'Wheel_ShimanoDuraAceC502026' },
  { id: 3181958393, name: 'Shimano C60', imageName: 'Wheel_ShimanoDuraAceC602026' },
  { id: 1160815788, name: 'Shimano C99/Disc', imageName: 'Wheel_ShimanoDuraAceC992026' }
]

export const SUPPLEMENT_REAR_WHEELS: BikeRearWheel[] = [
  { id: 14115933, name: 'Shimano C36', imageName: 'Wheel_ShimanoDuraAceC362026' },
  { id: 3673160473, name: 'Shimano C50', imageName: 'Wheel_ShimanoDuraAceC502026' },
  { id: 3415380320, name: 'Shimano C60', imageName: 'Wheel_ShimanoDuraAceC602026' },
  { id: 827108797, name: 'Shimano C99/Disc', imageName: 'Wheel_ShimanoDuraAceC992026' }
]

/**
 * Appends supplement entries not yet present upstream. Skips on either a
 * name or an id match: name is the app's identity key (wheelset `key`,
 * garage/localStorage, `WHEEL_SPEED_DATA`), id catches the case where
 * upstream ships the wheel under a corrected spelling - either way the
 * upstream entry must win unchallenged.
 */
export function applyWheelSupplement<W extends BikeFrontWheel | BikeRearWheel>(
  upstream: readonly W[],
  supplement: readonly W[]
): W[] {
  const names = new Set(upstream.map(w => w.name))
  const ids = new Set(upstream.map(w => w.id))
  return [...upstream, ...supplement.filter(w => !names.has(w.name) && !ids.has(w.id))]
}
