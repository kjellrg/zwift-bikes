import { prefersMarkdown } from '../utils/markdown/negotiate'

/**
 * A wrong page URL - an unknown route, segment, race, or a path that matches
 * no page at all - is answered with the server-rendered `app/error.vue`,
 * marked noindex, whoever asked (issue #269). Two things stood in the way,
 * and this middleware removes both without replacing Nuxt's error handling.
 *
 * ## The `Accept` header decides HTML or JSON
 *
 * Nitro's error handler answers in JSON unless the request's `Accept` names
 * `text/html` (`isJsonRequest` in `@nuxt/nitro-server`): curl's default
 * wildcard, an agent's `application/json` and a request with no `Accept`
 * all got the JSON error body instead of the page. So on a page URL the
 * header is rewritten to `text/html` before the page renders, and Nuxt
 * renders `error.vue` exactly as it does for a browser. Every status goes
 * the same way - a 500 on a page is the same page with the same noindex.
 *
 * `03.` puts it after the three numbered middlewares, none of which throws
 * for a page request that did not ask for markdown: the rate limit and the
 * markdown twin act only on markdown, and the security headers never throw.
 * A markdown request's 404 is thrown by `02.markdown.ts` before this runs,
 * and Nitro picks its JSON or HTML by the caller's headers, as it always
 * has.
 *
 * Left alone: `/api/**`, whose JSON errors are the contract; Nuxt and module
 * internals under `/_` (`/_nuxt/*`, `/__nuxt_error`, `/__og-image__/*`);
 * anything with a file extension (a payload, an icon, `robots.txt`), since no
 * page URL has one; and a request that asked for markdown, which
 * `02.markdown.ts` answers - an agent's script gets its errors in JSON.
 *
 * ## The error page render needs a robots context
 *
 * Nuxt renders the error page in a second, internal request to
 * `/__nuxt_error`, and the robots module's context middleware skips every
 * `/__` path, so `event.context.robots` is never set there. `useRobotsRule`
 * in `error.vue` writes straight into it, threw a TypeError, and took the
 * page's setup down with it: the title (set just before) survived, while the
 * body rendered empty and neither the `<meta name="robots">` nor the
 * `X-Robots-Tag` was ever set - the outer response kept the module's
 * `index, follow`. Seeding the context here lets the composable run as it
 * does on every other page; the header it sets on the render is copied onto
 * the real response by Nitro's error handler, so there is still exactly one.
 *
 * The seed is the module's own "not indexable" value, so an error page that
 * never names a rule still reads as noindex. `error.vue`'s own rule
 * replaces it.
 */
export default defineEventHandler((event) => {
  // The prerender crawl renders pages that exist and no error page, so there
  // is nothing here for a build to need - and with this middleware live the
  // crawl's share-card renders timed out (408), failing the build.
  if (import.meta.prerender) return

  const path = event.path.split('?')[0] ?? ''

  if (path === '/__nuxt_error') {
    event.context.robots ??= {
      indexable: false,
      rule: useRuntimeConfig(event).public['nuxt-robots'].robotsDisabledValue
    }
    return
  }

  if (!isPagePath(path) || prefersMarkdown(getRequestHeader(event, 'accept'))) return
  event.node.req.headers.accept = 'text/html'
})

function isPagePath(path: string): boolean {
  if (path === '/api' || path.startsWith('/api/') || path.startsWith('/_')) return false
  const lastSegment = path.slice(path.lastIndexOf('/') + 1)
  return !lastSegment.includes('.')
}
