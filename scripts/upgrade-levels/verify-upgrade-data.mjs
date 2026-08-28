// Data-integrity check for the bike upgrade scheme tables.
//
// Runs as `npm run validate:upgrade-data`, part of the `npm run validate`
// chain (and therefore every build and CI run). Before that wiring, a new
// measured frame committed without an upgrade scheme passed every check and
// silently fell back to linear level interpolation instead of its chart
// shape - exactly the drift check 2 exists to catch.
import { bikeFrames } from 'zwift-data'
import { loadSharedModule } from '../route-surfaces/loadShared.mjs'

const { STAGE_CHARTS, FRAME_UPGRADE_SCHEMES } = loadSharedModule('shared/data/frameUpgradeSchemes.ts')
const { FRAME_SPEED_DATA, TT_FRAME_SPEED_DATA } = loadSharedModule('shared/data/frameSpeedData.ts')

// Transcribed from the tables published alongside each chart on
// https://zwiftinsider.com/upgrade-charts/ (the page ships a real HTML table
// next to every chart image - read that, not the image).
//
// Two values here are easy to get wrong, so double-check against the live
// page before "fixing" them:
//   - duration-entry stage 1 is flat 34 / climb 3.4 (easy to transpose)
//   - elevation-high stage 1 flat is 5.8, not 5.2
const PUBLISHED = {
  'distance-entry': { flat: [14.8, 23.1, 27.8, 27.8, 27.8], climb: [2.4, 25.6, 36.2, 36.2, 36.2] },
  'distance-mid': { flat: [11.5, 13.2, 24.6, 28.5, 28.5], climb: [2.2, 24.6, 36, 36.6, 36.6] },
  'distance-high': { flat: [11.6, 12.8, 24.4, 28.1, 28], climb: [2, 17.8, 28.5, 29.3, 37.3] },
  'duration-entry': { flat: [34, 35, 47.9, 47.9, 47.9], climb: [3.4, 14.7, 26.8, 26.8, 26.8] },
  'duration-mid': { flat: [8.7, 9.8, 22.7, 48.6, 48.6], climb: [0.9, 12.9, 23.1, 26.2, 26.2] },
  'duration-high': { flat: [9.1, 10, 22.8, 22.8, 49.3], climb: [1.1, 8.2, 19.4, 23.5, 26.3] },
  'elevation-entry': { flat: [7.4, 10.2, 21.3, 21.3, 21.3], climb: [0.7, 48.4, 58, 58, 58] },
  'elevation-mid': { flat: [4.9, 10.5, 22.3, 23.5, 23.5], climb: [0.4, 41.2, 50.4, 50.8, 50.8] },
  'elevation-high': { flat: [5.8, 8.4, 19.8, 21.3, 21.7], climb: [0.9, 36.6, 47.6, 47.9, 59.8] }
}

// Where STAGE_CHARTS deliberately deviates from the published chart because
// the published value is demonstrably a transcription defect. Key format:
// `${scheme} ${axis} stage ${n}` -> the corrected value the code carries.
// Each entry must cite its evidence in a comment here AND next to the value
// in frameUpgradeSchemes.ts.
const PUBLISHED_CHART_CORRECTIONS = {
  // Published 23.1 is ~83% of the 27.8s flat total, but all 12 distance-entry
  // frames' own per-stage sheet rows put stage 2 at a mean 59.1% (16.4s);
  // 23.1 matches the CAAD12's *absolute* stage-2 gap on the sheet, i.e. the
  // chart most likely copied the wrong cell (issue #88).
  'distance-entry flat stage 2': 16.4
}

// Stage-1 flat power saving (W) from each scheme's power chart, used for the
// consistency check below.
const STAGE1_FLAT_WATTS = {
  'distance-entry': 3.3, 'distance-mid': 2.6, 'distance-high': 2.6,
  'duration-entry': 7.7, 'duration-mid': 2, 'duration-high': 2.1,
  'elevation-entry': 1.7, 'elevation-mid': 1.1, 'elevation-high': 1.3
}

let failures = 0
const fail = (msg) => {
  failures++
  console.log(`  FAIL  ${msg}`)
}
const median = (a) => {
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}
const measuredFor = name => FRAME_SPEED_DATA[name] ?? TT_FRAME_SPEED_DATA[name]

console.log('1. STAGE_CHARTS vs ZwiftInsider published tables')
let checked = 0
for (const [key, want] of Object.entries(PUBLISHED)) {
  const got = STAGE_CHARTS[key]
  if (!got) {
    fail(`scheme "${key}" missing from STAGE_CHARTS`)
    continue
  }
  for (const axis of ['flat', 'climb']) {
    want[axis].forEach((v, i) => {
      checked++
      const expected = PUBLISHED_CHART_CORRECTIONS[`${key} ${axis} stage ${i + 1}`] ?? v
      if (got[axis][i] !== expected) fail(`${key} ${axis} stage ${i + 1}: code ${got[axis][i]}, expected ${expected} (published ${v})`)
    })
  }
}
for (const key of Object.keys(STAGE_CHARTS)) {
  if (!PUBLISHED[key]) fail(`STAGE_CHARTS has "${key}" with no published reference here`)
}
console.log(`   ${checked} values checked\n`)

console.log('2. Scheme coverage')
const measuredNames = [...Object.keys(FRAME_SPEED_DATA), ...Object.keys(TT_FRAME_SPEED_DATA)]
const realNames = new Set(bikeFrames.map(f => f.name))
for (const n of measuredNames) {
  if (!FRAME_UPGRADE_SCHEMES[n]) fail(`measured frame "${n}" has no upgrade scheme (falls back to linear)`)
}
for (const n of Object.keys(FRAME_UPGRADE_SCHEMES)) {
  // A scheme keyed on a name zwift-data doesn't use is dead data - the lookup
  // silently misses and the frame quietly falls back to linear interpolation.
  if (!realNames.has(n)) fail(`scheme key "${n}" matches no zwift-data frame name`)
  if (!measuredFor(n)) fail(`scheme "${n}" has no speed data, so its level is inert`)
}
console.log(`   ${measuredNames.length} measured frames, ${Object.keys(FRAME_UPGRADE_SCHEMES).length} scheme entries\n`)

console.log('3. Unit basis: chart totals vs each frame\'s own measured L0->L5 gain')
console.log('   (both sources are "seconds saved across 1 hour at 300W" - a mismatched')
console.log('    basis would show up here as a large systematic offset)')
const errF = [], errC = []
for (const [name, s] of Object.entries(FRAME_UPGRADE_SCHEMES)) {
  const d = measuredFor(name)
  if (!d) continue
  const chart = STAGE_CHARTS[`${s.axis}-${s.tier}`]
  errF.push(Math.abs((d.flatGapSec5 - d.flatGapSec0) - chart.flat[4]))
  errC.push(Math.abs((d.climbGapSec5 - d.climbGapSec0) - chart.climb[4]))
}
const mF = median(errF), mC = median(errC)
console.log(`   median |error|: flat ${mF.toFixed(2)} s/hr, climb ${mC.toFixed(2)} s/hr`)
// ZwiftInsider states the charts are representative "within 1-2 seconds";
// anything past 5 s/hr median means the two tables disagree structurally.
if (mF > 5 || mC > 5) fail(`chart totals disagree with measured totals (median ${mF.toFixed(1)}/${mC.toFixed(1)} s/hr)`)
console.log()

console.log('4. Stage-1 consistency: seconds saved per watt saved')
console.log('   (stage 1 is an aero upgrade in every scheme, so s/W should be similar)')
const ratios = []
for (const [key, w] of Object.entries(STAGE1_FLAT_WATTS)) {
  const r = STAGE_CHARTS[key].flat[0] / w
  ratios.push(r)
  console.log(`   ${key.padEnd(17)} ${STAGE_CHARTS[key].flat[0].toString().padStart(5)}s / ${w}W = ${r.toFixed(2)}`)
}
const spread = Math.max(...ratios) / Math.min(...ratios)
console.log(`   spread ${spread.toFixed(2)}x`)
// Correct data sits at ~1.03x. The 5.2-vs-5.8 elevation-high transcription
// error this check exists to catch produces 1.12x, so the bar is 1.10x.
if (spread > 1.10) fail(`stage-1 seconds-per-watt spread is ${spread.toFixed(2)}x - one chart value is probably mistranscribed`)

console.log(`\n${failures === 0 ? 'OK - all checks passed.' : `${failures} check(s) FAILED.`}`)
process.exit(failures === 0 ? 0 : 1)
