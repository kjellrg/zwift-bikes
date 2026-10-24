import type { UpgradeScheme } from '#shared/data/frameUpgradeSchemes'

/** A frame's four ratings, in the order and words the drawers print them. */
export const FRAME_RATINGS = [
  { key: 'aero', label: 'Aero (flat/fast)' },
  { key: 'climb', label: 'Climbing' },
  { key: 'gravel', label: 'Gravel' },
  { key: 'cobble', label: 'Cobbles' }
] as const

// Zwift's own names for the scheme, matching docs/bike-upgrade-levels.md.
const UPGRADE_TIER_LABELS: Record<UpgradeScheme['tier'], string> = { entry: 'entry-level', mid: 'mid-range', high: 'high-end' }

/** "high-end frame, stages earned by duration". */
export function upgradeSchemeText(scheme: UpgradeScheme): string {
  return `${UPGRADE_TIER_LABELS[scheme.tier]} frame, stages earned by ${scheme.axis}`
}
