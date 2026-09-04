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
 * The sheet also tests every wheel at 150W and, at 300W, on the "Zwift TT"
 * frame instead of the "Zwift Carbon". Those rows are the optional `at150W`
 * and `onTtFrame` blocks: held-out validation data for the physics solve
 * (see the field comments and issue #168), written by
 * `scripts/zwiftinsider/import-validation-gaps.mjs` and read by nothing at
 * runtime. The top-level fields are always the Zwift Carbon 300W row.
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
  /**
   * The sheet's 150W row: this wheel on the Zwift Carbon vs the Zwift 32mm
   * Carbon on the Zwift Carbon, both at 150W. Validation only - see
   * `frameSpeedData.ts`'s `at150W`.
   */
  at150W?: { flatGapSec: number, climbGapSec: number }
  /**
   * The sheet's "Zwift TT" 300W row: this wheel on the Zwift TT frame vs the
   * Zwift 32mm Carbon on the Zwift TT frame. Validation only: the app never
   * solves a wheel against the TT baseline, it applies the road-solved delta
   * on top of it (plus the disc residual - see `physics/equipment.ts`), and
   * the golden tests check that transfer against this block.
   */
  onTtFrame?: { flatGapSec: number, climbGapSec: number }
}

export const WHEEL_SPEED_DATA: Record<string, WheelSpeedSample> = {
  'Bontrager Aeolus5': { flatGapSec: 17.3, climbGapSec: -3.1, at150W: { flatGapSec: 16.6, climbGapSec: -6 }, onTtFrame: { flatGapSec: 19.5, climbGapSec: -4.2 } },
  'Cadex 36': { flatGapSec: 5.2, climbGapSec: 6.4, at150W: { flatGapSec: 6, climbGapSec: 5.4 }, onTtFrame: { flatGapSec: 5.8, climbGapSec: 5 } },
  'Cadex 42': { flatGapSec: 14.7, climbGapSec: 6.7, at150W: { flatGapSec: 14.8, climbGapSec: 5.1 }, onTtFrame: { flatGapSec: 16, climbGapSec: 5.5 } },
  'Cadex 65': { flatGapSec: 31.7, climbGapSec: 2.5, at150W: { flatGapSec: 30.9, climbGapSec: -1.5 }, onTtFrame: { flatGapSec: 35.8, climbGapSec: 1.4 } },
  'Cadex Max 50': { flatGapSec: 31.8, climbGapSec: 11.1, at150W: { flatGapSec: 40.7, climbGapSec: 6.6 }, onTtFrame: { flatGapSec: 45.5, climbGapSec: 8.4 } },
  'Campagnolo Bora Ultra 35': { flatGapSec: -0.4, climbGapSec: 3, at150W: { flatGapSec: 0.5, climbGapSec: 2.6 }, onTtFrame: { flatGapSec: -0.2, climbGapSec: 1.7 } },
  'Campagnolo Bora Ultra 50': { flatGapSec: 24.6, climbGapSec: 4.4, at150W: { flatGapSec: 24.1, climbGapSec: 1.8 }, onTtFrame: { flatGapSec: 27.1, climbGapSec: 3.2 } },
  'DTSwiss ARC 1100 DICUT 62': { flatGapSec: 39.2, climbGapSec: 0, at150W: { flatGapSec: 38.5, climbGapSec: -5.1 }, onTtFrame: { flatGapSec: 43.9, climbGapSec: -0.9 } },
  'DTSwiss ARC 1100 DICUT 65': { flatGapSec: 44.5, climbGapSec: 4.2, at150W: { flatGapSec: 45.2, climbGapSec: -0.5 }, onTtFrame: { flatGapSec: 50.3, climbGapSec: 2.8 } },
  'DTSwiss ARC 1100 DICUT 85/Disc': { flatGapSec: 51.9, climbGapSec: -20, at150W: { flatGapSec: 50.2, climbGapSec: -28.3 }, onTtFrame: { flatGapSec: 68.6, climbGapSec: -19.3 } },
  'DTSwiss ARC 1100 DICUT DISC': { flatGapSec: 48.2, climbGapSec: -23.7, at150W: { flatGapSec: 46.2, climbGapSec: -31.3 }, onTtFrame: { flatGapSec: 66.1, climbGapSec: -22.4 } },
  'Enve SES 2.2': { flatGapSec: 0.1, climbGapSec: 4.4, at150W: { flatGapSec: 0.6, climbGapSec: 3.7 }, onTtFrame: { flatGapSec: -0.2, climbGapSec: 2 } },
  'Enve SES 3.4': { flatGapSec: 24.2, climbGapSec: 6, at150W: { flatGapSec: 23.6, climbGapSec: 2.6 }, onTtFrame: { flatGapSec: 26.8, climbGapSec: 4.3 } },
  'Enve SES 4.5 PRO': { flatGapSec: 40.2, climbGapSec: 9.4, at150W: { flatGapSec: 40.9, climbGapSec: 4.8 }, onTtFrame: { flatGapSec: 45.2, climbGapSec: 8 } },
  'Enve SES 6.7': { flatGapSec: 30.7, climbGapSec: 4.3, at150W: { flatGapSec: 30.1, climbGapSec: 0.6 }, onTtFrame: { flatGapSec: 34.1, climbGapSec: 2.9 } },
  'Enve SES 7.8': { flatGapSec: 45.1, climbGapSec: -0.7, at150W: { flatGapSec: 43.9, climbGapSec: -6.5 }, onTtFrame: { flatGapSec: 50.5, climbGapSec: -1.6 } },
  'Enve SES 8.9': { flatGapSec: 46.7, climbGapSec: -8.6, at150W: { flatGapSec: 44.8, climbGapSec: -14.6 }, onTtFrame: { flatGapSec: 52.3, climbGapSec: -9.4 } },
  'FFWD RYOT55': { flatGapSec: 23.2, climbGapSec: -7.4, at150W: { flatGapSec: 22.7, climbGapSec: -11.4 }, onTtFrame: { flatGapSec: 26.1, climbGapSec: -8.4 } },
  'Giant SLR 0': { flatGapSec: 20.8, climbGapSec: 6.2, at150W: { flatGapSec: 21.2, climbGapSec: 4.7 }, onTtFrame: { flatGapSec: 23.5, climbGapSec: 5.1 } },
  'HED Vanquish RC6 Pro': { flatGapSec: 14.2, climbGapSec: -3.1, at150W: { flatGapSec: 13.7, climbGapSec: -5.5 }, onTtFrame: { flatGapSec: 15.8, climbGapSec: -4 } },
  'Lightweight Lightweight Meilenstein': { flatGapSec: 11.8, climbGapSec: 9.7, at150W: { flatGapSec: 11.7, climbGapSec: 7.7 }, onTtFrame: { flatGapSec: 12.6, climbGapSec: 8.3 } },
  'Mavic Comete Pro Carbon SL UST': { flatGapSec: 24.1, climbGapSec: -3.6, at150W: { flatGapSec: 23.4, climbGapSec: -7.5 }, onTtFrame: { flatGapSec: 26.7, climbGapSec: -4.5 } },
  'Mavic Cosmic CXR60c': { flatGapSec: 20.2, climbGapSec: -11.4, at150W: { flatGapSec: 19.6, climbGapSec: -15 }, onTtFrame: { flatGapSec: 22.4, climbGapSec: -11.7 } },
  'Mavic Cosmic Ultimate UST': { flatGapSec: 17.8, climbGapSec: 6.2, at150W: { flatGapSec: 17.8, climbGapSec: 3.8 }, onTtFrame: { flatGapSec: 20.1, climbGapSec: 5.2 } },
  'Miche Deva RD 62': { flatGapSec: 43.1, climbGapSec: 7.2, at150W: { flatGapSec: 41.9, climbGapSec: 3.5 }, onTtFrame: { flatGapSec: 48.3, climbGapSec: 6.1 } },
  'Novatec Novatec R4': { flatGapSec: 2.5, climbGapSec: -5, at150W: { flatGapSec: 2.5, climbGapSec: -7 }, onTtFrame: { flatGapSec: 2.4, climbGapSec: -6.1 } },
  // The catalog name really does have a double space after "Princeton" and
  // end in a non-breaking space (U+00A0) - written as an escape so the key
  // visibly matches zwift-data's exact bytes. A plain trailing space here
  // silently misses the lookup and drops the wheel to the estimated preset.
  'Princeton  Mach TSV2/Blur Disc\u00A0': { flatGapSec: 47.4, climbGapSec: -23.4, at150W: { flatGapSec: 44.7, climbGapSec: -32 }, onTtFrame: { flatGapSec: 65, climbGapSec: -22.8 } },
  'Princeton Alta 3532': { flatGapSec: 28.8, climbGapSec: 14.5, at150W: { flatGapSec: 28.8, climbGapSec: 11.1 }, onTtFrame: { flatGapSec: 32.8, climbGapSec: 12.1 } },
  'Princeton Wake 6560 White': { flatGapSec: 44.3, climbGapSec: 12.7, at150W: { flatGapSec: 43.7, climbGapSec: 7.5 }, onTtFrame: { flatGapSec: 49.9, climbGapSec: 11.6 } },
  // Same wheel as the White in a different colorway - the sheet now tests
  // both colorways and measures them identically.
  'Princeton Wake 6560 Lava': { flatGapSec: 44.3, climbGapSec: 12.7, at150W: { flatGapSec: 43.7, climbGapSec: 7.5 }, onTtFrame: { flatGapSec: 49.9, climbGapSec: 11.6 } },
  'Reserve 34/37': { flatGapSec: 27.6, climbGapSec: 10.4, at150W: { flatGapSec: 28.6, climbGapSec: 7.4 }, onTtFrame: { flatGapSec: 31.4, climbGapSec: 8.1 } },
  'Reserve 57/64': { flatGapSec: 41.8, climbGapSec: 5, at150W: { flatGapSec: 42.4, climbGapSec: 1.1 }, onTtFrame: { flatGapSec: 47.5, climbGapSec: 4.2 } },
  'Roval Alpinist CLX': { flatGapSec: 11.4, climbGapSec: 9.3, at150W: { flatGapSec: 11.7, climbGapSec: 7.1 }, onTtFrame: { flatGapSec: 12.7, climbGapSec: 7.2 } },
  'Roval CLX64': { flatGapSec: 33.9, climbGapSec: 3.9, at150W: { flatGapSec: 32.9, climbGapSec: 0 }, onTtFrame: { flatGapSec: 38.2, climbGapSec: 2.7 } },
  'Roval Rapide CLX': { flatGapSec: 27.2, climbGapSec: 5.3, at150W: { flatGapSec: 27.1, climbGapSec: 2.2 }, onTtFrame: { flatGapSec: 30.6, climbGapSec: 4.7 } },
  'Roval Sprint CLX': { flatGapSec: 43, climbGapSec: 6.7, at150W: { flatGapSec: 42.4, climbGapSec: 2.2 }, onTtFrame: { flatGapSec: 48.6, climbGapSec: 5 } },
  // The plain "Shimano Cxx" names are the August 2026 revisions (catalog
  // entries supplied by `wheelSupplement.ts` until zwift-data ships them,
  // imageNames "Wheel_ShimanoDuraAceCxx2026"). ZwiftInsider's sheet titles
  // these rows "Shimano DURA-ACE C36" etc. and retitles the older revisions
  // below "... C36 2025" / "... C50 2021" / "... C60 2019" - but in the
  // game dictionary the OLD wheels keep the "Shimano DURA-ACE Cxx" names
  // unchanged, so both generations' keys here follow the game, not the
  // sheet.
  'Shimano C36': { flatGapSec: 27.2, climbGapSec: 10.8, at150W: { flatGapSec: 26.8, climbGapSec: 7.1 }, onTtFrame: { flatGapSec: 31.1, climbGapSec: 9.4 } },
  'Shimano C40': { flatGapSec: 9.8, climbGapSec: 2.6, at150W: { flatGapSec: 10, climbGapSec: 1.7 }, onTtFrame: { flatGapSec: 11, climbGapSec: 1.5 } },
  'Shimano C50': { flatGapSec: 39.9, climbGapSec: 10.6, at150W: { flatGapSec: 40.1, climbGapSec: 6.2 }, onTtFrame: { flatGapSec: 45.1, climbGapSec: 8.8 } },
  'Shimano C60': { flatGapSec: 42.4, climbGapSec: 8.7, at150W: { flatGapSec: 41.6, climbGapSec: 2.9 }, onTtFrame: { flatGapSec: 48, climbGapSec: 6.1 } },
  'Shimano C99/Disc': { flatGapSec: 52, climbGapSec: -19.2, at150W: { flatGapSec: 49.1, climbGapSec: -28.1 }, onTtFrame: { flatGapSec: 68.4, climbGapSec: -19.9 } },
  'Shimano DURA-ACE C36': { flatGapSec: 16, climbGapSec: 7.3, at150W: { flatGapSec: 15.9, climbGapSec: 6.8 }, onTtFrame: { flatGapSec: 18.1, climbGapSec: 5.3 } },
  'Shimano DURA-ACE C50': { flatGapSec: 18.9, climbGapSec: -2, at150W: { flatGapSec: 18.3, climbGapSec: -4.6 }, onTtFrame: { flatGapSec: 21.2, climbGapSec: -2.8 } },
  'Shimano DURA-ACE C60': { flatGapSec: 25.4, climbGapSec: -4.4, at150W: { flatGapSec: 24.7, climbGapSec: -8 }, onTtFrame: { flatGapSec: 28.2, climbGapSec: -5.5 } },
  'SwissSide HADRON Ultimate 650': { flatGapSec: 46.8, climbGapSec: 6, at150W: { flatGapSec: 45, climbGapSec: 0.5 }, onTtFrame: { flatGapSec: 52.8, climbGapSec: 4.6 } },
  // The sheet's 300W row for this wheel is titled "Swiss Side HADRON
  // Ultimate 850/Disc"; its old-style "SwissSide HADRON Ultimate Disc" row
  // is a 150W test. The game/zwift-data name stays as keyed here.
  'SwissSide HADRON Ultimate Disc': { flatGapSec: 51.9, climbGapSec: -20, at150W: { flatGapSec: 49.4, climbGapSec: -28.5 }, onTtFrame: { flatGapSec: 68.6, climbGapSec: -19.3 } },
  'Zipp 202': { flatGapSec: 3.7, climbGapSec: 3.1, at150W: { flatGapSec: 3.8, climbGapSec: 2.4 }, onTtFrame: { flatGapSec: 4.2, climbGapSec: 1.7 } },
  'Zipp 353 NSW': { flatGapSec: 27.4, climbGapSec: 9.8, at150W: { flatGapSec: 27.3, climbGapSec: 6.5 }, onTtFrame: { flatGapSec: 30.9, climbGapSec: 8.4 } },
  'Zipp 404': { flatGapSec: 30.2, climbGapSec: 1.3, at150W: { flatGapSec: 29.5, climbGapSec: -2.3 }, onTtFrame: { flatGapSec: 33.8, climbGapSec: 0.9 } },
  'Zipp 454': { flatGapSec: 34, climbGapSec: 8.5, at150W: { flatGapSec: 33.3, climbGapSec: 4.6 }, onTtFrame: { flatGapSec: 37.9, climbGapSec: 6.7 } },
  'Zipp 808': { flatGapSec: 35.9, climbGapSec: -2.2, at150W: { flatGapSec: 34.6, climbGapSec: -6.5 }, onTtFrame: { flatGapSec: 40.1, climbGapSec: -3.3 } },
  'Zipp 808/Super9': { flatGapSec: 44.6, climbGapSec: -21.6, at150W: { flatGapSec: 42.8, climbGapSec: -29.5 }, onTtFrame: { flatGapSec: 61.9, climbGapSec: -21.5 } },
  'Zipp 858': { flatGapSec: 39.6, climbGapSec: 1.8, at150W: { flatGapSec: 38.8, climbGapSec: -2.3 }, onTtFrame: { flatGapSec: 44.3, climbGapSec: 1.6 } },
  'Zipp 858/Super9': { flatGapSec: 48.5, climbGapSec: -19.4, at150W: { flatGapSec: 46.5, climbGapSec: -27.9 }, onTtFrame: { flatGapSec: 66.2, climbGapSec: -19 } },
  // This IS the baseline wheel every gap is measured against, so exactly 0/0
  // by definition (the sheet's own row agrees).
  'Zwift 32mm Carbon': { flatGapSec: 0, climbGapSec: 0, at150W: { flatGapSec: 0, climbGapSec: 0 }, onTtFrame: { flatGapSec: 0, climbGapSec: 0 } },
  'Zwift 50mm Carbon': { flatGapSec: 11.4, climbGapSec: -2.2, at150W: { flatGapSec: 10.9, climbGapSec: -4.2 }, onTtFrame: { flatGapSec: 12.4, climbGapSec: -3.5 } },
  'Zwift Buffalo Fahrrad': { flatGapSec: -6.8, climbGapSec: -20.6, at150W: { flatGapSec: -6.8, climbGapSec: -23.2 }, onTtFrame: { flatGapSec: -7.7, climbGapSec: -22.1 } },
  'Zwift Classic': { flatGapSec: -6.2, climbGapSec: -11.4, at150W: { flatGapSec: -6, climbGapSec: -13.2 }, onTtFrame: { flatGapSec: -7.2, climbGapSec: -13.5 } },
  'Zwift Groovy Time Trial Wheels': { flatGapSec: 34.2, climbGapSec: -25.2, at150W: { flatGapSec: 32.3, climbGapSec: -32 }, onTtFrame: { flatGapSec: 38.4, climbGapSec: -25.6 } },
  'Zwift Plain': { flatGapSec: 23.7, climbGapSec: -5.2, at150W: { flatGapSec: 23.2, climbGapSec: -9.2 }, onTtFrame: { flatGapSec: 26.6, climbGapSec: -6 } },
  'Zwift Pride On Disc': { flatGapSec: 34.2, climbGapSec: -25.2, at150W: { flatGapSec: 32.2, climbGapSec: -30.7 } },
  'Zwift Safety': { flatGapSec: -1.9, climbGapSec: -31.8, at150W: { flatGapSec: -2.8, climbGapSec: -35.7 }, onTtFrame: { flatGapSec: -2.2, climbGapSec: -33.3 } },
  'Zwift Supersonic Wheelset': { flatGapSec: 3.6, climbGapSec: 0.3, at150W: { flatGapSec: 3.6, climbGapSec: -0.5 }, onTtFrame: { flatGapSec: 4.1, climbGapSec: -0.4 } },
  'Zwift Tri Spoke // Disc Wheel': { flatGapSec: 28.7, climbGapSec: -24.1, at150W: { flatGapSec: 27.6, climbGapSec: -30.4 }, onTtFrame: { flatGapSec: 32.4, climbGapSec: -25.5 } },
  'Zwift Zwift Baseline Wheels': { flatGapSec: -0.4, climbGapSec: 0.1, at150W: { flatGapSec: 0.2, climbGapSec: -0.5 }, onTtFrame: { flatGapSec: -0.6, climbGapSec: -1.4 } }
}
