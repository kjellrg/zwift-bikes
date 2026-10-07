import type { BikeFrontWheel, BikeRearWheel } from 'zwift-data'

/**
 * Wheels that are live in Zwift's game dictionary
 * (https://www.zwift.com/zwift-web-pages/gamedictionary) but haven't shipped
 * in the `zwift-data` npm package yet. The dictionary is the exact file
 * zwift-data is generated from (its daily update workflow reads only that
 * URL), so entries here carry the real ids/names/imageNames the eventual
 * zwift-data release will ship - copied verbatim, never invented.
 *
 * Lifecycle: `applyWheelSupplement` merges these into the catalog. An entry
 * whose id upstream already ships replaces that record, and an entry whose
 * name upstream already uses is skipped - so a zwift-data release that
 * includes the wheel never produces a duplicate. Once that happens, `scripts/validate-speed-data.mjs` fails the
 * build naming the now-redundant entry, and the fix is deleting it here.
 *
 * The list also carries RENAMES, the way `frameSupplement.ts` does: an
 * entry sharing an id with an upstream record replaces that record in place
 * (front and rear are separate records with their own ids, so a rename is
 * two entries). Name is the wheelset key a garage holds, so a rename also
 * moves the `WHEEL_SPEED_DATA` row in the same change and adds the old key
 * to `RENAMED_WHEELSET_KEYS`, which the garage applies when it loads.
 *
 * The 2026 Shimano wheels replaced the older revisions in the game: the
 * older ones are gone from the garage and the wheel picker, and the 2026
 * wheels took their names ("Shimano DURA-ACE C36" ...; checked in game
 * 2026-10-07). The dictionary still lists the older records under those
 * same names, and zwift-data 1.50 ships them, so they are WITHDRAWN below
 * by id - otherwise the catalog would hold two wheels per name, sharing one
 * name-keyed speed row. The 2026 entries carry the dictionary's names
 * verbatim. ZwiftInsider's sheet titles the older rows "... C36 2025" /
 * "... C50 2021" / "... C60 2019"; their measurements left with the wheels.
 *
 * The three update-1.123 discs (Reserve Infinity, CADEX 4-Spoke, Black Inc
 * THREE/ZERO) have dictionary records whose names are still localization
 * placeholders (`Reserve LOC_ENTITLEMENT_CYCLING_WHEELS_RESERVE_INFINITY_NAME`),
 * so ids and imageNames are verbatim and the names are ZwiftInsider's
 * spelling (sheet + https://zwiftinsider.com/update-1-123-166757/, fetched
 * 2026-10-06) - provisional keys, the same call `frameSupplement.ts` makes
 * and documents. `npm run supplement:check` reports the moment the
 * dictionary names them for real; re-key the entry, its `WHEEL_SPEED_DATA`
 * row and its garage key (`RENAMED_WHEELSET_KEYS`) then.
 */
export const SUPPLEMENT_FRONT_WHEELS: BikeFrontWheel[] = [
  { id: 3842759965, name: 'Shimano DURA-ACE C36', imageName: 'Wheel_ShimanoDuraAceC362026' },
  { id: 2489344011, name: 'Shimano DURA-ACE C50', imageName: 'Wheel_ShimanoDuraAceC502026' },
  { id: 3181958393, name: 'Shimano DURA-ACE C60', imageName: 'Wheel_ShimanoDuraAceC602026' },
  { id: 1160815788, name: 'Shimano DURA-ACE C99 + Disc', imageName: 'Wheel_ShimanoDuraAceC992026' },
  { id: 3667484525, name: 'Reserve Infinity Disc-set', imageName: 'Wheel_ReserveInfinityDisc2026' },
  { id: 3827121667, name: 'CADEX 4-Spoke/Disc', imageName: 'Wheel_Cadex4SpokeDisc65' },
  { id: 1690454004, name: 'Black Inc THREE/ZERO', imageName: 'Wheel_BlackIncThreeZero2026' },
  // Renamed in the game (dictionary fetched 2026-10-07); zwift-data 1.50
  // still says "Roval Sprint CLX" and "Princeton  Mach TSV2/Blur Disc\u00A0".
  { id: 3400914270, name: 'Roval Rapide Sprint CLX', imageName: 'Wheel_RovalRapideCLX' },
  { id: 817265411, name: 'Princeton Mach TSV2/Blur Disc', imageName: 'Wheel_PrincetonCarbonWorksMachTSV2Blur' }
]

export const SUPPLEMENT_REAR_WHEELS: BikeRearWheel[] = [
  { id: 14115933, name: 'Shimano DURA-ACE C36', imageName: 'Wheel_ShimanoDuraAceC362026' },
  { id: 3673160473, name: 'Shimano DURA-ACE C50', imageName: 'Wheel_ShimanoDuraAceC502026' },
  { id: 3415380320, name: 'Shimano DURA-ACE C60', imageName: 'Wheel_ShimanoDuraAceC602026' },
  { id: 827108797, name: 'Shimano DURA-ACE C99 + Disc', imageName: 'Wheel_ShimanoDuraAceC992026' },
  { id: 659802619, name: 'Reserve Infinity Disc-set', imageName: 'Wheel_ReserveInfinityDisc2026' },
  { id: 3443883036, name: 'CADEX 4-Spoke/Disc', imageName: 'Wheel_Cadex4SpokeDisc65' },
  { id: 2002469001, name: 'Black Inc THREE/ZERO', imageName: 'Wheel_BlackIncThreeZero2026' },
  { id: 3517161569, name: 'Roval Rapide Sprint CLX', imageName: 'Wheel_RovalRapideCLX' },
  { id: 3710951039, name: 'Princeton Mach TSV2/Blur Disc', imageName: 'Wheel_PrincetonCarbonWorksMachTSV2Blur' }
]

/** An upstream wheel record the game no longer has, named for the reader and the validator. */
export interface WithdrawnWheel {
  id: number
  name: string
}

/**
 * The older Shimano DURA-ACE revisions, which the 2026 wheels replaced in
 * the game (see above). Deleted once zwift-data stops shipping them - the
 * validator says so.
 */
export const WITHDRAWN_FRONT_WHEELS: WithdrawnWheel[] = [
  { id: 304842870, name: 'Shimano DURA-ACE C36' },
  { id: 1742598126, name: 'Shimano DURA-ACE C50' },
  { id: 272842014, name: 'Shimano DURA-ACE C60' }
]

export const WITHDRAWN_REAR_WHEELS: WithdrawnWheel[] = [
  { id: 1002105871, name: 'Shimano DURA-ACE C36' },
  { id: 3725678091, name: 'Shimano DURA-ACE C50' },
  { id: 1207119882, name: 'Shimano DURA-ACE C60' }
]

/**
 * Merges the supplement into the upstream catalog, the way
 * `applyFrameSupplement` does for frames. A withdrawn id is dropped. An id
 * is one wheel: a supplement entry sharing an upstream id REPLACES that
 * record in place (a rename - the entry's name is the one the game shows).
 * An entry whose id is new is appended, unless its name already belongs to
 * a different upstream wheel - name is the wheelset key and the key of
 * `WHEEL_SPEED_DATA`, so upstream wins, and the validator reports it.
 */
export function applyWheelSupplement<W extends BikeFrontWheel | BikeRearWheel>(
  upstream: readonly W[],
  supplement: readonly W[],
  withdrawn: readonly WithdrawnWheel[] = []
): W[] {
  const withdrawnIds = new Set(withdrawn.map(w => w.id))
  const current = upstream.filter(w => !withdrawnIds.has(w.id))
  const overrides = new Map(supplement.map(w => [w.id, w]))
  const ids = new Set(current.map(w => w.id))
  const names = new Set(current.map(w => w.name))
  return [
    ...current.map(w => overrides.get(w.id) ?? w),
    ...supplement.filter(w => !ids.has(w.id) && !names.has(w.name))
  ]
}

/**
 * Old wheelset key -> the key the same wheel has now. A garage stores wheels
 * by `Wheelset.key`, which is the name, so a rename would otherwise drop the
 * wheel from every garage that held it; `migrateWheelsetKeys` runs when the
 * garage loads and rewrites the key once. Delete an entry once nothing can
 * still hold the old key.
 *
 * A garage that held one of the withdrawn Shimano revisions holds its name,
 * which is now the 2026 wheel's - the game made the same swap, so it stays.
 */
export const RENAMED_WHEELSET_KEYS: Readonly<Record<string, string>> = {
  'Roval Sprint CLX': 'Roval Rapide Sprint CLX',
  'Princeton  Mach TSV2/Blur Disc ': 'Princeton Mach TSV2/Blur Disc',
  'Shimano C36': 'Shimano DURA-ACE C36',
  'Shimano C50': 'Shimano DURA-ACE C50',
  'Shimano C60': 'Shimano DURA-ACE C60',
  'Shimano C99/Disc': 'Shimano DURA-ACE C99 + Disc'
}

/** The garage's owned wheels with every renamed key moved to its new name; the same object when nothing moved. */
export function migrateWheelsetKeys<T>(owned: Readonly<Record<string, T>>): Readonly<Record<string, T>> {
  const renamed = (key: string) => Object.hasOwn(RENAMED_WHEELSET_KEYS, key) ? RENAMED_WHEELSET_KEYS[key]! : undefined
  if (!Object.keys(owned).some(renamed)) return owned
  return Object.fromEntries(Object.entries(owned).map(([key, value]) => [renamed(key) ?? key, value]))
}
