import type { UpgradeScheme } from '#shared/data/frameUpgradeSchemes'

/** What each of a frame's five upgrade stages pays: stage 1 first. See `docs/bike-upgrade-levels.md`. */
export function stageUpgrades(scheme: UpgradeScheme): string[] {
  const tail = scheme.tier === 'entry'
    ? ['Drops', 'XP']
    : scheme.tier === 'mid'
      ? ['Aero', 'Drops']
      : ['Aero', 'Weight']
  // Only the high-end duration frames swap their last two stages. The
  // docs' footnote says the mid-range duration ones do too, but their
  // measured curves jump on the flat at stage 4, which is an aero stage.
  if (scheme.axis === 'duration' && scheme.tier === 'high') tail.reverse()
  return ['Aero', 'Weight', 'Drivetrain', ...tail]
}

/**
 * What each stage adds on one bot test, stage 1 to 5: the step from the stage
 * before, in seconds per hour. `gains` are the six cumulative gains over
 * stage 0 that `upgradeGains` returns for a frame's curve.
 */
export function stageSteps(gains: readonly number[]): number[] {
  return gains.slice(1).map((gain, index) => gain - (gains[index] ?? 0))
}
