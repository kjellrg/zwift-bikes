#!/usr/bin/env node
// Interactive scaffolder for adding a race to a season file:
//
//   npm run events:add
//
// Walks through season -> round -> date(s) -> format -> category groups
// (with a route picker that fuzzy-searches zwift-data and shows the fields
// that catch mistakes at entry: distance, elevation, lead-in and the `lap`
// flag, so laps > 1 on a point-to-point route never gets typed in), then
// powerups, note and sourceUrl. Generates the slug per series convention,
// writes the JSON entry in schema field order with 2-space indent, sets
// `updatedAt` to today, and finishes by running the validator over the
// result.
//
// Node `readline/promises` only - no new dependencies.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { spawnSync } from 'node:child_process'
import { routes } from 'zwift-data'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const eventsDir = path.join(repoRoot, 'shared/data/events')

const POWERUPS = ['feather', 'aero', 'draft', 'ghost', 'anvil', 'steamroller', 'burrito']
const FORMATS = ['points', 'scratch', 'ttt', 'rot']
const CATS = ['A', 'B', 'C', 'D', 'E']

const SLUG_CONVENTIONS = {
  zrl: race => `round-${race.round}-week-${race.week}`,
  zracing: race => `stage-${race.week}`
}

const rl = createInterface({ input: process.stdin, output: process.stdout })
// Answers come off the interface's async iterator rather than
// `rl.question()`: the iterator buffers lines that arrive while no prompt is
// waiting, where `question()` silently drops them - which is the difference
// between working and hanging the moment this script is driven by a pipe
// (`printf '...' | npm run events:add`) instead of a person.
const lines = rl[Symbol.asyncIterator]()
const ask = async (question, fallback) => {
  process.stdout.write(fallback !== undefined ? `${question} [${fallback}]: ` : `${question}: `)
  const { value, done } = await lines.next()
  if (done) throw new Error('stdin closed before all questions were answered')
  const answer = value.trim()
  return answer || (fallback !== undefined ? String(fallback) : '')
}
const askInt = async (question, fallback) => {
  const raw = await ask(question, fallback)
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value)) throw new Error(`"${raw}" isn't a number`)
  return value
}
const askOptionalNumber = async (question) => {
  const raw = await ask(`${question} (blank to skip)`)
  if (!raw) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error(`"${raw}" isn't a number`)
  return value
}
const askDate = async (question, optional = false) => {
  const raw = await ask(optional ? `${question} (blank to skip)` : question)
  if (!raw && optional) return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`"${raw}" isn't an ISO YYYY-MM-DD date`)
  return raw
}
const pick = async (question, options, render) => {
  options.forEach((option, index) => console.log(`  ${index + 1}. ${render(option)}`))
  const index = await askInt(question) - 1
  if (!options[index]) throw new Error('no such option')
  return options[index]
}

async function pickRoute() {
  for (;;) {
    const term = (await ask('Route search (name fragment, blank for an unlisted/exclusive route)')).toLowerCase()
    if (!term) return undefined
    const found = routes.filter(route => route.slug && (route.name.toLowerCase().includes(term) || route.slug.includes(term))).slice(0, 15)
    if (!found.length) {
      console.log('  no matches - try again')
      continue
    }
    const route = await pick('Pick a route', found, r =>
      `${r.name} (${r.slug}) - ${r.world}, ${r.distance} km${r.leadInDistance ? ` + ${r.leadInDistance} lead-in` : ''}, ${r.elevation} m, ${r.lap ? 'lap route' : 'point-to-point'}`)
    return route
  }
}

async function main() {
  // 1. Season file.
  const files = readdirSync(eventsDir).filter(file => file.endsWith('.json'))
  const file = await pick('Season file', files, f => f)
  const filePath = path.join(eventsDir, file)
  const season = JSON.parse(readFileSync(filePath, 'utf8'))

  // 2. Round.
  const round = await pick('Round', season.rounds, r => `Round ${r.number}${r.name ? `: ${r.name}` : ''} (${r.startDate} - ${r.endDate})`)

  // 3. Week / dates.
  const week = await askInt('Week number', round.races.length + 1)
  const date = await askDate('Race date (YYYY-MM-DD)')
  const endDate = await askDate('End date for a multi-day window (YYYY-MM-DD)', true)

  // 4. Format.
  const formatRaw = await ask(`Format (${FORMATS.join('/')}, blank while TBC)`)
  if (formatRaw && !FORMATS.includes(formatRaw)) throw new Error(`unknown format "${formatRaw}"`)

  // 5. Category groups.
  const categories = []
  for (;;) {
    console.log(`\nCategory group ${categories.length + 1}`)
    const catsRaw = (await ask(`Pens, comma-separated from ${CATS.join('/')} (blank for a score-range/label group)`)).toUpperCase()
    const cats = catsRaw ? catsRaw.split(/[\s,/]+/).filter(Boolean) : []
    for (const cat of cats) if (!CATS.includes(cat)) throw new Error(`unknown category "${cat}"`)
    const label = cats.length ? undefined : await ask('Group label (e.g. "All categories")')
    if (!cats.length && !label) throw new Error('a group needs pens or a label')

    const route = await pickRoute()
    const routeName = await ask('Course name as the organiser publishes it', route?.name)
    const laps = await askInt('Laps', 1)
    if (route && laps > 1 && !route.lap) throw new Error(`"${route.slug}" is point-to-point - laps must be 1`)
    const officialDistanceKm = await askOptionalNumber('Published distance, km')
    const officialElevationM = await askOptionalNumber('Published elevation, m')

    categories.push({
      cats,
      ...(label ? { label } : {}),
      ...(route ? { routeSlug: route.slug } : {}),
      ...(routeName ? { routeName } : {}),
      laps,
      ...(officialDistanceKm !== undefined ? { officialDistanceKm } : {}),
      ...(officialElevationM !== undefined ? { officialElevationM } : {})
    })

    if ((await ask('Add another group? (y/N)', 'n')).toLowerCase() !== 'y') break
  }

  // 6. Powerups: enum multi-select, "none" -> allowed: [], blank -> field
  // omitted entirely (not published - the UI then renders nothing).
  const powerupsRaw = (await ask(`Powerups, comma-separated from ${POWERUPS.join('/')}, "none", or blank for not published`)).toLowerCase()
  let powerups
  if (powerupsRaw === 'none') powerups = { allowed: [] }
  else if (powerupsRaw) {
    const allowed = powerupsRaw.split(/[\s,]+/).filter(Boolean)
    for (const p of allowed) if (!POWERUPS.includes(p)) throw new Error(`unknown powerup "${p}"`)
    powerups = { allowed }
  }

  // 7. The texts.
  const note = await ask('Tactical note (what makes this race play out the way it does)')
  const sourceUrl = await ask('Source URL the details came from')

  // 8. Assemble in schema field order, slug per series convention.
  const convention = SLUG_CONVENTIONS[season.seriesSlug]
  const race = {
    slug: convention ? convention({ round: round.number, week }) : `round-${round.number}-week-${week}`,
    round: round.number,
    week,
    date,
    ...(endDate ? { endDate } : {}),
    ...(formatRaw ? { format: formatRaw } : {}),
    categories,
    ...(powerups ? { powerups } : {}),
    ...(note ? { note } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    updatedAt: new Date().toISOString().slice(0, 10)
  }

  round.races.push(race)
  round.races.sort((a, b) => a.date.localeCompare(b.date))
  writeFileSync(filePath, `${JSON.stringify(season, null, 2)}\n`)
  console.log(`\nAdded ${season.slug}/${race.slug} to ${file}. Running the validator...\n`)

  const result = spawnSync('node', [path.join(__dirname, 'validate-events.mjs')], { stdio: 'inherit' })
  process.exitCode = result.status ?? 1
}

main()
  .catch((error) => {
    console.error(`\n${error.message}`)
    process.exitCode = 1
  })
  .finally(() => rl.close())
