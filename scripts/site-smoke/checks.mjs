// The pure half of the site smoke (see smoke.mjs): what a served page must
// contain, decided from its HTML alone. Everything here is a function of
// strings so `checks.test.mjs` can pin the rules without a network - the
// fetching, and the reporting, stay in smoke.mjs.

/**
 * The canonical URL a page must declare: the site origin plus the path with
 * its query and fragment dropped and no trailing slash. This restates
 * `useCanonicalUrl` (which builds from the path alone and strips a slash)
 * and the edge's `drop-trailing-slash` from the outside, which is the point
 * - the smoke asks what a crawler is told, not what the app meant to say.
 */
export function canonicalFor(base, path) {
  const origin = base.replace(/\/+$/, '')
  const clean = path.replace(/[?#].*$/, '').replace(/\/+$/, '')
  return `${origin}${clean || '/'}`
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' }

/** The entity forms the renderer emits: Vue's named set, unhead's hex, and decimal for completeness. */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match
  })
}

const attribute = (tag, name) => {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`))
  return match ? decodeEntities(match[1]) : undefined
}

/** One tag of `name` whose attributes contain `marker`, e.g. the `<meta>` with `name="description"`. */
function findTag(html, name, marker) {
  const pattern = new RegExp(`<${name}\\b[^>]*>`, 'g')
  for (const match of html.matchAll(pattern)) {
    if (match[0].includes(marker)) return match[0]
  }
  return undefined
}

/** The head fields the smoke asserts on. Absent fields are `undefined`; the caller words the failure. */
export function extractHead(html) {
  const title = html.match(/<title>([^<]*)<\/title>/)
  const description = findTag(html, 'meta', 'name="description"')
  const ogImage = findTag(html, 'meta', 'property="og:image"')
  const robots = findTag(html, 'meta', 'name="robots"')
  const canonical = findTag(html, 'link', 'rel="canonical"')
  return {
    title: title ? decodeEntities(title[1]).trim() || undefined : undefined,
    description: description ? attribute(description, 'content') : undefined,
    canonical: canonical ? attribute(canonical, 'href') : undefined,
    ogImage: ogImage ? attribute(ogImage, 'content') : undefined,
    robots: robots ? attribute(robots, 'content') : undefined
  }
}

/** Every JSON-LD block on the page, parsed. A block that does not parse is the finding, so it throws rather than being skipped. */
export function jsonLdBlocks(html) {
  const blocks = []
  for (const match of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      blocks.push(JSON.parse(match[1]))
    } catch (error) {
      throw new Error(`JSON-LD block does not parse: ${error.message}`, { cause: error })
    }
  }
  return blocks
}

export const jsonLdTypes = blocks => blocks.map(block => block['@type'])

/**
 * The structured data each page kind carries on top of the `WebSite` block
 * `app.vue` puts on every page: breadcrumbs where there is a trail, the FAQ
 * where there is a recommendation to answer with, the round list on a
 * season. Keyed by the page kinds the gate's inventory uses.
 */
const PAGE_KIND_JSON_LD = {
  'home': [],
  'segments hub': ['BreadcrumbList'],
  'route': ['BreadcrumbList', 'FAQPage'],
  'climb segment': ['BreadcrumbList', 'FAQPage'],
  'sprint segment': ['BreadcrumbList', 'FAQPage'],
  'events hub': ['BreadcrumbList'],
  'season': ['BreadcrumbList', 'ItemList'],
  'race': ['BreadcrumbList', 'FAQPage'],
  'about page': [],
  'report page': [],
  'profile page': [],
  'garage page': []
}

/** The page kinds the smoke knows, named as the accessibility spec names them. */
export const PAGE_KINDS = Object.keys(PAGE_KIND_JSON_LD)

export function expectedJsonLdTypes(kind) {
  const own = PAGE_KIND_JSON_LD[kind]
  if (!own) throw new Error(`unknown page kind: ${kind}`)
  return ['WebSite', ...own]
}

export const missingJsonLdTypes = (found, kind) => expectedJsonLdTypes(kind).filter(type => !found.includes(type))

/** The accepted answer of the page's FAQ question, if it has one. */
export function faqAnswer(blocks) {
  const faq = blocks.find(block => block['@type'] === 'FAQPage')
  return faq?.mainEntity?.[0]?.acceptedAnswer?.text
}

const collapse = text => decodeEntities(text.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

/** The text of the answer section the ranking pages render under the recommendation, or `undefined` when the page has none. */
export function visibleAnswer(html) {
  const match = html.match(/<section[^>]*aria-labelledby="ride-answer-heading"[^>]*>([\s\S]*?)<\/section>/)
  return match ? collapse(match[1]) : undefined
}

/**
 * Whether the FAQ answer a crawler reads is the answer a rider sees. Both
 * come from one computed in the app; this checks that the served HTML kept
 * them together, whitespace and entity encoding aside.
 */
export function answerAgrees(faq, visible) {
  if (!faq || !visible) return false
  return collapse(visible).includes(collapse(faq))
}

/** Each `/segments/<slug>` link on the page once, query-free, in document order. */
export function segmentLinks(html) {
  const links = new Set()
  for (const match of html.matchAll(/href="(\/segments\/[a-z0-9-]+)(?:[?#][^"]*)?"/g)) links.add(match[1])
  return [...links]
}

export function sitemapLocs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => decodeEntities(match[1]).trim())
}
