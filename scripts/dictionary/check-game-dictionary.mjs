#!/usr/bin/env node
// Checks the catalog against Zwift's game dictionary - the file zwift-data is
// generated from, and the authority on names and ids. zwift-data releases in
// bursts weeks to months apart, so the dictionary is where a rename, a new
// frame or a real name for a placeholder shows up first. Nothing in the build
// reads the dictionary, so this is run by hand and is not part of
// `npm run validate`:
//
//   npm run dictionary:check                         # fetch the live dictionary
//   npm run dictionary:check -- --dictionary=path    # an offline copy (JSON)
//   npm run dictionary:check -- --schemes            # also print every frame's scheme next to its lvId's
//
// Reports (the comparison itself is checkDictionary.mjs):
//   - frames and wheels: a rename of anything the catalog keys data by, a
//     changed isTT or imageName, an id the dictionary dropped, a record the
//     catalog lacks, a provisional-id frame that now has a record, and a
//     wheel still shown under a placeholder name
//   - two dictionary records sharing a name
//   - routes: renames, distance and lead-ins (event, free-ride, meetup) more
//     than 10 m apart, the event-only flag, routes either side lacks, and
//     each event lead-in override against the dictionary's figure
//   - upgrade schemes, against the scheme each frame's lvId names: reported
//     under their own heading and never failing the run, except an lvId the
//     check's table does not know, which is an upstream change
//
// Exits 1 only when a difference is not on ACCEPTED_GAPS (checkDictionary.mjs).
import { readFileSync } from 'node:fs'
import { bikeFrames, bikeFrontWheels, bikeRearWheels, routes } from 'zwift-data'
import { loadSharedModule } from '../route-surfaces/loadShared.mjs'
import { ACCEPTED_GAPS, checkDictionary, formatReport, formatSchemeComparison, missingGroups } from './checkDictionary.mjs'

const { SUPPLEMENT_FRAMES, applyFrameSupplement, isProvisionalFrameId } = loadSharedModule('shared/data/frameSupplement.ts')
const { SUPPLEMENT_FRONT_WHEELS, SUPPLEMENT_REAR_WHEELS, WITHDRAWN_FRONT_WHEELS, WITHDRAWN_REAR_WHEELS, applyWheelSupplement } = loadSharedModule('shared/data/wheelSupplement.ts')
const { FRAME_UPGRADE_SCHEMES } = loadSharedModule('shared/data/frameUpgradeSchemes.ts')
const { FRAME_SPEED_DATA, TT_FRAME_SPEED_DATA } = loadSharedModule('shared/data/frameSpeedData.ts')
const { EVENT_LEAD_IN_OVERRIDES } = loadSharedModule('shared/data/routeEventLeadIns.ts')

export const DICTIONARY_URL = 'https://www.zwift.com/zwift-web-pages/gamedictionary'

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')))
async function fetchDictionary() {
  const response = await fetch(DICTIONARY_URL)
  if (!response.ok) {
    console.error(`Could not fetch the game dictionary: HTTP ${response.status} from ${DICTIONARY_URL}`)
    process.exit(1)
  }
  return response.text()
}
const dictionary = JSON.parse(args.dictionary ? readFileSync(args.dictionary, 'utf8') : await fetchDictionary())
const missing = missingGroups(dictionary)
if (missing.length) {
  console.error(`Dictionary layout changed - no ${missing.join('/')} found; refusing to guess.`)
  process.exit(1)
}

// The catalog exactly as the site builds it from zwift-data and the
// supplements (`getFrames()` / `getWheelsets()`), each entry marked with
// where it came from so a finding can say which file to fix.
const tagged = (list, supplement) => {
  const supplementIds = new Set(supplement.map(item => item.id))
  return list.map(item => ({ ...item, source: supplementIds.has(item.id) ? 'supplement' : 'zwift-data' }))
}
const catalog = {
  frames: tagged(applyFrameSupplement(bikeFrames, SUPPLEMENT_FRAMES), SUPPLEMENT_FRAMES).map(f => ({ ...f, provisional: isProvisionalFrameId(f.id) })),
  frontWheels: tagged(applyWheelSupplement(bikeFrontWheels, SUPPLEMENT_FRONT_WHEELS, WITHDRAWN_FRONT_WHEELS), SUPPLEMENT_FRONT_WHEELS),
  rearWheels: tagged(applyWheelSupplement(bikeRearWheels, SUPPLEMENT_REAR_WHEELS, WITHDRAWN_REAR_WHEELS), SUPPLEMENT_REAR_WHEELS),
  withdrawnFrontWheels: WITHDRAWN_FRONT_WHEELS,
  withdrawnRearWheels: WITHDRAWN_REAR_WHEELS,
  routes,
  eventLeadInOverrides: EVENT_LEAD_IN_OVERRIDES,
  schemes: FRAME_UPGRADE_SCHEMES,
  measuredFrameNames: new Set([...Object.keys(FRAME_SPEED_DATA), ...Object.keys(TT_FRAME_SPEED_DATA)])
}

const result = checkDictionary(dictionary, catalog, ACCEPTED_GAPS)
const { text, exitCode } = formatReport(result)
console.log(text)
if ('schemes' in args) console.log(`\n${formatSchemeComparison(result)}`)
process.exit(exitCode)
