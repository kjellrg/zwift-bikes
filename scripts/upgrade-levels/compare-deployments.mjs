// Compare two deployed instances of the app against each other, via the public
// recommend API. Diagnostic only - nothing in the app runs this.
//
// Useful for checking a PR preview against production before merging: run it
// at the level where the two should agree (0 and 5 are the bot-tested anchors,
// so a physics change that only touches intermediate levels must leave them
// untouched) as well as at the levels you expect to move.
//
//   node scripts/upgrade-levels/compare-deployments.mjs \
//     --old=https://example.com --new=https://preview.example.com --level=3
//
// Options: --routes=a,b,c --weight=75 --height=180 --wkg=3.5 --quiet
const args = Object.fromEntries(process.argv.slice(2)
  .filter(a => a.startsWith('--'))
  .map((a) => {
    const i = a.indexOf('=')
    return i === -1 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]
  }))

if (!args.old || !args.new) {
  console.error('Usage: --old=<baseUrl> --new=<baseUrl> [--level=3] [--routes=slug,slug]')
  process.exit(1)
}

const OLD = String(args.old).replace(/\/$/, '')
const NEW = String(args.new).replace(/\/$/, '')
const level = args.level === undefined ? 3 : Number(args.level)
const rider = `weightKg=${args.weight ?? 75}&heightCm=${args.height ?? 180}&wkg=${args.wkg ?? 3.5}`

// A spread of terrain types by default: flat, flat+cobbles, rolling,
// rolling+dirt, hilly and mountain, so a surface- or grade-dependent change
// can't hide in a single route archetype.
const routes = String(args.routes ?? [
  'tempus-fugit', 'cirque-du-suffer', 'the-greenway', 'sand-and-sequoias',
  'climb-control', 'rising-empire', 'achterbahn', 'road-to-sky'
].join(',')).split(',')

async function combos(base, slug) {
  const url = `${base}/api/recommend/${slug}?${rider}&defaultUnownedLevel=${level}&limit=9`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  const json = await res.json()
  return json.combos.map((c, i) => ({
    // Frame+wheelset is the identity of a row: the same frame legitimately
    // appears several times with different wheels, so keying on frame alone
    // silently compares unrelated rows.
    key: `${c.frame.name}|${c.wheelset?.name ?? '(fixed wheels)'}`,
    rank: i + 1,
    frame: c.frame.name,
    wheel: c.wheelset?.name ?? '(fixed wheels)',
    t: c.finishTimeSec
  }))
}

console.log(`old: ${OLD}`)
console.log(`new: ${NEW}`)
console.log(`level ${level} | ${rider.replace(/&/g, ' ')}\n`)

let moved = 0, compared = 0, worst = { d: 0 }
for (const slug of routes) {
  let a, b
  try {
    [a, b] = await Promise.all([combos(OLD, slug.trim()), combos(NEW, slug.trim())])
  } catch (e) {
    console.log(`${slug}: REQUEST FAILED - ${e.message}\n`)
    continue
  }
  const before = new Map(a.map(c => [c.key, c]))
  if (!args.quiet) {
    console.log(`=== ${slug} ===`)
    console.log('  old->new      frame                          wheelset                        old        new      diff')
  }
  for (const c of b) {
    const p = before.get(c.key)
    if (p) {
      compared++
      if (p.rank !== c.rank) moved++
      if (Math.abs(c.t - p.t) > Math.abs(worst.d)) worst = { d: c.t - p.t, key: c.key, slug }
    }
    if (args.quiet) continue
    const move = !p ? 'new' : p.rank === c.rank ? '' : p.rank > c.rank ? `+${p.rank - c.rank}` : `-${c.rank - p.rank}`
    const diff = p ? `${c.t - p.t >= 0 ? '+' : ''}${(c.t - p.t).toFixed(1)}s` : ''
    console.log(`  ${String(p?.rank ?? '-').padStart(2)}->${String(c.rank).padStart(2)} ${move.padStart(4)}  ${c.frame.slice(0, 30).padEnd(31)} ${c.wheel.slice(0, 28).padEnd(29)} ${p ? `${p.t.toFixed(1)}s` : '-'.padStart(9)} ${c.t.toFixed(1)}s ${diff}`)
  }
  const gone = a.filter(p => !b.some(c => c.key === p.key))
  if (gone.length && !args.quiet) console.log(`  left the top 9: ${gone.map(g => `${g.frame} / ${g.wheel} (#${g.rank})`).join(', ')}`)
  if (!args.quiet) console.log()
}

console.log(`SUMMARY  level ${level}: ${moved}/${compared} shared rows changed rank; largest time change ${worst.d >= 0 ? '+' : ''}${worst.d.toFixed(1)}s${worst.key ? ` (${worst.key} on ${worst.slug})` : ''}`)
