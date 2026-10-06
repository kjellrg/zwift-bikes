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
 *
 * The three update-1.123 discs (Reserve Infinity, CADEX 4-Spoke, Black Inc
 * THREE/ZERO) have dictionary records whose names are still localization
 * placeholders (`Reserve LOC_ENTITLEMENT_CYCLING_WHEELS_RESERVE_INFINITY_NAME`),
 * so ids and imageNames are verbatim and the names are ZwiftInsider's
 * spelling (sheet + https://zwiftinsider.com/update-1-123-166757/, fetched
 * 2026-10-06) - provisional keys, the same call `frameSupplement.ts` makes
 * and documents. `npm run supplement:check` reports the moment the
 * dictionary names them for real; re-key the entry, its `WHEEL_SPEED_DATA`
 * row and (via a garage migration) its wheelset key then. The same check
 * already reports the dictionary's rename of the 2026 Shimano wheels to
 * "Shimano DURA-ACE Cxx" - a collision with the legacy names tracked in
 * issue #272, deliberately not acted on here.
 */
export const SUPPLEMENT_FRONT_WHEELS: BikeFrontWheel[] = [
  { id: 3842759965, name: 'Shimano C36', imageName: 'Wheel_ShimanoDuraAceC362026' },
  { id: 2489344011, name: 'Shimano C50', imageName: 'Wheel_ShimanoDuraAceC502026' },
  { id: 3181958393, name: 'Shimano C60', imageName: 'Wheel_ShimanoDuraAceC602026' },
  { id: 1160815788, name: 'Shimano C99/Disc', imageName: 'Wheel_ShimanoDuraAceC992026' },
  { id: 3667484525, name: 'Reserve Infinity Disc-set', imageName: 'Wheel_ReserveInfinityDisc2026' },
  { id: 3827121667, name: 'CADEX 4-Spoke/Disc', imageName: 'Wheel_Cadex4SpokeDisc65' },
  { id: 1690454004, name: 'Black Inc THREE/ZERO', imageName: 'Wheel_BlackIncThreeZero2026' }
]

export const SUPPLEMENT_REAR_WHEELS: BikeRearWheel[] = [
  { id: 14115933, name: 'Shimano C36', imageName: 'Wheel_ShimanoDuraAceC362026' },
  { id: 3673160473, name: 'Shimano C50', imageName: 'Wheel_ShimanoDuraAceC502026' },
  { id: 3415380320, name: 'Shimano C60', imageName: 'Wheel_ShimanoDuraAceC602026' },
  { id: 827108797, name: 'Shimano C99/Disc', imageName: 'Wheel_ShimanoDuraAceC992026' },
  { id: 659802619, name: 'Reserve Infinity Disc-set', imageName: 'Wheel_ReserveInfinityDisc2026' },
  { id: 3443883036, name: 'CADEX 4-Spoke/Disc', imageName: 'Wheel_Cadex4SpokeDisc65' },
  { id: 2002469001, name: 'Black Inc THREE/ZERO', imageName: 'Wheel_BlackIncThreeZero2026' }
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
