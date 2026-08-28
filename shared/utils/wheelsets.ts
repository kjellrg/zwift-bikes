import { bikeFrontWheels, bikeRearWheels } from 'zwift-data'
import type { ClassificationScores, ClassifiedWheel, EquipmentPhysicsDelta, ScoreConfidence, Wheelset } from '../types/catalog'
import { SUPPLEMENT_FRONT_WHEELS, SUPPLEMENT_REAR_WHEELS, applyWheelSupplement } from '../data/wheelSupplement'
import { classifyFrontWheel, classifyRearWheel } from './classifyWheel'

/**
 * Pairs front/rear wheels into the "wheelsets" riders commonly use in Zwift
 * (same wheel model front and rear). `zwift-data` stores front and rear
 * wheels as separate lists; ~98% of them share an identical `name` across
 * both lists, so we group by name. The remaining rear-only entries (e.g. a
 * disc wheel variant like "Zipp 808/Super9") are paired with the closest
 * matching front wheel (the part of the name before the "/").
 */

function averageScores(a: ClassificationScores, b: ClassificationScores): ClassificationScores {
  return {
    aero: Math.round((a.aero + b.aero) / 2),
    climb: Math.round((a.climb + b.climb) / 2),
    gravel: Math.round((a.gravel + b.gravel) / 2),
    cobble: Math.round((a.cobble + b.cobble) / 2)
  }
}

function combinedConfidence(a: ClassifiedWheel, b: ClassifiedWheel): ScoreConfidence {
  return a.confidence === 'measured' && b.confidence === 'measured' ? 'measured' : 'estimated'
}

// Only used by the same-name pairing loop, where both legs classify from the
// SAME `WHEEL_SPEED_DATA` entry and therefore solve to identical deltas - the
// average is a no-op that exists only so a future divergence averages rather
// than silently picking a side. It deliberately does NOT run on the rear-only
// pairings, whose two legs come from different rows (see issue #150 below).
function averagePhysics(a: ClassifiedWheel, b: ClassifiedWheel): EquipmentPhysicsDelta | undefined {
  if (!a.physics || !b.physics) return undefined
  return {
    cdaDeltaM2: (a.physics.cdaDeltaM2 + b.physics.cdaDeltaM2) / 2,
    bikeMassDeltaKg: (a.physics.bikeMassDeltaKg + b.physics.bikeMassDeltaKg) / 2,
    crrDelta: (a.physics.crrDelta + b.physics.crrDelta) / 2
  }
}

// Integrated wheels that only exist welded to their frame - Zwift never
// offers them as a separate, swappable wheelset (see `FIXED_WHEEL_FRAMES` in
// `classifyBikeFrame.ts`: the frame's speed measurement already covers the
// whole frame+wheel unit). `zwift-data` still lists them in the front/rear
// wheel catalogs, so without this they'd be offered to ANY frame at an
// estimated score no measured wheel can beat (issue #87).
// Exported for `scripts/validate-speed-data.mjs`, which checks every name
// against the catalog at build time.
export const INTEGRATED_ONLY_WHEELS = new Set(['Roval PROJECT 74', 'Cannondale R4000 Roller Blade'])

let cachedWheelsets: Wheelset[] | undefined

export function getWheelsets(): Wheelset[] {
  if (cachedWheelsets) return cachedWheelsets

  const allFront = applyWheelSupplement(bikeFrontWheels, SUPPLEMENT_FRONT_WHEELS)
  const allRear = applyWheelSupplement(bikeRearWheels, SUPPLEMENT_REAR_WHEELS)
  const classifiedFront = allFront.filter(w => !INTEGRATED_ONLY_WHEELS.has(w.name)).map(classifyFrontWheel)
  const classifiedRear = allRear.filter(w => !INTEGRATED_ONLY_WHEELS.has(w.name)).map(classifyRearWheel)

  const frontByName = new Map(classifiedFront.map(w => [w.name, w]))
  const rearByName = new Map(classifiedRear.map(w => [w.name, w]))

  const wheelsets: Wheelset[] = []
  const usedRearNames = new Set<string>()

  for (const front of classifiedFront) {
    const rear = rearByName.get(front.name)
    if (!rear) continue
    usedRearNames.add(rear.name)
    wheelsets.push({
      key: front.name,
      name: front.name,
      front,
      rear,
      crrClass: front.crrClass,
      scores: averageScores(front.scores, rear.scores),
      confidence: combinedConfidence(front, rear),
      physics: averagePhysics(front, rear)
    })
  }

  // Handle rear-only entries (e.g. disc wheels) by pairing with the closest
  // matching front wheel, falling back to itself as a pseudo-front wheel.
  //
  // Here the REAR is authoritative for the whole set, and the matched front
  // contributes identity only (which wheel is shown/equipped up front, and
  // its Crr class). A `WHEEL_SPEED_DATA` row always measures the complete
  // assembled set ZwiftInsider bot-tested, so "Zipp 808/Super9"'s row (flat
  // +44.6s, climb -21.6s) already describes an 808 front with a Super9 rear;
  // averaging it with the standalone "Zipp 808" row halved the disc's
  // measured character and shipped physics for a set that doesn't exist
  // (issue #150). Confidence follows the same logic: the set's numbers now
  // trace entirely to the rear's real bot test, so the front leg's own
  // confidence describes a measurement the set no longer uses.
  //
  // `key` stays the rear's name - it is the garage/localStorage identity and
  // the API's `ownedWheels` filter key, so it must never move.
  for (const rear of classifiedRear) {
    if (usedRearNames.has(rear.name)) continue

    const prefix = (rear.name.split('/')[0] ?? rear.name).trim()
    const front = frontByName.get(prefix) ?? classifiedFront.find(w => rear.name.includes(w.name))

    const effectiveFront = front ?? { ...rear, id: -rear.id }
    wheelsets.push({
      key: rear.name,
      name: rear.name,
      front: effectiveFront,
      rear,
      crrClass: effectiveFront.crrClass,
      scores: rear.scores,
      confidence: rear.confidence,
      physics: rear.physics
    })
  }

  cachedWheelsets = wheelsets
  return wheelsets
}
