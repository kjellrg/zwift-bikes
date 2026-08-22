/**
 * Real bot-tested speed data for wheels, sourced from ZwiftInsider's public
 * wheel comparison charts (https://zwiftinsider.com/charts-wheels/), which
 * publish results from Zwift's own "bot" testing methodology (a fixed rider
 * profile completing a flat and a climb test route at constant power).
 *
 * Each entry is the wheel's time saved/lost over one hour of riding at 300W,
 * relative to the baseline "Zwift 32mm Carbon" wheel, separately for a flat
 * course and a climb course. Positive = faster than baseline, negative =
 * slower.
 *
 * Only wheels covered by ZwiftInsider's standard road-wheel comparison are
 * included here. Gravel-specific and novelty/fun-bike wheels aren't part of
 * that comparison, so they keep using the existing name/depth-based
 * heuristic in `classifyWheel.ts`.
 *
 * Wheels not present in this table fall back to the existing heuristic.
 */
export interface WheelSpeedSample {
  /** Seconds saved (+) or lost (-) per hour on a flat course at 300W vs. baseline */
  flatGapSec: number
  /** Seconds saved (+) or lost (-) per hour on a climb course at 300W vs. baseline */
  climbGapSec: number
}

export const WHEEL_SPEED_DATA: Record<string, WheelSpeedSample> = {
  'Bontrager Aeolus5': { flatGapSec: 17.3, climbGapSec: -3.1 },
  'Cadex 36': { flatGapSec: 5.2, climbGapSec: 6.4 },
  'Cadex 42': { flatGapSec: 14.7, climbGapSec: 6.7 },
  'Cadex 65': { flatGapSec: 31.7, climbGapSec: 2.5 },
  'Cadex Max 50': { flatGapSec: 31.8, climbGapSec: 11.1 },
  'Campagnolo Bora Ultra 35': { flatGapSec: -0.4, climbGapSec: 3 },
  'Campagnolo Bora Ultra 50': { flatGapSec: 24.6, climbGapSec: 4.4 },
  'DTSwiss ARC 1100 DICUT 62': { flatGapSec: 39.2, climbGapSec: 0 },
  'DTSwiss ARC 1100 DICUT 65': { flatGapSec: 44.5, climbGapSec: 4.2 },
  'DTSwiss ARC 1100 DICUT 85/Disc': { flatGapSec: 50, climbGapSec: -20 },
  'DTSwiss ARC 1100 DICUT DISC': { flatGapSec: 48.2, climbGapSec: -23.7 },
  'Enve SES 2.2': { flatGapSec: 0.1, climbGapSec: 4.4 },
  'Enve SES 3.4': { flatGapSec: 24.2, climbGapSec: 6 },
  'Enve SES 4.5 PRO': { flatGapSec: 40.2, climbGapSec: 9.4 },
  'Enve SES 6.7': { flatGapSec: 30.7, climbGapSec: 4.3 },
  'Enve SES 7.8': { flatGapSec: 45.1, climbGapSec: -0.7 },
  'Enve SES 8.9': { flatGapSec: 46.7, climbGapSec: -8.6 },
  'FFWD RYOT55': { flatGapSec: 23.2, climbGapSec: -7.4 },
  'Giant SLR 0': { flatGapSec: 20.8, climbGapSec: 6.2 },
  'HED Vanquish RC6 Pro': { flatGapSec: 14.2, climbGapSec: -3.1 },
  'Lightweight Lightweight Meilenstein': { flatGapSec: 11.8, climbGapSec: 9.7 },
  'Mavic Comete Pro Carbon SL UST': { flatGapSec: 24.1, climbGapSec: -3.6 },
  'Mavic Cosmic CXR60c': { flatGapSec: 20.2, climbGapSec: -11.4 },
  'Mavic Cosmic Ultimate UST': { flatGapSec: 17.8, climbGapSec: 6.2 },
  'Miche Deva RD 62': { flatGapSec: 43.1, climbGapSec: 7.2 },
  'Novatec Novatec R4': { flatGapSec: 2.5, climbGapSec: -5 },
  // The catalog name really does have a double space after "Princeton" and
  // end in a non-breaking space (U+00A0) - written as an escape so the key
  // visibly matches zwift-data's exact bytes. A plain trailing space here
  // silently misses the lookup and drops the wheel to the estimated preset.
  'Princeton  Mach TSV2/Blur Disc\u00A0': { flatGapSec: 47.4, climbGapSec: -23.4 },
  'Princeton Alta 3532': { flatGapSec: 28.8, climbGapSec: 14.5 },
  'Princeton Wake 6560 White': { flatGapSec: 44.3, climbGapSec: 12.7 },
  // Same wheel as the White in a different colorway - the sheet only tests
  // one "Wake 6560" row, so both colorways carry it.
  'Princeton Wake 6560 Lava': { flatGapSec: 44.3, climbGapSec: 12.7 },
  'Reserve 34/37': { flatGapSec: 27.6, climbGapSec: 10.4 },
  'Reserve 57/64': { flatGapSec: 41.8, climbGapSec: 5 },
  'Roval Alpinist CLX': { flatGapSec: 11.4, climbGapSec: 9.3 },
  'Roval CLX64': { flatGapSec: 33.9, climbGapSec: 3.9 },
  'Roval Rapide CLX': { flatGapSec: 27.2, climbGapSec: 5.3 },
  'Roval Sprint CLX': { flatGapSec: 43, climbGapSec: 6.7 },
  // The plain "Shimano Cxx" names are the August 2026 revisions (catalog
  // entries supplied by `wheelSupplement.ts` until zwift-data ships them,
  // imageNames "Wheel_ShimanoDuraAceCxx2026"). ZwiftInsider's sheet titles
  // these rows "Shimano DURA-ACE C36" etc. and retitles the older revisions
  // below "... C36 2025" / "... C50 2021" / "... C60 2019" - but in the
  // game dictionary the OLD wheels keep the "Shimano DURA-ACE Cxx" names
  // unchanged, so both generations' keys here follow the game, not the
  // sheet.
  'Shimano C36': { flatGapSec: 27.2, climbGapSec: 10.8 },
  'Shimano C40': { flatGapSec: 9.8, climbGapSec: 2.6 },
  'Shimano C50': { flatGapSec: 39.9, climbGapSec: 10.6 },
  'Shimano C60': { flatGapSec: 42.4, climbGapSec: 8.7 },
  'Shimano C99/Disc': { flatGapSec: 52, climbGapSec: -19.2 },
  'Shimano DURA-ACE C36': { flatGapSec: 16, climbGapSec: 7.3 },
  'Shimano DURA-ACE C50': { flatGapSec: 18.9, climbGapSec: -2 },
  'Shimano DURA-ACE C60': { flatGapSec: 25.4, climbGapSec: -4.4 },
  'SwissSide HADRON Ultimate 650': { flatGapSec: 46.8, climbGapSec: 6 },
  'SwissSide HADRON Ultimate Disc': { flatGapSec: 50, climbGapSec: -20 },
  'Zipp 202': { flatGapSec: 3.7, climbGapSec: 3.1 },
  'Zipp 353 NSW': { flatGapSec: 27.4, climbGapSec: 9.8 },
  'Zipp 404': { flatGapSec: 30.2, climbGapSec: 1.3 },
  'Zipp 454': { flatGapSec: 34, climbGapSec: 8.5 },
  'Zipp 808': { flatGapSec: 35.9, climbGapSec: -2.2 },
  'Zipp 808/Super9': { flatGapSec: 44.6, climbGapSec: -21.6 },
  'Zipp 858': { flatGapSec: 39.6, climbGapSec: 1.8 },
  'Zipp 858/Super9': { flatGapSec: 48.5, climbGapSec: -19.4 },
  // This IS the baseline wheel every gap is measured against, so exactly 0/0
  // by definition (the sheet's own row agrees).
  'Zwift 32mm Carbon': { flatGapSec: 0, climbGapSec: 0 },
  'Zwift 50mm Carbon': { flatGapSec: 11.4, climbGapSec: -2.2 },
  'Zwift Buffalo Fahrrad': { flatGapSec: -6.8, climbGapSec: -20.6 },
  'Zwift Classic': { flatGapSec: -6.2, climbGapSec: -11.4 },
  'Zwift Groovy Time Trial Wheels': { flatGapSec: 34.2, climbGapSec: -25.2 },
  'Zwift Plain': { flatGapSec: 23.7, climbGapSec: -5.2 },
  'Zwift Pride On Disc': { flatGapSec: 34.2, climbGapSec: -25.2 },
  'Zwift Safety': { flatGapSec: -1.9, climbGapSec: -31.8 },
  'Zwift Supersonic Wheelset': { flatGapSec: 3.6, climbGapSec: 0.3 },
  'Zwift Tri Spoke // Disc Wheel': { flatGapSec: 28.7, climbGapSec: -24.1 },
  'Zwift Zwift Baseline Wheels': { flatGapSec: -0.4, climbGapSec: 0.1 }
}
