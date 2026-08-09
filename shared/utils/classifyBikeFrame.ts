import type { BikeFrame } from 'zwift-data'
import type { BikeCategory, BikeStyle, ClassificationScores, ClassifiedBikeFrame } from '../types/catalog'
import { FRAME_SPEED_DATA, TT_FRAME_SPEED_DATA } from '../data/frameSpeedData'

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
// Specialized PROJECT 74 - a fixed-wheel frame scored as a whole aero unit,
// see FIXED_WHEEL_FRAMES): flat max ~93 (Cervelo S5 92.6), climb range
// widened both ends (Zwift Steel's -30 climb gap, Aethos S-Works' genuine
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
// riding distance after purchase (Stage 0 = just bought, Stage 5 = fully
// upgraded). ZwiftInsider only bot-tests the two endpoints, so an
// intermediate level is linearly interpolated between them.
function interpolateGap(gap0: number, gap5: number, level: number): number {
  const clampedLevel = Math.min(5, Math.max(0, level))
  return gap0 + (clampedLevel / 5) * (gap5 - gap0)
}

const STYLE_PRESETS: Record<BikeStyle, ClassificationScores> = {
  aero: { aero: 88, climb: 42, gravel: 8, cobble: 18 },
  climb: { aero: 42, climb: 94, gravel: 15, cobble: 25 },
  endurance: { aero: 52, climb: 55, gravel: 40, cobble: 78 },
  allrounder: { aero: 62, climb: 62, gravel: 22, cobble: 38 }
}

const CATEGORY_PRESETS: Record<Exclude<BikeCategory, 'standard'>, ClassificationScores> = {
  tt: { aero: 96, climb: 15, gravel: 0, cobble: 5 },
  gravel: { aero: 28, climb: 48, gravel: 96, cobble: 82 },
  handbike: { aero: 20, climb: 20, gravel: 15, cobble: 20 },
  funbike: { aero: 20, climb: 20, gravel: 20, cobble: 20 }
}

// A handful of special/event-exclusive frames come with their own
// integrated disc wheels that Zwift does not let you swap out - confirmed
// via zwiftinsider.com/pinarello-espada/: "the Espada, like the Tron bike,
// can only be tested with its disc wheels installed". The Specialized
// PROJECT 74 is the same story - it's always paired with its own integrated
// "Roval PROJECT 74" wheels (see `zwift-data`'s `bikeFrontWheels`/
// `bikeRearWheels`), which aren't offered as a separate swappable wheelset.
// Their `FRAME_SPEED_DATA`/`TT_FRAME_SPEED_DATA` measurements are for the
// whole frame+wheel unit, so `scoreCombo`/`estimateFinishTimeSec` must
// ignore whatever wheelset they'd otherwise be paired with rather than
// blending it in on top (see both files' `hasFixedWheels` branches), and the
// UI/API must not present a swappable wheel choice for them (see `rankCombos`).
const FIXED_WHEEL_FRAMES = new Set(['Pinarello Espada', 'Zwift Concept Z1', 'Zwift Golden Concept Z1', 'Specialized PROJECT 74'])

const HANDBIKE_RE = /handcycle/i

// Known Zwift-exclusive fun bikes - novelty/achievement unlocks, incl. the
// "Tron"/Concept bikes which Zwift itself files under the Fun tab.
const FUNBIKE_RE = /recumbent trike|atomic cruiser|big\s*wheel|bmx bandit|\bbat\b|\bsafety\b|mx rider|buffalo|roller blade|skeletal|brompton|default\s*orange|\bconcept\b|golden concept|8-bit|\btrike\b/i

const GRAVEL_RE = /grail|checkpoint|diverge|grizl|\bcrux\b|topstone|revolt|exploro|aspero|true\s*grit|allroad|devote|super\s*x\b|\bepic\b|spark\s*rc|super\s*caliber|dogma\s*gr\b|zwift\s+(mountain|gravel)/i

const TT_NAME_RE = /\btt\b/i

const ENDURANCE_RE = /roubaix|synapse|road\s*machine|endurance/i

const AERO_RE = /aeroad|venge|system\s*six|\bfoil\b|madone|propel|speedmax|speed\s*concept|felt\s*ar\b|felt\s*fr\b|\bs5\b|dogma\s*f(?!.*gr)|time\s*machine|\bp5\b|\bshiv\b|plasma|\bslice\b|bolide|aerium|noah\s*fast|\bia\s*2?\.?0?\b/i

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
  if (FUNBIKE_RE.test(name)) return 'funbike'
  if (GRAVEL_RE.test(name)) return 'gravel'
  return 'standard'
}

export function classifyBikeFrame(frame: BikeFrame, level = 0): ClassifiedBikeFrame {
  const category = classifyBikeCategory(frame)
  const hasFixedWheels = FIXED_WHEEL_FRAMES.has(frame.name)
  const clampedLevel = Math.min(5, Math.max(0, level))

  if (category === 'standard') {
    const style = classifyBikeStyle(frame.name)
    const preset = STYLE_PRESETS[style]
    const measured = FRAME_SPEED_DATA[frame.name]

    if (measured) {
      const flatGap = interpolateGap(measured.flatGapSec0, measured.flatGapSec5, level)
      const climbGap = interpolateGap(measured.climbGapSec0, measured.climbGapSec5, level)
      const scores: ClassificationScores = {
        aero: scoreFromGap(flatGap, FLAT_GAP_RANGE),
        climb: scoreFromGap(climbGap, CLIMB_GAP_RANGE),
        gravel: preset.gravel,
        cobble: preset.cobble
      }
      return { ...frame, category, style, scores, confidence: 'measured', hasFixedWheels, level: clampedLevel }
    }

    return { ...frame, category, style, scores: preset, confidence: 'estimated', hasFixedWheels, level: clampedLevel }
  }

  if (category === 'tt') {
    const preset = CATEGORY_PRESETS.tt
    const measured = TT_FRAME_SPEED_DATA[frame.name]

    if (measured) {
      const flatGap = interpolateGap(measured.flatGapSec0, measured.flatGapSec5, level)
      const climbGap = interpolateGap(measured.climbGapSec0, measured.climbGapSec5, level)
      const scores: ClassificationScores = {
        aero: scoreFromGap(flatGap, TT_FLAT_GAP_RANGE),
        climb: scoreFromGap(climbGap, TT_CLIMB_GAP_RANGE),
        gravel: preset.gravel,
        cobble: preset.cobble
      }
      return { ...frame, category, scores, confidence: 'measured', hasFixedWheels, level: clampedLevel }
    }

    return { ...frame, category, scores: preset, confidence: 'estimated', hasFixedWheels, level: clampedLevel }
  }

  return { ...frame, category, scores: CATEGORY_PRESETS[category], confidence: 'estimated', hasFixedWheels, level: clampedLevel }
}
