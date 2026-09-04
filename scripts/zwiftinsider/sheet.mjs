// The one place that knows how to reach and read ZwiftInsider's public
// speed-test sheet - the sheet behind zwiftinsider.com/charts-frames/,
// /charts-tt/ and /charts-wheels/, and the source of every gap-second in
// shared/data/frameSpeedData.ts and wheelSpeedData.ts. Shared by the two
// importers (scripts/upgrade-levels/import-stage-curves.mjs and
// scripts/zwiftinsider/import-validation-gaps.mjs) so they can never
// disagree about the URL, the CSV dialect or what a "gap" means.
import { readFileSync } from 'node:fs'

export const SHEET_ID = '1S0pTN_hBMddX0GhCqSOd6fPlIJeWtw0xr6Y1M6PzNJY'

// The frames tab is addressed by gid (the link the charts pages cite); the
// wheels tab has no published gid, so it goes through the gviz export, which
// takes the tab's title instead.
export const FRAMES_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=173681512`
export const WHEELS_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Wheels`

/**
 * The sheet's own "Hour Time Gap" definition: how many seconds the baseline
 * bike is behind after this bike has ridden for an hour, i.e.
 * `3600 * (v / v0 - 1)`. Verified against the printed gap cells (mean
 * disagreement 0.11 s/h over 585 cells at 300 W, i.e. rounding of the
 * 4-decimal mph speeds).
 *
 * NOTE this is not the convention `shared/utils/physics/equipment.ts` uses
 * to turn a gap back into a speed (`speedFromGapSec`: `v0 / (1 - gap/3600)`,
 * seconds saved over the BASELINE's hour). The two differ by ~(gap/3600)^2
 * in speed ratio - 0.1 % for a 115 s/h Tron, ~1 % for a -360 s/h Canyon Lux.
 * Both ends of the app agree with each other, so its round trips close; the
 * mismatch is a calibration question tracked separately from #168. The
 * importers use THIS definition only to check that a printed gap agrees with
 * its own speed cells, never to write a gap.
 */
export function sheetGapSec(speedMph, baselineSpeedMph) {
  return 3600 * (speedMph / baselineSpeedMph - 1)
}

/** `--flag` -> `{ flag: true }`, `--key=value` -> `{ key: 'value' }`. */
export function parseArgs(argv) {
  return Object.fromEntries(argv
    .filter(a => a.startsWith('--'))
    .map((a) => {
      const i = a.indexOf('=')
      return i === -1 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]
    }))
}

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF tolerated. Rows are arrays of strings. */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  const endField = () => {
    row.push(field.replace(/\r$/, ''))
    field = ''
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') {
        inQuotes = false
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      endField()
    } else if (c === '\n') {
      endField()
      rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length) {
    endField()
    rows.push(row)
  }
  return rows
}

/** A local CSV (`--csv=path` style offline runs) when `path` is given, otherwise the live sheet. */
export async function loadCsv({ path, url }) {
  return path ? readFileSync(path, 'utf8') : await (await fetch(url)).text()
}
