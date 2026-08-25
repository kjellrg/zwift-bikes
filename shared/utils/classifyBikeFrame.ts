import type { BikeFrame } from 'zwift-data'
import type { BikeCategory, BikeStyle, ClassificationScores, ClassifiedBikeFrame, EquipmentPhysicsDelta } from '../types/catalog'
import { FRAME_SPEED_DATA, TT_FRAME_SPEED_DATA } from '../data/frameSpeedData'
import { FRAME_UPGRADE_SCHEMES, drivetrainCrrDeltaForLevel, stageChartFor, type StageChart, type StageCurve } from '../data/frameUpgradeSchemes'
import { precomputedFrameDelta } from '../data/equipmentPhysics'
import { solveFrameEquipmentDelta } from './physics/equipment'

/**
 * Classifier for Zwift bike frames.
 *
 * `zwift-data` only exposes { id, name, modelYear, isTT } for frames - there is
 * no official aero/weight/handling rating. This classifier:
 *
 * 1. Sorts every frame into the same category Zwift itself uses in the
 *    garage/drop shop: `standard` (road), `tt`, `gravel`, `handbike` or
 *    `funbike`.
 * 2. For `standard` road bikes, additionally derives a riding `style` (aero /
 *    climb / endurance / allrounder) from well-known real-world traits of the
 *    bike model it represents (e.g. the Specialized Aethos is a dedicated
 *    lightweight climbing bike, the Specialized Roubaix is a cobble/endurance
 *    bike). The `style` is used to pick a fallback score preset and to label
 *    the bike in the UI.
 * 3. For `standard` and `tt` frames with real bot speed-test data available
 *    (see `../data/frameSpeedData.ts`), the `aero`/`climb` scores are derived
 *    directly from that data instead of the style/category preset, giving
 *    each model its own individual rating rather than sharing one with its
 *    whole style/category bucket. `gravel`/`cobble` scores (not covered by
 *    the speed tests, and in Zwift's actual physics almost entirely driven
 *    by the *wheel*, not the frame - see `classifyWheel.ts`) still come from
 *    the style/category preset either way.
 *
 * Frames without real data fall back to the style/category presets, which
 * remain a best-effort estimate, not data pulled from Zwift's game engine.
 *
 * An optional `level` (0-5, representing Zwift's frame unlock stages) can be
 * passed to get scores for a specific upgrade stage instead of the default
 * Stage 0 (just-purchased) baseline - see `interpolateGap`.
 */

/**
 * What upgrade stage to assume for a frame the rider hasn't put in their
 * garage. Lives here, next to the `level` semantics it refers to, so that
 * every surface that has to pick a stage - `useRiderProfile`, the recommend
 * endpoints, the MCP tools - reads the same number.
 *
 * That matters more than it looks: frames upgrade along different per-stage
 * schemes, so the assumed stage changes the *ranking*, not just the times.
 * On Road to Sky a stage-0 assumption puts the Tarmac SL9 on top while a
 * stage-5 one puts the Aethos S-Works there, 74s apart - so two surfaces
 * disagreeing on this default answer the same question with different bikes.
 *
 * 5 (fully upgraded) rather than 0: it is what the site has always shown, and
 * an unowned frame is being considered as something to work towards, which
 * makes its end state the fair comparison against everything else.
 */
export const DEFAULT_UNOWNED_LEVEL = 5

// Calibration bounds for converting a raw "seconds saved/lost per hour at
// 300W vs. baseline" gap into a 0-100 score. Chosen from the bulk of the
// measured `standard` frame distribution, clamping the small number of
// extreme outliers (e.g. mislabeled off-road-ish frames) to the ends of the
// scale rather than letting them stretch/skew everyone else's scores.
// NOTE: previously [-10, 65] / [-10, 60] - way too narrow. At Stage 5, 49 of
// 93 standard frames exceed a 65s flat gap and 61 of 93 exceed a 60s climb
// gap, so roughly half the fully-upgraded roster was clamped to the same
// max score. Recalibrated to the real Stage-5 bulk max, excluding the
// documented extreme outliers (Canyon Lux/Inflite, Allied Able - low end;
// Specialized PROJECT 74 and Zwift Concept Z1 - fixed-wheel frames scored
// as whole aero units, see FIXED_WHEEL_FRAMES): flat max ~93 (Cervelo S5
// 92.6), climb range widened both ends (Zwift Steel's -30 climb gap, Aethos S-Works' genuine
// 115.6 climb gap - a real, well-known ultralight climbing bike, not a
// data error).
const FLAT_GAP_RANGE: [number, number] = [-10, 93]
const CLIMB_GAP_RANGE: [number, number] = [-30, 116]

// Same idea, calibrated separately for TT frames since they're measured
// against a different baseline ("Zwift TT") and have a different
// distribution than standard road frames.
// NOTE: previously [-5, 50] / [-20, 32] - way too narrow. At Stage 5 (fully
// upgraded), 23 of 24 TT frames exceed a 50s flat gap and 20 of 24 exceed a
// 32s climb gap, so nearly the entire upgraded TT roster (e.g. Cadex Tri at
// 93.4/51.2 and Canyon Speedmax CFR at 95/58.9) was clamped to the same
// max score, hiding real (if sometimes small) performance differences.
// Recalibrated to the real Stage-5 max among non-fixed-wheel TT frames
// (Canyon Speedmax CFR: 95 flat / 58.9 climb) - the Pinarello Espada's
// 141.3/-9.6 stays an intentional outlier (it's a fixed-wheel frame scored
// as a whole aero unit, see FIXED_WHEEL_FRAMES).
const TT_FLAT_GAP_RANGE: [number, number] = [-5, 95]
const TT_CLIMB_GAP_RANGE: [number, number] = [-20, 59]

const SCORE_RANGE: [number, number] = [8, 96]

function scoreFromGap(gapSec: number, [gapMin, gapMax]: [number, number]): number {
  const [scoreMin, scoreMax] = SCORE_RANGE
  const clamped = Math.min(gapMax, Math.max(gapMin, gapSec))
  const ratio = (clamped - gapMin) / (gapMax - gapMin)
  return Math.round(scoreMin + ratio * (scoreMax - scoreMin))
}

// Zwift unlocks a frame's full performance gradually over 5 "stages" of
// riding after purchase (Stage 0 = just bought, Stage 5 = fully upgraded).
// Three tiers of fidelity, best available wins (issue #88):
//   1. `byStage` - the frame's own bot-tested gap at every stage
//      (`flatGapSecByStage`/`climbGapSecByStage` in `frameSpeedData.ts`);
//      no interpolation at all, the level's measured value is returned.
//   2. `curve` - the frame's upgrade scheme's published per-stage shape
//      (`frameUpgradeSchemes.ts`): what fraction of the total endpoint gain
//      lands at each stage, shared by every frame in the scheme.
//   3. Neither (frame not yet catalogued) - linear between the endpoints.
// Exported for `classifyBikeFrame.test.ts`: with the whole catalog now
// stage-tested, tiers 2 and 3 only run for future frames, so no real
// catalog entry exercises them end-to-end.
export function interpolateGap(gap0: number, gap5: number, level: number, curve?: StageCurve, byStage?: readonly number[]): number {
  const clampedLevel = Math.min(5, Math.max(0, level))
  if (byStage) return byStage[clampedLevel] ?? gap5
  if (clampedLevel === 0) return gap0
  if (!curve) return gap0 + (clampedLevel / 5) * (gap5 - gap0)
  const total = curve[4]
  const atLevel = curve[clampedLevel - 1] ?? total
  const fraction = total === 0 ? clampedLevel / 5 : atLevel / total
  return gap0 + fraction * (gap5 - gap0)
}

function frameStageChart(frameName: string): StageChart | undefined {
  const scheme = FRAME_UPGRADE_SCHEMES[frameName]
  return scheme && stageChartFor(scheme)
}

// Presets only apply to frames WITHOUT a speed-data row, and being unmeasured
// must never be an advantage: a preset above what measured frames of the same
// class can score makes the guess outrank the data because it's a guess.
// Ceilings derived from the measured level-5 distribution (2026-08-16):
// - climb style: the old 94 sat above every measured climb-style frame except
//   the Aethos S-Works (96), so five unmeasured climb frames beat the whole
//   measured climb roster uphill (issue #85). Measured climb-style frames
//   span 45-96 with the bulk at 66+; 64 sits below that bulk. It can't go
//   lower without breaking the style presets' internal ordering - an
//   estimated climb bike must still out-climb an estimated allrounder (62)
//   and endurance (55) bike, or the labels lie relative to each other.
// - aero style (88) stays below the measured flat maximum (96) - fine as-is.
const STYLE_PRESETS: Record<BikeStyle, ClassificationScores> = {
  aero: { aero: 88, climb: 42, gravel: 8, cobble: 18 },
  climb: { aero: 42, climb: 64, gravel: 15, cobble: 25 },
  endurance: { aero: 52, climb: 55, gravel: 40, cobble: 78 },
  allrounder: { aero: 62, climb: 62, gravel: 22, cobble: 38 }
}

const CATEGORY_PRESETS: Record<Exclude<BikeCategory, 'standard'>, ClassificationScores> = {
  // The TT aero preset was 96 - above every measured TT frame except the
  // clamped range maximum, so the one unmeasured TT frame outranked the
  // whole measured TT roster (issue #86). Unlike the wheel-disc rule
  // (below the slowest measured member), TT frames spread wide (measured
  // level-5 aero scores run 53-96), and the honest claim for an unknown TT
  // frame is "a typical TT frame", not "slower than the worst one ever
  // measured" - so it sits at the measured median (72), well below the
  // measured Speedmax CFR/Cadex Tri at the top.
  tt: { aero: 72, climb: 15, gravel: 0, cobble: 5 },
  gravel: { aero: 28, climb: 48, gravel: 96, cobble: 82 },
  handbike: { aero: 20, climb: 20, gravel: 15, cobble: 20 },
  funbike: { aero: 20, climb: 20, gravel: 20, cobble: 20 }
}

// A handful of special/event-exclusive frames come with their own
// integrated wheels that Zwift does not let you swap out - confirmed via
// zwiftinsider.com/pinarello-espada/: "the Espada, like the Tron bike,
// can only be tested with its disc wheels installed". Only the Espada
// actually runs disc wheels; the Concept Z1's integrated wheels are its own
// power-reactive lit wheels, not discs (zwiftinsider.com/halo-bikes/) - what
// they share is that the wheel is welded to the frame choice, which is all
// this set is about. The Specialized PROJECT 74 is the same story - it's
// always paired with its own integrated "Roval PROJECT 74" wheels (see
// `zwift-data`'s `bikeFrontWheels`/
// `bikeRearWheels`), which aren't offered as a separate swappable wheelset.
// Their `FRAME_SPEED_DATA`/`TT_FRAME_SPEED_DATA` measurements are for the
// whole frame+wheel unit, so `scoreCombo`/`estimateFinishTimeSec` must
// ignore whatever wheelset they'd otherwise be paired with rather than
// blending it in on top (see both files' `hasFixedWheels` branches), and the
// UI/API must not present a swappable wheel choice for them (see `rankCombos`).
// The Cannondale R4000 Roller Blade is the same story again: a Halo bike the
// sheet tests with its own integrated wheels (its Wheels column names the
// bike itself), which `zwift-data` also lists as a standalone front/rear
// wheel - excluded from the swappable pool in `wheelsets.ts`.
// Exported for `scripts/validate-speed-data.mjs`, which checks every name
// against the catalog at build time.
export const FIXED_WHEEL_FRAMES = new Set(['Pinarello Espada', 'Zwift Concept Z1', 'Zwift Golden Concept Z1', 'Specialized PROJECT 74', 'Cannondale R4000 Roller Blade'])

// The three Halo bikes almost nobody can ride (issue #112). ZwiftInsider
// lists exactly four Halo bikes (zwiftinsider.com/halo-bikes/): these three -
// each unlocked by fully upgrading three frames of one brand and then costing
// ~10M Drops to buy plus ~10M more to upgrade - and the Zwift Concept Z1
// ("Tron"). The Z1 pair is deliberately NOT in this set: the Tron is a free
// Everest-challenge unlock, widely owned, and ZwiftInsider's own benchmark
// bike, so hiding it would take away an answer most riders can act on.
// The recommend endpoints drop these three from the ranked pool unless the
// caller opts in (`includeHalo`), owns the frame, or is searching - see the
// `isHiddenHalo` predicates there.
// Intentionally a separate set from `FIXED_WHEEL_FRAMES` above: integrated
// wheels and unlock cost are different facts about a frame, even though the
// members currently coincide minus the Z1s.
// Exported for `scripts/validate-speed-data.mjs`.
export const PURCHASABLE_HALO_FRAMES = new Set(['Pinarello Espada', 'Specialized PROJECT 74', 'Cannondale R4000 Roller Blade'])

// `Zwift Golden Concept Z1` is the plain `Zwift Concept Z1` with a gold light
// scheme - the same frame, sharing one `FRAME_SPEED_DATA` sample - so a ranked
// result list showing both would just repeat one bike in two adjacent rows.
const COSMETIC_RESKIN = 'Zwift Golden Concept Z1'
const RESKINNED_ORIGINAL = 'Zwift Concept Z1'

/**
 * True when `frame` is the redundant half of a cosmetic re-skin pair and
 * should be left out of a ranked result list (both halves always stay in the
 * catalog itself - `/api/bikes`/garage - so the re-skin can be owned in the
 * first place).
 *
 * Exactly one of the pair is ever listed. The re-skin is pure noise for the
 * vast majority of riders, who don't own it, so by default it's the one
 * dropped. A rider who has explicitly added it to their garage clearly does
 * want to see it, and it stands in for the original for them - carrying their
 * real unlock level, which the original wouldn't have - so it's the original
 * that drops out instead.
 *
 * `ownedFrameNames` is the rider's garage by frame name (`zwift-data` ids are
 * what the garage actually stores, so the caller resolves them to names).
 */
export function isRedundantCosmeticVariant(frame: BikeFrame, ownedFrameNames: ReadonlySet<string>): boolean {
  const ownsReskin = ownedFrameNames.has(COSMETIC_RESKIN)
  if (frame.name === COSMETIC_RESKIN) return !ownsReskin
  return frame.name === RESKINNED_ORIGINAL && ownsReskin
}

// The Concept Z1 ("Tron") frames match `FUNBIKE_RE` on name, but they are not
// novelty bikes: ZwiftInsider bot-tests them like any road frame and
// benchmarks them against the fastest road frame+wheel combos
// (zwiftinsider.com/top-performers/, /tron-vs-top-performers-2024/), and they
// have real `FRAME_SPEED_DATA` measurements - which only the `standard` branch
// of `classifyBikeFrame` reads. Left in `funbike` they'd instead share the one
// flat funbike preset with ~37 other novelty frames, tie with every one of
// them on both `score` and the derived finish time, and stable-sort to the
// very bottom of every route page (issue #25). `Specialized PROJECT 74` is the
// same kind of bike and already resolves to `standard` simply because its name
// doesn't happen to match `FUNBIKE_RE`. The `Cannondale R4000 Roller Blade`
// is the same defect one bike later (issue #72, the Concept Z1 fix was #25):
// a bot-tested Halo bike - the sheet's fastest flat frame - whose name
// matches `FUNBIKE_RE`'s `roller blade` term.
// Exported for `scripts/validate-speed-data.mjs`.
export const ROAD_HALO_FRAMES = new Set(['Zwift Concept Z1', 'Zwift Golden Concept Z1', 'Cannondale R4000 Roller Blade'])

const HANDBIKE_RE = /handcycle/i

// Known Zwift-exclusive fun bikes - novelty/achievement unlocks, incl. the
// "Tron"/Concept bikes which Zwift itself files under the Fun tab.
const FUNBIKE_RE = /recumbent trike|atomic cruiser|big\s*wheel|bmx bandit|\bbat\b|\bsafety\b|mx rider|buffalo|roller blade|skeletal|brompton|default\s*orange|\bconcept\b|golden concept|8-bit|\btrike\b/i

const GRAVEL_RE = /grail|checkpoint|diverge|grizl|\bcrux\b|topstone|revolt|exploro|aspero|true\s*grit|allroad|devote|super\s*x\b|\bepic\b|spark\s*rc|super\s*caliber|dogma\s*gr\b|zwift\s+(mountain|gravel)/i

const TT_NAME_RE = /\btt\b/i

const ENDURANCE_RE = /roubaix|synapse|road\s*machine|endurance/i

// `concept\s*z1` covers the Tron bikes: the fastest flat frame in the game by
// a clear margin (114.6s/hr saved at Stage 0 vs the Zwift Carbon baseline) but
// only a middling climber, which is the aero preset's profile exactly. With
// `FRAME_SPEED_DATA` present the preset only supplies their gravel/cobble
// scores (inert in ranking - `OFFROAD_FRAME_WEIGHT` is 0) and the UI's style
// label, so this is about labelling them honestly rather than "allrounder".
// `roller\s*blade` is the same reasoning for the R4000 (flat 120.8 vs climb
// 7.7 at Stage 0 - a flat-dominant Halo profile).
const AERO_RE = /aeroad|venge|system\s*six|\bfoil\b|madone|propel|speedmax|speed\s*concept|concept\s*z1|roller\s*blade|felt\s*ar\b|felt\s*fr\b|\bs5\b|dogma\s*f(?!.*gr)|time\s*machine|\bp5\b|\bshiv\b|plasma|\bslice\b|bolide|aerium|noah\s*fast|\bia\s*2?\.?0?\b/i

const CLIMB_RE = /aethos|emonda|scultura|super\s*six\s*evo|addict\s*rc|team\s*machine|izalco|\ballez\b|tarmac(?!.*sl7|.*sl8|.*sl9|.*sram)|\btcr\b|ultimate(?!.*cfr)|\bopus\b|\btoa\b|\bkoko\b|\brere\b|\btere\b|vamoots|mosaic|amira|dogma\s*(65\.1|f8|f10|f12)\b|litening/i

function classifyBikeStyle(name: string): BikeStyle {
  if (ENDURANCE_RE.test(name)) return 'endurance'
  if (AERO_RE.test(name)) return 'aero'
  if (CLIMB_RE.test(name)) return 'climb'
  return 'allrounder'
}

function classifyBikeCategory(frame: BikeFrame): BikeCategory {
  const name = frame.name

  if (HANDBIKE_RE.test(name)) return 'handbike'
  if (frame.isTT || TT_NAME_RE.test(name)) return 'tt'
  if (ROAD_HALO_FRAMES.has(name)) return 'standard'
  if (FUNBIKE_RE.test(name)) return 'funbike'
  if (GRAVEL_RE.test(name)) return 'gravel'
  return 'standard'
}

/**
 * Classified frames, by frame object and then upgrade level.
 *
 * Classification is pure - the same frame at the same level always produces
 * the same scores - but it is not cheap: every measured frame runs
 * `solveFrameEquipmentDelta`, a numerical solve, and the recommend endpoints
 * classify all 166 frames on every request (`getFrames()` is memoized, this
 * was not). Measured on the deployed Static Web App that was 850 ms of a
 * 900 ms response - 94% of a short-route request spent recomputing 166
 * answers the process had already computed.
 *
 * Keyed on the frame OBJECT rather than its id or name: both call sites pass
 * elements of a memoized array (`getFrames()`, or `bikeFrames` from
 * zwift-data), so identity is stable for the life of the process, and a
 * WeakMap can't outlive the frames it describes or collide on a duplicate id.
 *
 * Nothing mutates a classified frame - the whole app treats them as read-only
 * values - so handing the same object to every caller is safe. If that ever
 * stops being true, this cache turns a local edit into a global one.
 */
const classifiedByFrame = new WeakMap<BikeFrame, Map<number, ClassifiedBikeFrame>>()

export function classifyBikeFrame(frame: BikeFrame, level = 0): ClassifiedBikeFrame {
  // Only whole levels 0-5 are cached, which is the entire real domain (see
  // `DEFAULT_UNOWNED_LEVEL` and the garage). Anything else - a fraction, a
  // negative, a level past 5 - still classifies (as its rounded/clamped
  // stage, see `classifyFrame`) and is simply not stored, so a caller
  // passing arbitrary numbers (the `owned` query parameter is rider-supplied
  // JSON) can neither change an answer nor grow this map without bound.
  if (!Number.isInteger(level) || level < 0 || level > 5) return classifyFrame(frame, level)

  let byLevel = classifiedByFrame.get(frame)
  if (!byLevel) {
    byLevel = new Map()
    classifiedByFrame.set(frame, byLevel)
  }

  const cached = byLevel.get(level)
  if (cached) return cached

  const classified = classifyFrame(frame, level)
  byLevel.set(level, classified)
  return classified
}

function classifyFrame(frame: BikeFrame, level: number): ClassifiedBikeFrame {
  const category = classifyBikeCategory(frame)
  const hasFixedWheels = FIXED_WHEEL_FRAMES.has(frame.name)
  // Rounded, not just clamped: Zwift's upgrade stages are whole numbers, and
  // whole stages 0-5 are the entire domain the precomputed physics table
  // (`../data/equipmentPhysics.ts`) covers. The API schemas already snap
  // incoming levels to integers; rounding again here makes the classifier
  // total for any numeric input a direct caller might pass.
  const clampedLevel = Math.min(5, Math.max(0, Math.round(level)))

  if (category === 'standard') {
    const style = classifyBikeStyle(frame.name)
    const preset = STYLE_PRESETS[style]
    const measured = FRAME_SPEED_DATA[frame.name]

    if (measured) {
      const chart = frameStageChart(frame.name)
      const flatGap = interpolateGap(measured.flatGapSec0, measured.flatGapSec5, clampedLevel, chart?.flat, measured.flatGapSecByStage)
      const climbGap = interpolateGap(measured.climbGapSec0, measured.climbGapSec5, clampedLevel, chart?.climb, measured.climbGapSecByStage)
      const scores: ClassificationScores = {
        aero: scoreFromGap(flatGap, FLAT_GAP_RANGE),
        climb: scoreFromGap(climbGap, CLIMB_GAP_RANGE),
        gravel: preset.gravel,
        cobble: preset.cobble
      }
      const physics = precomputedFrameDelta(frame.name, clampedLevel, false)
      return { ...frame, category, style, scores, confidence: 'measured', hasFixedWheels, level: clampedLevel, physics }
    }

    return { ...frame, category, style, scores: preset, confidence: 'estimated', hasFixedWheels, level: clampedLevel }
  }

  if (category === 'tt') {
    const preset = CATEGORY_PRESETS.tt
    const measured = TT_FRAME_SPEED_DATA[frame.name]

    if (measured) {
      const chart = frameStageChart(frame.name)
      const flatGap = interpolateGap(measured.flatGapSec0, measured.flatGapSec5, clampedLevel, chart?.flat, measured.flatGapSecByStage)
      const climbGap = interpolateGap(measured.climbGapSec0, measured.climbGapSec5, clampedLevel, chart?.climb, measured.climbGapSecByStage)
      const scores: ClassificationScores = {
        aero: scoreFromGap(flatGap, TT_FLAT_GAP_RANGE),
        climb: scoreFromGap(climbGap, TT_CLIMB_GAP_RANGE),
        gravel: preset.gravel,
        cobble: preset.cobble
      }
      const physics = precomputedFrameDelta(frame.name, clampedLevel, true)
      return { ...frame, category, scores, confidence: 'measured', hasFixedWheels, level: clampedLevel, physics }
    }

    return { ...frame, category, scores: preset, confidence: 'estimated', hasFixedWheels, level: clampedLevel }
  }

  return { ...frame, category, scores: CATEGORY_PRESETS[category], confidence: 'estimated', hasFixedWheels, level: clampedLevel }
}

/**
 * The real numerical solve behind the precomputed table - the exact inputs
 * `classifyFrame` used to hand `solveFrameEquipmentDelta` at runtime, for a
 * measured frame at a whole upgrade stage. NOT called at runtime: each solve
 * is a nested bisection, and running it for the full catalog cost 4-11.5s of
 * CPU per fresh isolate on Workers (the `pool` phase in
 * docs/observability.md). Used by
 * `scripts/equipment-physics/compute-equipment-physics.mjs` to generate
 * `shared/data/equipmentPhysics.generated.json`, and by its `--check` mode
 * (wired into `npm run validate`) to prove the committed table still matches
 * the speed data.
 */
export function solveMeasuredFramePhysics(name: string, level: number, isTT: boolean): EquipmentPhysicsDelta | undefined {
  const measured = (isTT ? TT_FRAME_SPEED_DATA : FRAME_SPEED_DATA)[name]
  if (!measured) return undefined
  const clampedLevel = Math.min(5, Math.max(0, Math.round(level)))
  const chart = frameStageChart(name)
  const flatGap = interpolateGap(measured.flatGapSec0, measured.flatGapSec5, clampedLevel, chart?.flat, measured.flatGapSecByStage)
  const climbGap = interpolateGap(measured.climbGapSec0, measured.climbGapSec5, clampedLevel, chart?.climb, measured.climbGapSecByStage)
  return solveFrameEquipmentDelta({ flatGapSec: flatGap, climbGapSec: climbGap }, isTT, drivetrainCrrDeltaForLevel(clampedLevel))
}
