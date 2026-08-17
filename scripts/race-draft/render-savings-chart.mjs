#!/usr/bin/env node
// Renders `docs/assets/race-draft-field-savings.svg` from the per-rider output
// of `analyze-field-draft.mjs`: one row per race and category, showing where
// that group's implied draft savings actually landed (p25-p75 bar, median
// marker, every rider as a dot) against the old and new proposed defaults.
//
//   node scripts/race-draft/analyze-field-draft.mjs --json > /tmp/field.json
//   node scripts/race-draft/render-savings-chart.mjs /tmp/field.json > docs/assets/race-draft-field-savings.svg
import { readFileSync } from 'node:fs'

const EXCLUDED_RACE = 'mech-isle-mayhem'
const SCENARIO = 'typical'
const OLD_DEFAULT = 0.267
const NEW_DEFAULT = 0.31

const input = JSON.parse(readFileSync(process.argv[2] ?? '/dev/stdin', 'utf8'))
const rows = input.results.filter(r => r.bunch && r.race !== EXCLUDED_RACE)

// The constant-setting races, in the same order as `CONSTANT_RACES` in
// spot-check-shipped-race-mode.mjs. Turf N Surf and Neokyo All-Nighter joined
// after the sand investigation (docs §5): they put Makuri sand and Neokyo
// brick inside the pool, which is what let the sand claim be tested at all.
const RACE_LABELS = {
  'la-boucle': 'La Boucle',
  'hell-of-the-north': 'Hell of the North',
  'rolling-highlands': 'Rolling Highlands',
  'sprinters-playground': 'Sprinter\'s Playground',
  'braek-fast-crits-and-grits': 'Crits and Grits',
  'turf-n-surf': 'Turf N Surf (29% sand)',
  'neokyo-all-nighter': 'Neokyo All-Nighter'
}
// Drawn below a divider: the loose-surface races, which calibrate nothing
// (docs §4). They get an assumption band rather than an interquartile range,
// because on dirt the equipment and Crr assumptions move the answer by 20-30
// points and quoting one of them as a distribution would be a lie about
// precision.
const LOOSE_RACES = { 'yumezi-grit': 'Yumezi Grit (35% dirt)', 'jungle-circuit': 'Jungle Circuit (97% dirt)' }
const BAND_SCENARIOS = ['stock', 'typical', 'fast', 'gravel']

function quantile(sorted, q) {
  const index = (sorted.length - 1) * q
  const low = Math.floor(index)
  return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low)
}

const groups = []
for (const race of Object.keys(RACE_LABELS)) {
  for (const cat of ['A', 'B', 'C', 'D']) {
    const members = rows.filter(r => r.race === race && r.cat === cat).map(r => r.saving[SCENARIO]).sort((a, b) => a - b)
    if (members.length) groups.push({ label: `${RACE_LABELS[race]} - ${cat}`, values: members })
  }
}
for (const [race, label] of Object.entries(LOOSE_RACES)) {
  const members = rows.filter(r => r.race === race)
  if (!members.length) continue
  const scenarioMedians = BAND_SCENARIOS
    .map(key => quantile(members.map(r => r.saving[key]).sort((a, b) => a - b), 0.5))
    .sort((a, b) => a - b)
  groups.push({ label, values: scenarioMedians, separate: true, count: members.length })
}
const firstSeparateIndex = groups.findIndex(g => g.separate)

const width = 760
const left = 168
const right = 724
const top = 46
const rowHeight = 26
const height = top + groups.length * rowHeight + 74
const minX = 0.15
const maxX = 0.5
const x = v => left + (Math.min(maxX, Math.max(minX, v)) - minX) / (maxX - minX) * (right - left)

const parts = []
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="ttl dsc">`)
parts.push('<title id="ttl">Draft savings implied by nine full race fields</title>')
parts.push(`<desc id="dsc">For each category of seven mass-start races, the draft saving implied by every bunch finisher's own power, weight and finish time. Bars span the interquartile range, the notch is the median, dots are individual riders. The seven intact races all sit above the ${(OLD_DEFAULT * 100).toFixed(1)} percent originally proposed and cluster around ${(NEW_DEFAULT * 100).toFixed(0)} percent, with the fastest A fields lowest and the slower D fields highest. Turf N Surf carries 29 percent beach sand and sits with the rest, which is the evidence that Zwift rolls sand at its published tarmac rolling resistance. Below the divider the two loose-surface races are excluded from the constant, and their bars span the range of defensible equipment and rolling-resistance assumptions rather than a rider distribution - on dirt that range is wider than the whole effect being measured.</desc>`)
parts.push(`<style>
text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.t{fill:#6e7781}
.grid{stroke:#6e7781;opacity:.28}
.iqr{fill:#0969da;opacity:.22}
.dot{fill:#0969da;opacity:.55}
.med{stroke:#0969da;stroke-width:2.4}
.old{stroke:#57606a;stroke-dasharray:4 3}
.new{stroke:#bc4c00}
.newt{fill:#bc4c00}
@media (prefers-color-scheme:dark){
.t{fill:#9198a1}
.grid{stroke:#9198a1;opacity:.22}
.iqr{fill:#58a6ff;opacity:.25}
.dot{fill:#58a6ff;opacity:.6}
.med{stroke:#58a6ff}
.old{stroke:#b1bac4}
.new{stroke:#f0883e}
.newt{fill:#f0883e}
}
</style>`)

const axisTop = top - 12
const axisBottom = top + groups.length * rowHeight + 8
for (let tick = 0.15; tick <= 0.5001; tick += 0.05) {
  parts.push(`<line x1="${x(tick).toFixed(1)}" y1="${axisTop}" x2="${x(tick).toFixed(1)}" y2="${axisBottom}" class="grid" stroke-width="0.5"/>`)
  parts.push(`<text x="${x(tick).toFixed(1)}" y="${axisBottom + 18}" font-size="11" class="t" text-anchor="middle">${Math.round(tick * 100)}%</text>`)
}

parts.push(`<line x1="${x(OLD_DEFAULT).toFixed(1)}" y1="${axisTop}" x2="${x(OLD_DEFAULT).toFixed(1)}" y2="${axisBottom}" class="old" stroke-width="1.4"/>`)
parts.push(`<text x="${x(OLD_DEFAULT).toFixed(1)}" y="${axisTop - 16}" font-size="11.5" class="t" text-anchor="middle">first proposal 26.7%</text>`)
parts.push(`<line x1="${x(NEW_DEFAULT).toFixed(1)}" y1="${axisTop}" x2="${x(NEW_DEFAULT).toFixed(1)}" y2="${axisBottom}" class="new" stroke-width="1.6"/>`)
parts.push(`<text x="${x(NEW_DEFAULT).toFixed(1)}" y="${axisTop - 2}" font-size="11.5" class="newt" text-anchor="middle">field-calibrated 31%</text>`)

groups.forEach((group, index) => {
  const y = top + index * rowHeight + 10 + (group.separate ? 16 : 0)
  // Constant races show an interquartile range of riders; the excluded
  // loose-surface races show the full span of their assumption band.
  const p25 = group.separate ? group.values[0] : quantile(group.values, 0.25)
  const p75 = group.separate ? group.values[group.values.length - 1] : quantile(group.values, 0.75)
  const median = quantile(group.values, 0.5)
  if (index === firstSeparateIndex) {
    const dividerY = y - rowHeight + 4
    parts.push(`<line x1="16" y1="${dividerY}" x2="${right}" y2="${dividerY}" class="grid" stroke-width="0.5" stroke-dasharray="3 3"/>`)
    parts.push(`<text x="${right}" y="${dividerY + 15}" font-size="11" class="t" text-anchor="end" font-style="italic">excluded from the constant - bar spans the equipment and surface assumptions, not riders</text>`)
  }
  parts.push(`<g${group.separate ? ' opacity="0.6"' : ''}>`)
  parts.push(`<text x="${left - 12}" y="${y + 4}" font-size="11.5" class="t" text-anchor="end">${group.label}</text>`)
  parts.push(`<rect x="${x(p25).toFixed(1)}" y="${y - 7}" width="${(x(p75) - x(p25)).toFixed(1)}" height="14" rx="3" class="iqr"/>`)
  for (const value of group.values) parts.push(`<circle cx="${x(value).toFixed(1)}" cy="${y}" r="2.6" class="dot"/>`)
  parts.push(`<line x1="${x(median).toFixed(1)}" y1="${y - 9}" x2="${x(median).toFixed(1)}" y2="${y + 9}" class="med"/>`)
  parts.push(`<text x="${right + 4}" y="${y + 4}" font-size="11" class="t">n=${group.count ?? group.values.length}</text>`)
  parts.push('</g>')
})

parts.push(`<text x="${(left + right) / 2}" y="${height - 12}" font-size="12" class="t" text-anchor="middle">Draft saving implied by each rider's own power, weight and finish time (flat-speed equivalent)</text>`)
parts.push('</svg>')
process.stdout.write(parts.join('\n') + '\n')
