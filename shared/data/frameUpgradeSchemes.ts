/**
 * Zwift's real per-stage bike upgrade schemes.
 *
 * Every frame is assigned one of 9 upgrade schemes: a progression axis
 * (Distance / Duration / Elevation - what you must do to earn each stage)
 * crossed with a price tier (Entry-Level / Mid-Range / High-End). Halo
 * frames share their tier's High-End performance chart - ZwiftInsider
 * confirms "the performance upgrades a 'maxed out' bike receives are the
 * same for all bikes within [a] category" regardless of tier, Halo's only
 * difference is unlock cost/distance, which this app doesn't model - so
 * Halo frames use `tier: 'high'` here.
 *
 * Sources (bot-tested at 300W, verified against the live pages):
 * - https://zwiftinsider.com/bike-upgrade-details/ - the frame -> scheme table
 * - https://zwiftinsider.com/upgrade-charts/ - the per-scheme, per-stage
 *   seconds-saved charts (`STAGE_CHARTS` below)
 *
 * Frame names here are `zwift-data` spellings (matching
 * `frameSpeedData.ts`'s keys), not ZwiftInsider's sheet/table spelling,
 * since the two frequently differ - see `classifyBikeFrame.ts`'s notes on
 * Van Rysel/Tarmac naming.
 */

export type UpgradeAxis = 'distance' | 'duration' | 'elevation'
export type UpgradeTier = 'entry' | 'mid' | 'high'

export interface UpgradeScheme {
  axis: UpgradeAxis
  tier: UpgradeTier
}

/**
 * Stage 1-5 seconds-saved-per-hour, read directly off each scheme's chart on
 * zwiftinsider.com/upgrade-charts/. Stage 0 is always 0 (just purchased) so
 * isn't stored. Values aren't necessarily monotonic (ZwiftInsider notes real
 * bot-test frames can be 0.1-2s slower at one stage than the previous one
 * due to how a stage trades off aero vs. weight) - that's real, not an error.
 */
export type StageCurve = readonly [number, number, number, number, number]

export interface StageChart {
  flat: StageCurve
  climb: StageCurve
}

type SchemeKey = `${UpgradeAxis}-${UpgradeTier}`

export const STAGE_CHARTS: Record<SchemeKey, StageChart> = {
  // Flat stage 2 is 16.4s, not the 23.1 the published chart shows: all 12
  // frames' own per-stage sheet rows put stage 2 at a mean 59.1% of the
  // 27.8s total (16.4), not 83% (23.1) - and 23.1 happens to be the
  // CAAD12's *absolute* stage-2 gap on the sheet, so the chart most likely
  // copied that cell instead of the per-stage saving. Third documented
  // defect in these chart graphics (see the two below). Only matters for
  // future distance-entry frames without their own `flatGapSecByStage`
  // curve; see also PUBLISHED_CHART_CORRECTIONS in
  // scripts/upgrade-levels/verify-upgrade-data.mjs.
  'distance-entry': { flat: [14.8, 16.4, 27.8, 27.8, 27.8], climb: [2.4, 25.6, 36.2, 36.2, 36.2] },
  'distance-mid': { flat: [11.5, 13.2, 24.6, 28.5, 28.5], climb: [2.2, 24.6, 36, 36.6, 36.6] },
  'distance-high': { flat: [11.6, 12.8, 24.4, 28.1, 28], climb: [2, 17.8, 28.5, 29.3, 37.3] },
  // Stage 1 climb is 3.4s, not 34s: the flat value on this row IS 34, so the
  // two are easy to transpose when copying.
  'duration-entry': { flat: [34, 35, 47.9, 47.9, 47.9], climb: [3.4, 14.7, 26.8, 26.8, 26.8] },
  'duration-mid': { flat: [8.7, 9.8, 22.7, 48.6, 48.6], climb: [0.9, 12.9, 23.1, 26.2, 26.2] },
  'duration-high': { flat: [9.1, 10, 22.8, 22.8, 49.3], climb: [1.1, 8.2, 19.4, 23.5, 26.3] },
  'elevation-entry': { flat: [7.4, 10.2, 21.3, 21.3, 21.3], climb: [0.7, 48.4, 58, 58, 58] },
  'elevation-mid': { flat: [4.9, 10.5, 22.3, 23.5, 23.5], climb: [0.4, 41.2, 50.4, 50.8, 50.8] },
  // Stage 1 flat is 5.8s, not 5.2s. Corroborated by the power chart: stage 1
  // saves 1.3W here vs 1.7W/1.1W on the entry/mid charts, and 5.8 keeps
  // seconds-per-watt at 4.46 in line with their 4.35/4.45; 5.2 gives 4.00.
  'elevation-high': { flat: [5.8, 8.4, 19.8, 21.3, 21.7], climb: [0.9, 36.6, 47.6, 47.9, 59.8] }
}

export function stageChartFor(scheme: UpgradeScheme): StageChart {
  return STAGE_CHARTS[`${scheme.axis}-${scheme.tier}`]
}

/**
 * Stage 3 is a "Drivetrain" upgrade in all 12 rows of ZwiftInsider's
 * per-tier upgrade tables (every axis x tier, including Halo), so it lands
 * at the same stage for every frame.
 *
 * It is NOT a drivetrain-efficiency (power multiplier) change, despite the
 * name. A power multiplier saves the same wattage at any speed, but the
 * stage-3 step in ZwiftInsider's power-savings charts saves ~2.6 W on the
 * flat and only ~1.0 W on the climb - a 2.6:1 ratio that tracks the 2.67:1
 * flat/climb bot-test speed ratio. That is the signature of a constant
 * retarding-force (i.e. rolling-resistance) reduction, and only of that:
 * fitted to the flat step, an efficiency change predicts 2.6 W on the climb
 * (way high), a CdA change 0.14 W (way low) and a mass change 15.4 W (wildly
 * high), while a Crr change predicts 0.97 W against the charted 1.0 W.
 *
 * Fitting all 18 flat/climb power steps (9 schemes x 2) gives a consistent
 * -0.000303 mean (range -0.00024 to -0.00034), i.e. one shared upgrade, so
 * this is a single global constant rather than per-scheme data. Applied as
 * an absolute offset to whatever surface Crr is in play, not a percentage:
 * drivetrain friction doesn't care what you're rolling over.
 */
export const DRIVETRAIN_UPGRADE_STAGE = 3
export const DRIVETRAIN_UPGRADE_CRR_DELTA = -0.0003

export function drivetrainCrrDeltaForLevel(level: number): number {
  return level >= DRIVETRAIN_UPGRADE_STAGE ? DRIVETRAIN_UPGRADE_CRR_DELTA : 0
}

// Two documented cases where a frame's scheme axis doesn't match its Type
// column (Road frames upgrading like TT bikes, and vice versa) - Zwift's
// assignment, not a data error. See zwiftinsider.com/bike-upgrade-details/.
export const FRAME_UPGRADE_SCHEMES: Record<string, UpgradeScheme> = {
  // --- standard/road frames (FRAME_SPEED_DATA keys) ---
  'Allied Able': { axis: 'distance', tier: 'mid' },
  'BMC Roadmachine': { axis: 'distance', tier: 'mid' },
  'BMC SLR01': { axis: 'distance', tier: 'high' },
  'BMC TeamMachine': { axis: 'distance', tier: 'high' },
  'Bridgestone Anchor RS9s': { axis: 'elevation', tier: 'mid' },
  'Cannondale CAAD12': { axis: 'distance', tier: 'entry' },
  'Cannondale CAAD13': { axis: 'distance', tier: 'mid' },
  'Cannondale EVO': { axis: 'distance', tier: 'mid' },
  // Halo (tier: high per the header note). The sheet's own per-stage gaps
  // (flat +12.4/13.6/25.8/29.8/30.0) match the distance-high chart.
  'Cannondale R4000 Roller Blade': { axis: 'distance', tier: 'high' },
  'Cannondale Super Six Evo': { axis: 'distance', tier: 'high' },
  'Cannondale SuperSix Evo LAB71': { axis: 'distance', tier: 'high' },
  'Cannondale SuperSix EVO LAB71 Team': { axis: 'distance', tier: 'high' },
  'Cannondale Synapse': { axis: 'distance', tier: 'entry' },
  'Cannondale System Six': { axis: 'distance', tier: 'mid' },
  // Not in ZwiftInsider's table (recent releases) - assumed from the
  // unversioned/base model's own scheme.
  'Canyon Aeroad 2015': { axis: 'distance', tier: 'mid' },
  'Canyon Aeroad 2021': { axis: 'distance', tier: 'high' },
  'Canyon Aeroad 2024': { axis: 'distance', tier: 'high' },
  'Canyon Aeroad 2024 / SRAM': { axis: 'distance', tier: 'high' },
  'Canyon Aeroad CFR Alpecin Premier-Tech': { axis: 'distance', tier: 'high' },
  'Canyon Inflite': { axis: 'distance', tier: 'entry' },
  'Canyon Lux': { axis: 'elevation', tier: 'mid' },
  'Canyon Ultimate': { axis: 'distance', tier: 'mid' },
  'Canyon Ultimate CFR': { axis: 'distance', tier: 'high' },
  'Cervelo R5': { axis: 'distance', tier: 'mid' },
  'Cervelo S3D': { axis: 'distance', tier: 'mid' },
  'Cervelo S5': { axis: 'distance', tier: 'high' },
  'Cervelo S5 2015': { axis: 'distance', tier: 'mid' },
  'Cervelo S5 2020': { axis: 'distance', tier: 'high' },
  'Chapter2 Koko': { axis: 'distance', tier: 'high' },
  'Chapter2 Rere': { axis: 'distance', tier: 'mid' },
  'Chapter2 Tere': { axis: 'distance', tier: 'entry' },
  'Chapter2 Toa': { axis: 'distance', tier: 'mid' },
  'Colnago V3RS': { axis: 'distance', tier: 'high' },
  'Cube Litening': { axis: 'distance', tier: 'mid' },
  'Cube Litening C:68X': { axis: 'distance', tier: 'high' },
  'Factor One': { axis: 'distance', tier: 'high' },
  'Felt AR': { axis: 'distance', tier: 'mid' },
  'Felt FR': { axis: 'distance', tier: 'high' },
  'Focus Izalco Max': { axis: 'distance', tier: 'mid' },
  'Giant Propel Advanced SL Disc': { axis: 'distance', tier: 'high' },
  'Giant Propel Advanced SL Team': { axis: 'distance', tier: 'high' },
  'Giant TCR Advanced SL 2021': { axis: 'distance', tier: 'mid' },
  'Giant TCR Advanced SL 2025': { axis: 'distance', tier: 'high' },
  'Giant TCR BikeExchange-Jayco Team': { axis: 'distance', tier: 'high' },
  // Real, documented exception: Road-type frame that upgrades on the
  // Duration axis, like a TT bike.
  'Liv Langma Advanced SL 2021': { axis: 'duration', tier: 'high' },
  'Liv Langma Advanced SL 2025': { axis: 'distance', tier: 'high' },
  'Liv Langma SL Advanced Disc': { axis: 'distance', tier: 'mid' },
  'Moots Vamoots RCS': { axis: 'distance', tier: 'high' },
  'Mosaic RT-1d': { axis: 'distance', tier: 'mid' },
  'Parlee ESX': { axis: 'distance', tier: 'entry' },
  'Parlee RZ7': { axis: 'distance', tier: 'high' },
  'Pinarello Dogma 65.1': { axis: 'distance', tier: 'mid' },
  'Pinarello Dogma F 2021': { axis: 'distance', tier: 'high' },
  'Pinarello Dogma F 2024': { axis: 'distance', tier: 'high' },
  'Pinarello Dogma F10': { axis: 'distance', tier: 'high' },
  'Pinarello Dogma F12': { axis: 'distance', tier: 'high' },
  'Pinarello Dogma X': { axis: 'distance', tier: 'high' },
  'Pinarello F8': { axis: 'distance', tier: 'mid' },
  'Ribble Endurance': { axis: 'distance', tier: 'entry' },
  'Ridley Helium': { axis: 'distance', tier: 'mid' },
  'Ridley Noah Fast 2019': { axis: 'distance', tier: 'high' },
  'Scott Addict RC': { axis: 'distance', tier: 'mid' },
  'Scott Foil 2015': { axis: 'distance', tier: 'mid' },
  'Scott Foil 2023': { axis: 'distance', tier: 'high' },
  'Specialized Aethos S-Works': { axis: 'elevation', tier: 'high' },
  'Specialized Allez': { axis: 'distance', tier: 'entry' },
  'Specialized Allez Sprint': { axis: 'distance', tier: 'mid' },
  'Specialized Amira': { axis: 'distance', tier: 'entry' },
  'Specialized Amira S-Works': { axis: 'distance', tier: 'mid' },
  'Specialized PROJECT 74': { axis: 'distance', tier: 'high' },
  'Specialized Roubaix': { axis: 'distance', tier: 'mid' },
  // Real, documented exception: Road-type frame that upgrades on the
  // Duration axis, like a TT bike.
  'Specialized Roubaix S-Works': { axis: 'duration', tier: 'high' },
  'Specialized Ruby': { axis: 'distance', tier: 'entry' },
  'Specialized Ruby S-Works': { axis: 'distance', tier: 'mid' },
  'Specialized S-Works Tarmac SL8': { axis: 'distance', tier: 'high' },
  'Specialized Tarmac': { axis: 'distance', tier: 'mid' },
  'Specialized Tarmac Pro': { axis: 'distance', tier: 'mid' },
  'Specialized Tarmac SL7': { axis: 'distance', tier: 'high' },
  'Specialized Tarmac SL8': { axis: 'distance', tier: 'high' },
  'Specialized Tarmac SL9': { axis: 'distance', tier: 'high' },
  'Specialized Venge 2015': { axis: 'distance', tier: 'mid' },
  'Specialized Venge S-Works 2019': { axis: 'distance', tier: 'high' },
  'Trek Emonda': { axis: 'elevation', tier: 'high' },
  'Trek Emonda SL': { axis: 'elevation', tier: 'entry' },
  'Trek Madone': { axis: 'distance', tier: 'high' },
  // Not in ZwiftInsider's table - no close relative to base an assumption
  // on, so kept at the most common tier for its endpoint magnitude.
  'Uranium Nuclear': { axis: 'distance', tier: 'mid' },
  'VanRysel EDR CF': { axis: 'distance', tier: 'mid' },
  'VanRysel RCR Pro': { axis: 'distance', tier: 'mid' },
  'VanRysel RCR-F': { axis: 'distance', tier: 'high' },
  'Ventum NS1': { axis: 'distance', tier: 'mid' },
  'Wilier Filante SLR ID2 Team': { axis: 'distance', tier: 'high' },
  'Zwift Aero': { axis: 'distance', tier: 'entry' },
  'Zwift Carbon': { axis: 'distance', tier: 'entry' },
  'Zwift Concept Z1': { axis: 'distance', tier: 'high' },
  'Zwift Golden Concept Z1': { axis: 'distance', tier: 'high' },
  'Zwift Steel': { axis: 'distance', tier: 'entry' },

  // --- TT frames (TT_FRAME_SPEED_DATA keys) ---
  'BMC Timemachine01': { axis: 'duration', tier: 'mid' },
  'Cadex Tri': { axis: 'duration', tier: 'high' },
  'Canyon Speedmax': { axis: 'duration', tier: 'mid' },
  'Canyon Speedmax CF SLX Disc': { axis: 'duration', tier: 'high' },
  'Canyon Speedmax CFR': { axis: 'duration', tier: 'high' },
  'Cervelo P5': { axis: 'duration', tier: 'mid' },
  // Real, documented exception: TT-type frame that upgrades on the
  // Distance axis, like a road bike.
  'Cervelo PX-Series': { axis: 'distance', tier: 'high' },
  'Cube Aerium': { axis: 'duration', tier: 'high' },
  'DiamondBack Andean': { axis: 'duration', tier: 'high' },
  'Felt IA': { axis: 'duration', tier: 'high' },
  'Felt IA 2.0': { axis: 'duration', tier: 'high' },
  'Pinarello Bolide': { axis: 'duration', tier: 'mid' },
  'Pinarello Bolide TT': { axis: 'duration', tier: 'high' },
  'Pinarello Espada': { axis: 'duration', tier: 'high' },
  'QuintanaRoo Roo V-PR': { axis: 'duration', tier: 'high' },
  'Scott Plasma': { axis: 'duration', tier: 'mid' },
  'Scott Plasma RC Ultimate': { axis: 'duration', tier: 'high' },
  'Specialized Shiv': { axis: 'duration', tier: 'high' },
  'Specialized Shiv Disc': { axis: 'duration', tier: 'high' },
  'Specialized Shiv S-Works': { axis: 'duration', tier: 'high' },
  'Trek Speed Concept SLR 9': { axis: 'duration', tier: 'high' },
  'VanRysel RCR-X': { axis: 'duration', tier: 'high' },
  // Real, documented exception: TT-type frame that upgrades on the
  // Distance axis, like a road bike.
  'Ventum One': { axis: 'distance', tier: 'high' },
  'Zwift TT': { axis: 'duration', tier: 'entry' }
}
