// Smoke-test a deployed instance of the site from the outside: what a
// crawler and a rider get from the served HTML, page kind by page kind, and
// whether every URL in the sitemap answers. Diagnostic only - nothing in the
// app runs this. Used once against the PR preview worker before the
// promotion gate (issue #218) and again against production after it (#219).
//
//   npm run smoke -- --base=https://zwiftbikes.com
//
// Options:
//   --sample=5          segment links to resolve from the route page and the segments hub
//   --concurrency=8     parallel requests in the sitemap sweep
//   --skip-sitemap      deep checks only
//   --access-jwt=<jwt>  see below; prefer the env var
//
// Per page kind (one URL each): status 200, `rel=canonical` equal to the
// query-free URL, a title and a description, an `og:image` that resolves,
// JSON-LD that parses with the types the kind carries, and on the ranking
// pages the FAQ answer inside the visible answer section. Then a sample of
// segment links resolves, an unknown segment is a 404, a trailing slash is
// redirected away, and every `<loc>` in /sitemap.xml answers 200 - status
// only, which touches prerendered HTML and never a recommend endpoint, so
// the 30/60 s rate limit on those is never in play.
//
// For a deployment behind Cloudflare Access (the PR preview workers), pass
// either the Access JWT of a logged-in user, sent as the CF_Authorization
// cookie on every request:
//
//   CF_ACCESS_JWT=$(cloudflared access token --app=https://zwift-bikes-pr-220.zwiftbikes.workers.dev) \
//     npm run smoke -- --base=https://zwift-bikes-pr-220.zwiftbikes.workers.dev
//
// or a service token, sent as the CF-Access-Client-Id / CF-Access-Client-Secret
// header pair:
//
//   CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... npm run smoke -- --base=...
//
// Both are harmless where Access is off. An unauthenticated request to a
// protected worker answers with a redirect to the Access login rather than
// an error, which is reported as such below.
import {
  answerAgrees,
  canonicalFor,
  expectedJsonLdTypes,
  extractHead,
  faqAnswer,
  jsonLdBlocks,
  jsonLdTypes,
  missingJsonLdTypes,
  segmentLinks,
  sitemapLocs,
  visibleAnswer
} from './checks.mjs'

const args = Object.fromEntries(process.argv.slice(2)
  .filter(a => a.startsWith('--'))
  .map((a) => {
    const i = a.indexOf('=')
    return i === -1 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]
  }))

if (!args.base) {
  console.error('Usage: npm run smoke -- --base=<origin> [--sample=5] [--concurrency=8] [--skip-sitemap]')
  process.exit(1)
}

const BASE = String(args.base).replace(/\/+$/, '')
const SAMPLE = Number(args.sample ?? 5)
const CONCURRENCY = Number(args.concurrency ?? 8)

const accessJwt = args['access-jwt'] ?? process.env.CF_ACCESS_JWT
const headers = { accept: 'text/html' }
if (accessJwt) headers.cookie = `CF_Authorization=${accessJwt}`
if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
  headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
  headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET
}

/** One URL per page kind - the same set the accessibility spec scans, plus the two SSR pages that must stay out of the index. */
const PAGES = [
  { kind: 'home', path: '/' },
  { kind: 'segments hub', path: '/segments', sampleSegments: true },
  { kind: 'route', path: '/routes/hilly-route', sampleSegments: true },
  { kind: 'climb segment', path: '/segments/alpe-du-zwift' },
  { kind: 'sprint segment', path: '/segments/fuego-flats' },
  { kind: 'events hub', path: '/events' },
  { kind: 'season', path: '/events/zrl-2026-27' },
  { kind: 'race', path: '/events/zrl-2026-27/round-1-week-1' },
  { kind: 'about page', path: '/about' },
  { kind: 'report page', path: '/report' },
  { kind: 'profile page', path: '/profile', noindex: true },
  { kind: 'garage page', path: '/garage', noindex: true }
]

let passed = 0
let failed = 0
function report(ok, label, detail) {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail && !ok ? ` - ${detail}` : ''}`)
}

/** Whether a redirect lands on the Access login: the host itself, not a substring of the URL. */
function isAccessLogin(location, from) {
  if (!location) return false
  try {
    const { hostname } = new URL(location, from)
    return hostname === 'cloudflareaccess.com' || hostname.endsWith('.cloudflareaccess.com')
  } catch {
    return false
  }
}

async function get(path, options = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`
  const response = await fetch(url, { headers, redirect: 'manual', ...options })
  if (response.status >= 300 && response.status < 400 && isAccessLogin(response.headers.get('location'), url)) {
    throw new Error(`${url} redirected to the Cloudflare Access login - pass CF_ACCESS_JWT or a service token (see the header of this script)`)
  }
  return response
}

const stripOrigin = url => url.replace(/^https?:\/\/[^/]+/, '')
/** Rewrites a site-absolute URL (the sitemap and canonical carry the public origin) onto the instance under test. */
const onBase = url => `${BASE}${stripOrigin(url)}`

async function checkPage({ kind, path, sampleSegments, noindex }) {
  const label = `${kind} ${path}`
  const response = await get(path)
  report(response.status === 200, `${label}: status 200`, `got ${response.status}`)
  if (response.status !== 200) return
  const html = await response.text()
  const head = extractHead(html)

  // The canonical carries the public site URL whatever host served it (see
  // `useCanonicalUrl`), so it is compared in full against the public origin
  // rather than against `--base`.
  const expectedCanonical = canonicalFor('https://zwiftbikes.com', path)
  report(head.canonical === expectedCanonical, `${label}: canonical is the query-free URL`, `${head.canonical} != ${expectedCanonical}`)
  report(!!head.title, `${label}: title present`, 'no <title>')
  report(!!head.description, `${label}: description present`, 'no meta description')
  if (noindex) report(head.robots?.startsWith('noindex') ?? false, `${label}: noindex`, `robots is ${head.robots}`)

  if (head.ogImage) {
    // Followed rather than manual: the edge redirects the `+` in a SiteCard
    // URL to its `%2B` form before serving the PNG, and scrapers follow that
    // too. What matters is that the last hop is an image.
    const image = await get(onBase(head.ogImage), { redirect: 'follow' })
    const type = image.headers.get('content-type') ?? ''
    report(image.status === 200 && type.startsWith('image/'), `${label}: og:image resolves`, `${head.ogImage} -> ${image.status} ${type}`)
  } else {
    report(false, `${label}: og:image resolves`, 'no og:image')
  }

  let blocks = []
  try {
    blocks = jsonLdBlocks(html)
    const found = jsonLdTypes(blocks)
    const missing = missingJsonLdTypes(found, kind)
    report(missing.length === 0, `${label}: JSON-LD has ${expectedJsonLdTypes(kind).join(', ')}`, `missing ${missing.join(', ')} (found ${found.join(', ') || 'none'})`)
  } catch (error) {
    report(false, `${label}: JSON-LD parses`, error.message)
  }

  if (expectedJsonLdTypes(kind).includes('FAQPage')) {
    const faq = faqAnswer(blocks)
    const visible = visibleAnswer(html)
    report(answerAgrees(faq, visible), `${label}: FAQ answer matches the visible answer`, `faq: ${faq ?? '(none)'} | visible: ${visible ?? '(none)'}`)
  }

  if (sampleSegments) {
    const links = segmentLinks(html).slice(0, SAMPLE)
    report(links.length > 0, `${label}: links to segments`, 'no /segments/ links in the HTML')
    for (const link of links) {
      const target = await get(link)
      report(target.status === 200, `${label}: ${link} resolves`, `got ${target.status}`)
    }
  }
}

async function checkEdges() {
  const missing = await get('/segments/not-a-segment')
  report(missing.status === 404, 'unknown segment answers 404', `got ${missing.status}`)

  const slashed = await get('/routes/hilly-route/')
  const location = slashed.headers.get('location') ?? ''
  report(slashed.status >= 300 && slashed.status < 400 && stripOrigin(location) === '/routes/hilly-route',
    'trailing slash is redirected away', `got ${slashed.status} ${location || '(no location)'}`)

  // The deep checks fetch clean URLs; this is the one that proves the query
  // is dropped on the served page, not only in the rule's unit test.
  const queried = await get('/routes/hilly-route?laps=2')
  const canonical = queried.status === 200 ? extractHead(await queried.text()).canonical : undefined
  report(canonical === canonicalFor('https://zwiftbikes.com', '/routes/hilly-route?laps=2'),
    'a query string is dropped from the canonical', `got ${queried.status}, canonical ${canonical}`)
}

async function sweepSitemap() {
  const response = await get('/sitemap.xml')
  report(response.status === 200, 'sitemap.xml: status 200', `got ${response.status}`)
  if (response.status !== 200) return
  const locs = sitemapLocs(await response.text())
  report(locs.length > 0, `sitemap.xml: ${locs.length} URLs`, 'no <loc> entries')

  const bad = []
  let next = 0
  async function worker() {
    while (next < locs.length) {
      const loc = locs[next++]
      try {
        const page = await get(onBase(loc))
        if (page.status !== 200) bad.push(`${loc} -> ${page.status}`)
        // Drain the body so the connection is reused rather than left open.
        await page.arrayBuffer()
      } catch (error) {
        bad.push(`${loc} -> ${error.message}`)
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  report(bad.length === 0, `sitemap sweep: every URL answers 200 (${locs.length - bad.length}/${locs.length})`, bad.slice(0, 20).join('; '))
}

console.log(`smoke: ${BASE}\n`)
try {
  for (const page of PAGES) await checkPage(page)
  await checkEdges()
  if (!args['skip-sitemap']) await sweepSitemap()
} catch (error) {
  console.error(`\nABORTED: ${error.message}`)
  process.exit(2)
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
