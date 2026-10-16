#!/usr/bin/env node
// (Re)generates shared/data/standings.generated.json - the timings the Bikes
// and Wheels pages average across routes (see **Standings** in CONTEXT.md) -
// or, with `--check`, fails if the committed file was computed from other
// equipment physics or another default rider than the ones in the repo now
// (wired into `npm run validate`, which the pre-commit hook and the build run).
//
// What it times, per catalog route, for the rider every page is prerendered
// with (`DEFAULT_RIDER_INPUTS`):
//
// - The route page's own Ranking, every frame on one page: the query the page
//   sends (`buildRecommendQuery`) with the category opened to every frame, so
//   road and TT frames both get a row, run through the same pipeline the
//   recommend endpoint runs (`runRecommendPipeline`). A frame's time here is
//   its row's time on the route page - same window, same wheel confirmation.
// - The Wheel alternatives of the fastest road frame and the fastest TT frame
//   that take wheels - the list rank 1's row opens on the route page. A frame
//   with fixed wheels (the Concept Z1) has no wheel list, so the first frame
//   below it that takes wheels stands in.
//
// Why it is precomputed rather than answered per request: it is ~750
// integrations per route (measured: 610 for the frames, 134 for the two wheel
// lists) - 1s of CPU for Hilly Route, 8s for the Gran Fondo on a recent
// laptop - so a ranking over every route is minutes of CPU, against a 30s
// per-request limit (see `recommendLimits.ts`). The times only change with
// the physics, the speed data or the default rider, so they are computed
// here, on several cores at once (~3.5 minutes for every route on 8), and
// committed.
//
// The check is cheap on purpose - it runs in every pre-commit. It compares a
// fingerprint of the inputs that change the numbers: the equipment physics
// table, the measured frames and wheels, and the default rider. A route the
// catalog gained since is not a failure: it has no standings until the next
// run, and the pages count only the routes they have times for. A change to
// the physics or ranking CODE is not fingerprinted - rerun this after one, as
// docs/standings.md says.
//
// Usage: node scripts/standings/compute-standings.mjs [--check] [--workers N] [--only slug,slug]
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainThread, parentPort, Worker } from 'node:worker_threads'
import { createJiti } from 'jiti'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outputPath = path.join(repoRoot, 'shared/data/standings.generated.json')

/** Bump when what is timed, or how, changes - it is part of the fingerprint. */
const STANDINGS_VERSION = 1

/** The categories the pages offer: every measured frame is one of these two. */
const CATEGORIES = ['standard', 'tt']

/** Deeper than any pool: every row on one page. */
const WHOLE_POOL = 10_000

// Modules load through jiti (Nuxt's own TypeScript loader) as in
// `scripts/recommend-parity/run.mjs`, so the server pipeline runs unbundled
// and unchanged. Its Nitro globals are never reached on this path; they are
// stubbed only so a module that names one at load time still loads.
globalThis.useRuntimeConfig ??= () => ({ public: {} })
globalThis.createError ??= init => Object.assign(new Error(init.message || init.statusMessage), init)
const jiti = createJiti(import.meta.url)
const load = specifier => jiti.import(path.join(repoRoot, specifier))

const round1 = seconds => Math.round(seconds * 10) / 10

if (isMainThread) await main()
else await worker()

async function main() {
  const check = process.argv.includes('--check')
  const catalog = await load('shared/utils/catalog.ts')
  const fingerprint = await inputFingerprint()

  if (check) {
    const committed = JSON.parse(readFileSync(outputPath, 'utf8'))
    const missing = catalog.getRoutesWithMeta().filter(route => !committed.routes.some(entry => entry.slug === route.slug))
    if (missing.length) console.warn(`standings: ${missing.length} route(s) not timed yet (${missing.map(route => route.slug).join(', ')}) - run \`npm run standings:compute\` to add them`)
    if (committed.fingerprint !== fingerprint) {
      console.error('standings: shared/data/standings.generated.json was computed from other equipment physics or another default rider. Run `npm run standings:compute` and commit the result.')
      process.exit(1)
    }
    console.log(`standings: up to date (${committed.routes.length} routes)`)
    return
  }

  const onlyArg = argValue('--only')
  const only = onlyArg ? new Set(onlyArg.split(',')) : undefined
  // Longest first, so the slowest routes start early and no worker is left
  // with one at the end.
  const routes = catalog.getRoutesWithMeta()
    .filter(route => !only || only.has(route.slug))
    .sort((a, b) => (b.distance + (b.leadInDistance ?? 0)) - (a.distance + (a.leadInDistance ?? 0)))
  const workerCount = Math.max(1, Math.min(routes.length, Number(argValue('--workers')) || Math.min(8, availableParallelism() - 1)))
  console.log(`standings: timing ${routes.length} routes on ${workerCount} workers`)

  const started = Date.now()
  const results = []
  const queue = routes.map(route => route.slug)
  await Promise.all(Array.from({ length: workerCount }, () => new Promise((resolve, reject) => {
    const thread = new Worker(fileURLToPath(import.meta.url))
    const next = () => {
      const slug = queue.shift()
      if (slug) thread.postMessage(slug)
      else thread.terminate().then(resolve, reject)
    }
    thread.on('message', (message) => {
      if (message.ready) return next()
      results.push(message)
      if (message.skipped) console.warn(`standings: ${message.slug} skipped - ${message.skipped}`)
      if (results.length % 25 === 0 || results.length === routes.length) {
        console.log(`standings: ${results.length}/${routes.length} routes, ${Math.round((Date.now() - started) / 1000)}s`)
      }
      next()
    })
    thread.on('error', reject)
  })))

  const timed = results.filter(result => !result.skipped)
  if (only && existsSync(outputPath)) {
    // A partial run refreshes the routes it was given and keeps the rest.
    const previous = JSON.parse(readFileSync(outputPath, 'utf8'))
    if (previous.fingerprint !== fingerprint) throw new Error('--only needs a committed file computed from the same inputs; run without it')
    timed.push(...previous.routes.filter(entry => !only.has(entry.slug)).map(fromCommitted(previous)))
  }
  writeFileSync(outputPath, serialise(assemble(timed, fingerprint)))
  console.log(`standings: wrote ${timed.length} routes in ${Math.round((Date.now() - started) / 1000)}s`)
}

/**
 * What the times depend on besides code: the equipment physics table, the
 * measured equipment (names, categories, paints) and the default rider.
 * Estimated equipment is left out - the default ranking never sees it - so a
 * catalog bump that only adds unmeasured frames does not make this stale.
 */
async function inputFingerprint() {
  const { getFrames } = await load('shared/utils/catalog.ts')
  const { getWheelsets } = await load('shared/utils/wheelsets.ts')
  const { DEFAULT_RIDER_INPUTS: rider } = await load('shared/utils/recommendQuery.ts')
  const hash = createHash('sha256')
  hash.update(JSON.stringify({
    version: STANDINGS_VERSION,
    rider: [rider.weightKg, rider.heightCm, rider.powerW, rider.defaultUnownedLevel, rider.draftMode, rider.verifiedOnly, rider.includeHaloBikes],
    frames: getFrames().filter(frame => frame.confidence === 'measured').map(frame => [frame.id, frame.name, frame.category]),
    wheels: getWheelsets().filter(wheelset => wheelset.confidence === 'measured').map(wheelset => [wheelset.key, wheelset.name, wheelset.crrClass])
  }))
  hash.update(readFileSync(path.join(repoRoot, 'shared/data/equipmentPhysics.generated.json')))
  return hash.digest('hex')
}

/** A committed route entry, back in the shape a worker reports. */
function fromCommitted(previous) {
  return entry => ({
    slug: entry.slug,
    frames: Object.fromEntries(previous.frames.flatMap((frame, index) => entry.frameSec[index] === null ? [] : [[frame.id, entry.frameSec[index]]])),
    wheels: Object.fromEntries(Object.entries(entry.wheels).map(([category, list]) => [category, {
      frameId: list.frameId,
      times: Object.fromEntries(previous.wheels.flatMap((wheel, index) => list.sec[index] === null ? [] : [[wheel.key, list.sec[index]]]))
    }])),
    frameInfo: previous.frames,
    wheelInfo: previous.wheels
  })
}

/** Every route's times as one table: frames and wheels each in one fixed order, a route per row. */
function assemble(results, fingerprint) {
  const frames = new Map()
  const wheels = new Map()
  for (const result of results) {
    for (const frame of result.frameInfo) frames.set(frame.id, frame)
    for (const wheel of result.wheelInfo) wheels.set(wheel.key, wheel)
  }
  const frameList = [...frames.values()].sort((a, b) => a.id - b.id)
  const wheelList = [...wheels.values()].sort((a, b) => a.key.localeCompare(b.key, 'en'))
  const rider = results[0]?.rider ?? JSON.parse(readFileSync(outputPath, 'utf8')).rider
  return {
    fingerprint,
    rider,
    frames: frameList,
    wheels: wheelList,
    routes: [...results].sort((a, b) => a.slug.localeCompare(b.slug, 'en')).map(result => ({
      slug: result.slug,
      frameSec: frameList.map(frame => result.frames[frame.id] ?? null),
      wheels: Object.fromEntries(CATEGORIES.filter(category => result.wheels[category]).map(category => [category, {
        frameId: result.wheels[category].frameId,
        sec: wheelList.map(wheel => result.wheels[category].times[wheel.key] ?? null)
      }]))
    }))
  }
}

/** One route per line, so a regenerated file diffs by route rather than by number. */
function serialise(table) {
  const lines = (entries, indent) => entries.map(entry => `${indent}${JSON.stringify(entry)}`).join(',\n')
  return `{
  "fingerprint": ${JSON.stringify(table.fingerprint)},
  "rider": ${JSON.stringify(table.rider)},
  "frames": [
${lines(table.frames, '    ')}
  ],
  "wheels": [
${lines(table.wheels, '    ')}
  ],
  "routes": [
${lines(table.routes, '    ')}
  ]
}
`
}

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function worker() {
  const { getRouteBySlug } = await load('shared/utils/catalog.ts')
  const { getWheelsets } = await load('shared/utils/wheelsets.ts')
  const { buildRecommendQuery, DEFAULT_RIDER_INPUTS } = await load('shared/utils/recommendQuery.ts')
  const { rideForRoute } = await load('shared/utils/recommendRide.ts')
  const { comboPhysicsKey, RouteSimulationStallError } = await load('shared/utils/physics/index.ts')
  const { recommendRouteQuerySchema } = await load('server/utils/apiQuerySchemas.ts')
  const { rankingRequestFromQuery } = await load('server/utils/rankRide.ts')
  const { runRecommendPipeline } = await load('server/utils/recommendPipeline.ts')

  // The fresh visitor's query, as every route page is prerendered with it,
  // with only the category opened: a frame's time does not depend on which
  // other frames share the page.
  const inputs = { ...DEFAULT_RIDER_INPUTS, bikeCategory: 'all' }
  // Every wheel a road or TT frame takes under the default filters - the
  // pool behind each Wheel alternatives list below.
  const wheelPool = getWheelsets().filter(wheelset => wheelset.crrClass === 'road' && (!inputs.verifiedOnly || wheelset.confidence === 'measured'))

  async function timeRoute(slug) {
    const route = getRouteBySlug(slug)
    const query = recommendRouteQuerySchema.parse(buildRecommendQuery(inputs, { course: { kind: 'route', slug } }))
    const request = rankingRequestFromQuery(query)
    const ride = rideForRoute(route, query.laps, query.excludeTT)
    const ranked = await runRecommendPipeline(undefined, { ...request, options: { ...request.options, page: { offset: 0, limit: WHOLE_POOL } } }, ride)

    const frames = {}
    const frameInfo = []
    for (const row of ranked.combos) {
      frames[row.frame.id] = round1(row.finishTimeSec)
      frameInfo.push({ id: row.frame.id, name: row.frame.name, category: row.frame.category, ...(row.frame.otherPaints ? { otherPaints: row.frame.otherPaints } : {}) })
    }

    const wheels = {}
    const wheelInfo = new Map()
    for (const category of CATEGORIES) {
      const timedOn = ranked.combos.find(row => row.frame.category === category && !row.frame.hasFixedWheels)
      if (!timedOn) continue
      const list = await runRecommendPipeline(undefined, {
        ...request,
        options: { ...request.options, category, wheelsForFrame: timedOn.frame.id, page: { offset: 0, limit: WHOLE_POOL } }
      }, ride)
      // The list collapses wheels that time identically - a wheel's
      // colourways - into one row, so every wheel the frame takes is looked
      // up by its physics instead of by the row that happened to lead.
      const byPhysics = new Map(list.combos.map(row => [comboPhysicsKey(row), row.finishTimeSec]))
      const times = {}
      for (const row of list.combos) wheelInfo.set(row.wheelset.key, { key: row.wheelset.key, name: row.wheelset.name })
      for (const wheelset of wheelPool) {
        const seconds = byPhysics.get(comboPhysicsKey({ frame: list.combos[0].frame, wheelset }))
        if (seconds === undefined) continue
        times[wheelset.key] = round1(seconds)
        wheelInfo.set(wheelset.key, { key: wheelset.key, name: wheelset.name })
      }
      wheels[category] = { frameId: timedOn.frame.id, times }
    }

    const rider = { weightKg: query.weightKg, heightCm: query.heightCm, powerW: query.powerW, upgradeStage: query.defaultUnownedLevel, draftMode: DEFAULT_RIDER_INPUTS.draftMode }
    return { slug, frames, frameInfo, wheels, wheelInfo: [...wheelInfo.values()], rider }
  }

  parentPort.on('message', async (slug) => {
    try {
      parentPort.postMessage(await timeRoute(slug))
    } catch (error) {
      // A rider who cannot hold a route's grade at the default power is a
      // fact about the route, not a fault: it has no standings.
      if (error instanceof RouteSimulationStallError) parentPort.postMessage({ slug, skipped: error.message })
      else throw error
    }
  })
  parentPort.postMessage({ ready: true })
}
