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
 * @returns {{ entry: object, classification: 'lap' | 'ride-split' | 'ambiguous' | 'no-trace' | 'lead-in-too-small' }}
 * `entry` is the input object itself when nothing changed.
 */
export function normalizeRouteSurfaceEntry(entry, lapKm, leadInKm) {
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
