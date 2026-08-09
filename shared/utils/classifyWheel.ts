import type { BikeFrontWheel, BikeRearWheel } from 'zwift-data'
import type { ClassificationScores, ClassifiedWheel, WheelCategory } from '../types/catalog'
import { WHEEL_SPEED_DATA } from '../data/wheelSpeedData'

/**
 * Classifier for Zwift wheels.
 *
 * `zwift-data` only exposes { id, name, imageName } for wheels - no official
 * aero/weight rating. This classifier:
 *
 * 1. Flags known gravel-specific and disc/TT-specific wheels by name.
 * 2. Otherwise extracts an approximate rim depth (mm) from the wheel name -
 *    either a literal number (e.g. "Shimano DURA-ACE C50" -> 50mm) or a small
 *    lookup for well-known model families whose numbers aren't literal mm
 *    (e.g. Zipp 404 -> ~58mm) - and maps depth to an aero/climb tradeoff,
 *    using the well-established principle that deeper rims are more
 *    aerodynamic but heavier/less climb-friendly.
 * 3. For wheels with real bot speed-test data available (see
 *    `../data/wheelSpeedData.ts`), the `aero`/`climb` scores are derived
 *    directly from that data instead of the depth-based estimate.
 * 4. `gravel`/`cobble` scores always come from Zwift's real, published Crr
 *    (rolling resistance) values (see `CRR_GRAVEL_SCORE`/`CRR_COBBLE_SCORE`
 *    below) rather than a per-wheel guess, since in Zwift's physics engine
 *    rolling resistance on unpaved/rough surfaces is purely a function of
 *    the *wheel's* Crr class (Road/Gravel/Mountain) - every wheel within a
 *    class has identical Crr, regardless of aero shape or depth.
 *
 * Wheels' aero/climb ratings without real data fall back to the
 * category/depth heuristic, which remains a best-effort estimate, not data
 * pulled from Zwift's game engine.
 */

const GRAVEL_RE = /xplr|terra|gravel|g23|\bgrc\b|\bgr\b|mountain/i
const DISC_RE = /disc|super\s?9|tri.?spoke|time trial|supersonic|big spin/i
const NOVELTY_RE = /recumbent trike|atomic cruiser|big\s*wheel|bmx bandit|\bbat\b|handcycle|\bsafety\b|mx rider|buffalo|roller blade|skeletal|brompton|8-bit|\btrike\b|loc_wheelname/i

// Depth (mm) isn't literal for these well-known model families.
const KNOWN_DEPTH_MM: Record<string, number> = {
  202: 32,
  303: 45,
  353: 45,
  404: 58,
  454: 58,
  808: 88,
  858: 88
}

function extractDepthMm(name: string): number | undefined {
  for (const [model, depth] of Object.entries(KNOWN_DEPTH_MM)) {
    if (new RegExp(`\\b${model}\\b`).test(name)) return depth
  }

  // Enve "SES x.y" naming: take the larger of the two digits x10 as an
  // approximate depth (e.g. SES 4.5 -> 50mm, SES 8.9 -> 90mm).
  const sesMatch = name.match(/ses\s*(\d)\.(\d)/i)
  if (sesMatch) return Math.max(Number(sesMatch[1]), Number(sesMatch[2])) * 10

  // Otherwise take the last standalone 2-3 digit number in the name as mm.
  const numbers = name.match(/\d{2,3}/g)
  if (numbers) return Number(numbers[numbers.length - 1])

  return undefined
}

// gravel/cobble fields are placeholders here too - see note on scoresForCategory().
const ALLROUNDER_SCORES: ClassificationScores = { aero: 65, climb: 70, gravel: 0, cobble: 0 }

// Calibration bounds for converting a raw "seconds saved/lost per hour at
// 300W vs. baseline" gap into a 0-100 score, chosen from the measured wheel
// distribution's range.
const FLAT_GAP_RANGE: [number, number] = [-10, 52]
const CLIMB_GAP_RANGE: [number, number] = [-33, 16]
const SCORE_RANGE: [number, number] = [8, 96]

function scoreFromGap(gapSec: number, [gapMin, gapMax]: [number, number]): number {
  const [scoreMin, scoreMax] = SCORE_RANGE
  const clamped = Math.min(gapMax, Math.max(gapMin, gapSec))
  const ratio = (clamped - gapMin) / (gapMax - gapMin)
  return Math.round(scoreMin + ratio * (scoreMax - scoreMin))
}

/**
 * Real Crr (rolling resistance) values from Zwift's game data, via
 * ZwiftInsider (https://zwiftinsider.com/crr/). Every wheelset in Zwift
 * belongs to one of 3 Crr classes - Road, Gravel or Mountain (the last one
 * is only the "Zwift Mountain" wheel) - and Zwift assigns each class its own
 * fixed rolling resistance per road surface, identical across every wheel
 * within that class (a Zipp 404 and a basic alloy wheel roll exactly the
 * same on cobbles, since both are "Road" class).
 *
 * Counterintuitively, Gravel wheels are NOT better than Road wheels on
 * cobblestones in Zwift: Road wheels have the lowest cobblestone Crr
 * (.0065) vs. Gravel (.008) and Mountain (.009) - the opposite of the
 * gravel/dirt surface, where Gravel wheels have by far the lowest Crr.
 * Scores below are derived from ZwiftInsider's power-cost table (75kg
 * rider/7kg bike at 40kmh): Cobbles = Road 58W / Gravel 72W / Mountain 80W;
 * Dirt (used as the representative "gravel surface" proxy, since it's the
 * far more common unpaved surface in Zwift routes) = Road 143W / Gravel 80W
 * / Mountain 89W. Lower watts -> higher score.
 */
const CRR_COBBLE_SCORE: Record<'road' | 'gravel' | 'mountain', number> = { road: 96, gravel: 40, mountain: 8 }
const CRR_GRAVEL_SCORE: Record<'road' | 'gravel' | 'mountain', number> = { road: 8, gravel: 96, mountain: 83 }

function crrClassFor(category: WheelCategory, name: string): 'road' | 'gravel' | 'mountain' {
  if (name === 'Zwift Mountain') return 'mountain'
  return category === 'gravel' ? 'gravel' : 'road'
}

// Only the `aero`/`climb` fields of the returned preset are used - the
// `gravel`/`cobble` fields are placeholders, always overridden by the real
// Crr-derived scores in `classify()` below.
function scoresForCategory(category: WheelCategory, depthMm?: number): ClassificationScores {
  switch (category) {
    case 'gravel':
      return { aero: 25, climb: 55, gravel: 0, cobble: 0 }
    case 'disc':
      return { aero: 97, climb: 15, gravel: 0, cobble: 0 }
    case 'climb':
      return { aero: 45, climb: 92, gravel: 0, cobble: 0 }
    case 'aero':
      return { aero: 94, climb: 25, gravel: 0, cobble: 0 }
    case 'allrounder':
    default:
      if (depthMm === undefined) return ALLROUNDER_SCORES
      if (depthMm >= 50 && depthMm < 65) return { aero: 82, climb: 45, gravel: 0, cobble: 0 }
      return ALLROUNDER_SCORES
  }
}

function classifyWheelCategory(name: string): { category: WheelCategory, depthMm?: number } {
  if (NOVELTY_RE.test(name)) return { category: 'allrounder' }
  if (GRAVEL_RE.test(name)) return { category: 'gravel' }
  if (DISC_RE.test(name)) return { category: 'disc' }

  const depthMm = extractDepthMm(name)
  if (depthMm === undefined) return { category: 'allrounder' }
  if (depthMm < 35) return { category: 'climb', depthMm }
  if (depthMm >= 65) return { category: 'aero', depthMm }
  return { category: 'allrounder', depthMm }
}

function classify(wheel: { id: number, name: string, imageName: string }): ClassifiedWheel {
  const { category, depthMm } = classifyWheelCategory(wheel.name)
  const measured = WHEEL_SPEED_DATA[wheel.name]
  const crrClass = crrClassFor(category, wheel.name)
  const gravel = CRR_GRAVEL_SCORE[crrClass]
  const cobble = CRR_COBBLE_SCORE[crrClass]

  if (measured) {
    const scores: ClassificationScores = {
      aero: scoreFromGap(measured.flatGapSec, FLAT_GAP_RANGE),
      climb: scoreFromGap(measured.climbGapSec, CLIMB_GAP_RANGE),
      gravel,
      cobble
    }
    return { ...wheel, category, crrClass, scores, confidence: 'measured' }
  }

  const preset = scoresForCategory(category, depthMm)
  const scores: ClassificationScores = { aero: preset.aero, climb: preset.climb, gravel, cobble }
  return { ...wheel, category, crrClass, scores, confidence: 'estimated' }
}

export function classifyFrontWheel(wheel: BikeFrontWheel): ClassifiedWheel {
  return classify(wheel)
}

export function classifyRearWheel(wheel: BikeRearWheel): ClassifiedWheel {
  return classify(wheel)
}
