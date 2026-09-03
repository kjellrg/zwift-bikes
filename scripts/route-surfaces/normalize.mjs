// Normalizes one routeSurfaces.generated.json entry to the LAP-relative
// convention (issue #126). The Strava segments the generator fetches are
// community-created and heterogeneous: most were cut at the route's start
// banner (trace covers exactly one lap), a handful were cut from a ride that
// started in the event pen (trace covers lead-in + lap), and a few are off
// both marks by GPS noise. Nothing in the payload says which - the only
// signal is comparing the trace's end against the route's official lap
// distance vs. lap + lead-in.
//
// Lap-aligned entries pass through UNTOUCHED (byte-identical, keeps the
// migration diff minimal). Lead-in-inclusive traces are SPLIT, not trimmed:
// the lead-in's measured shape moves into `leadInSegments` /
// `leadInElevationProfile` (rebased to the lead-in's own start) so the
// physics keeps e.g. lutscher's 10.8km of real lead-in terrain, while
// `segments`/`elevationProfile` become pure-lap and `composition` is
// recomputed over the lap alone. Ambiguous traces pass through untouched and
// are reported for curation.

/** Tolerance for matching a trace end against an official distance, km. */
export function traceAlignmentToleranceKm(lapKm) {
  return Math.max(0.3, lapKm * 0.01)
}

function interpolateElevationAt(profile, distanceM) {
  if (distanceM <= profile[0].distanceM) return profile[0].elevationM
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i]
    const b = profile[i + 1]
    if (distanceM >= a.distanceM && distanceM <= b.distanceM) {
      const span = b.distanceM - a.distanceM
      const t = span > 0 ? (distanceM - a.distanceM) / span : 0
      return a.elevationM + t * (b.elevationM - a.elevationM)
    }
  }
  return profile[profile.length - 1].elevationM
}

function compositionFromSegments(segments) {
  const totalsKm = {}
  for (const segment of segments) {
    const lengthKm = segment.toKm - segment.fromKm
    if (lengthKm <= 0) continue
    totalsKm[segment.type] = (totalsKm[segment.type] ?? 0) + lengthKm
  }
  const totalKm = Object.values(totalsKm).reduce((sum, km) => sum + km, 0)
  if (totalKm <= 0) return { tarmac: 100 }
  return Object.fromEntries(Object.entries(totalsKm).map(([type, km]) => [type, (km / totalKm) * 100]))
}

/**
 * A handful of community Strava segments carry a flat/garbage altitude
 * stream: the profile RDP-simplifies to two points with ~0m of ascent on a
 * route officially climbing 33-262m (16 routes as of 2026-08, jons-route
 * and most `-run` segments among them). Keeping such a profile is worse
 * than having none - the geometry builder trusts it and models the route
 * pancake-flat, where the no-profile fallback synthesizes the official
 * elevation. Discard it (surfaces are lat/lng-based and stay fine) when the
 * measured ascent is implausibly below the official figure on a route with
 * real climbing.
 */
function profileAscentM(profile) {
  let ascent = 0
  for (let i = 1; i < profile.length; i++) {
    const delta = profile[i].elevationM - profile[i - 1].elevationM
    if (delta > 0) ascent += delta
  }
  return ascent
}

const FLAT_PROFILE_MIN_OFFICIAL_M = 20
const FLAT_PROFILE_ASCENT_FRACTION = 0.25

/**
 * The opposite failure: an altitude stream that is not flat but does not
 * close. A lap route's profile must end within noise of where it started -
 * `geometryForRouteLaps` chains laps by appending the profile end-to-end, so
 * an unclosed lap climbs (or falls) by its net gain again on EVERY lap.
 * 5k-loop shipped a two-point profile `[0 m, 0 m] -> [5006 m, 50 m]` on a
 * lap with an official 31 m of ascent: a 1% ramp that never came back down,
 * +250 m and ~292 s over five laps. The flat-profile rule cannot see it
 * (its ascent is 161% of official, not under 25%). Reject the profile when
 * a lap's net elevation change exceeds the larger of an absolute GPS-noise
 * floor and the same fraction of official ascent the flat rule uses -
 * point-to-point routes legitimately end elsewhere and are exempt. Checked
 * AFTER alignment: a ride-covering trace starts in the pen, and only the
 * split-off lap-relative profile is expected to close.
 */
const UNCLOSED_LAP_MIN_M = 10

function lapProfileIsUnclosed(profile, officialElevationM) {
  const netM = Math.abs(profile[profile.length - 1].elevationM - profile[0].elevationM)
  return netM > Math.max(UNCLOSED_LAP_MIN_M, (officialElevationM ?? 0) * FLAT_PROFILE_ASCENT_FRACTION)
}

/**
 * @returns {{ entry: object, classification: 'lap' | 'ride-split' | 'already-split' | 'ambiguous' | 'no-trace' | 'lead-in-too-small', profileDropped: boolean }}
 * `entry` is the input object itself when nothing changed.
 */
export function normalizeRouteSurfaceEntry(entry, lapKm, leadInKm, officialElevationM = undefined, isLapRoute = false) {
  let profileDropped = false
  if (entry.elevationProfile?.length >= 2 && officialElevationM > FLAT_PROFILE_MIN_OFFICIAL_M
    && profileAscentM(entry.elevationProfile) < officialElevationM * FLAT_PROFILE_ASCENT_FRACTION) {
    // The lead-in profile comes from the same altitude stream, so it is the
    // same garbage - drop both together, never one without the other.
    entry = { ...entry }
    delete entry.elevationProfile
    delete entry.leadInElevationProfile
    profileDropped = true
  }

  const aligned = alignEntry(entry, lapKm, leadInKm)
  if (isLapRoute && aligned.entry.elevationProfile?.length >= 2 && lapProfileIsUnclosed(aligned.entry.elevationProfile, officialElevationM)) {
    const stripped = { ...aligned.entry }
    delete stripped.elevationProfile
    delete stripped.leadInElevationProfile
    return { ...aligned, entry: stripped, profileDropped: true }
  }
  return { ...aligned, profileDropped }
}

function alignEntry(entry, lapKm, leadInKm) {
  // Already split by a previous run - structurally final, never re-derive.
  // The arithmetic alone is NOT idempotent on the borderline: cirque-du-suffer's
  // GPS-short trace ends nearer the ride mark than the lap mark even after
  // its lead-in has been split off, and re-running the nearest-mark rule on
  // it would shave another lead-in's worth off the lap.
  if (entry.traceCoveredLeadIn) return { entry, classification: 'already-split' }

  const segments = entry.segments
  if (!segments?.length) return { entry, classification: 'no-trace' }

  const endKm = segments[segments.length - 1].toKm
  const tolKm = traceAlignmentToleranceKm(lapKm)
  // With a lead-in smaller than the tolerance, "lap" and "lead-in + lap" are
  // the same mark - there is nothing to split that GPS noise wouldn't dwarf.
  if ((leadInKm ?? 0) <= tolKm) return { entry, classification: 'lead-in-too-small' }

  const deltaLap = Math.abs(endKm - lapKm)
  const deltaRide = Math.abs(endKm - (lapKm + leadInKm))
  if (deltaLap <= tolKm && deltaLap <= deltaRide) return { entry, classification: 'lap' }
  if (deltaRide > tolKm || deltaRide >= deltaLap) return { entry, classification: 'ambiguous' }

  // The trace covers lead-in + lap: split at the lead-in.
  const leadInSegments = []
  const lapSegments = []
  for (const segment of segments) {
    if (segment.toKm <= leadInKm) {
      leadInSegments.push(segment)
    } else if (segment.fromKm >= leadInKm) {
      lapSegments.push({ fromKm: segment.fromKm - leadInKm, toKm: segment.toKm - leadInKm, type: segment.type })
    } else {
      leadInSegments.push({ fromKm: segment.fromKm, toKm: leadInKm, type: segment.type })
      lapSegments.push({ fromKm: 0, toKm: segment.toKm - leadInKm, type: segment.type })
    }
  }

  let lapProfile
  let leadInProfile
  if (entry.elevationProfile?.length >= 2) {
    const profile = entry.elevationProfile
    const splitM = leadInKm * 1000
    const splitElevationM = interpolateElevationAt(profile, splitM)
    leadInProfile = [...profile.filter(p => p.distanceM < splitM), { distanceM: splitM, elevationM: splitElevationM }]
    lapProfile = [
      { distanceM: 0, elevationM: 0 },
      ...profile.filter(p => p.distanceM > splitM).map(p => ({ distanceM: p.distanceM - splitM, elevationM: p.elevationM - splitElevationM }))
    ]
  }

  return {
    classification: 'ride-split',
    entry: {
      composition: compositionFromSegments(lapSegments),
      segments: lapSegments,
      ...(lapProfile ? { elevationProfile: lapProfile } : {}),
      leadInSegments,
      ...(leadInProfile ? { leadInElevationProfile: leadInProfile } : {}),
      /** The source trace covered the lead-in; the split above is derived, not fetched. */
      traceCoveredLeadIn: true,
      generatedAt: entry.generatedAt,
      stravaSegmentId: entry.stravaSegmentId
    }
  }
}
