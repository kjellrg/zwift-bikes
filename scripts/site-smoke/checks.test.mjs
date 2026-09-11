import { describe, expect, it } from 'vitest'
import {
  answerAgrees,
  canonicalFor,
  decodeEntities,
  expectedJsonLdTypes,
  extractHead,
  faqAnswer,
  jsonLdBlocks,
  jsonLdTypes,
  missingJsonLdTypes,
  PAGE_KINDS,
  segmentLinks,
  sitemapLocs,
  visibleAnswer
} from './checks.mjs'

// A trimmed route page head and answer section, in the forms the renderer
// emits (unhead's `&#x2F;` in titles, Vue's `&amp;` in text, the JSON-LD
// with `<` written as `\u003c`). The answer wording is a stand-in, not the
// app's.
const ROUTE_HTML = `<!DOCTYPE html><html lang="en"><head>
<title>Best Bike for Watopia Hilly Route - ZwiftBikes</title>
<meta name="description" content="Find the fastest bike &amp; wheel combo for Watopia Hilly Route.">
<meta property="og:image" content="https://zwiftbikes.com/_og/s/o_tjcqa5.png">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="https://zwiftbikes.com/routes/hilly-route">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"ZwiftBikes"}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home"}]}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"What's the fastest bike for Watopia Hilly Route?","acceptedAnswer":{"@type":"Answer","text":"Specialized Tarmac SL9 with ENVE SES 7.8 \\u003c 14:51 (39.2 km/h). 75 kg / 175 cm / 225 W / solo; 1 lap. Standard road bikes; includes estimates; Halo bikes excluded."}}]}</script>
</head><body>
<a href="/segments/hilly-kom">Hilly KOM</a> <a href="/segments/hilly-kom">again</a> <a href="/segments/fuego-flats?x=1">Fuego</a> <a href="/routes/hilly-route">self</a>
<section aria-labelledby="ride-answer-heading" class="border-y">
  <h2 id="ride-answer-heading">What's the fastest bike for Watopia Hilly Route?</h2>
  <p class="mt-2 text-muted">Specialized Tarmac SL9 with ENVE SES 7.8 &lt; 14:51 (39.2 km/h).</p>
  <p class="mt-1 text-xs">75 kg / 175 cm / 225 W / solo; 1 lap. Standard road bikes; includes estimates; Halo bikes excluded.</p>
</section>
</body></html>`

describe('canonicalFor', () => {
  it('is the query-free path on the site origin, trailing slash dropped', () => {
    expect(canonicalFor('https://zwiftbikes.com', '/routes/hilly-route?laps=2#x')).toBe('https://zwiftbikes.com/routes/hilly-route')
    expect(canonicalFor('https://zwiftbikes.com/', '/routes/hilly-route/')).toBe('https://zwiftbikes.com/routes/hilly-route')
  })

  it('keeps the root as a bare slash', () => {
    expect(canonicalFor('https://zwiftbikes.com', '/')).toBe('https://zwiftbikes.com/')
    expect(canonicalFor('https://zwiftbikes.com', '/?category=tt')).toBe('https://zwiftbikes.com/')
  })
})

describe('extractHead', () => {
  it('reads the title, description, canonical, og:image and robots, entities decoded', () => {
    expect(extractHead(ROUTE_HTML)).toEqual({
      title: 'Best Bike for Watopia Hilly Route - ZwiftBikes',
      description: 'Find the fastest bike & wheel combo for Watopia Hilly Route.',
      canonical: 'https://zwiftbikes.com/routes/hilly-route',
      ogImage: 'https://zwiftbikes.com/_og/s/o_tjcqa5.png',
      robots: 'index, follow, max-image-preview:large'
    })
  })

  it('reports what is missing as undefined rather than throwing', () => {
    expect(extractHead('<html><head></head></html>')).toEqual({
      title: undefined, description: undefined, canonical: undefined, ogImage: undefined, robots: undefined
    })
  })
})

describe('decodeEntities', () => {
  it('handles the named, decimal and hex forms the renderer emits', () => {
    expect(decodeEntities('Zwift Racing League 2026&#x2F;27 &amp; Climbs &#39;n&#39; Sprints &lt;3 &#169;')).toBe('Zwift Racing League 2026/27 & Climbs \'n\' Sprints <3 ©')
  })
})

describe('JSON-LD', () => {
  it('parses every block and lists the top-level types', () => {
    const blocks = jsonLdBlocks(ROUTE_HTML)
    expect(blocks).toHaveLength(3)
    expect(jsonLdTypes(blocks)).toEqual(['WebSite', 'BreadcrumbList', 'FAQPage'])
  })

  it('surfaces an unparseable block as an error rather than silently dropping it', () => {
    expect(() => jsonLdBlocks('<script type="application/ld+json">{not json</script>')).toThrow(/JSON-LD/)
  })

  it('expects WebSite first on every kind, the FAQ on every ranking kind and nowhere else', () => {
    for (const kind of PAGE_KINDS) expect(expectedJsonLdTypes(kind)[0], kind).toBe('WebSite')
    const withFaq = PAGE_KINDS.filter(kind => expectedJsonLdTypes(kind).includes('FAQPage'))
    expect(withFaq).toEqual(['route', 'climb segment', 'sprint segment', 'race'])
    expect(missingJsonLdTypes(['WebSite', 'BreadcrumbList'], 'route')).toEqual(['FAQPage'])
    expect(missingJsonLdTypes(['WebSite', 'BreadcrumbList', 'FAQPage'], 'route')).toEqual([])
    expect(() => expectedJsonLdTypes('not a kind')).toThrow(/page kind/)
  })

  it('reads the FAQ answer text', () => {
    expect(faqAnswer(jsonLdBlocks(ROUTE_HTML))).toBe('Specialized Tarmac SL9 with ENVE SES 7.8 < 14:51 (39.2 km/h). 75 kg / 175 cm / 225 W / solo; 1 lap. Standard road bikes; includes estimates; Halo bikes excluded.')
    expect(faqAnswer([])).toBeUndefined()
  })
})

describe('answer agreement', () => {
  it('finds the FAQ text inside the visible answer section, whitespace and entities aside', () => {
    const visible = visibleAnswer(ROUTE_HTML)
    expect(visible).toContain('What\'s the fastest bike for Watopia Hilly Route?')
    expect(answerAgrees(faqAnswer(jsonLdBlocks(ROUTE_HTML)), visible)).toBe(true)
  })

  it('fails when the visible answer names a different setup', () => {
    expect(answerAgrees('Zwift Concept Z1 14:51', 'What is fastest? Specialized Tarmac SL9 14:51')).toBe(false)
  })

  it('fails when either side is missing', () => {
    expect(answerAgrees(undefined, 'anything')).toBe(false)
    expect(answerAgrees('anything', undefined)).toBe(false)
    expect(visibleAnswer('<html><body></body></html>')).toBeUndefined()
  })
})

describe('link extraction', () => {
  it('lists each segment link once, query-free, and nothing else', () => {
    expect(segmentLinks(ROUTE_HTML)).toEqual(['/segments/hilly-kom', '/segments/fuego-flats'])
  })

  it('reads sitemap locations in order', () => {
    const xml = '<?xml version="1.0"?><urlset><url><loc>https://zwiftbikes.com/events</loc></url><url><loc>https://zwiftbikes.com/routes/hilly-route</loc><lastmod>2026-08-01</lastmod></url></urlset>'
    expect(sitemapLocs(xml)).toEqual(['https://zwiftbikes.com/events', 'https://zwiftbikes.com/routes/hilly-route'])
  })
})
