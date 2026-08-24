// Compare bike frames across upgrade levels, on one route or across the whole
// catalogue. Diagnostic only - nothing in the app runs this.
//
//   # one route, every level, for a few bikes
//   node scripts/upgrade-levels/compare-bike-levels.mjs \
//     --route=road-to-sky --bikes="Canyon Speedmax CFR,Cadex Tri"
//
//   # find every route where one bike/level beats another
//   node scripts/upgrade-levels/compare-bike-levels.mjs \
//     --crossover="Canyon Speedmax CFR@4,Cadex Tri@5"
//
// Options: --weight=75 --height=180 --wkg=3.5 --top=12
import { loadSharedModule } from '../route-surfaces/loadShared.mjs'

const { getRouteBySlug, getRoutesWithMeta } = loadSharedModule('shared/utils/catalog.ts')
const { classifyBikeFrame } = loadSharedModule('shared/utils/classifyBikeFrame.ts')
const { estimateFinishTimeSec } = loadSharedModule('shared/utils/finishTime.ts')
const { getWheelsets } = loadSharedModule('shared/utils/wheelsets.ts')
const { FRAME_UPGRADE_SCHEMES } = loadSharedModule('shared/data/frameUpgradeSchemes.ts')
const { FRAME_SPEED_DATA, TT_FRAME_SPEED_DATA } = loadSharedModule('shared/data/frameSpeedData.ts')

const args = Object.fromEntries(process.argv.slice(2)
  .filter(a => a.startsWith('--'))
  .map((a) => {
    const i = a.indexOf('=')
    return i === -1 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]
  }))

const rider = { kg: Number(args.weight ?? 75), cm: Number(args.height ?? 180), wkg: Number(args.wkg ?? 3.5) }
const topN = Number(args.top ?? 12)

// A frame-only comparison still has to give each frame the wheels a rider
// would actually put on it for that route, or the result flatters whichever
// frame the one fixed wheelset happens to suit. It especially flatters
// fixed-wheel frames (Tron, Espada, PROJECT 74): their measurement covers the
// whole frame+wheel unit, so they always "have" their own wheels while every
// swappable frame is stuck with whatever was chosen here.
const FLAT_WHEEL = 'DTSwiss ARC 1100 DICUT 85/Disc'
const CLIMB_WHEEL = 'Princeton Wake 6560 Lava'

const wheelsets = getWheelsets()
const byName = (n) => {
  const w = wheelsets.find(x => x.name === n)
  if (!w) {
    console.error(`Unknown wheelset "${n}"`)
    process.exit(1)
  }
  return w
}
const measuredRoadWheels = wheelsets.filter(w => w.crrClass === 'road' && w.physics)
const flatWheel = byName(FLAT_WHEEL)
const climbWheel = byName(CLIMB_WHEEL)

// `auto` gives every frame its own best wheelset per route - the closest match
// to what the app's ranked pages actually show, and the fairest comparison.
const wheelMode = args.wheels ? String(args.wheels) : 'terrain'
const forcedWheel = wheelMode !== 'terrain' && wheelMode !== 'auto' ? byName(wheelMode) : undefined
const isClimb = route => route.terrain.category === 'hilly' || route.terrain.category === 'mountainous'

const isTT = name => name in TT_FRAME_SPEED_DATA
const cache = new Map()
function frame(name, level) {
  const key = `${name}|${level}`
  if (!cache.has(key)) {
    if (!FRAME_SPEED_DATA[name] && !TT_FRAME_SPEED_DATA[name]) {
      console.error(`No measured speed data for "${name}" - its level has no effect. Check the exact zwift-data spelling.`)
      process.exit(1)
    }
    cache.set(key, classifyBikeFrame({ id: 1, name, modelYear: 2024, isTT: isTT(name) }, level))
  }
  return cache.get(key)
}

function wheelFor(route, f) {
  if (f.hasFixedWheels) return undefined
  if (forcedWheel) return forcedWheel
  if (wheelMode === 'auto') {
    return measuredRoadWheels.reduce((best, w) => {
      const a = estimateFinishTimeSec(route, f, w, rider.kg, rider.cm, rider.kg * rider.wkg)
      const b = estimateFinishTimeSec(route, f, best, rider.kg, rider.cm, rider.kg * rider.wkg)
      return a < b ? w : best
    })
  }
  return isClimb(route) ? climbWheel : flatWheel
}

function time(route, name, level) {
  const f = frame(name, level)
  return estimateFinishTimeSec(route, f, wheelFor(route, f), rider.kg, rider.cm, rider.kg * rider.wkg)
}
const schemeOf = (n) => {
  const s = FRAME_UPGRADE_SCHEMES[n]
  return s ? `${s.axis}/${s.tier}` : 'unknown'
}
const parseBikeAtLevel = (s) => {
  const [n, l] = s.split('@')
  return { name: n.trim(), level: Number(l ?? 5) }
}

const wheelDescription = forcedWheel
  ? forcedWheel.name
  : wheelMode === 'auto'
    ? 'auto (fastest measured road wheelset per frame + route)'
    : `${FLAT_WHEEL} on flat/rolling, ${CLIMB_WHEEL} on hilly/mountainous`
console.log(`rider ${rider.kg}kg / ${rider.cm}cm @ ${rider.wkg} W/kg (${(rider.kg * rider.wkg).toFixed(0)}W)`)
console.log(`wheels: ${wheelDescription}`)
console.log('fixed-wheel frames (Tron, Espada, PROJECT 74) always use their own integrated wheels\n')

if (args.crossover) {
  const [a, b] = String(args.crossover).split(',').map(parseBikeAtLevel)
  console.log(`Where does ${a.name} @L${a.level} (${schemeOf(a.name)}) beat ${b.name} @L${b.level} (${schemeOf(b.name)})?\n`)

  const rows = getRoutesWithMeta()
    .filter(r => r.distance >= 5)
    .map(r => ({ r, d: time(r, a.name, a.level) - time(r, b.name, b.level) }))
    .sort((x, y) => x.d - y.d)

  const wins = rows.filter(x => x.d < 0)
  const line = x => `  ${x.r.terrain.climbRatio.toFixed(1).padStart(5)} m/km ${x.r.distance.toFixed(1).padStart(6)}km  ${x.r.name.padEnd(36)} ${x.d >= 0 ? '+' : ''}${x.d.toFixed(2)}s`
  console.log(`  BEST for ${a.name} @L${a.level}:`)
  rows.slice(0, topN).forEach(x => console.log(line(x)))
  console.log(`\n  WORST for ${a.name} @L${a.level}:`)
  rows.slice(-5).forEach(x => console.log(line(x)))
  console.log(`\n  Wins on ${wins.length} of ${rows.length} routes.`)
  if (wins.length) {
    const rs = wins.map(w => w.r.terrain.climbRatio)
    console.log(`  All wins are at ${Math.min(...rs).toFixed(1)}-${Math.max(...rs).toFixed(1)} m/km.`)
  }
  process.exit(0)
}

const slugs = String(args.route ?? 'tempus-fugit,sand-and-sequoias,road-to-sky').split(',')
const bikes = String(args.bikes ?? 'Canyon Speedmax CFR,Cadex Tri').split(',').map(s => s.trim())

for (const slug of slugs) {
  const route = getRouteBySlug(slug.trim())
  if (!route) {
    console.error(`Unknown route slug "${slug}"`)
    process.exit(1)
  }
  console.log(`=== ${route.name}  ${route.distance.toFixed(1)}km / ${route.elevation}m (${route.terrain.climbRatio.toFixed(1)} m/km, ${route.terrain.category}) ===`)
  console.log(`  wheels: ${bikes.map(b => `${b} -> ${wheelFor(route, frame(b, 5))?.name ?? 'integrated'}`).join('; ')}`)
  console.log(`  lvl | ${bikes.map(b => b.slice(0, 20).padStart(21)).join(' |')}`)
  const at5 = bikes.map(b => time(route, b, 5))
  for (let l = 0; l <= 5; l++) {
    const t = bikes.map(b => time(route, b, l))
    console.log(`   ${l}  | ${t.map(x => `${x.toFixed(1)}s`.padStart(21)).join(' |')}`)
  }
  console.log(`  vs same bike @L5: ${bikes.map((b, i) => `${b}: ${(time(route, b, 0) - at5[i]).toFixed(1)}s to gain`).join('; ')}`)
  console.log(`  schemes: ${bikes.map(b => `${b} = ${schemeOf(b)}`).join('; ')}\n`)
}
