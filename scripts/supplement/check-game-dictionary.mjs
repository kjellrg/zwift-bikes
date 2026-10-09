#!/usr/bin/env node
// Checks the supplement catalogs (shared/data/frameSupplement.ts and
// shared/data/wheelSupplement.ts) against Zwift's live game dictionary -
// the file zwift-data is generated from, and the only authority on names,
// ids and imageNames. The supplements exist because zwift-data lags the
// dictionary by months and some entries ship before Zwift even localizes
// their names, so this is the "look again later" that frameSupplement.ts
// promises for any provisional name or id. Maintenance only; network-bound,
// so it is not part of `npm run validate`:
//
//   npm run supplement:check                       # fetch the live dictionary
//   npm run supplement:check -- --dictionary=path  # offline copy (JSON)
//
// Reports, and exits 1 when any of them is non-empty:
//   - a supplement entry whose id the dictionary now names for real (or
//     differently): re-key the entry, its speed data and scheme/garage key
//     on the dictionary's spelling (except the one name kept on purpose,
//     `KEPT_FRAME_NAMES` below)
//   - a provisional-id frame whose name the dictionary now has a record
//     for: take the real id
//   - a dictionary frame or wheel that neither zwift-data nor a supplement
//     accounts for: new equipment, or a provisional entry under a spelling
//     this script could not match - decide by hand
//
// Withdrawn wheels (gone from the game, still in zwift-data) are listed
// with whether the dictionary still has them; that is never a finding.
import { readFileSync } from 'node:fs'
import { bikeFrames, bikeFrontWheels, bikeRearWheels } from 'zwift-data'
import { loadSharedModule } from '../route-surfaces/loadShared.mjs'

const { SUPPLEMENT_FRAMES, isProvisionalFrameId } = loadSharedModule('shared/data/frameSupplement.ts')
const { SUPPLEMENT_FRONT_WHEELS, SUPPLEMENT_REAR_WHEELS, WITHDRAWN_FRONT_WHEELS, WITHDRAWN_REAR_WHEELS } = loadSharedModule('shared/data/wheelSupplement.ts')

export const DICTIONARY_URL = 'https://www.zwift.com/zwift-web-pages/gamedictionary'

// Wheel placeholders don't follow the frames' `LOC_..._NAME` shape
// (`Zwift LOC_WHEELNAME_ZWIFT_BigSpinCruiser2024` is in zwift-data today).
const PLACEHOLDER = /\bLOC_[A-Za-z0-9_]+/

// Supplement names follow the dictionary, with one documented exception,
// by id: the dictionary calls both Cervelo P5s plain "Cervelo P5" (2015:
// 3932292289, 2026: 1969226988), and name is the key of every speed-data
// and scheme table, so the 2026 bike keeps its year (see frameSupplement.ts).
// Accepted only while the dictionary still says exactly `dictionaryName`;
// a dictionary rename of this frame is a finding like any other.
const KEPT_FRAME_NAMES = new Map([
  [1969226988, { name: 'Cervelo P5 2026', dictionaryName: 'Cervelo P5' }]
])
const normalize = name => name.toLowerCase().replace(/\s+/gu, ' ').trim()

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')))
const raw = args.dictionary ? readFileSync(args.dictionary, 'utf8') : await (await fetch(DICTIONARY_URL)).text()
const dictionary = JSON.parse(raw).GameDictionary
const records = (group, item) => (dictionary[group]?.[0]?.[item] ?? []).map(r => ({ ...r.$, id: Number(r.$.signature) }))
const dictFrames = records('BIKEFRAMES', 'BIKEFRAME')
const dictFront = records('BIKEFRONTWHEELS', 'BIKEFRONTWHEEL')
const dictRear = records('BIKEREARWHEELS', 'BIKEREARWHEEL')
if (!dictFrames.length || !dictFront.length || !dictRear.length) {
  console.error('Dictionary layout changed - no BIKEFRAMES/BIKEFRONTWHEELS/BIKEREARWHEELS records found; refusing to guess.')
  process.exit(1)
}

const findings = []

// --- Frames ---
const dictFrameById = new Map(dictFrames.map(f => [f.id, f]))
const dictFrameByName = new Map(dictFrames.map(f => [normalize(f.name), f]))
for (const frame of SUPPLEMENT_FRAMES) {
  if (isProvisionalFrameId(frame.id)) {
    const match = dictFrameByName.get(normalize(frame.name))
    if (match) findings.push(`frame ${JSON.stringify(frame.name)}: the dictionary now has a record (id ${match.id}, name ${JSON.stringify(match.name)}) - replace the provisional id ${frame.id}`)
    else console.log(`frame ${JSON.stringify(frame.name)}: no dictionary record yet (provisional id ${frame.id})`)
    continue
  }
  const record = dictFrameById.get(frame.id)
  const kept = KEPT_FRAME_NAMES.get(frame.id)
  if (!record) {
    findings.push(`frame ${JSON.stringify(frame.name)} (id ${frame.id}): the dictionary no longer has this id - withdrawn, or the id was mistranscribed`)
  } else if (PLACEHOLDER.test(record.name)) {
    console.log(`frame ${JSON.stringify(frame.name)} (id ${frame.id}): dictionary name is still the placeholder ${JSON.stringify(record.name)}`)
  } else if (kept?.name === frame.name && kept.dictionaryName === record.name) {
    console.log(`frame ${JSON.stringify(frame.name)} (id ${frame.id}): the dictionary names it ${JSON.stringify(record.name)}; the name is kept on purpose (documented exception)`)
  } else if (record.name !== frame.name) {
    findings.push(`frame ${JSON.stringify(frame.name)} (id ${frame.id}): the dictionary now names it ${JSON.stringify(record.name)} - re-key the supplement entry, its speed data and its upgrade scheme`)
  } else {
    console.log(`frame ${JSON.stringify(frame.name)} (id ${frame.id}): dictionary name matches`)
  }
  if (record && (Number(record.isTT) === 1) !== frame.isTT) findings.push(`frame ${JSON.stringify(frame.name)}: dictionary isTT=${record.isTT}, supplement says ${frame.isTT}`)
}
const knownFrameIds = new Set([...bikeFrames, ...SUPPLEMENT_FRAMES].map(f => f.id))
for (const record of dictFrames) {
  if (!knownFrameIds.has(record.id)) findings.push(`dictionary frame ${JSON.stringify(record.name)} (id ${record.id}, isTT=${record.isTT}, modelYear=${record.modelYear}) is in neither zwift-data nor the supplement`)
}

// --- Wheels ---
for (const [label, supplement, upstream, dict, withdrawn] of [
  ['front wheel', SUPPLEMENT_FRONT_WHEELS, bikeFrontWheels, dictFront, WITHDRAWN_FRONT_WHEELS],
  ['rear wheel', SUPPLEMENT_REAR_WHEELS, bikeRearWheels, dictRear, WITHDRAWN_REAR_WHEELS]
]) {
  const byId = new Map(dict.map(w => [w.id, w]))
  // A withdrawal rests on an in-game check, not on the dictionary, which can
  // keep a record the game no longer offers - so it is reported, never failed.
  for (const wheel of withdrawn) {
    console.log(`${label} ${JSON.stringify(wheel.name)} (id ${wheel.id}): withdrawn - ${byId.has(wheel.id) ? 'the dictionary still lists it' : 'the dictionary has dropped it too; delete the withdrawal once zwift-data does'}`)
  }
  for (const wheel of supplement) {
    const record = byId.get(wheel.id)
    if (!record) {
      findings.push(`${label} ${JSON.stringify(wheel.name)} (id ${wheel.id}): the dictionary no longer has this id`)
      continue
    }
    const diffs = []
    if (record.name !== wheel.name) diffs.push(`name is now ${JSON.stringify(record.name)}${PLACEHOLDER.test(record.name) ? ' (still a placeholder)' : ''}`)
    if (record.imageName !== wheel.imageName) diffs.push(`imageName is now ${JSON.stringify(record.imageName)}`)
    if (diffs.length && !(diffs.length === 1 && PLACEHOLDER.test(record.name))) findings.push(`${label} ${JSON.stringify(wheel.name)} (id ${wheel.id}): ${diffs.join('; ')} - re-key the supplement entry and its speed data`)
    else console.log(`${label} ${JSON.stringify(wheel.name)} (id ${wheel.id}): ${diffs[0] ?? 'dictionary matches'}`)
  }
  const knownIds = new Set([...upstream, ...supplement].map(w => w.id))
  for (const record of dict) {
    if (!knownIds.has(record.id)) findings.push(`dictionary ${label} ${JSON.stringify(record.name)} (id ${record.id}, image ${record.imageName}) is in neither zwift-data nor the supplement`)
  }
}

if (findings.length) {
  console.error(`\n${findings.length} supplement entr${findings.length === 1 ? 'y needs' : 'ies need'} attention:\n  ${findings.join('\n  ')}`)
  process.exit(1)
}
console.log('\nsupplement:check OK - every supplement entry matches the game dictionary and nothing is unaccounted for')
