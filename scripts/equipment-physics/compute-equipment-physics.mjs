#!/usr/bin/env node
// (Re)generates shared/data/equipmentPhysics.generated.json - the precomputed
// equipment physics deltas the classifiers read at runtime - or, with
// `--check`, re-solves everything and fails if the committed table has
// drifted from the speed data (wired into `npm run validate`, which is also
// what `npm run build` and the pre-commit hook run).
//
// Why this exists: `solveEquipmentDelta` is a nested bisection (~60x60x60
// force evaluations), and running it for every measured frame x level and
// every measured wheel cost 4-11.5s of CPU inside the first request of every
// fresh Workers isolate. The solver's inputs are all static repo data
// (`frameSpeedData.ts`, `wheelSpeedData.ts`, `frameUpgradeSchemes.ts`), so
// the solve happens here, at build time, and runtime does table lookups.
//
// There is deliberately NO runtime fallback to the solver: a table entry
// missing at runtime throws (see shared/data/equipmentPhysics.ts). That
// makes this check load-bearing - it is what guarantees the throw can never
// fire in production: every speed-data change must be accompanied by a
// regenerated table, or the build fails right here naming the missing/stale
// entries.
//
// The output is deterministic (same inputs -> byte-identical file, keys
// sorted, no timestamp), so `--check` can compare exact values: JSON
// round-trips JS doubles losslessly, meaning the runtime table lookups are
// bit-identical to what the solver would have produced.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSharedModule } from '../route-surfaces/loadShared.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outputPath = path.join(repoRoot, 'shared/data/equipmentPhysics.generated.json')
const check = process.argv.includes('--check')

const { FRAME_SPEED_DATA, TT_FRAME_SPEED_DATA } = loadSharedModule('shared/data/frameSpeedData.ts')
const { WHEEL_SPEED_DATA } = loadSharedModule('shared/data/wheelSpeedData.ts')
const { solveMeasuredFramePhysics } = loadSharedModule('shared/utils/classifyBikeFrame.ts')
const { solveMeasuredWheelPhysics } = loadSharedModule('shared/utils/classifyWheel.ts')
const { solveTtBaseline, solveTtDiscResidualCdaDeltaM2 } = loadSharedModule('shared/utils/physics/equipment.ts')

const LEVELS = [0, 1, 2, 3, 4, 5]

// Solved first and passed explicitly to everything TT-relative: the runtime
// module reads the TT baseline from the very table this script regenerates,
// so letting the TT frame solve default to it would fit the frames against a
// stale baseline whenever the measurement changes.
const ttBaseline = solveTtBaseline()

/** @param {Record<string, unknown>} speedData @param {boolean} isTT */
function solveFrames(speedData, isTT) {
  /** @type {Record<string, unknown[]>} */
  const frames = {}
  for (const name of Object.keys(speedData).sort()) {
    frames[name] = LEVELS.map(level => solveMeasuredFramePhysics(name, level, isTT, ttBaseline))
  }
  return frames
}

const table = {
  frames: solveFrames(FRAME_SPEED_DATA, false),
  ttFrames: solveFrames(TT_FRAME_SPEED_DATA, true),
  wheels: Object.fromEntries(Object.keys(WHEEL_SPEED_DATA).sort().map(name => [name, solveMeasuredWheelPhysics(name)])),
  ttBaseline,
  ttDiscResidualCdaDeltaM2: solveTtDiscResidualCdaDeltaM2(ttBaseline)
}

const serialized = JSON.stringify(table, null, 1) + '\n'

if (!check) {
  writeFileSync(outputPath, serialized)
  const frameCount = Object.keys(table.frames).length + Object.keys(table.ttFrames).length
  console.log(`[equipment-physics] wrote ${path.relative(repoRoot, outputPath)}: ${frameCount} frames x ${LEVELS.length} levels, ${Object.keys(table.wheels).length} wheels`)
  process.exit(0)
}

let committed
try {
  committed = readFileSync(outputPath, 'utf8')
} catch {
  console.error(`[equipment-physics] ${path.relative(repoRoot, outputPath)} is missing - run \`npm run equipment-physics:compute\` and commit it.`)
  process.exit(1)
}

if (committed === serialized) {
  const frameCount = Object.keys(table.frames).length + Object.keys(table.ttFrames).length
  console.log(`[equipment-physics] OK: table matches a fresh solve (${frameCount} frames x ${LEVELS.length} levels, ${Object.keys(table.wheels).length} wheels)`)
  process.exit(0)
}

// Byte comparison failed - diff the parsed structures so the error names the
// exact entries instead of "files differ".
const parsed = JSON.parse(committed)
const problems = []
for (const [section, expected] of [['frames', table.frames], ['ttFrames', table.ttFrames], ['wheels', table.wheels]]) {
  const actual = parsed[section] ?? {}
  for (const name of Object.keys(expected)) {
    if (!(name in actual)) problems.push(`${section}: missing "${name}"`)
    else if (JSON.stringify(actual[name]) !== JSON.stringify(expected[name])) problems.push(`${section}: stale values for "${name}"`)
  }
  for (const name of Object.keys(actual)) {
    if (!(name in expected)) problems.push(`${section}: extra "${name}" (no longer in the speed data)`)
  }
}
if (JSON.stringify(parsed.ttBaseline) !== JSON.stringify(table.ttBaseline)) problems.push('ttBaseline: stale value')
if (parsed.ttDiscResidualCdaDeltaM2 !== table.ttDiscResidualCdaDeltaM2) problems.push('ttDiscResidualCdaDeltaM2: stale value')
if (problems.length === 0) problems.push('formatting differs from the generator output')

console.error(`[equipment-physics] ${path.relative(repoRoot, outputPath)} is out of date with the speed data:`)
for (const problem of problems.slice(0, 20)) console.error(`  - ${problem}`)
if (problems.length > 20) console.error(`  ... and ${problems.length - 20} more`)
console.error('Run `npm run equipment-physics:compute` and commit the result.')
process.exit(1)
