import { markdownDocumentFor } from '../utils/markdown/documents'
import { estimateTokens, MARKDOWN_CONTENT_TYPE, prefersMarkdown } from '../utils/markdown/negotiate'
import { enforceRateLimit } from '../utils/rateLimit'
import { getSiteFlags } from '../utils/siteFlags'

/**
 * Markdown content negotiation: a request for a ranking page that sends
 * `Accept: text/markdown` gets that page as markdown, at the same URL, and
 * everything else gets the HTML it always got.
 *
 * ## Why this middleware also serves the HTML
 *
 * Every page with a markdown twin is prerendered, and Cloudflare's asset
 * layer answers a prerendered page BEFORE the Worker runs (see
 * public/_headers) - which would make the `Accept` header unobservable from
 * here. So wrangler.jsonc routes those paths to the Worker first
 * (`assets.run_worker_first`, kept honest against
 * `MARKDOWN_WORKER_FIRST_RULES` by `documents.test.ts`), and this middleware
 * hands every request that did not ask for markdown straight back to the
 * asset binding.
 *
 * That passthrough is the whole cost of the feature on the HTML path: one
 * binding call, no SSR, no re-render, the same bytes as before. Letting the
 * request fall into Nitro instead would re-render the page the prerendering
 * exists to avoid (~1.7s TTFB against ~0.2s - see `nitro.prerender` in
 * nuxt.config.ts).
 *
 * An asset MISS deliberately falls through to Nitro rather than returning
 * the asset layer's bare 404: `/routes/does-not-exist` has no prerendered
 * file, and the styled Nuxt error page behind it is what a rider should get.
 * The same fall-through covers every environment with no assets binding at
 * all - `nuxt dev`, vitest, the prerender crawl - so negotiation works in
 * dev and only the passthrough is production-shaped.
 *
 * ## Ordering, and the two gates this middleware answers for
 *
 * `01.` runs it after `00.security-headers.ts`, so a passed-through page
 * carries the security headers twice over: the asset worker applies
 * `public/_headers` to a binding fetch just as it does to a direct one
 * (undocumented by Cloudflare, measured against wrangler's asset worker),
 * and `sendWebResponse` adds the asset response's headers ON TOP of what is
 * already set on the event rather than clearing it. Same values from both
 * sides, so the page is covered whichever of the two ever changes.
 *
 * It runs BEFORE `rate-limit.ts` and `site-flags-gate.ts`, and returning a
 * response here means neither of them ever runs for this request. Both are
 * keyed on `/api/**` paths and a page URL would slip past them regardless,
 * so this middleware applies them itself for the markdown it renders -
 * which is the only branch that reaches the recommend pipeline:
 *
 * - the rate limiter, through the shared `enforceRateLimit`, because
 *   rendering a ranking page costs what `/api/recommend/**` costs;
 * - the recommend kill switch, read here and handed to the document, for
 *   the same reason `mcp.post.ts` reads it (issue #154): the in-process
 *   `$fetch` those documents use carries no KV binding, so the gate itself
 *   is blind to them.
 */

/**
 * The one method of the assets binding this uses, hand-declared for the same
 * reason `rateLimit.ts` and `siteFlags.ts` declare theirs: pulling in
 * `@cloudflare/workers-types` for it would drag that package's ambient
 * globals into a codebase typed against Node everywhere else.
 */
interface AssetsBinding {
  fetch(request: Request): Promise<Response>
}

interface CloudflareContext {
  env?: { ASSETS?: AssetsBinding }
  /** The original inbound `Request`, which the asset binding resolves by URL. */
  request?: Request
}

export default defineEventHandler(async (event) => {
  // The prerender crawl renders these same pages through this same app. It
  // asks for HTML and there is no asset binding to pass it back to, so the
  // only thing this middleware could do during a build is get in the way.
  if (import.meta.prerender) return

  // Only a read of a page can have a markdown representation. Without this
  // a POST to a page URL would be answered with a document instead of
  // reaching Nitro, which is what refuses it today.
  if (event.method !== 'GET' && event.method !== 'HEAD') return

  const path = event.path.split('?')[0] ?? ''
  const document = markdownDocumentFor(path)
  if (!document) return

  const cloudflare = event.context.cloudflare as CloudflareContext | undefined

  if (!prefersMarkdown(getRequestHeader(event, 'accept'))) {
    // `Vary` on the HTML too, not only on the markdown: without it a shared
    // cache holding one representation would serve it to callers who asked
    // for the other. Appended rather than set, so a `Vary` the asset layer
    // or a later handler adds survives.
    appendResponseHeader(event, 'Vary', 'Accept')
    // `nuxt dev` is excluded rather than left to the binding check below.
    // The cloudflare-dev emulation DOES expose an `ASSETS` binding, but it
    // is a wrangler proxy whose `request` is a Node-realm `Request` it
    // cannot read ("Invalid URL"), and there is no `.output/public` behind
    // it to serve from in the first place - dev renders these pages, which
    // is the correct answer here anyway.
    const assets = import.meta.dev ? undefined : cloudflare?.env?.ASSETS
    const request = cloudflare?.request
    if (!assets || !request) return
    const response = await assets.fetch(request)
    return response.status === 404 ? undefined : response
  }

  await enforceRateLimit(event)
  const { killSwitches } = await getSiteFlags(event)

  const origin = getRequestURL(event).origin
  // The canonical is built from the CONFIGURED site URL and never from the
  // host that served the render - the rule `useCanonicalUrl` documents at
  // length, and for the same reason: a preview Worker or a workers.dev host
  // must not nominate itself as the canonical copy of a page. Every other
  // link in the document stays on `origin`, the way the HTML's own links
  // are relative.
  const siteUrl = getSiteConfig(event).url.replace(/\/+$/, '')
  const markdown = await document.render({ origin, siteUrl, recommendPaused: killSwitches.recommend })

  setResponseHeaders(event, {
    'Content-Type': MARKDOWN_CONTENT_TYPE,
    'Vary': 'Accept',
    // What this document costs a model's context, so an agent can decide
    // whether to fetch the rest of the site before it does. An estimate, and
    // named exactly as Cloudflare's own edge conversion names it, so a
    // caller written against that feature reads ours without special-casing.
    'x-markdown-tokens': String(estimateTokens(markdown)),
    // The HTML page is the canonical document. Sent as a header because a
    // markdown body has nowhere to put a `<link rel="canonical">`, and an
    // agent that indexes this needs to attribute it to the URL a person
    // would be sent to.
    'Link': `<${siteUrl}${document.path}>; rel="canonical"`
  })
  return markdown
})
