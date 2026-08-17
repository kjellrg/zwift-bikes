#!/usr/bin/env node
// Renders `docs/assets/race-draft-alpe-finishes.svg`: every March 2025 Road to
// Sky finisher's actual time vs the solo model's prediction for that same
// rider (typical equipment), against the rider's own race-average W/kg.
//
//   node scripts/race-draft/analyze-field-draft.mjs --json --race road-to-sky-2025-03 > /tmp/rts03.json
//   node scripts/race-draft/render-alpe-chart.mjs /tmp/rts03.json > docs/assets/race-draft-alpe-finishes.svg
import { readFileSync } from 'node:fs'

const input = JSON.parse(readFileSync(process.argv[2] ?? '/dev/stdin', 'utf8'))
const riders = input.results.map(r => ({
  cat: r.cat,
  wkg: r.avgW / r.weightKg,
  deltaPct: (r.timeSec - r.soloSec.typical) / r.soloSec.typical * 100
}))

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = (sorted.length - 1) / 2
  return (sorted[Math.floor(mid)] + sorted[Math.ceil(mid)]) / 2
}

const overallMedian = median(riders.map(r => r.deltaPct))
const catMedians = ['A', 'B', 'C'].map(cat => ({
  cat,
  n: riders.filter(r => r.cat === cat).length,
  median: median(riders.filter(r => r.cat === cat).map(r => r.deltaPct))
}))

// Race mode's own draft term at observed Alpe speeds (12-18 km/h):
// 31% x (v/11.7)^2 spans 2.5-5.7% of time - docs/race-drafting.md §5.
const DRAFT_BAND_HI = -2.5
const DRAFT_BAND_LO = -5.7

const width = 760
const height = 470
const left = 64
const right = 736
const top = 56
const bottom = 386
const X_MIN = 2.0
const X_MAX = 5.6
const Y_MAX = 2 // % (slower than model)
const Y_MIN = -10 // % (faster than model)
const x = v => left + (Math.min(X_MAX, Math.max(X_MIN, v)) - X_MIN) / (X_MAX - X_MIN) * (right - left)
const y = v => top + (Y_MAX - Math.min(Y_MAX, Math.max(Y_MIN, v))) / (Y_MAX - Y_MIN) * (bottom - top)

const CAT_CLASS = { A: 'ca', B: 'cb', C: 'cc' }

const parts = []
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="ttl dsc">`)
parts.push('<title id="ttl">Road to Sky, March 2025: every finisher vs the solo model</title>')
parts.push(`<desc id="dsc">Scatter plot of ${riders.length} finishers of a March 2025 Road to Sky race up Alpe du Zwift. For each rider, the vertical axis shows their actual finish time relative to what the solo model predicts from their own average power, weight and height; the horizontal axis is their race-average watts per kilogram. Nearly the whole field sits in a narrow band around ${overallMedian.toFixed(1)} percent faster than the solo model, uniformly across categories A, B and C - unlike flat races, where the spread within one bunch is many times wider. A shaded band from minus 2.5 to minus 5.7 percent marks how much of that offset race mode's own speed-scaled draft term explains at Alpe climbing speeds.</desc>`)
parts.push(`<style>
text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.t{fill:#6e7781}
.grid{stroke:#6e7781;opacity:.25}
.zero{stroke:#57606a;stroke-width:1.4}
.band{fill:#bc4c00;opacity:.13}
.bandt{fill:#bc4c00}
.med{stroke:#0969da;stroke-width:1.6;stroke-dasharray:5 3}
.medt{fill:#0969da}
.ca{fill:#cf222e;opacity:.6}
.cb{fill:#0969da;opacity:.6}
.cc{fill:#1a7f37;opacity:.6}
@media (prefers-color-scheme:dark){
.t{fill:#9198a1}
.grid{stroke:#9198a1;opacity:.2}
.zero{stroke:#b1bac4}
.band{fill:#f0883e;opacity:.15}
.bandt{fill:#f0883e}
.med{stroke:#58a6ff}
.medt{fill:#58a6ff}
.ca{fill:#ff7b72;opacity:.65}
.cb{fill:#58a6ff;opacity:.65}
.cc{fill:#3fb950;opacity:.65}
}
</style>`)

for (let tick = X_MIN; tick <= X_MAX + 0.001; tick += 0.5) {
  parts.push(`<line x1="${x(tick).toFixed(1)}" y1="${top}" x2="${x(tick).toFixed(1)}" y2="${bottom}" class="grid" stroke-width="0.5"/>`)
  parts.push(`<text x="${x(tick).toFixed(1)}" y="${bottom + 18}" font-size="11" class="t" text-anchor="middle">${tick.toFixed(1)}</text>`)
}
for (let tick = Y_MIN; tick <= Y_MAX + 0.001; tick += 2) {
  if (tick === 0) continue
  parts.push(`<line x1="${left}" y1="${y(tick).toFixed(1)}" x2="${right}" y2="${y(tick).toFixed(1)}" class="grid" stroke-width="0.5"/>`)
  parts.push(`<text x="${left - 8}" y="${y(tick).toFixed(1)}" font-size="11" class="t" text-anchor="end" dominant-baseline="middle">${tick > 0 ? '+' : ''}${tick}%</text>`)
}

parts.push(`<rect x="${left}" y="${y(DRAFT_BAND_HI).toFixed(1)}" width="${right - left}" height="${(y(DRAFT_BAND_LO) - y(DRAFT_BAND_HI)).toFixed(1)}" class="band"/>`)
parts.push(`<text x="${right - 6}" y="${(y(DRAFT_BAND_HI) + 14).toFixed(1)}" font-size="11.5" class="bandt" text-anchor="end">race mode's draft term at Alpe speeds: 31% &#215; (v/11.7)&#178; = 2.5&#8211;5.7% of time</text>`)

parts.push(`<line x1="${left}" y1="${y(0).toFixed(1)}" x2="${right}" y2="${y(0).toFixed(1)}" class="zero"/>`)
parts.push(`<text x="${left + 6}" y="${(y(0) - 6).toFixed(1)}" font-size="11.5" class="t">solo model prediction (no draft)</text>`)

parts.push(`<line x1="${left}" y1="${y(overallMedian).toFixed(1)}" x2="${right}" y2="${y(overallMedian).toFixed(1)}" class="med"/>`)
parts.push(`<text x="${left + 6}" y="${(y(overallMedian) + 16).toFixed(1)}" font-size="11.5" class="medt">field median ${overallMedian.toFixed(1)}%</text>`)

for (const rider of riders) {
  parts.push(`<circle cx="${x(rider.wkg).toFixed(1)}" cy="${y(rider.deltaPct).toFixed(1)}" r="3" class="${CAT_CLASS[rider.cat]}"/>`)
}

// Legend with per-category medians - the flatness across categories is the finding.
let legendX = left + 4
parts.push(`<text x="${legendX}" y="${top - 24}" font-size="12" class="t">Road to Sky, March 2025 &#8212; ${riders.length} finishers, actual time vs the solo model (typical equipment)</text>`)
for (const { cat, n, median: m } of catMedians) {
  parts.push(`<circle cx="${legendX + 5}" cy="${top - 10}" r="3.4" class="${CAT_CLASS[cat]}"/>`)
  parts.push(`<text x="${legendX + 13}" y="${top - 6}" font-size="11.5" class="t">${cat} (n=${n}, median ${m.toFixed(1)}%)</text>`)
  legendX += 158
}

parts.push(`<text x="${(left + right) / 2}" y="${bottom + 40}" font-size="12" class="t" text-anchor="middle">Rider's own race-average W/kg</text>`)
parts.push(`<text x="${(left + right) / 2}" y="${bottom + 62}" font-size="11" class="t" text-anchor="middle">Below the line = finished faster than the solo model predicts. The whole field shares one narrow offset &#8212; a flat-race bunch spans 17&#8211;41% within a single category.</text>`)
parts.push(`<text x="${(left + right) / 2}" y="${bottom + 78}" font-size="11" class="t" text-anchor="middle" font-style="italic">The February 2025 Alpe event is omitted: its ridden distance could not be verified (docs/race-drafting.md &#167;5).</text>`)
parts.push('</svg>')
process.stdout.write(parts.join('\n') + '\n')
