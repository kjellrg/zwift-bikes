// Checks what each race's tactical note claims about its equipment against the
// physics, for `validate-events.mjs --notes`. Opt-in because it needs the
// network and a TypeSafe key, and the build runs the validator without either.
//
// A note is prose the curator wrote once; the ranking beside it is recomputed
// on every data update. When a note says "the climbing is too shallow to pay
// for a lightweight build" and a recalibration or a new frame makes the
// lightweight build the faster one, the page contradicts itself and nothing
// else notices.
//
// Two halves, kept apart:
//   - What the note claims is a judgment over prose: Jev (typesafe.ai) reads it
//     as one Choice - climbing pays, aerodynamics win, or it doesn't say.
//   - What the physics says is arithmetic: the full aero build and the
//     lightweight build are each simulated over every category group's course,
//     under the race's own rules, for the site's default rider.
// Code compares the two. Only a confident claim the physics contradicts is a
// warning; an uncertain answer, a note that says neither, or an unreachable
// model leaves the validator's result unchanged. Every raw answer is printed as
// a note next to the numbers, so the threshold can be tuned.
//
// The builds are the extremes of the bot-test data, which is what the notes'
// own language compares ("a full aero build", "a lightweight build"): the frame
// with the best flat result and the frame with the best climb result, each on
// the road wheelset with the matching best result. Fixed-wheel and purchasable
// Halo frames are left out, as the default ranking leaves them out. Where TT
// frames are legal both builds are TT frames, because there the notes compare
// TT setups with each other, not with a road bike.

import { bikeFrames } from 'zwift-data'
import { loadSharedModule } from '../route-surfaces/loadShared.mjs'

const MODEL = 'jev-latest'
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
/** A claim below this probability is treated as unread, never as a contradiction. */
const CLAIM_THRESHOLD = 0.8

const { isRacePublishable, ttBikesAllowed, draftingAllowed } = loadSharedModule('shared/utils/events.ts')
const { getRouteBySlug } = loadSharedModule('shared/utils/catalog.ts')
const { getWheelsets } = loadSharedModule('shared/utils/wheelsets.ts')
const { classifyBikeFrame, FIXED_WHEEL_FRAMES, PURCHASABLE_HALO_FRAMES } = loadSharedModule('shared/utils/classifyBikeFrame.ts')
const { FRAME_SPEED_DATA, TT_FRAME_SPEED_DATA } = loadSharedModule('shared/data/frameSpeedData.ts')
const { WHEEL_SPEED_DATA } = loadSharedModule('shared/data/wheelSpeedData.ts')
const { simulateRoute } = loadSharedModule('shared/utils/physics/simulator.ts')
const { geometryForRouteLaps } = loadSharedModule('shared/utils/physics/routeGeometry.ts')
const { resolveDraft, draftOf, TTT_DEFAULT_RIDERS } = loadSharedModule('shared/utils/physics/draft.ts')
const { DEFAULT_WEIGHT_KG, DEFAULT_HEIGHT_CM, DEFAULT_POWER_W } = loadSharedModule('shared/utils/riderBounds.ts')

const CLAIM_QUESTION = {
  type: 'choice',
  instructions: 'What does `race.note` claim about whether a light, climbing-oriented bike setup pays off in this race?',
  criteria: {
    climb: 'The note says climbing performance or a lighter setup makes a real difference in this race.',
    aero: 'The note says aerodynamics decide this race, or that the climbing is not enough to pay for a lighter setup.',
    none: 'The note does not say whether climbing or aerodynamics decides the equipment choice.'
  }
}

const rider = { weightKg: DEFAULT_WEIGHT_KG, heightCm: DEFAULT_HEIGHT_CM, powerW: DEFAULT_POWER_W }

const bestBy = (names, table, key) => names.filter(name => table[name]).sort((a, b) => table[b][key] - table[a][key])[0]

function referenceBuilds() {
  const frameNames = bikeFrames
    .filter(frame => !FIXED_WHEEL_FRAMES.has(frame.name) && !PURCHASABLE_HALO_FRAMES.has(frame.name))
    .map(frame => frame.name)
  const wheelsets = getWheelsets().filter(wheelset => wheelset.crrClass === 'road' && WHEEL_SPEED_DATA[wheelset.name])
  const wheelsetBy = key => wheelsets.find(wheelset => wheelset.name === bestBy(wheelsets.map(w => w.name), WHEEL_SPEED_DATA, key))
  const frame = name => classifyBikeFrame(bikeFrames.find(candidate => candidate.name === name), 5)
  const build = (frameName, wheelset) => ({ label: `${frameName} + ${wheelset.name}`, frame: frame(frameName), wheelset })
  const aeroWheels = wheelsetBy('flatGapSec')
  const lightWheels = wheelsetBy('climbGapSec')
  return {
    road: {
      aero: build(bestBy(frameNames, FRAME_SPEED_DATA, 'flatGapSec5'), aeroWheels),
      light: build(bestBy(frameNames, FRAME_SPEED_DATA, 'climbGapSec5'), lightWheels)
    },
    tt: {
      aero: build(bestBy(frameNames, TT_FRAME_SPEED_DATA, 'flatGapSec5'), aeroWheels),
      light: build(bestBy(frameNames, TT_FRAME_SPEED_DATA, 'climbGapSec5'), lightWheels)
    }
  }
}

/** Lightweight build minus full aero build, in seconds, for every group whose course resolves. Negative: the lightweight build is faster. */
function physicsGaps(race, builds) {
  const pair = ttBikesAllowed(race.format) ? builds.tt : builds.road
  const draftMode = !draftingAllowed(race.format) ? 'solo' : race.format === 'ttt' ? 'ttt' : 'race'
  const gaps = []
  for (const group of race.categories) {
    const route = group.routeSlug && getRouteBySlug(group.routeSlug)
    if (!route) continue
    const geometry = geometryForRouteLaps(route, group.laps)
    const draft = resolveDraft(draftOf({ draftMode, tttRiders: TTT_DEFAULT_RIDERS }), geometry, rider)
    const time = ({ frame, wheelset }) => simulateRoute({
      rider, frame, wheelset, geometry,
      powerSegmentsW: draft.plan?.powerSegmentsW,
      powerScaleAtSpeed: draft.powerScaleAtSpeed
    }).elapsedSec
    const aeroSec = time(pair.aero)
    const gapSec = time(pair.light) - aeroSec
    gaps.push({ group: group.label ?? group.cats.join('/'), routeName: route.name, gapSec, gapPct: (gapSec / aeroSec) * 100 })
  }
  return { pair, draftMode, gaps }
}

async function readClaim(race, apiKey) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, state: { race: { format: race.format, note: race.note } }, questions: { claim: CLAIM_QUESTION } }),
    signal: AbortSignal.timeout(15_000)
  })
  if (!response.ok) throw new Error(`TypeSafe answered ${response.status}`)
  const answer = (await response.json()).answers.claim
  return { choice: answer.choice, probability: answer.probabilities[answer.choice] }
}

const seconds = gapSec => `${Math.abs(gapSec).toFixed(1)} s`

/**
 * @returns {Promise<{ warnings: string[], notes: string[] }>} warnings for contradicted claims, notes for every raw reading
 */
export async function checkRaceNotes(seasons, apiKey = process.env.TYPESAFE_API_KEY) {
  if (!apiKey) return { warnings: [], notes: ['--notes skipped: TYPESAFE_API_KEY is not set'] }

  const builds = referenceBuilds()
  const notes = [
    `--notes road builds: aero ${builds.road.aero.label}, light ${builds.road.light.label}`,
    `--notes TT builds: aero ${builds.tt.aero.label}, light ${builds.tt.light.label}`
  ]
  const warnings = []

  const races = seasons.flatMap(season => season.rounds.flatMap(round => round.races
    .filter(race => race.note && isRacePublishable(race))
    .map(race => ({ where: `${season.slug}/${race.slug}`, race }))))

  let claims
  try {
    claims = await Promise.all(races.map(({ race }) => readClaim(race, apiKey)))
  } catch (error) {
    return { warnings: [], notes: [...notes, `--notes skipped: ${error.message}`] }
  }

  for (const [i, { where, race }] of races.entries()) {
    const claim = claims[i]
    const { pair, draftMode, gaps } = physicsGaps(race, builds)
    const numbers = gaps.map(gap => `${gap.group} ${gap.gapSec >= 0 ? '+' : ''}${gap.gapSec.toFixed(1)} s (${gap.gapPct.toFixed(2)}%)`).join(', ') || 'no resolvable course'
    notes.push(`${where}: note reads "${claim.choice}" at ${claim.probability.toFixed(2)}; lightweight minus aero, ${draftMode}: ${numbers}`)

    if (claim.probability < CLAIM_THRESHOLD) continue
    for (const gap of gaps) {
      const onCourse = `on ${gap.routeName}${gaps.length > 1 ? ` (${gap.group})` : ''}`
      if (claim.choice === 'climb' && gap.gapSec >= 0) {
        warnings.push(`${where}: the note says a lighter setup pays off, but ${onCourse} the lightweight build (${pair.light.label}) is still ${seconds(gap.gapSec)} slower than the full aero build (${pair.aero.label}) for the default rider`)
      }
      if (claim.choice === 'aero' && gap.gapSec < 0) {
        warnings.push(`${where}: the note says aerodynamics win, but ${onCourse} the lightweight build (${pair.light.label}) is ${seconds(gap.gapSec)} faster than the full aero build (${pair.aero.label}) for the default rider`)
      }
    }
  }
  return { warnings, notes }
}
