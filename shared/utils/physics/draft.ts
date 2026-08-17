import type { RouteGeometry } from '../../types/physics'
import { speedForPower } from './forces'

/**
 * Draft modes the recommendation pipeline understands. `solo` is today's
 * behavior - one rider, no draft anywhere (which is also exactly how
 * ZwiftInsider's bot tests are ridden, so all equipment data stays valid).
 * `ttt` models a Team Time Trial paceline. `race` models a mass-start bunch;
 * both extend the same speed-dependence curve below
 * (`draftSavingsSpeedScale`) and differ only in the position/rotation model.
 *
 * Race semantics: the rider's entered power is **their own mechanical average
 * for the whole race**, exactly as in solo and TTT mode - not their normalised
 * power, which runs ~5% higher and would feed the model speed the rider never
 * produced. The pack itself is assumed rather than modelled per-rider: there
 * is no rider count, no position and no rotation, because a racer does not
 * occupy a position in a mass start, they occupy a distribution of positions.
 * What `RACE_DRAFT_SAVING` measures is the time-weighted expectation over that
 * whole distribution, taken from real race fields rather than from a pack
 * model - see `docs/race-drafting.md`.
 *
 * TTT semantics: the rider's entered power is **their own average over a full
 * rotation** - the same thing it means in solo mode, i.e. what they can
 * actually sustain for the effort. This matches how real TTT calculators are
 * framed (ZwiftInsider's own calculator, Target Watts and others all take each
 * rider's FTP/sustainable effort and *derive* the per-position pull watts).
 * The group therefore rides at the speed a lone rider producing
 * `riderPowerW / tttAveragePowerFactor(N)` would hold: the rider pushes well
 * above their average while pulling and sits well below it in the wheels, and
 * it averages back out to what they entered. An 8-rider paceline moves at the
 * speed a solo rider at ~1.38x their power would hold on the flat - which is
 * the entire point of riding a TTT.
 *
 * An earlier version of this module treated the entered watts as the FRONT
 * rider's power. That is defensible physics (Zwift gives the front no draft)
 * but useless as a tool: it makes TTT and solo mode produce identical times,
 * since the group by definition moves at the front rider's solo speed.
 *
 * IMPORTANT: never feed draft factors into `equipment.ts`'s
 * `steadyStateSpeedMps`/`solveEquipmentDelta` - those invert ZwiftInsider's
 * no-draft bot test protocol and must stay draft-free. That applies to race
 * mode exactly as it does to TTT: the equipment solvers reproduce a bot test
 * ridden alone, and a draft factor anywhere near them corrupts every frame and
 * wheel CdA the site owns.
 */
export type DraftMode = 'solo' | 'ttt' | 'race'

export const TTT_MIN_RIDERS = 2
export const TTT_MAX_RIDERS = 8
export const TTT_DEFAULT_RIDERS = 8

export function clampTttRiders(riders: number): number {
  if (!Number.isFinite(riders)) return TTT_DEFAULT_RIDERS
  return Math.min(TTT_MAX_RIDERS, Math.max(TTT_MIN_RIDERS, Math.round(riders)))
}

/**
 * Bounds for the optional team climb pace. A paceline that has broken up on a
 * long climb is riding at each rider's own sustainable climbing effort, which
 * realistically sits somewhere between a steady tempo and a hard sustained
 * effort - hence 2 W/kg at the low end and 9 at the high end, in 0.1 steps.
 */
export const TTT_MIN_CLIMB_WKG = 2
export const TTT_MAX_CLIMB_WKG = 9

/**
 * Clamps a team climb pace to the supported range, or returns `undefined` for
 * "not set" (climbs ridden at the rider's normal power). Snapped to the 0.1
 * the controls step in: a slider that accumulates `min + n * step` in binary
 * floating point hands back values like 4.300000000000001, which would show up
 * verbatim in the query string and defeat response caching for no reason.
 */
export function clampTttClimbWkg(climbWkg: number | undefined): number | undefined {
  if (typeof climbWkg !== 'number' || !Number.isFinite(climbWkg) || climbWkg <= 0) return undefined
  return Math.round(Math.min(TTT_MAX_CLIMB_WKG, Math.max(TTT_MIN_CLIMB_WKG, climbWkg)) * 10) / 10
}

/**
 * Power saved vs the front rider, by paceline position (index 0 = front),
 * at flat TTT speeds. Measured by ZwiftInsider's 4-bot single-file TTT test
 * on TT bikes under **Pack Dynamics 4.1**, the current pack model
 * (https://zwiftinsider.com/tt-drafting-pd41/): at 300 W on the front the
 * following riders hold 234 W, 214 W and 198 W - savings of 22%, 28.7% and
 * 34%. PD4.1 deliberately trimmed the draft back from PD4 (24/30/35) while
 * staying far stronger than PD3.
 *
 * Positions 5-8 are ASSUMED to plateau at the 4th wheel's 34% - ZwiftInsider
 * tests four bots and publishes nothing deeper, and the marginal gain from
 * 3rd to 4th wheel is already small. Note this plateau does NOT make team
 * size irrelevant past four: a larger rotation means each rider spends a
 * smaller *fraction* of the time on the front, which is where the whole cost
 * is (see `tttAveragePowerFactor`).
 */
export const TTT_POSITION_POWER_SAVINGS = [0, 0.22, 0.287, 0.34, 0.34, 0.34, 0.34, 0.34] as const

/**
 * Average power of an N-rider paceline as a fraction of the front rider's
 * power, at flat TTT speeds - each rider spends 1/N of the time in each
 * position of an even rotation, so the group average is the mean of the
 * per-position requirements.
 *
 * N=2 -> 0.890, N=3 -> 0.831, N=4 -> 0.78825, N=8 -> 0.72413. The N=4 value
 * reproduces ZwiftInsider's own "each rider would average 237 W" for a 300 W
 * front (0.78825 x 300 = 236.5), which is the cross-check that the position
 * numbers above were read correctly.
 *
 * Team size keeps mattering well past four even though the per-position
 * savings plateau there: a 4-rider team spends 1/4 of its time on the front
 * at full power, an 8-rider team only 1/8. That is a ~9% difference in
 * sustained effort between a 4- and an 8-rider team (0.788 vs 0.724), worth
 * minutes over a TTT - which is why the rider count is a real input and not a
 * cosmetic one.
 */
export function tttAveragePowerFactor(riders: number): number {
  const n = clampTttRiders(riders)
  let sum = 0
  for (let position = 0; position < n; position++) sum += 1 - TTT_POSITION_POWER_SAVINGS[position]!
  return sum / n
}

/**
 * How the per-position savings above scale with group speed. Draft is an
 * aerodynamic effect, so it collapses at climbing speeds and grows on fast
 * descents - ZwiftInsider measured single-rider draft savings of ~25% on
 * flats (~42 km/h), ~10-11% on a moderate climb (~27 km/h), only ~2-3% on a
 * steep climb (~18 km/h), and up to ~46% on descents
 * (https://zwiftinsider.com/draft-savings/). Normalizing those to the flat
 * value (scale 1.0 at ~42 km/h) gives anchors ~0.43 at 27 km/h and ~0.1 at
 * 18 km/h; a clamped power law `(v / 11.7)^2` fits them: 1.0 at 11.7 m/s
 * (42 km/h), 0.41 at 7.5 m/s (27 km/h), 0.18 at 5 m/s (18 km/h), capped at
 * 1.4 (46/25 ~ 1.8 was measured in a supertuck-speed descent; 1.4 keeps the
 * extrapolation conservative for ordinary fast descents). This is a 4-anchor
 * fit, not per-position measured data - kept isolated here so better data
 * can replace it without touching callers.
 */
/** The flat-TTT speed the scale is normalized to (~42 km/h) - scale 1.0 here. Named so `CLIMB_BLOCK_MAX_SPEED_MPS` can invert the curve against the same anchor. */
export const DRAFT_SCALE_REFERENCE_SPEED_MPS = 11.7

export function draftSavingsSpeedScale(speedMps: number): number {
  const scale = (speedMps / DRAFT_SCALE_REFERENCE_SPEED_MPS) ** 2
  return Math.min(1.4, Math.max(0, scale))
}

/** `tttAveragePowerFactor`, with each position's savings scaled to the group's speed - approaches 1 (no benefit) at steep-climb speeds. */
export function tttAveragePowerFactorAtSpeed(riders: number, speedMps: number): number {
  const n = clampTttRiders(riders)
  const scale = draftSavingsSpeedScale(speedMps)
  let sum = 0
  for (let position = 0; position < n; position++) sum += 1 - TTT_POSITION_POWER_SAVINGS[position]! * scale
  return sum / n
}

/**
 * What a paceline's power output is worth, as a multiplier on each rider's
 * own sustainable power: `1 / tttAveragePowerFactorAtSpeed`. This is the
 * number that makes TTT mode mean something - a rider entering 240 W in an
 * 8-rider team drives the group as if they were a solo rider at ~331 W on
 * the flat, because that is what the group's combined effort actually
 * produces when everyone averages 240 W.
 *
 * Speed-dependent, and evaluated against the CURRENT speed at each simulator
 * timestep (see `SimulateRouteOptions.powerScaleAtSpeed`): the benefit fades
 * to nothing as the group slows on a steep climb and grows on a descent,
 * with no separate per-grade bookkeeping. Stable despite being a feedback
 * loop - the scale saturates (`draftSavingsSpeedScale` is capped) while drag
 * keeps growing with v^3.
 */
export function tttPowerScaleAtSpeed(riders: number, speedMps: number): number {
  return 1 / tttAveragePowerFactorAtSpeed(riders, speedMps)
}

/** What a rider actually holds while pulling on the front, given their own rotation-average power - the number a TTT calculator reports as the pull target. */
export function tttFrontPullPowerW(riderPowerW: number, riders: number): number {
  return riderPowerW / tttAveragePowerFactor(riders)
}

/** What a rider sits at in the LAST wheel of the rotation - the easiest position, for the "you'll swing between X and Y watts" note. */
export function tttLastWheelPowerW(riderPowerW: number, riders: number): number {
  const n = clampTttRiders(riders)
  return tttFrontPullPowerW(riderPowerW, n) * (1 - TTT_POSITION_POWER_SAVINGS[n - 1]!)
}

/**
 * Steady-state group speed for a paceline whose riders each average
 * `riderPowerW`, on a constant grade. The draft benefit depends on the speed
 * and the speed depends on the benefit, so this is a fixed point rather than
 * a single `speedForPower` call - it converges in a couple of iterations
 * (the scale is smooth and speed grows only as roughly the cube root of
 * power, so each pass is a strong contraction). Used by the cheap closed-form
 * estimate; the simulator gets the same physics per timestep instead.
 */
export function tttGroupSpeedMps(
  riderPowerW: number,
  riders: number,
  massKg: number,
  grade: number,
  crr: number,
  cdaM2: number
): number {
  let speedMps = speedForPower(riderPowerW, massKg, grade, crr, cdaM2)
  for (let iteration = 0; iteration < 4; iteration++) {
    speedMps = speedForPower(riderPowerW * tttPowerScaleAtSpeed(riders, speedMps), massKg, grade, crr, cdaM2)
  }
  return speedMps
}

/**
 * Power saving of a typical mid-pack racer versus riding solo, at flat race
 * speeds. Field-calibrated in `docs/race-drafting.md` §5 from real ZwiftPower
 * race fields: originally five races (1313 riders, n = 430 bunch finishers,
 * pooled bunch median 31.7%), since widened to seven constant-setting races out
 * of twenty collected (1654 riders, n = 473, pooled bunch median 31.4%) - a
 * quarter-point move, well inside §11's >=1-point rule for touching this
 * number. Both under the typical-equipment scenario. 31% rather than 31.7% because ZwiftPower does not
 * publish equipment and the assumed bike moves the answer (35.4% stock, 31.7%
 * typical, 29.0% fast) - 31% is the midpoint of the plausible field, and that
 * +/-3-point band is the real error bar, larger than every other uncertainty
 * here.
 *
 * Valid ONLY under `racePowerScaleAtSpeed`'s exact transform - the constant was
 * bisected per rider under that formula against `simulateRoute`, so changing
 * the formula silently invalidates the number. Recalibrate first: see
 * `scripts/race-draft/README.md`.
 *
 * A single constant is the measured answer, not a simplification: per-category
 * constants were fitted and rejected (they buy at most 0.2 points of mean
 * absolute time error, and ~80% of the A->D gradient is a speed effect the
 * curve below already handles), and within one bunch riders who finished five
 * seconds apart imply savings spanning 17-42%, so no position-free model can
 * beat that spread.
 */
export const RACE_DRAFT_SAVING = 0.31

/**
 * What sitting in a mass-start bunch is worth, as a multiplier on the rider's
 * own race-average power: the rider covers ground like a lone rider at
 * `power x this`, because the pack let them hold their average while producing
 * less of the speed themselves.
 *
 * This exact expression is the calibration's invariant (see
 * `RACE_DRAFT_SAVING`). It is speed-dependent through the same
 * `draftSavingsSpeedScale` TTT mode uses and is evaluated against the CURRENT
 * speed at each simulator timestep, so the benefit fades on a climb and grows
 * on a descent with no per-grade bookkeeping - which is why race mode needs no
 * grade term of its own. On the flat it is 1/(1-0.31) = 1.449; on Alpe du Zwift
 * it collapses to a few percent on its own.
 *
 * `saving` is defaulted rather than hard-coded on purpose: per-category
 * constants, a "front group / typical bunch" selector, or a recalibrated value
 * all pass through here without touching a single caller.
 */
export function racePowerScaleAtSpeed(speedMps: number, saving = RACE_DRAFT_SAVING): number {
  return 1 / (1 - saving * draftSavingsSpeedScale(speedMps))
}

/**
 * Steady-state bunch speed for a rider averaging `riderPowerW` in a race, on a
 * constant grade. Same fixed point as `tttGroupSpeedMps` and for the same
 * reason - the draft benefit depends on the speed and the speed depends on the
 * benefit - converging in a couple of iterations because the scale saturates
 * while drag keeps growing with v^3. Used by the cheap closed-form estimate;
 * the simulator applies `racePowerScaleAtSpeed` per timestep instead.
 */
export function raceGroupSpeedMps(
  riderPowerW: number,
  massKg: number,
  grade: number,
  crr: number,
  cdaM2: number,
  saving = RACE_DRAFT_SAVING
): number {
  let speedMps = speedForPower(riderPowerW, massKg, grade, crr, cdaM2)
  for (let iteration = 0; iteration < 4; iteration++) {
    speedMps = speedForPower(riderPowerW * racePowerScaleAtSpeed(speedMps, saving), massKg, grade, crr, cdaM2)
  }
  return speedMps
}

/**
 * Representative physics constants used ONLY for estimating a paceline's own
 * speed on a grade (to decide how long a climb takes). Deliberately
 * combo-independent: a TTT power plan must be computed ONCE per request and
 * shared by every combo, because `orderBySimulatedTime`'s dedupe cache keys
 * simulations on `cdaM2|bikeMassKg|crrClass` only - a per-combo plan would
 * poison it. Combo-to-combo speed differences at >=3% grade are under ~2%,
 * far below the thresholds these estimates feed, so the shared plan loses
 * nothing real.
 */
const REPRESENTATIVE_CDA_M2 = 0.32
const REPRESENTATIVE_BIKE_MASS_KG = 7
const REPRESENTATIVE_CRR = 0.004

/** A stretch of route ridden at an overridden power - see `SimulateRouteOptions.powerSegmentsW`. */
export interface PowerSegmentW {
  fromM: number
  toM: number
  powerW: number
}

export interface TttClimbBlock {
  fromM: number
  toM: number
  distanceM: number
  elevationM: number
  avgGrade: number
  /** Estimated solo speed at `climbPowerW` on this block - what the qualifying test is applied to, kept so callers can explain why a block counted. */
  climbSpeedMps: number
  estDurationSec: number
}

/**
 * What a climb block models, and why the qualifying test is a SPEED and not
 * a grade.
 *
 * This detector does not model draft dying on a climb - `powerScaleAtSpeed`
 * already does that, continuously and per timestep, via
 * `draftSavingsSpeedScale`. What a block changes is the riders' own POWER:
 * on a long enough climb the rotation stops and everyone settles onto their
 * own sustainable climbing effort (`tttPowerPlan` -> `powerSegmentsW`). The
 * question is therefore "when does the team stop rotating", not "when does
 * draft stop working" - the latter needs no threshold at all.
 *
 * A grade threshold answered that question badly, because the same grade is
 * a different event for different riders. At 3%, a 2.5 W/kg rider is doing
 * 19.8 km/h with the draft worth 22% of its flat value - the rotation is
 * pointless - while a 4.0 W/kg rider is doing 27.3 km/h with it still worth
 * 42%. A speed test splits those two correctly; a grade test cannot see the
 * difference.
 *
 * So: a block qualifies once the group has slowed to where the draft is
 * worth a quarter of its flat value (`draftSavingsSpeedScale` = 0.25), which
 * is 21.1 km/h. For an 8-rider paceline that is a ~7% power advantage,
 * against ~38% on the flat - past that point the cost of holding a rotation
 * (surging to pull, gaps opening on the gradient) outweighs what is left of
 * the benefit, which is the real reason teams ride climbs individually.
 *
 * Not a loosening in disguise: at a typical 3.0 W/kg climb pace this cutoff
 * lands at ~3.3% grade, slightly stricter than the 3% it replaces. What it
 * does is re-slice. Across the 335-route catalog at that pace, routes with
 * at least one block go 117 -> 143 from the grade/speed swap alone (holding
 * the old 210 s floor), then 143 -> 151 from the shorter floor below. The
 * count is strongly rider-dependent by design - 191 routes at a 2.5 W/kg
 * team pace, 88 at 4.0 - which is the whole point of testing speed.
 */
const CLIMB_BLOCK_MAX_DRAFT_SCALE = 0.25
const CLIMB_BLOCK_MAX_SPEED_MPS = DRAFT_SCALE_REFERENCE_SPEED_MPS * Math.sqrt(CLIMB_BLOCK_MAX_DRAFT_SCALE)
/**
 * Cheap prefilter while walking segments, so the speed solve only runs on
 * stretches that could plausibly qualify. It exists to avoid work, not to
 * make decisions, so it has to be safe: nothing it drops may be something
 * the speed test would have kept.
 *
 * Verified across the full range the UI allows (`TTT_MIN_CLIMB_WKG`..9 W/kg,
 * 50-110 kg): at 1% the slowest case is a 50 kg rider at 2 W/kg doing
 * 22.6 km/h, still above the 21.06 km/h cutoff. That is only ~7% of margin,
 * so lower this rather than raise it if the cutoff ever moves up.
 */
const CLIMB_BLOCK_PREFILTER_GRADE = 0.01
/** Sub-threshold gaps shorter than this merge two climb stretches into one block (a short flat in the middle of a climb doesn't reform the paceline). */
const CLIMB_BLOCK_MERGE_GAP_M = 200
/**
 * Minimum estimated duration for a block to count as a "long" climb. 2.5
 * minutes: a team settles into its own pace when the climb is long enough to
 * be worth reorganising for, and shorter ramps get muscled over in formation.
 * Was 210 s, which sat above the "climbs over 3-4 minutes" this is meant to
 * capture and missed climbs teams visibly do ride individually.
 */
const CLIMB_BLOCK_MIN_DURATION_SEC = 150

/**
 * Finds the route's long climbs - contiguous rising stretches of
 * `geometry.points` whose estimated speed at `climbPowerW` is at or below
 * `CLIMB_BLOCK_MAX_SPEED_MPS` and which last at least
 * `CLIMB_BLOCK_MIN_DURATION_SEC`. See the constants above for why the test is
 * speed rather than grade. Works on geometry positions directly (NOT
 * `route.terrain.climbs`, whose per-lap km positions don't map onto
 * lap-repeated/lead-in-offset geometry). Adjacent stretches separated by less
 * than 200 m merge before the speed test runs.
 *
 * The speed used is the SOLO speed at `climbPowerW`, not the drafted group
 * speed. At these speeds the two are within a few percent (the draft being
 * nearly gone is the whole premise), and using the solo speed keeps this a
 * plain solve instead of a fixed point.
 */
export function detectLongClimbBlocks(geometry: RouteGeometry, climbPowerW: number, riderWeightKg: number): TttClimbBlock[] {
  const points = geometry.points
  const massKg = riderWeightKg + REPRESENTATIVE_BIKE_MASS_KG
  const raw: { fromM: number, toM: number, elevationM: number }[] = []

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const distanceM = b.distanceM - a.distanceM
    if (distanceM <= 0) continue
    const grade = (b.elevationM - a.elevationM) / distanceM
    if (grade < CLIMB_BLOCK_PREFILTER_GRADE) continue
    const last = raw[raw.length - 1]
    if (last && a.distanceM <= last.toM) {
      last.toM = b.distanceM
      last.elevationM += b.elevationM - a.elevationM
    } else {
      raw.push({ fromM: a.distanceM, toM: b.distanceM, elevationM: b.elevationM - a.elevationM })
    }
  }

  // Merge across short sub-threshold gaps, but only while the merged block
  // still clears the prefilter - otherwise a rolling route chains into one
  // bogus "climb" through its flats. The real speed test runs after this, on
  // the merged block, so a merge can never smuggle in a stretch the group
  // would have ridden fast.
  const merged: typeof raw = []
  for (const block of raw) {
    const last = merged[merged.length - 1]
    if (last && block.fromM - last.toM < CLIMB_BLOCK_MERGE_GAP_M) {
      const mergedElevationM = last.elevationM + block.elevationM
      const mergedDistanceM = block.toM - last.fromM
      if (mergedElevationM / mergedDistanceM >= CLIMB_BLOCK_PREFILTER_GRADE) {
        last.toM = block.toM
        last.elevationM = mergedElevationM
        continue
      }
    }
    merged.push({ ...block })
  }

  return merged
    .map((block) => {
      const distanceM = block.toM - block.fromM
      const avgGrade = block.elevationM / distanceM
      const climbSpeedMps = speedForPower(climbPowerW, massKg, avgGrade, REPRESENTATIVE_CRR, REPRESENTATIVE_CDA_M2)
      return {
        fromM: block.fromM,
        toM: block.toM,
        distanceM,
        elevationM: block.elevationM,
        avgGrade,
        climbSpeedMps,
        estDurationSec: distanceM / climbSpeedMps
      }
    })
    .filter(block => block.climbSpeedMps <= CLIMB_BLOCK_MAX_SPEED_MPS && block.estDurationSec >= CLIMB_BLOCK_MIN_DURATION_SEC)
}

export interface TttPowerPlan {
  blocks: TttClimbBlock[]
  /** Power overrides for `simulateRoute` - the long climbs ridden at `climbPowerW`, everything else at the rider's own average power. */
  powerSegmentsW: PowerSegmentW[]
  climbDistanceM: number
  climbElevationM: number
  climbPowerW: number
}

/**
 * The TTT pacing plan for a route: every long climb (see
 * `detectLongClimbBlocks`) is ridden at the team's climb power
 * `climbWkg x weightKg` instead of the rider's flat-effort power, modeling
 * "average W/kg on climbs over 3-4 minutes where the paceline breaks up".
 * The draft scaling still applies on top and simply fades to nothing at
 * climbing speed on its own, so this is purely about pacing, not drafting.
 * Returns `undefined` when the route has no qualifying climb - callers then
 * change nothing at all. Compute this ONCE per request and share it across
 * combos - see the note on `REPRESENTATIVE_CDA_M2`.
 */
export function tttPowerPlan(geometry: RouteGeometry, climbWkg: number, weightKg: number): TttPowerPlan | undefined {
  const climbPowerW = climbWkg * weightKg
  const blocks = detectLongClimbBlocks(geometry, climbPowerW, weightKg)
  if (blocks.length === 0) return undefined
  return {
    blocks,
    powerSegmentsW: blocks.map(block => ({ fromM: block.fromM, toM: block.toM, powerW: climbPowerW })),
    climbDistanceM: blocks.reduce((sum, block) => sum + block.distanceM, 0),
    climbElevationM: blocks.reduce((sum, block) => sum + block.elevationM, 0),
    climbPowerW
  }
}
