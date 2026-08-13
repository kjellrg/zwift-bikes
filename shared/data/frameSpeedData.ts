/**
 * Real bot-tested speed data for `standard` (road) and `tt` bike frames,
 * sourced from ZwiftInsider's public speed-test spreadsheet
 * (https://zwiftinsider.com/charts-frames/ and https://zwiftinsider.com/charts-tt/),
 * which publish results from Zwift's own "bot" testing methodology (a fixed
 * rider profile completing a flat and a climb test route at constant power).
 *
 * Every frame in Zwift is progressively unlocked over 5 "stages" of riding
 * after purchase (Stage 0 = just bought, Stage 5 = fully unlocked/upgraded).
 * ZwiftInsider bot-tests Stage 0 and Stage 5 for each frame; the values here
 * are each frame's time saved/lost over one hour of riding at a fixed power,
 * at those two endpoints, separately for a flat course and a climb course.
 * Positive = faster than baseline, negative = slower. Stages 1-4 aren't
 * separately tested - `classifyBikeFrame.ts` linearly interpolates between
 * the Stage 0 and Stage 5 numbers for a requested intermediate level.
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
 * skins, a couple of rows in the source sheet with corrupted Stage 5 data,
 * etc.) fall back to the existing name-based heuristic.
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
}

// The Concept Z1 ("Tron") is listed on the source sheet as a Halo bike, with
// its own integrated wheels in the `Wheels` column, so this sample covers the
// whole frame+wheel unit (see `FIXED_WHEEL_FRAMES` in `classifyBikeFrame.ts`).
// `Zwift Golden Concept Z1` is the same bike with a gold light scheme and is
// not tested separately by ZwiftInsider, so both frames deliberately share
// this one sample instead of carrying two copies of the numbers that could
// drift apart. Only one of the two is ever listed in ranked results - see
// `isRedundantCosmeticVariant`.
const CONCEPT_Z1: FrameSpeedSample = { flatGapSec0: 114.6, flatGapSec5: 144, climbGapSec0: 31.1, climbGapSec5: 68 }

export const FRAME_SPEED_DATA: Record<string, FrameSpeedSample> = {
  'Allied Able': { flatGapSec0: -136.7, flatGapSec5: -111.9, climbGapSec0: -138.4, climbGapSec5: -103.9 },
  'BMC Roadmachine': { flatGapSec0: 7.8, flatGapSec5: 35.1, climbGapSec0: 20, climbGapSec5: 55.6 },
  'BMC SLR01': { flatGapSec0: 8.5, flatGapSec5: 35.8, climbGapSec0: 28.6, climbGapSec5: 64.5 },
  'BMC TeamMachine': { flatGapSec0: 41.6, flatGapSec5: 69.8, climbGapSec0: 38.2, climbGapSec5: 74.4 },
  'Bridgestone Anchor RS9s': { flatGapSec0: 9.1, flatGapSec5: 30.2, climbGapSec0: 40.9, climbGapSec5: 100.1 },
  'Cannondale CAAD12': { flatGapSec0: 6.8, flatGapSec5: 34, climbGapSec0: -0.4, climbGapSec5: 35.9 },
  'Cannondale CAAD13': { flatGapSec0: 58.4, flatGapSec5: 86.3, climbGapSec0: 29.9, climbGapSec5: 67.3 },
  'Cannondale EVO': { flatGapSec0: 9.3, flatGapSec5: 36.7, climbGapSec0: 43.5, climbGapSec5: 80.4 },
  'Cannondale Super Six Evo': { flatGapSec0: 45.4, flatGapSec5: 73.5, climbGapSec0: 42.3, climbGapSec5: 79.4 },
  'Cannondale SuperSix Evo LAB71': { flatGapSec0: 61.4, flatGapSec5: 89.4, climbGapSec0: 53.5, climbGapSec5: 90.8 },
  'Cannondale SuperSix EVO LAB71 Team': { flatGapSec0: 62.6, flatGapSec5: 91, climbGapSec0: 55.4, climbGapSec5: 93.4 },
  'Cannondale Synapse': { flatGapSec0: 8.2, flatGapSec5: 35.5, climbGapSec0: 24.5, climbGapSec5: 61.3 },
  'Cannondale System Six': { flatGapSec0: 61, flatGapSec5: 89.5, climbGapSec0: 13.5, climbGapSec5: 49.7 },
  'Canyon Aeroad 2015': { flatGapSec0: 57.1, flatGapSec5: 85.5, climbGapSec0: 17.2, climbGapSec5: 53.4 },
  'Canyon Aeroad 2021': { flatGapSec0: 60.4, flatGapSec5: 88.7, climbGapSec0: 40.1, climbGapSec5: 76.7 },
  'Canyon Aeroad 2024': { flatGapSec0: 63, flatGapSec5: 91.5, climbGapSec0: 43.9, climbGapSec5: 81.3 },
  'Canyon Aeroad 2024 / SRAM': { flatGapSec0: 63.3, flatGapSec5: 92.4, climbGapSec0: 43.6, climbGapSec5: 80.1 },
  'Canyon Aeroad CFR Alpecin Premier-Tech': { flatGapSec0: 63.3, flatGapSec5: 92.4, climbGapSec0: 43.6, climbGapSec5: 80.1 },
  'Canyon Inflite': { flatGapSec0: -138.7, flatGapSec5: -113.9, climbGapSec0: -158.8, climbGapSec5: -124.5 },
  'Canyon Lux': { flatGapSec0: -223.4, flatGapSec5: -200.1, climbGapSec0: -360.9, climbGapSec5: -310.7 },
  'Canyon Ultimate': { flatGapSec0: 9, flatGapSec5: 36.3, climbGapSec0: 37.8, climbGapSec5: 74.3 },
  'Canyon Ultimate CFR': { flatGapSec0: 9.3, flatGapSec5: 36.7, climbGapSec0: 44.2, climbGapSec5: 80.1 },
  'Cervelo R5': { flatGapSec0: 9.5, flatGapSec5: 36.3, climbGapSec0: 36, climbGapSec5: 72.5 },
  'Cervelo S3D': { flatGapSec0: 52.3, flatGapSec5: 80.9, climbGapSec0: 4.9, climbGapSec5: 40.9 },
  'Cervelo S5': { flatGapSec0: 63.5, flatGapSec5: 92.6, climbGapSec0: 39.8, climbGapSec5: 76.2 },
  'Cervelo S5 2015': { flatGapSec0: 61.8, flatGapSec5: 90.9, climbGapSec0: 30.8, climbGapSec5: 67.1 },
  'Cervelo S5 2020': { flatGapSec0: 62.4, flatGapSec5: 91, climbGapSec0: 31.4, climbGapSec5: 68.3 },
  'Chapter2 Koko': { flatGapSec0: 17.4, flatGapSec5: 44.5, climbGapSec0: 32.3, climbGapSec5: 69.5 },
  'Chapter2 Rere': { flatGapSec0: 14.5, flatGapSec5: 41.9, climbGapSec0: 8.1, climbGapSec5: 43.9 },
  'Chapter2 Tere': { flatGapSec0: 9, flatGapSec5: 36.3, climbGapSec0: 36, climbGapSec5: 72.4 },
  'Chapter2 Toa': { flatGapSec0: 59.4, flatGapSec5: 87.5, climbGapSec0: 38.7, climbGapSec5: 75.2 },
  'Colnago V3RS': { flatGapSec0: 8.4, flatGapSec5: 35.5, climbGapSec0: 24.9, climbGapSec5: 61.1 },
  'Cube Litening': { flatGapSec0: 8.9, flatGapSec5: 36.1, climbGapSec0: 34.9, climbGapSec5: 70.2 },
  'Cube Litening C:68X': { flatGapSec0: 9.2, flatGapSec5: 36.6, climbGapSec0: 42.8, climbGapSec5: 80 },
  'Factor One': { flatGapSec0: 51.5, flatGapSec5: 79.8, climbGapSec0: 11.3, climbGapSec5: 47.1 },
  'Felt AR': { flatGapSec0: 62.6, flatGapSec5: 91.2, climbGapSec0: 36.7, climbGapSec5: 72.8 },
  'Felt FR': { flatGapSec0: 27, flatGapSec5: 54.6, climbGapSec0: 39.7, climbGapSec5: 75.7 },
  'Focus Izalco Max': { flatGapSec0: 56.1, flatGapSec5: 84.7, climbGapSec0: 30.4, climbGapSec5: 67.3 },
  'Giant Propel Advanced SL Disc': { flatGapSec0: 56.4, flatGapSec5: 84.9, climbGapSec0: 25.6, climbGapSec5: 62.3 },
  'Giant Propel Advanced SL Team': { flatGapSec0: 61.7, flatGapSec5: 90, climbGapSec0: 43.5, climbGapSec5: 82.8 },
  'Giant TCR Advanced SL 2021': { flatGapSec0: 8.6, flatGapSec5: 35.9, climbGapSec0: 31.2, climbGapSec5: 66.6 },
  'Giant TCR Advanced SL 2025': { flatGapSec0: 61.2, flatGapSec5: 89.6, climbGapSec0: 45.9, climbGapSec5: 82.2 },
  'Giant TCR BikeExchange-Jayco Team': { flatGapSec0: 25.9, flatGapSec5: 53.5, climbGapSec0: 17.1, climbGapSec5: 52.8 },
  'Liv Langma Advanced SL 2021': { flatGapSec0: 8.7, flatGapSec5: 50, climbGapSec0: 30.3, climbGapSec5: 57.3 },
  'Liv Langma Advanced SL 2025': { flatGapSec0: 60.1, flatGapSec5: 88.5, climbGapSec0: 42.1, climbGapSec5: 78.8 },
  'Liv Langma SL Advanced Disc': { flatGapSec0: 26.4, flatGapSec5: 54.4, climbGapSec0: 34, climbGapSec5: 70.4 },
  'Moots Vamoots RCS': { flatGapSec0: 6.3, flatGapSec5: 33.8, climbGapSec0: -4.9, climbGapSec5: 31.1 },
  'Mosaic RT-1d': { flatGapSec0: 6.4, flatGapSec5: 33.8, climbGapSec0: -4.6, climbGapSec5: 31 },
  'Parlee ESX': { flatGapSec0: 25.8, flatGapSec5: 53.4, climbGapSec0: 15.5, climbGapSec5: 51.6 },
  'Parlee RZ7': { flatGapSec0: 43.3, flatGapSec5: 71.4, climbGapSec0: 15.5, climbGapSec5: 50.8 },
  'Pinarello Dogma 65.1': { flatGapSec0: 24.9, flatGapSec5: 52.7, climbGapSec0: 0.2, climbGapSec5: 36.2 },
  'Pinarello Dogma F 2021': { flatGapSec0: 56.5, flatGapSec5: 85.1, climbGapSec0: 44.1, climbGapSec5: 81.3 },
  'Pinarello Dogma F 2024': { flatGapSec0: 62.2, flatGapSec5: 90.3, climbGapSec0: 48.4, climbGapSec5: 86.1 },
  'Pinarello Dogma F10': { flatGapSec0: 48.4, flatGapSec5: 76.6, climbGapSec0: 27.8, climbGapSec5: 64.5 },
  'Pinarello Dogma F12': { flatGapSec0: 53, flatGapSec5: 81.2, climbGapSec0: 31.7, climbGapSec5: 68.2 },
  'Pinarello Dogma X': { flatGapSec0: 8.3, flatGapSec5: 35.3, climbGapSec0: 26.9, climbGapSec5: 63.1 },
  'Pinarello F8': { flatGapSec0: 40.7, flatGapSec5: 68.8, climbGapSec0: 23.2, climbGapSec5: 60.1 },
  'Ribble Endurance': { flatGapSec0: 19.7, flatGapSec5: 47.5, climbGapSec0: 6.5, climbGapSec5: 42.6 },
  'Ridley Helium': { flatGapSec0: 7.9, flatGapSec5: 34.9, climbGapSec0: 14.9, climbGapSec5: 51 },
  'Ridley Noah Fast 2019': { flatGapSec0: 51.4, flatGapSec5: 80, climbGapSec0: 12.5, climbGapSec5: 48.2 },
  'Scott Addict RC': { flatGapSec0: 50.8, flatGapSec5: 79.1, climbGapSec0: 47.8, climbGapSec5: 84.9 },
  'Scott Foil 2015': { flatGapSec0: 15.3, flatGapSec5: 42.7, climbGapSec0: 21.1, climbGapSec5: 57.5 },
  'Scott Foil 2023': { flatGapSec0: 56.5, flatGapSec5: 84.6, climbGapSec0: 27.5, climbGapSec5: 64.1 },
  'Specialized Aethos S-Works': { flatGapSec0: 46.1, flatGapSec5: 67.8, climbGapSec0: 55.8, climbGapSec5: 115.6 },
  'Specialized Allez': { flatGapSec0: 6.5, flatGapSec5: 34, climbGapSec0: -2.8, climbGapSec5: 33.5 },
  'Specialized Allez Sprint': { flatGapSec0: 39.6, flatGapSec5: 67.6, climbGapSec0: 25, climbGapSec5: 60.8 },
  'Specialized Amira': { flatGapSec0: 8.7, flatGapSec5: 36, climbGapSec0: 30.7, climbGapSec5: 67.1 },
  'Specialized Amira S-Works': { flatGapSec0: 9, flatGapSec5: 36.3, climbGapSec0: 37.7, climbGapSec5: 74.4 },
  'Specialized PROJECT 74': { flatGapSec0: 124.2, flatGapSec5: 154.4, climbGapSec0: -0.1, climbGapSec5: 35.8 },
  'Specialized Roubaix': { flatGapSec0: 8, flatGapSec5: 35.2, climbGapSec0: 18.6, climbGapSec5: 54.7 },
  'Specialized Roubaix S-Works': { flatGapSec0: 8.6, flatGapSec5: 49.9, climbGapSec0: 30.2, climbGapSec5: 57.2 },
  'Specialized Ruby': { flatGapSec0: 8, flatGapSec5: 35.1, climbGapSec0: 17.7, climbGapSec5: 54.7 },
  'Specialized Ruby S-Works': { flatGapSec0: 8, flatGapSec5: 36, climbGapSec0: 30.2, climbGapSec5: 66.7 },
  'Specialized S-Works Tarmac SL8': { flatGapSec0: 61.9, flatGapSec5: 90, climbGapSec0: 57.6, climbGapSec5: 94.6 },
  'Specialized Tarmac': { flatGapSec0: 8.9, flatGapSec5: 36.3, climbGapSec0: 36.5, climbGapSec5: 72.4 },
  'Specialized Tarmac Pro': { flatGapSec0: 41, flatGapSec5: 68.9, climbGapSec0: 47.4, climbGapSec5: 84.4 },
  'Specialized Tarmac SL7': { flatGapSec0: 50.9, flatGapSec5: 79.3, climbGapSec0: 47.8, climbGapSec5: 85.5 },
  'Specialized Tarmac SL8': { flatGapSec0: 60.7, flatGapSec5: 88.9, climbGapSec0: 49.5, climbGapSec5: 86.6 },
  'Specialized Tarmac SL9': { flatGapSec0: 63, flatGapSec5: 91.6, climbGapSec0: 57.7, climbGapSec5: 94.6 },
  'Specialized Venge 2015': { flatGapSec0: 60.3, flatGapSec5: 88.9, climbGapSec0: 15.5, climbGapSec5: 51.1 },
  'Specialized Venge S-Works 2019': { flatGapSec0: 62.8, flatGapSec5: 91.8, climbGapSec0: 36.1, climbGapSec5: 72.3 },
  'Trek Emonda': { flatGapSec0: 9.1, flatGapSec5: 30.3, climbGapSec0: 40.6, climbGapSec5: 99.5 },
  'Trek Emonda SL': { flatGapSec0: 8.8, flatGapSec5: 29.8, climbGapSec0: 34.4, climbGapSec5: 92.7 },
  'Trek Madone': { flatGapSec0: 57.6, flatGapSec5: 86.2, climbGapSec0: 26.6, climbGapSec5: 62.9 },
  'Uranium Nuclear': { flatGapSec0: 46.8, flatGapSec5: 74.8, climbGapSec0: 29, climbGapSec5: 66.2 },
  'VanRysel EDR CF': { flatGapSec0: 7.7, flatGapSec5: 34.8, climbGapSec0: 14.2, climbGapSec5: 49.4 },
  'VanRysel RCR Pro': { flatGapSec0: 58.7, flatGapSec5: 87.6, climbGapSec0: 49.4, climbGapSec5: 86 },
  'VanRysel RCR-F': { flatGapSec0: 60.7, flatGapSec5: 89.3, climbGapSec0: 40.7, climbGapSec5: 76 },
  'Ventum NS1': { flatGapSec0: 48.8, flatGapSec5: 76.8, climbGapSec0: 10.8, climbGapSec5: 47 },
  'Wilier Filante SLR ID2 Team': { flatGapSec0: 62.9, flatGapSec5: 91.6, climbGapSec0: 42.5, climbGapSec5: 80.4 },
  'Zwift Aero': { flatGapSec0: 48.1, flatGapSec5: 75.9, climbGapSec0: 6.5, climbGapSec5: 43.1 },
  'Zwift Carbon': { flatGapSec0: 0, flatGapSec5: 26.5, climbGapSec0: 0, climbGapSec5: 36.9 },
  'Zwift Concept Z1': CONCEPT_Z1,
  'Zwift Golden Concept Z1': CONCEPT_Z1,
  'Zwift Steel': { flatGapSec0: -5.1, flatGapSec5: 21.6, climbGapSec0: -30, climbGapSec5: 5.8 }
}

export const TT_FRAME_SPEED_DATA: Record<string, FrameSpeedSample> = {
  'BMC Timemachine01': { flatGapSec0: 21, flatGapSec5: 67.6, climbGapSec0: 17.3, climbGapSec5: 45.6 },
  'Cadex Tri': { flatGapSec0: 45.9, flatGapSec5: 93.4, climbGapSec0: 24.4, climbGapSec5: 51.2 },
  'Canyon Speedmax': { flatGapSec0: 21.1, flatGapSec5: 67.6, climbGapSec0: 17.5, climbGapSec5: 44.6 },
  'Canyon Speedmax CF SLX Disc': { flatGapSec0: 41.8, flatGapSec5: 89.2, climbGapSec0: 21.8, climbGapSec5: 48.8 },
  'Canyon Speedmax CFR': { flatGapSec0: 47.1, flatGapSec5: 95, climbGapSec0: 31.6, climbGapSec5: 58.9 },
  'Cervelo P5': { flatGapSec0: 29.7, flatGapSec5: 76.7, climbGapSec0: 28.4, climbGapSec5: 55.1 },
  'Cervelo PX-Series': { flatGapSec0: 37.5, flatGapSec5: 68.2, climbGapSec0: 19.1, climbGapSec5: 56.4 },
  'Cube Aerium': { flatGapSec0: 21.2, flatGapSec5: 67.6, climbGapSec0: 18.5, climbGapSec5: 46.1 },
  'DiamondBack Andean': { flatGapSec0: 21.4, flatGapSec5: 67.8, climbGapSec0: 23, climbGapSec5: 49.8 },
  'Felt IA': { flatGapSec0: 37.5, flatGapSec5: 85, climbGapSec0: 19.7, climbGapSec5: 47 },
  'Felt IA 2.0': { flatGapSec0: 37.8, flatGapSec5: 85.6, climbGapSec0: 30.1, climbGapSec5: 57.6 },
  'Pinarello Bolide': { flatGapSec0: 20.6, flatGapSec5: 67.1, climbGapSec0: 8.2, climbGapSec5: 34.8 },
  'Pinarello Bolide TT': { flatGapSec0: 20.5, flatGapSec5: 66.9, climbGapSec0: 5.7, climbGapSec5: 32.4 },
  'Pinarello Espada': { flatGapSec0: 90.9, flatGapSec5: 141.3, climbGapSec0: -9.6, climbGapSec5: 17 },
  'QuintanaRoo Roo V-PR': { flatGapSec0: 21.2, flatGapSec5: 67.3, climbGapSec0: 19.4, climbGapSec5: 45.9 },
  'Scott Plasma': { flatGapSec0: 21.7, flatGapSec5: 68.2, climbGapSec0: 28.4, climbGapSec5: 55.7 },
  'Scott Plasma RC Ultimate': { flatGapSec0: 38.2, flatGapSec5: 85.3, climbGapSec0: 30.7, climbGapSec5: 57.9 },
  'Specialized Shiv': { flatGapSec0: 21.1, flatGapSec5: 67.5, climbGapSec0: 18, climbGapSec5: 44.1 },
  'Specialized Shiv Disc': { flatGapSec0: 35.3, flatGapSec5: 82.6, climbGapSec0: 19.4, climbGapSec5: 45.9 },
  'Specialized Shiv S-Works': { flatGapSec0: 21.7, flatGapSec5: 68.2, climbGapSec0: 29.6, climbGapSec5: 55.6 },
  'Trek Speed Concept SLR 9': { flatGapSec0: 35, flatGapSec5: 82.6, climbGapSec0: -18.8, climbGapSec5: 7.4 },
  'VanRysel RCR-X': { flatGapSec0: 39.6, flatGapSec5: 87.2, climbGapSec0: 18.7, climbGapSec5: 45.3 },
  'Ventum One': { flatGapSec0: 25.6, flatGapSec5: 56, climbGapSec0: -10.3, climbGapSec5: 25.9 },
  'Zwift TT': { flatGapSec0: 0, flatGapSec5: 45.6, climbGapSec0: 0, climbGapSec5: 26.6 }
}
