# Markdown for agents

Every Ranking page on the site - route, segment and race - answers in
markdown when the request asks for it, at the same URL a browser uses, as do
the two Discovery pages that list them (both terms are defined in
[CONTEXT.md](../CONTEXT.md)).

```
$ curl -H 'Accept: text/markdown' https://zwiftbikes.com/routes/hilly-route

# What's the fastest bike for Watopia Hilly Route?

Our model puts the **Specialized Tarmac SL9 with Shimano C99/Disc** fastest on
Watopia Hilly Route: **17:42** (~32.9 km/h), under the assumptions below.
...
```

- **Negotiated pages:** `/routes/{slug}`, `/segments/{slug}`,
  `/events/{season}/{race}`, plus `/` and `/segments`
- **Response:** `Content-Type: text/markdown; charset=utf-8`, `Vary: Accept`,
  `x-markdown-tokens`, and a `Link: <...>; rel="canonical"` back to the page.
  The canonical is built from the configured site URL and never from the host
  that served the request - the rule `useCanonicalUrl` documents, so a preview
  Worker cannot nominate itself. Every other link in the document is built
  from the request's own origin, the way the HTML's links are relative.
- **Index:** [`/llms.txt`](https://zwiftbikes.com/llms.txt), the whole route
  and segment catalog with the contract above stated at the top
- **HTML stays the default.** Only a request that names `text/markdown`
  explicitly, at a quality at least as high as anything HTML-shaped in the
  same header, gets markdown. No browser sends it.

## Why it exists

An assistant answering "what's the fastest bike on Alpe du Zwift?" has two
ways in without credentials. The [JSON API](../README.md) is the best for a
program and needs the rider's numbers. This is the other: the one that works
when something simply fetched the URL, which is what a search-grounded
assistant does. (The [MCP server](mcp-server.md) is the best of the three for
a conversation, but it is gated at the edge, so nothing a document or
`/llms.txt` is read by can reach it - which is why neither links to it.) Scraping the answer back out of a
Nuxt page - charts, drawers, hydration payload - costs a lot of tokens to
recover a table that the server already has in hand.

## How it works, and the one thing that is easy to break

Every page with a markdown twin is prerendered. On Cloudflare Workers the
**asset layer answers a prerendered page before the Worker runs**, which would
make the `Accept` header unobservable from application code. So
`assets.run_worker_first` in [wrangler.jsonc](../wrangler.jsonc) lists exactly
those paths, the Worker runs first for them, and
[`server/middleware/01.markdown.ts`](../server/middleware/01.markdown.ts)
decides:

| Request | What happens |
| --- | --- |
| asks for markdown | the document is rendered and returned |
| anything else | handed straight back to the `ASSETS` binding - same prerendered bytes, no SSR |
| anything else, no such asset | falls through to Nitro, which renders the styled 404 |

Two things about that routing were measured rather than assumed, because
Cloudflare documents neither: a rule without a trailing `*` is an **exact**
path match (so `/` routes the homepage and nothing else - `/_nuxt/*` and
`/about` never pay a Worker invocation), and `public/_headers` **is** applied
to an `ASSETS` binding fetch, so a passed-through page keeps its security
headers from that side as well as from `00.security-headers.ts`.

**A path the resolver knows and `run_worker_first` misses fails silently**:
the asset layer answers first, the middleware never runs, the page keeps
working and the markdown twin simply never appears. Nothing errors and nothing
logs. That is why `MARKDOWN_WORKER_FIRST_RULES` lives next to the resolver in
[`server/utils/markdown/documents.ts`](../server/utils/markdown/documents.ts)
and `documents.test.ts` reads wrangler.jsonc and diffs the two. **Adding a page
to the resolver means adding its path to both.**

## What a document contains

The same ranking the HTML shows, for the same rider - not a summary of it.
Each ranking document calls the same recommend endpoint with the same query
the prerendered page was rendered with (`defaultRankingQuery`, mirroring
`buildRecommendQuery` on the client) and for the same phantom default rider
from [`shared/utils/riderBounds.ts`](../shared/utils/riderBounds.ts). Serving
an agent a different answer from the one a person sees would be cloaking, and
the numbers are the answer.

Three things are said out loud that the page can leave to its UI:

- **Whose time this is.** Nobody chose 75 kg / 175 cm / 225 W, so every
  document names the default rider and points at the open JSON API for the
  reader's own.
- **What narrowed "fastest".** Road frames only, verified equipment only,
  upgrade stage 5, Halo frames excluded, one wheelset per frame - and, on a
  race, what the organiser's format bars outright.
- **What the number rests on.** The `Data` column carries `measured` or
  `estimated` per row, with the confidence note from the MCP formatter.

The table, the confidence column and that note are
[`server/utils/mcp/format.ts`](../server/utils/mcp/format.ts)'s, reused rather
than re-derived: MCP and markdown answer the same question for the same kind
of reader, so a fix to either lands in both. The one piece deliberately not
reused is the pagination line - it tells an MCP client to "call again with a
higher `offset`", and a document has no call to make.

## Cost, and the rate limit

Rendering a ranking document runs the recommend pipeline, which is the
expensive thing on this site - so a markdown page request costs what an
`/api/recommend/**` request costs, while the HTML at the same URL costs
nothing, having been computed at build time.

**Neither rate limit caught that traffic as this feature was first written.**
A zone rule matched on `/api/recommend`, and the path check in the
Workers-binding middleware, both key on the request path - and a markdown
request arrives as `GET /routes/x`. The pipeline run it triggers is invisible
to the zone for a second and independent reason: it goes out over Nitro's
in-process `$fetch`, which never crosses the edge and carries no platform
context (that exemption is deliberate - it is what stops one MCP call costing
one count per internal fetch it fans out into).

Telling an agent from a reader needs the `Accept` header, and the path cannot
stand in for it, because the same URL serves free prerendered HTML to
browsers. A zone rate-limiting rule can read that header only under
**Advanced Rate Limiting** (Business/Enterprise) - on a lower plan an
expression using `http.request.headers` is rejected outright, `not entitled`.

So the budget is taken in the Worker, by
[`server/middleware/01.rate-limit.ts`](../server/middleware/01.rate-limit.ts),
which is where the rest of the site's rate limiting already lives. Still one
implementation, covering the two expensive requests anyone can make without
credentials: `/api/recommend/**` and a page URL that asked for markdown. It
reuses `markdownDocumentFor` and `prefersMarkdown`, so it meters exactly the
requests that will do work - a season page under the `/events/*` rule has no
document and is never counted. `/api/mcp` is gated at the edge and left out
deliberately; `01.rate-limit.ts` records the dependency.

**The numbering is load-bearing, not cosmetic.** Nitro orders middleware by
filename, and the markdown middleware returns a response that ends the chain,
so a limiter ordered after it would never run for the traffic it exists to
meter. `01.rate-limit.ts` before `02.markdown.ts` is what makes the budget
reachable at all.

The counter is the existing one (30 requests / 60 s per client IP, per
Cloudflare location). A 429 carries `Retry-After`, which a well-behaved
crawler backs off on; discovery itself is never blocked, because `/llms.txt`
is not a negotiated page and runs no physics.

**The recommend kill switch IS applied in app code.**
`killSwitches.recommend` (see [site flags](site-flags.md)) is read on the
real request and handed to the document, which then skips the ranking and
says so — the gate cannot see the in-process `$fetch` either, the same hole
`mcp.post.ts` closes the same way. Note this makes a paused ranking diverge
from the prerendered HTML at the same URL, which still shows the ranking it
was built with. That is accepted deliberately: the switch exists to stop
*live* computation during an incident, and of the two representations only
the markdown does any.

Beyond that, the ranking rides the recommend endpoint's own edge cache
(`server/utils/recommendCache.ts`), so the pipeline runs once per route per
deploy per colo, not once per request. `/llms.txt` touches no physics at all
and carries a one-hour `Cache-Control`.

## Why not the Cloudflare zone feature

Cloudflare's
[Markdown for Agents](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/)
does this at the edge with no application code, by converting the origin's
HTML. It is a fine default and needs a paid plan, but it would convert the
rendered page: the chart markup, the equipment drawer, the hydration payload,
the filter controls - and it cannot say whose rider profile the times belong
to, because the HTML does not say it in a sentence. The site already has these
documents in structured form one function call away, so it writes them.

Both can coexist: the zone feature leaves a response alone when the origin has
already answered `text/markdown`.

## Adding a page

1. Write the renderer in `server/utils/markdown/documents.ts` and add the path
   to `markdownDocumentFor`.
2. Add the path to `MARKDOWN_WORKER_FIRST_RULES` **and** to
   `assets.run_worker_first` in wrangler.jsonc. `documents.test.ts` fails if
   the two disagree, which is the only thing standing between a new page and a
   silent no-op.
3. Add a page under that rule to `MARKDOWN_PAGES` in
   `scripts/site-smoke/smoke.mjs` - `documents.test.ts` fails if a rule has no
   smoke page, because the smoke run is the only place the deployed routing is
   ever checked.
4. Rate limiting needs nothing: `01.rate-limit.ts` asks the same resolver,
   so a new document is metered the moment `markdownDocumentFor` knows it.
5. Cover it in `documents.test.ts` - at minimum that the ranking it fetches is
   the one the prerendered HTML was rendered with.

`/about` has no twin on purpose: its content is hand-written prose in a Vue
file, and a markdown copy would be a second one to keep in step. `/profile`
and `/garage` render only from the rider's own browser and have nothing to
serve. A season page (`/events/{season}`) is a Discovery page whose races each
carry their own document, so it is the one gap left deliberately - it is
routed to the Worker anyway (the `/events/*` prefix is the only shape
available for reaching a race page) and handed straight back to the assets.

## Verifying it

Locally, `nuxt dev` renders the markdown but never exercises the asset
passthrough (there is no build output behind it, and the dev binding is a
wrangler proxy that cannot read a Node-realm `Request`). The passthrough needs
the real runtime:

```sh
npm run build && npm run preview
curl -sI -H 'Accept: text/markdown' http://localhost:3000/routes/hilly-route
curl -sI http://localhost:3000/routes/hilly-route          # HTML, from the assets
```

Against production, the scanner behind the spec this implements:

```sh
curl -X POST https://isitagentready.com/api/scan \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://zwiftbikes.com"}'
# checks.contentAccessibility.markdownNegotiation.status == "pass"
```
