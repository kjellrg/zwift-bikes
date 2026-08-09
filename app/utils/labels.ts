import type { BikeCategory, SurfaceEstimate, TerrainCategory, WheelCategory } from '../../shared/types/catalog'

export const BIKE_CATEGORY_LABELS: Record<BikeCategory, string> = {
  standard: 'Standard (Road)',
  tt: 'Time Trial',
  gravel: 'Gravel',
  handbike: 'Hand Cycle',
  funbike: 'Fun Bike'
}

export const BIKE_CATEGORY_COLORS: Record<BikeCategory, 'primary' | 'info' | 'warning' | 'neutral' | 'success'> = {
  standard: 'primary',
  tt: 'info',
  gravel: 'warning',
  handbike: 'neutral',
  funbike: 'success'
}

export const WHEEL_CATEGORY_LABELS: Record<WheelCategory, string> = {
  aero: 'Aero',
  climb: 'Lightweight',
  gravel: 'Gravel',
  allrounder: 'All-round',
  disc: 'Disc / TT'
}

export const TERRAIN_LABELS: Record<TerrainCategory, string> = {
  flat: 'Flat',
  rolling: 'Rolling',
  hilly: 'Hilly',
  mountainous: 'Mountainous'
}

export const TERRAIN_COLORS: Record<TerrainCategory, 'success' | 'primary' | 'warning' | 'error'> = {
  flat: 'success',
  rolling: 'primary',
  hilly: 'warning',
  mountainous: 'error'
}

export function formatDistance(km: number): string {
  return `${km.toFixed(1)} km`
}

export function formatElevation(m: number): string {
  return `${Math.round(m)} m`
}

export function formatDuration(seconds: number): string {
  const totalSeconds = Math.round(seconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const secs = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

/**
 * Describes how much time a route's gravel/cobble sections cost vs. an
 * equivalent fully-paved route - see `estimateSurfaceTimePenaltySec`.
 * Returns `undefined` when there's nothing non-tarmac or no penalty to report.
 */
export function formatSurfaceTimePenalty(surface: SurfaceEstimate, penaltySec: number | undefined): string | undefined {
  if (!penaltySec || penaltySec <= 0) return undefined
  if (surface.gravel <= 0 && surface.cobble <= 0) return undefined

  const word = surface.gravel > 0 && surface.cobble > 0
    ? 'gravel and cobbles'
    : surface.gravel > 0 ? 'gravel' : 'cobbles'
  // "gravel" is a singular mass noun ("gravel adds...") but "cobbles" and the
  // combined "gravel and cobbles" read as plural ("...add...").
  const verb = surface.gravel > 0 && surface.cobble === 0 ? 'adds' : 'add'

  return `Due to increased rolling resistance, ${word} ${verb} ~${Math.round(penaltySec)}s to this route with the fastest combo below.`
}

/** Formats a time gap vs. the fastest combo on the route, e.g. `+45s slower` or `+1:23 slower`. */
export function formatDurationDelta(seconds: number): string {
  const totalSeconds = Math.round(seconds)
  if (totalSeconds <= 0) return 'fastest'
  if (totalSeconds < 60) return `+${totalSeconds}s slower`
  const minutes = Math.floor(totalSeconds / 60)
  const secs = totalSeconds % 60
  return `+${minutes}:${secs.toString().padStart(2, '0')} slower`
}

/** Formats an average speed (route distance in km over a finish time in seconds), e.g. `32.4 km/h`. */
export function formatSpeedKmh(distanceKm: number, seconds: number): string {
  if (seconds <= 0) return '-'
  const kmh = distanceKm / (seconds / 3600)
  return `${kmh.toFixed(1)} km/h`
}
