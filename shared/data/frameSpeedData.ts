/**
 * Real bot-tested speed data for `standard` (road) and `tt` bike frames,
 * sourced from ZwiftInsider's public speed-test spreadsheet
 * (https://zwiftinsider.com/charts-frames/ and https://zwiftinsider.com/charts-tt/),
 * which publish results from Zwift's own "bot" testing methodology (a fixed
 * rider profile completing a flat and a climb test route at constant power).
 *
 * Every frame in Zwift is progressively unlocked over 5 "stages" of riding
 * after purchase (Stage 0 = just bought, Stage 5 = fully unlocked/upgraded).
 * The values here are each frame's time saved/lost over one hour of riding
 * at a fixed power, separately for a flat course and a climb course.
 * Positive = faster than baseline, negative = slower.
 *
 * ZwiftInsider's sheet now bot-tests ALL SIX stages per frame, not just the
 * endpoints: where a frame has been stage-tested, `flatGapSecByStage`/
 * `climbGapSecByStage` hold the full measured curve (imported via
 * `scripts/upgrade-levels/import-stage-curves.mjs`) and `classifyBikeFrame.ts`
 * reads an intermediate level straight off it. Frames the sheet hasn't
 * stage-tested yet (recent releases) carry only the `*0`/`*5` endpoints, and
 * levels 1-4 fall back to the per-scheme shape published for each of the 9
 * upgrade schemes - see `frameUpgradeSchemes.ts`. The endpoints stay
 * authoritative either way: `scripts/validate-speed-data.mjs` fails the build
 * if a stage array disagrees with its row's `*0`/`*5` fields.
 *
 * `FRAME_SPEED_DATA` (standard/road frames) is relative to the baseline
 * "Zwift Carbon" frame + "Zwift 32mm Carbon" wheels. `TT_FRAME_SPEED_DATA`
 * (TT frames) is relative to the baseline "Zwift TT" frame + "Zwift 32mm
 * Carbon" wheels instead - a *different* baseline, so the two tables' values
 * aren't directly comparable to each other.
 *
 * `gravel`/`handbike`/`funbike` frames aren't covered by either table -
 * ZwiftInsider doesn't run the same comparative test for those categories,
 * so they keep using the fixed heuristic presets in `classifyBikeFrame.ts`.
 * The sheet's "Halo" bikes (Concept Z1, PROJECT 74, Espada, ...) *are*
 * tested and so do appear here, measured as one frame+integrated-wheel unit
 * rather than as a bare frame - see `FIXED_WHEEL_FRAMES`.
 *
 * Note the source sheet holds two test rows per bike, one at 150W and one
 * at 300W, with materially different gaps. Every value below is from the
 * 300W row (verified against the baseline "Zwift Carbon" row: 0 -> 26.5
 * flat, 0 -> 36.9 climb); mixing the two would silently corrupt the table.
 *
 * Frames not present in these tables (new releases, cosmetic team-edition
 * skins, etc.) fall back to the existing name-based heuristic.
 *
 * A previous version of this note also blamed "a couple of rows in the
 * source sheet with corrupted Stage 5 data". That was wrong for the rows
 * still in this table: the odd-looking ones (Specialized Roubaix S-Works,
 * Liv Langma Advanced SL 2021 - road frames with TT-shaped Stage 5 gains)
 * are real, and are explained by Zwift assigning them the Duration upgrade
 * scheme despite their Road type. See `frameUpgradeSchemes.ts`.
 */
export interface FrameSpeedSample {
  /** Seconds saved (+) or lost (-) per hour on a flat course at Stage 0 (just purchased) */
  flatGapSec0: number
  /** Seconds saved (+) or lost (-) per hour on a flat course at Stage 5 (fully unlocked) */
  flatGapSec5: number
  /** Seconds saved (+) or lost (-) per hour on a climb course at Stage 0 (just purchased) */
  climbGapSec0: number
  /** Seconds saved (+) or lost (-) per hour on a climb course at Stage 5 (fully unlocked) */
  climbGapSec5: number
  /**
   * Measured flat gap at every stage `[stage0..stage5]`, present only for
   * sheet stage-tested frames. Endpoints must equal `flatGapSec0`/`flatGapSec5`
   * (enforced by `validate-speed-data.mjs`). Not necessarily monotonic - real
   * bot tests show a stage can trade a fraction of a second back (e.g. the
   * CAAD12's flat Stage 4 34.6 vs Stage 5 34.0).
   */
  flatGapSecByStage?: readonly [number, number, number, number, number, number]
  /** Measured climb gap at every stage `[stage0..stage5]` - same contract as `flatGapSecByStage`. */
  climbGapSecByStage?: readonly [number, number, number, number, number, number]
}

// The Concept Z1 ("Tron") is listed on the source sheet as a Halo bike, with
// its own integrated wheels in the `Wheels` column, so this sample covers the
// whole frame+wheel unit (see `FIXED_WHEEL_FRAMES` in `classifyBikeFrame.ts`).
// `Zwift Golden Concept Z1` is the same bike with a gold light scheme and is
// not tested separately by ZwiftInsider, so both frames deliberately share
// this one sample instead of carrying two copies of the numbers that could
// drift apart. Only one of the two is ever listed in ranked results - see
// `isRedundantCosmeticVariant`.
const CONCEPT_Z1: FrameSpeedSample = { flatGapSec0: 114.6, flatGapSec5: 144, climbGapSec0: 31.1, climbGapSec5: 68, flatGapSecByStage: [114.6, 126.8, 128, 140.1, 144.2, 144], climbGapSecByStage: [31.1, 33.7, 48.8, 60.8, 60.6, 68] }

export const FRAME_SPEED_DATA: Record<string, FrameSpeedSample> = {
  'Allied Able': { flatGapSec0: -136.7, flatGapSec5: -111.9, climbGapSec0: -138.4, climbGapSec5: -103.9, flatGapSecByStage: [-136.7, -129, -126.3, -114.5, -111.2, -111.9], climbGapSecByStage: [-138.4, -136.7, -113.8, -104, -103.3, -103.9] },
  'BMC Roadmachine': { flatGapSec0: 7.8, flatGapSec5: 35.1, climbGapSec0: 20, climbGapSec5: 55.6, flatGapSecByStage: [7.8, 19, 20.8, 32, 35.3, 35.1], climbGapSecByStage: [20, 21.9, 44.3, 55.1, 56.1, 55.6] },
  'BMC SLR01': { flatGapSec0: 8.5, flatGapSec5: 35.8, climbGapSec0: 28.6, climbGapSec5: 64.5, flatGapSecByStage: [8.5, 19.5, 20.8, 32.1, 35.4, 35.8], climbGapSecByStage: [28.6, 30, 45.6, 56.1, 56.5, 64.5] },
  'BMC TeamMachine': { flatGapSec0: 41.6, flatGapSec5: 69.8, climbGapSec0: 38.2, climbGapSec5: 74.4, flatGapSecByStage: [41.6, 53.1, 54.2, 65.7, 69.5, 69.8], climbGapSecByStage: [38.2, 39.6, 55.8, 66.9, 67.1, 74.4] },
  'Bridgestone Anchor RS9s': { flatGapSec0: 9.1, flatGapSec5: 30.2, climbGapSec0: 40.9, climbGapSec5: 100.1, flatGapSecByStage: [9.1, 14.9, 17.6, 28.7, 30.5, 30.2], climbGapSecByStage: [40.9, 41.1, 88.4, 98.9, 99.8, 100.1] },
  'Cannondale CAAD12': { flatGapSec0: 6.8, flatGapSec5: 34, climbGapSec0: -0.4, climbGapSec5: 35.9, flatGapSecByStage: [6.8, 21.6, 23.1, 34.5, 34.6, 34], climbGapSecByStage: [-0.4, 2.1, 25.2, 35.8, 35.9, 35.9] },
  'Cannondale CAAD13': { flatGapSec0: 58.4, flatGapSec5: 86.3, climbGapSec0: 29.9, climbGapSec5: 67.3, flatGapSecByStage: [58.4, 70, 71.6, 83.1, 86.9, 86.3], climbGapSecByStage: [29.9, 32.1, 54.5, 65.9, 66.6, 67.3] },
  'Cannondale EVO': { flatGapSec0: 9.3, flatGapSec5: 36.7, climbGapSec0: 43.5, climbGapSec5: 80.4, flatGapSecByStage: [9.3, 20.4, 22, 33.2, 37, 36.7], climbGapSecByStage: [43.5, 45.2, 68.2, 80.6, 80, 80.4] },
  // Halo bike measured as one frame+integrated-wheel unit (the sheet's Wheels
  // column names the bike itself) - see FIXED_WHEEL_FRAMES. The fastest flat
  // frame in the sheet, ahead of the Concept Z1's 114.6 at Stage 0.
  'Cannondale R4000 Roller Blade': { flatGapSec0: 120.8, flatGapSec5: 150.8, climbGapSec0: 7.7, climbGapSec5: 43.2, flatGapSecByStage: [120.8, 133.2, 134.4, 146.6, 150.6, 150.8], climbGapSecByStage: [7.7, 9.3, 25.3, 36.7, 36.5, 43.2] },
  'Cannondale Super Six Evo': { flatGapSec0: 45.4, flatGapSec5: 73.5, climbGapSec0: 42.3, climbGapSec5: 79.4, flatGapSecByStage: [45.4, 56.9, 58.2, 70, 73.3, 73.5], climbGapSecByStage: [42.3, 44.1, 59.5, 70.3, 71, 79.4] },
  'Cannondale SuperSix Evo LAB71': { flatGapSec0: 61.4, flatGapSec5: 89.4, climbGapSec0: 53.5, climbGapSec5: 90.8, flatGapSecByStage: [61.4, 73, 74.2, 85.8, 89.5, 89.4], climbGapSecByStage: [53.5, 55.5, 71.3, 82, 82.8, 90.8] },
  'Cannondale SuperSix EVO LAB71 Team': { flatGapSec0: 62.6, flatGapSec5: 91, climbGapSec0: 55.4, climbGapSec5: 93.4, flatGapSecByStage: [62.6, 74.1, 75.1, 86.7, 90.9, 91], climbGapSecByStage: [55.4, 57.8, 73.6, 84.8, 85.1, 93.4] },
  'Cannondale Synapse': { flatGapSec0: 8.2, flatGapSec5: 35.5, climbGapSec0: 24.5, climbGapSec5: 61.3, flatGapSecByStage: [8.2, 22.9, 24.5, 35.9, 35.7, 35.5], climbGapSecByStage: [24.5, 26.9, 49.9, 60.8, 61, 61.3] },
  'Cannondale System Six': { flatGapSec0: 61, flatGapSec5: 89.5, climbGapSec0: 13.5, climbGapSec5: 49.7, flatGapSecByStage: [61, 72.7, 74.4, 86.1, 89.8, 89.5], climbGapSecByStage: [13.5, 14.9, 38.4, 48.8, 49.2, 49.7] },
  'Canyon Aeroad 2015': { flatGapSec0: 57.1, flatGapSec5: 85.5, climbGapSec0: 17.2, climbGapSec5: 53.4, flatGapSecByStage: [57.1, 68.8, 70.7, 82.4, 85.8, 85.5], climbGapSecByStage: [17.2, 18.4, 41.5, 52.8, 53.1, 53.4] },
  'Canyon Aeroad 2021': { flatGapSec0: 60.4, flatGapSec5: 88.7, climbGapSec0: 40.1, climbGapSec5: 76.7, flatGapSecByStage: [60.4, 71.9, 73.2, 84.9, 88.5, 88.7], climbGapSecByStage: [40.1, 41.8, 56.7, 68.5, 68.9, 76.7] },
  'Canyon Aeroad 2024': { flatGapSec0: 63, flatGapSec5: 91.5, climbGapSec0: 43.9, climbGapSec5: 81.3, flatGapSecByStage: [63, 74.9, 76.2, 87.8, 91.5, 91.5], climbGapSecByStage: [43.9, 45.7, 61.6, 72, 73.7, 81.3] },
  'Canyon Aeroad 2024 / SRAM': { flatGapSec0: 63.3, flatGapSec5: 92.4, climbGapSec0: 43.6, climbGapSec5: 80.1, flatGapSecByStage: [63.3, 74.6, 75.8, 87.6, 92.1, 92.4], climbGapSecByStage: [43.6, 44.6, 60.7, 71.7, 72.6, 80.1] },
  'Canyon Aeroad CFR Alpecin Premier-Tech': { flatGapSec0: 63.3, flatGapSec5: 92.4, climbGapSec0: 43.6, climbGapSec5: 80.1, flatGapSecByStage: [63.3, 74.6, 75.8, 87.6, 92.1, 92.4], climbGapSecByStage: [43.6, 44.6, 60.7, 71.7, 72.6, 80.1] },
  'Canyon Inflite': { flatGapSec0: -138.7, flatGapSec5: -113.9, climbGapSec0: -158.8, climbGapSec5: -124.5, flatGapSecByStage: [-138.7, -127.6, -125, -112.5, -113.2, -113.9], climbGapSecByStage: [-158.8, -157.4, -135, -124.5, -125.4, -124.5] },
  'Canyon Lux': { flatGapSec0: -223.4, flatGapSec5: -200.1, climbGapSec0: -360.9, climbGapSec5: -310.7, flatGapSecByStage: [-223.4, -218.5, -212.9, -201.1, -199.9, -200.1], climbGapSecByStage: [-360.9, -360.5, -319.7, -310.5, -310.1, -310.7] },
  'Canyon Ultimate': { flatGapSec0: 9, flatGapSec5: 36.3, climbGapSec0: 37.8, climbGapSec5: 74.3, flatGapSecByStage: [9, 20, 21.7, 32.9, 36.7, 36.3], climbGapSecByStage: [37.8, 39.9, 62.9, 73.8, 74.5, 74.3] },
  'Canyon Ultimate CFR': { flatGapSec0: 9.3, flatGapSec5: 36.7, climbGapSec0: 44.2, climbGapSec5: 80.1, flatGapSecByStage: [9.3, 20.5, 21.6, 32.7, 36.4, 36.7], climbGapSecByStage: [44.2, 45.7, 60.1, 72.3, 72.7, 80.1] },
  'Cervelo R5': { flatGapSec0: 9.5, flatGapSec5: 36.3, climbGapSec0: 36, climbGapSec5: 72.5, flatGapSecByStage: [9.5, 20, 21.6, 32.9, 36.5, 36.3], climbGapSecByStage: [36, 37.9, 61.6, 71.9, 73, 72.5] },
  'Cervelo S3D': { flatGapSec0: 52.3, flatGapSec5: 80.9, climbGapSec0: 4.9, climbGapSec5: 40.9, flatGapSecByStage: [52.3, 63.9, 65.7, 77.1, 81.2, 80.9], climbGapSecByStage: [4.9, 5.6, 29.9, 39.9, 40.6, 40.9] },
  'Cervelo S5': { flatGapSec0: 63.5, flatGapSec5: 92.6, climbGapSec0: 39.8, climbGapSec5: 76.2, flatGapSecByStage: [63.5, 74.8, 76, 87.7, 92.1, 92.6], climbGapSecByStage: [39.8, 41.6, 56.9, 68.3, 68.6, 76.2] },
  'Cervelo S5 2015': { flatGapSec0: 61.8, flatGapSec5: 90.9, climbGapSec0: 30.8, climbGapSec5: 67.1, flatGapSecByStage: [61.8, 74, 75.9, 87.6, 91.2, 90.9], climbGapSecByStage: [30.8, 32.4, 56.4, 67.3, 67, 67.1] },
  'Cervelo S5 2020': { flatGapSec0: 62.4, flatGapSec5: 91, climbGapSec0: 31.4, climbGapSec5: 68.3, flatGapSecByStage: [62.4, 74, 75.5, 87.2, 90.8, 91], climbGapSecByStage: [31.4, 32.8, 48.5, 59.3, 59.8, 68.3] },
  'Chapter2 Koko': { flatGapSec0: 17.4, flatGapSec5: 44.5, climbGapSec0: 32.3, climbGapSec5: 69.5, flatGapSecByStage: [17.4, 28.6, 29.8, 41.2, 44.7, 44.5], climbGapSecByStage: [32.3, 35, 49.9, 61.1, 61.5, 69.5] },
  'Chapter2 Rere': { flatGapSec0: 14.5, flatGapSec5: 41.9, climbGapSec0: 8.1, climbGapSec5: 43.9, flatGapSecByStage: [14.5, 25.7, 27.2, 38.6, 42.2, 41.9], climbGapSecByStage: [8.1, 10.7, 33, 43.8, 44.3, 43.9] },
  'Chapter2 Tere': { flatGapSec0: 9, flatGapSec5: 36.3, climbGapSec0: 36, climbGapSec5: 72.4, flatGapSecByStage: [9, 23.5, 25.4, 36.6, 36.5, 36.3], climbGapSecByStage: [36, 38.3, 61.5, 72.3, 72.4, 72.4] },
  'Chapter2 Toa': { flatGapSec0: 59.4, flatGapSec5: 87.5, climbGapSec0: 38.7, climbGapSec5: 75.2, flatGapSecByStage: [59.4, 70.9, 72.5, 84, 87.8, 87.5], climbGapSecByStage: [38.7, 39.8, 63.7, 74.6, 75, 75.2] },
  'Colnago V3RS': { flatGapSec0: 8.4, flatGapSec5: 35.5, climbGapSec0: 24.9, climbGapSec5: 61.1, flatGapSecByStage: [8.4, 19.3, 20.5, 31.9, 35.2, 35.5], climbGapSecByStage: [24.9, 26, 41.4, 52.1, 52.7, 61.1] },
  'Cube Litening': { flatGapSec0: 8.9, flatGapSec5: 36.1, climbGapSec0: 34.9, climbGapSec5: 70.2, flatGapSecByStage: [8.9, 19.9, 21.5, 32.7, 36.4, 36.1], climbGapSecByStage: [34.9, 35.8, 59, 69.8, 69.8, 70.2] },
  'Cube Litening C:68X': { flatGapSec0: 9.2, flatGapSec5: 36.6, climbGapSec0: 42.8, climbGapSec5: 80, flatGapSecByStage: [9.2, 20.4, 21.5, 32.7, 36.4, 36.6], climbGapSecByStage: [42.8, 44.5, 59.9, 70.9, 71.5, 80] },
  'Factor One': { flatGapSec0: 51.5, flatGapSec5: 79.8, climbGapSec0: 11.3, climbGapSec5: 47.1, flatGapSecByStage: [51.5, 63, 64.4, 76, 79.6, 79.8], climbGapSecByStage: [11.3, 12.5, 27.7, 38.8, 39.4, 47.1] },
  'Felt AR': { flatGapSec0: 62.6, flatGapSec5: 91.2, climbGapSec0: 36.7, climbGapSec5: 72.8, flatGapSecByStage: [62.6, 74.3, 76.2, 87.6, 91.5, 91.2], climbGapSecByStage: [36.7, 37.7, 61.3, 72.1, 72.3, 72.8] },
  'Felt FR': { flatGapSec0: 27, flatGapSec5: 54.6, climbGapSec0: 39.7, climbGapSec5: 75.7, flatGapSecByStage: [27, 38.2, 39.2, 50.8, 54.4, 54.6], climbGapSecByStage: [39.7, 40.9, 57.5, 67.6, 68.5, 75.7] },
  'Focus Izalco Max': { flatGapSec0: 56.1, flatGapSec5: 84.7, climbGapSec0: 30.4, climbGapSec5: 67.3, flatGapSecByStage: [56.1, 67.9, 69.8, 81.5, 84.9, 84.7], climbGapSecByStage: [30.4, 32.6, 55, 66.4, 66.8, 67.3] },
  'Giant Propel Advanced SL Disc': { flatGapSec0: 56.4, flatGapSec5: 84.9, climbGapSec0: 25.6, climbGapSec5: 62.3, flatGapSecByStage: [56.4, 68.1, 69.4, 81.2, 84.7, 84.9], climbGapSecByStage: [25.6, 27.1, 42.8, 53.4, 54, 62.3] },
  'Giant Propel Advanced SL Team': { flatGapSec0: 61.7, flatGapSec5: 90, climbGapSec0: 43.5, climbGapSec5: 82.8, flatGapSecByStage: [61.7, 73.1, 73.9, 85.4, 90.1, 90], climbGapSecByStage: [43.5, 47.9, 64.1, 74.9, 75.2, 82.8] },
  'Giant TCR Advanced SL 2021': { flatGapSec0: 8.6, flatGapSec5: 35.9, climbGapSec0: 31.2, climbGapSec5: 66.6, flatGapSecByStage: [8.6, 19.7, 21.2, 32.6, 36.4, 35.9], climbGapSecByStage: [31.2, 32.6, 55.6, 66.7, 67.2, 66.6] },
  'Giant TCR Advanced SL 2025': { flatGapSec0: 61.2, flatGapSec5: 89.6, climbGapSec0: 45.9, climbGapSec5: 82.2, flatGapSecByStage: [61.2, 72.5, 73.9, 85.3, 89.1, 89.6], climbGapSecByStage: [45.9, 47.6, 63.3, 73.7, 74.3, 82.2] },
  'Giant TCR BikeExchange-Jayco Team': { flatGapSec0: 25.9, flatGapSec5: 53.5, climbGapSec0: 17.1, climbGapSec5: 52.8, flatGapSecByStage: [25.9, 37.1, 38.2, 49.6, 53.3, 53.5], climbGapSecByStage: [17.1, 18.2, 33.8, 44.3, 45, 52.8] },
  'Liv Langma Advanced SL 2021': { flatGapSec0: 8.7, flatGapSec5: 50, climbGapSec0: 30.3, climbGapSec5: 57.3, flatGapSecByStage: [8.7, 16, 16.7, 28, 28, 50], climbGapSecByStage: [30.3, 31.9, 39.6, 51.2, 53.6, 57.3] },
  'Liv Langma Advanced SL 2025': { flatGapSec0: 60.1, flatGapSec5: 88.5, climbGapSec0: 42.1, climbGapSec5: 78.8, flatGapSecByStage: [60.1, 71.6, 72.8, 84.3, 88.1, 88.5], climbGapSecByStage: [42.1, 43.9, 59.2, 70.4, 71.5, 78.8] },
  'Liv Langma SL Advanced Disc': { flatGapSec0: 26.4, flatGapSec5: 54.4, climbGapSec0: 34, climbGapSec5: 70.4, flatGapSecByStage: [26.4, 38, 39.5, 50.9, 54.6, 54.4], climbGapSecByStage: [34, 35.7, 59, 70.6, 70.5, 70.4] },
  'Moots Vamoots RCS': { flatGapSec0: 6.3, flatGapSec5: 33.8, climbGapSec0: -4.9, climbGapSec5: 31.1, flatGapSecByStage: [6.3, 17.4, 18.6, 30.3, 33.6, 33.8], climbGapSecByStage: [-4.9, -3.1, 11.7, 22.9, 23, 31.1] },
  'Mosaic RT-1d': { flatGapSec0: 6.4, flatGapSec5: 33.8, climbGapSec0: -4.6, climbGapSec5: 31, flatGapSecByStage: [6.4, 17.4, 19.3, 30.7, 34.1, 33.8], climbGapSecByStage: [-4.6, -3.5, 20.1, 30.6, 31.1, 31] },
  'Parlee ESX': { flatGapSec0: 25.8, flatGapSec5: 53.4, climbGapSec0: 15.5, climbGapSec5: 51.6, flatGapSecByStage: [25.8, 40.5, 42.4, 53.8, 53.7, 53.4], climbGapSecByStage: [15.5, 17.6, 40.7, 51.7, 51.8, 51.6] },
  'Parlee RZ7': { flatGapSec0: 43.3, flatGapSec5: 71.4, climbGapSec0: 15.5, climbGapSec5: 50.8, flatGapSecByStage: [43.3, 54.6, 55.9, 67.4, 71.2, 71.4], climbGapSecByStage: [15.5, 16, 31.5, 42.9, 43.3, 50.8] },
  'Pinarello Dogma 65.1': { flatGapSec0: 24.9, flatGapSec5: 52.7, climbGapSec0: 0.2, climbGapSec5: 36.2, flatGapSecByStage: [24.9, 36.3, 37.9, 49.3, 53.1, 52.7], climbGapSecByStage: [0.2, 1.8, 24.5, 35.8, 36.7, 36.2] },
  'Pinarello Dogma F 2021': { flatGapSec0: 56.5, flatGapSec5: 85.1, climbGapSec0: 44.1, climbGapSec5: 81.3, flatGapSecByStage: [56.5, 68.3, 69.7, 81.4, 84.9, 85.1], climbGapSecByStage: [44.1, 45.7, 61.3, 72.4, 72.8, 81.3] },
  'Pinarello Dogma F 2024': { flatGapSec0: 62.2, flatGapSec5: 90.3, climbGapSec0: 48.4, climbGapSec5: 86.1, flatGapSecByStage: [62.2, 73.9, 75.2, 87, 90.5, 90.3], climbGapSecByStage: [48.4, 50.3, 66.6, 77.3, 78.1, 86.1] },
  'Pinarello Dogma F10': { flatGapSec0: 48.4, flatGapSec5: 76.6, climbGapSec0: 27.8, climbGapSec5: 64.5, flatGapSecByStage: [48.4, 60, 61.2, 72.7, 76.5, 76.6], climbGapSecByStage: [27.8, 29.1, 44.5, 55.5, 55.7, 64.5] },
  'Pinarello Dogma F12': { flatGapSec0: 53, flatGapSec5: 81.2, climbGapSec0: 31.7, climbGapSec5: 68.2, flatGapSecByStage: [53, 64.4, 65.5, 77.1, 81, 81.2], climbGapSecByStage: [31.7, 33, 48.8, 59.5, 60.8, 68.2] },
  'Pinarello Dogma X': { flatGapSec0: 8.3, flatGapSec5: 35.3, climbGapSec0: 26.9, climbGapSec5: 63.1, flatGapSecByStage: [8.3, 19.5, 20.6, 31.9, 35.2, 35.3], climbGapSecByStage: [26.9, 28.6, 43.3, 54, 55.2, 63.1] },
  'Pinarello F8': { flatGapSec0: 40.7, flatGapSec5: 68.8, climbGapSec0: 23.2, climbGapSec5: 60.1, flatGapSecByStage: [40.7, 52.2, 54, 65.5, 69.2, 68.8], climbGapSecByStage: [23.2, 25.3, 48.8, 60, 59.8, 60.1] },
  'Ribble Endurance': { flatGapSec0: 19.7, flatGapSec5: 47.5, climbGapSec0: 6.5, climbGapSec5: 42.6, flatGapSecByStage: [19.7, 34.6, 36.4, 48, 47.7, 47.5], climbGapSecByStage: [6.5, 9.1, 32.4, 42.4, 43, 42.6] },
  'Ridley Helium': { flatGapSec0: 7.9, flatGapSec5: 34.9, climbGapSec0: 14.9, climbGapSec5: 51, flatGapSecByStage: [7.9, 18.7, 20.5, 31.8, 35.1, 34.9], climbGapSecByStage: [14.9, 16.7, 39.4, 50.7, 50.7, 51] },
  'Ridley Noah Fast 2019': { flatGapSec0: 51.4, flatGapSec5: 80, climbGapSec0: 12.5, climbGapSec5: 48.2, flatGapSecByStage: [51.4, 63, 64.4, 76.1, 79.6, 80], climbGapSecByStage: [12.5, 14.1, 29.6, 39.5, 40.4, 48.2] },
  'Scott Addict RC': { flatGapSec0: 50.8, flatGapSec5: 79.1, climbGapSec0: 47.8, climbGapSec5: 84.9, flatGapSecByStage: [50.8, 62.5, 64.3, 75.8, 79.3, 79.1], climbGapSecByStage: [47.8, 49.2, 72.5, 83.8, 84.9, 84.9] },
  'Scott Foil 2015': { flatGapSec0: 15.3, flatGapSec5: 42.7, climbGapSec0: 21.1, climbGapSec5: 57.5, flatGapSecByStage: [15.3, 26.4, 28, 39.3, 42.9, 42.7], climbGapSecByStage: [21.1, 22.8, 46.6, 57.1, 57.7, 57.5] },
  'Scott Foil 2023': { flatGapSec0: 56.5, flatGapSec5: 84.6, climbGapSec0: 27.5, climbGapSec5: 64.1, flatGapSecByStage: [56.5, 68.1, 69.4, 81.3, 84.7, 84.6], climbGapSecByStage: [27.5, 28.9, 44.7, 55.7, 56.1, 64.1] },
  'Specialized Aethos S-Works': { flatGapSec0: 46.1, flatGapSec5: 67.8, climbGapSec0: 55.8, climbGapSec5: 115.6, flatGapSecByStage: [46.1, 51.9, 54.6, 65.9, 67.5, 67.8], climbGapSecByStage: [55.8, 56.7, 92.4, 103.4, 103.7, 115.6] },
  'Specialized Allez': { flatGapSec0: 6.5, flatGapSec5: 34, climbGapSec0: -2.8, climbGapSec5: 33.5, flatGapSecByStage: [6.5, 21.3, 22.9, 34.4, 34.5, 34], climbGapSecByStage: [-2.8, -0.8, 22.3, 32.7, 32.8, 33.5] },
  'Specialized Allez Sprint': { flatGapSec0: 39.6, flatGapSec5: 67.6, climbGapSec0: 25, climbGapSec5: 60.8, flatGapSecByStage: [39.6, 51.1, 52.7, 64.4, 67.9, 67.6], climbGapSecByStage: [25, 26.1, 49.3, 60.6, 60.3, 60.8] },
  'Specialized Amira': { flatGapSec0: 8.7, flatGapSec5: 36, climbGapSec0: 30.7, climbGapSec5: 67.1, flatGapSecByStage: [8.7, 23.2, 25, 36.4, 35.6, 36], climbGapSecByStage: [30.7, 33, 56.6, 66.7, 67.2, 67.1] },
  'Specialized Amira S-Works': { flatGapSec0: 9, flatGapSec5: 36.3, climbGapSec0: 37.7, climbGapSec5: 74.4, flatGapSecByStage: [9, 20.1, 21.7, 32.8, 36.8, 36.3], climbGapSecByStage: [37.7, 39.2, 62.5, 73, 74.1, 74.4] },
  'Specialized PROJECT 74': { flatGapSec0: 124.2, flatGapSec5: 154.4, climbGapSec0: -0.1, climbGapSec5: 35.8, flatGapSecByStage: [124.2, 137.2, 138.2, 150.5, 154.6, 154.4], climbGapSecByStage: [-0.1, 2.5, 18, 28.8, 29.6, 35.8] },
  'Specialized Roubaix': { flatGapSec0: 8, flatGapSec5: 35.2, climbGapSec0: 18.6, climbGapSec5: 54.7, flatGapSecByStage: [8, 19, 20.7, 32, 35.3, 35.2], climbGapSecByStage: [18.6, 20.4, 42.5, 54.4, 54.4, 54.7] },
  'Specialized Roubaix S-Works': { flatGapSec0: 8.6, flatGapSec5: 49.9, climbGapSec0: 30.2, climbGapSec5: 57.2, flatGapSecByStage: [8.6, 16, 16.7, 28, 28, 49.9], climbGapSecByStage: [30.2, 30.9, 39.3, 49.8, 53.8, 57.2] },
  'Specialized Ruby': { flatGapSec0: 8, flatGapSec5: 35.1, climbGapSec0: 17.7, climbGapSec5: 54.7, flatGapSecByStage: [8, 22.5, 24, 35.5, 35.3, 35.1], climbGapSecByStage: [17.7, 21, 44, 54.5, 55.2, 54.7] },
  'Specialized Ruby S-Works': { flatGapSec0: 8, flatGapSec5: 36, climbGapSec0: 30.2, climbGapSec5: 66.7, flatGapSecByStage: [8, 19.7, 21.4, 32.5, 36.2, 36], climbGapSecByStage: [30.2, 31.5, 54.2, 65.5, 66.8, 66.7] },
  'Specialized S-Works Tarmac SL8': { flatGapSec0: 61.9, flatGapSec5: 90, climbGapSec0: 57.6, climbGapSec5: 94.6, flatGapSecByStage: [61.9, 73.7, 74.9, 86.5, 90.2, 90], climbGapSecByStage: [57.6, 59.2, 74.8, 86.5, 86.7, 94.6] },
  'Specialized Tarmac': { flatGapSec0: 8.9, flatGapSec5: 36.3, climbGapSec0: 36.5, climbGapSec5: 72.4, flatGapSecByStage: [8.9, 20, 21.7, 32.9, 36.9, 36.3], climbGapSecByStage: [36.5, 37.6, 60.7, 71.6, 72.5, 72.4] },
  'Specialized Tarmac Pro': { flatGapSec0: 41, flatGapSec5: 68.9, climbGapSec0: 47.4, climbGapSec5: 84.4, flatGapSecByStage: [41, 52.4, 54.2, 65.7, 69.5, 68.9], climbGapSecByStage: [47.4, 48.5, 72.5, 84, 83.9, 84.4] },
  'Specialized Tarmac SL7': { flatGapSec0: 50.9, flatGapSec5: 79.3, climbGapSec0: 47.8, climbGapSec5: 85.5, flatGapSecByStage: [50.9, 62.6, 63.7, 75.5, 79.2, 79.3], climbGapSecByStage: [47.8, 50.2, 65.5, 76.5, 76.9, 85.5] },
  'Specialized Tarmac SL8': { flatGapSec0: 60.7, flatGapSec5: 88.9, climbGapSec0: 49.5, climbGapSec5: 86.6, flatGapSecByStage: [60.7, 72.3, 73.7, 85.3, 88.9, 88.9], climbGapSecByStage: [49.5, 51.2, 66.9, 78, 78.4, 86.6] },
  'Specialized Tarmac SL9': { flatGapSec0: 63, flatGapSec5: 91.6, climbGapSec0: 57.7, climbGapSec5: 94.6, flatGapSecByStage: [63, 74, 75.4, 87.1, 91.2, 91.6], climbGapSecByStage: [57.7, 58.7, 74.9, 86.4, 86.9, 94.6] },
  'Specialized Venge 2015': { flatGapSec0: 60.3, flatGapSec5: 88.9, climbGapSec0: 15.5, climbGapSec5: 51.1, flatGapSecByStage: [60.3, 72.1, 73.9, 85.5, 88.8, 88.9], climbGapSecByStage: [15.5, 16.8, 40.2, 50.7, 51.7, 51.1] },
  'Specialized Venge S-Works 2019': { flatGapSec0: 62.8, flatGapSec5: 91.8, climbGapSec0: 36.1, climbGapSec5: 72.3, flatGapSecByStage: [62.8, 74.9, 76.1, 87.8, 91.8, 91.8], climbGapSecByStage: [36.1, 37.8, 52.7, 64.3, 65, 72.3] },
  'Trek Emonda': { flatGapSec0: 9.1, flatGapSec5: 30.3, climbGapSec0: 40.6, climbGapSec5: 99.5, flatGapSecByStage: [9.1, 14.9, 17.1, 28.2, 30.1, 30.3], climbGapSecByStage: [40.6, 41.4, 76.5, 87.8, 87.7, 99.5] },
  'Trek Emonda SL': { flatGapSec0: 8.8, flatGapSec5: 29.8, climbGapSec0: 34.4, climbGapSec5: 92.7, flatGapSecByStage: [8.8, 16.2, 19.1, 30.2, 30.4, 29.8], climbGapSecByStage: [34.4, 35.1, 82.8, 92.4, 93.3, 92.7] },
  'Trek Madone': { flatGapSec0: 57.6, flatGapSec5: 86.2, climbGapSec0: 26.6, climbGapSec5: 62.9, flatGapSecByStage: [57.6, 69.5, 70.8, 82.4, 86, 86.2], climbGapSecByStage: [26.6, 27.9, 42.8, 54.3, 54.9, 62.9] },
  'Uranium Nuclear': { flatGapSec0: 46.8, flatGapSec5: 74.8, climbGapSec0: 29, climbGapSec5: 66.2, flatGapSecByStage: [46.8, 58.3, 59.9, 71.4, 75, 74.8], climbGapSecByStage: [29, 30.7, 53.8, 65.3, 65.9, 66.2] },
  'VanRysel EDR CF': { flatGapSec0: 7.7, flatGapSec5: 34.8, climbGapSec0: 14.2, climbGapSec5: 49.4, flatGapSecByStage: [7.7, 18.7, 20.3, 31.8, 35, 34.8], climbGapSecByStage: [14.2, 16.3, 39, 49.4, 50.4, 49.4] },
  'VanRysel RCR Pro': { flatGapSec0: 58.7, flatGapSec5: 87.6, climbGapSec0: 49.4, climbGapSec5: 86, flatGapSecByStage: [58.7, 70.7, 71.8, 82.7, 87.6, 87.6], climbGapSecByStage: [49.4, 50.1, 73.6, 84.7, 85.8, 86] },
  'VanRysel RCR-F': { flatGapSec0: 60.7, flatGapSec5: 89.3, climbGapSec0: 40.7, climbGapSec5: 76, flatGapSecByStage: [60.7, 72.4, 73.3, 84.9, 89.6, 89.3], climbGapSecByStage: [40.7, 41, 56, 67.5, 68.1, 76] },
  'Ventum NS1': { flatGapSec0: 48.8, flatGapSec5: 76.8, climbGapSec0: 10.8, climbGapSec5: 47, flatGapSecByStage: [48.8, 60.3, 62, 73.6, 77.3, 76.8], climbGapSecByStage: [10.8, 12.6, 34.8, 46.2, 46.8, 47] },
  'Wilier Filante SLR ID2 Team': { flatGapSec0: 62.9, flatGapSec5: 91.6, climbGapSec0: 42.5, climbGapSec5: 80.4, flatGapSecByStage: [62.9, 74.6, 75.4, 87.2, 91.4, 91.6], climbGapSecByStage: [42.5, 45, 61.2, 72, 71.5, 80.4] },
  'Zwift Aero': { flatGapSec0: 48.1, flatGapSec5: 75.9, climbGapSec0: 6.5, climbGapSec5: 43.1, flatGapSecByStage: [48.1, 62.9, 64.8, 76.4, 76.5, 75.9], climbGapSecByStage: [6.5, 9.8, 32.7, 42.8, 43, 43.1] },
  'Zwift Carbon': { flatGapSec0: 0, flatGapSec5: 26.5, climbGapSec0: 0, climbGapSec5: 36.9, flatGapSecByStage: [0, 14.4, 15.3, 26.9, 26.9, 26.5], climbGapSecByStage: [0, 3.1, 26.1, 36.8, 37.2, 36.9] },
  'Zwift Concept Z1': CONCEPT_Z1,
  'Zwift Golden Concept Z1': CONCEPT_Z1,
  'Zwift Steel': { flatGapSec0: -5.1, flatGapSec5: 21.6, climbGapSec0: -30, climbGapSec5: 5.8, flatGapSecByStage: [-5.1, 8.9, 10.3, 21.8, 21.8, 21.6], climbGapSecByStage: [-30, -27.7, -5.7, 5.1, 5.4, 5.8] }
}

export const TT_FRAME_SPEED_DATA: Record<string, FrameSpeedSample> = {
  'BMC Timemachine01': { flatGapSec0: 21, flatGapSec5: 67.6, climbGapSec0: 17.3, climbGapSec5: 45.6, flatGapSecByStage: [21, 29.4, 30.4, 42.8, 67.8, 67.6], climbGapSecByStage: [17.3, 18.2, 30.4, 40.8, 43.9, 45.6] },
  'Cadex Tri': { flatGapSec0: 45.9, flatGapSec5: 93.4, climbGapSec0: 24.4, climbGapSec5: 51.2, flatGapSecByStage: [45.9, 54.7, 55.5, 67.9, 67.9, 93.4], climbGapSecByStage: [24.4, 25.6, 32.8, 44.1, 48.4, 51.2] },
  'Canyon Speedmax': { flatGapSec0: 21.1, flatGapSec5: 67.6, climbGapSec0: 17.5, climbGapSec5: 44.6, flatGapSecByStage: [21.1, 29.4, 30.5, 43, 68, 67.6], climbGapSecByStage: [17.5, 19, 30.1, 41.3, 43.7, 44.6] },
  'Canyon Speedmax CF SLX Disc': { flatGapSec0: 41.8, flatGapSec5: 89.2, climbGapSec0: 21.8, climbGapSec5: 48.8, flatGapSecByStage: [41.8, 50.3, 51.2, 63.7, 63.8, 89.2], climbGapSecByStage: [21.8, 22.3, 30.4, 41.9, 45.5, 48.8] },
  'Canyon Speedmax CFR': { flatGapSec0: 47.1, flatGapSec5: 95, climbGapSec0: 31.6, climbGapSec5: 58.9, flatGapSecByStage: [47.1, 55.6, 55.8, 68.5, 68.3, 95], climbGapSecByStage: [31.6, 32.8, 40.5, 51.5, 55.8, 58.9] },
  'Cervelo P5': { flatGapSec0: 29.7, flatGapSec5: 76.7, climbGapSec0: 28.4, climbGapSec5: 55.1, flatGapSecByStage: [29.7, 38.3, 39.3, 51.7, 76.9, 76.7], climbGapSecByStage: [28.4, 28.5, 40.1, 51.8, 54.7, 55.1] },
  'Cervelo PX-Series': { flatGapSec0: 37.5, flatGapSec5: 68.2, climbGapSec0: 19.1, climbGapSec5: 56.4, flatGapSecByStage: [37.5, 50.3, 51.7, 64.2, 67.5, 68.2], climbGapSecByStage: [19.1, 21.3, 36.9, 47.7, 48.4, 56.4] },
  'Cube Aerium': { flatGapSec0: 21.2, flatGapSec5: 67.6, climbGapSec0: 18.5, climbGapSec5: 46.1, flatGapSecByStage: [21.2, 29.5, 30.3, 42.5, 42.7, 67.6], climbGapSecByStage: [18.5, 20.1, 28.1, 38.7, 43.1, 46.1] },
  'DiamondBack Andean': { flatGapSec0: 21.4, flatGapSec5: 67.8, climbGapSec0: 23, climbGapSec5: 49.8, flatGapSecByStage: [21.4, 29.8, 30.5, 42.9, 42.9, 67.8], climbGapSecByStage: [23, 24.4, 31.4, 42.2, 45.8, 49.8] },
  'Felt IA': { flatGapSec0: 37.5, flatGapSec5: 85, climbGapSec0: 19.7, climbGapSec5: 47, flatGapSecByStage: [37.5, 46, 46.9, 59.3, 59.4, 85], climbGapSecByStage: [19.7, 21, 28.7, 39.1, 43.3, 47] },
  'Felt IA 2.0': { flatGapSec0: 37.8, flatGapSec5: 85.6, climbGapSec0: 30.1, climbGapSec5: 57.6, flatGapSecByStage: [37.8, 46.6, 47.5, 59.9, 59.8, 85.6], climbGapSecByStage: [30.1, 30.9, 38.5, 50, 53.7, 57.6] },
  'Pinarello Bolide': { flatGapSec0: 20.6, flatGapSec5: 67.1, climbGapSec0: 8.2, climbGapSec5: 34.8, flatGapSecByStage: [20.6, 28.8, 29.9, 42.3, 67.5, 67.1], climbGapSecByStage: [8.2, 8.8, 20.2, 31.6, 34.8, 34.8] },
  'Pinarello Bolide TT': { flatGapSec0: 20.5, flatGapSec5: 66.9, climbGapSec0: 5.7, climbGapSec5: 32.4, flatGapSecByStage: [20.5, 28.7, 29.5, 41.9, 42, 66.9], climbGapSecByStage: [5.7, 7, 15.2, 25.8, 30.3, 32.4] },
  'Pinarello Espada': { flatGapSec0: 90.9, flatGapSec5: 141.3, climbGapSec0: -9.6, climbGapSec5: 17, flatGapSecByStage: [90.9, 100.2, 101.1, 114.1, 114.1, 141.3], climbGapSecByStage: [-9.6, -7.2, 0, 11.3, 14.7, 17] },
  'QuintanaRoo Roo V-PR': { flatGapSec0: 21.2, flatGapSec5: 67.3, climbGapSec0: 19.4, climbGapSec5: 45.9, flatGapSecByStage: [21.2, 29.4, 30.2, 42.7, 42.7, 67.3], climbGapSecByStage: [19.4, 20.8, 27.9, 39.5, 42.7, 45.9] },
  'Scott Plasma': { flatGapSec0: 21.7, flatGapSec5: 68.2, climbGapSec0: 28.4, climbGapSec5: 55.7, flatGapSecByStage: [21.7, 30.1, 31.1, 43.4, 68.4, 68.2], climbGapSecByStage: [28.4, 29.9, 41, 52.5, 56, 55.7] },
  'Scott Plasma RC Ultimate': { flatGapSec0: 38.2, flatGapSec5: 85.3, climbGapSec0: 30.7, climbGapSec5: 57.9, flatGapSecByStage: [38.2, 46.6, 47.5, 59.8, 59.9, 85.3], climbGapSecByStage: [30.7, 31.7, 39.2, 50.9, 54.4, 57.9] },
  'Specialized Shiv': { flatGapSec0: 21.1, flatGapSec5: 67.5, climbGapSec0: 18, climbGapSec5: 44.1, flatGapSecByStage: [21.1, 29.4, 30.2, 42.7, 42.6, 67.5], climbGapSecByStage: [18, 18.2, 26.5, 37.2, 41.3, 44.1] },
  'Specialized Shiv Disc': { flatGapSec0: 35.3, flatGapSec5: 82.6, climbGapSec0: 19.4, climbGapSec5: 45.9, flatGapSecByStage: [35.3, 44, 44.8, 57.1, 57.1, 82.6], climbGapSecByStage: [19.4, 20.1, 28.5, 38.5, 42.2, 45.9] },
  'Specialized Shiv S-Works': { flatGapSec0: 21.7, flatGapSec5: 68.2, climbGapSec0: 29.6, climbGapSec5: 55.6, flatGapSecByStage: [21.7, 30.1, 31, 43.3, 43.4, 68.2], climbGapSecByStage: [29.6, 29.9, 37.9, 48.8, 52.9, 55.6] },
  'Trek Speed Concept SLR 9': { flatGapSec0: 35, flatGapSec5: 82.6, climbGapSec0: -18.8, climbGapSec5: 7.4, flatGapSecByStage: [35, 43.7, 44.5, 57, 57.1, 82.6], climbGapSecByStage: [-18.8, -17.2, -10, 1.5, 4.8, 7.4] },
  'VanRysel RCR-X': { flatGapSec0: 39.6, flatGapSec5: 87.2, climbGapSec0: 18.7, climbGapSec5: 45.3, flatGapSecByStage: [39.6, 48.5, 49, 61.5, 61.8, 87.2], climbGapSecByStage: [18.7, 19.3, 26.9, 37.7, 42.4, 45.3] },
  'Ventum One': { flatGapSec0: 25.6, flatGapSec5: 56, climbGapSec0: -10.3, climbGapSec5: 25.9, flatGapSecByStage: [25.6, 38, 39.4, 51.7, 55.7, 56], climbGapSecByStage: [-10.3, -9.1, 6.4, 16.6, 17.7, 25.9] },
  'Zwift TT': { flatGapSec0: 0, flatGapSec5: 45.6, climbGapSec0: 0, climbGapSec5: 26.6, flatGapSecByStage: [0, 32.8, 33.7, 46.1, 46.1, 45.6], climbGapSecByStage: [0, 3.5, 14.9, 26.2, 27.3, 26.6] }
}
