# Markdown for agents

Every Ranking page on the site - route, segment and race - answers in
markdown when the request asks for it, at the same URL a browser uses, as do
the two Discovery pages that list them (both terms are defined in
[CONTEXT.md](../CONTEXT.md)).

```
$ curl -H 'Accept: text/markdown' https://zwiftbikes.com/routes/hilly-route

# What's the fastest bike for Watopia Hilly Route?

ZwiftBikes predicts the Specialized Tarmac SL9 with Shimano C99/Disc is the
best bike and wheels for Watopia Hilly Route in Watopia: the fastest road setup
for a 75 kg rider at 225 W, finishing in 17:42 (~32.9 km/h). The Canyon Aeroad
2024 with Zipp 858/Super9 is 0.33 s behind.

75 kg / 175 cm / 225 W / solo; 1 lap, including any lead-in once. Standard
(Road); verified only; unowned Halo bikes excluded.
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
  A run race's twin also carries `X-Robots-Tag: noindex, follow`, as its page
  does (see below); no other twin carries a robots header.
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
[`server/middleware/02.markdown.ts`](../server/middleware/02.markdown.ts)
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
Serving an agent a different answer from the one a person sees would be
cloaking, and the numbers are the answer.

A ranking document gets its ranking in process, from the Ride ranking module
([`server/utils/rankRide.ts`](../server/utils/rankRide.ts)) - the same module
the recommend endpoints and the MCP tools rank through - and never over HTTP.
It builds its input the way its page's own request is built, from one source
the page and the document share:

1. **The page's Ride.** The route at one lap (the lap picker's start); the
   segment at race pace, or at sprint power on a sprint; the race's first
   Category group's course and laps, with every rule its Race format fixes -
   the TT-frame bar *and* the draft (`rideRulesForFormat`).
2. **The page's query.** `buildRecommendQuery` - the browser's own builder -
   applied to `DEFAULT_RIDER_INPUTS`, the values the page's composables seed
   their state with: the phantom 75 kg / 175 cm / 225 W rider, solo, road
   frames, verified equipment only, Halo frames left out, upgrade stage 5,
   no Garage. Both live in
   [`shared/utils/recommendQuery.ts`](../shared/utils/recommendQuery.ts), so
   there is no server-side copy of the client's defaults to drift.
3. **The endpoint's parse.** The query is parsed with the endpoint's own zod
   schema and ranked through `rankRideForQuery`, the call the HTTP adapter
   makes, which translates it with `rankingRequestFromQuery`. Nothing builds
   ranking options by hand.

The module keys its edge cache on that parsed question, not on a URL, so a
document and its page's browser request reach **one cache entry**:
`documents.test.ts` renders a route and a race document and then sends the
real route endpoint the query string the browser sends for the page, and
checks the endpoint's cache read is the key the document wrote.

What a ranking page says about its Ride on its own - its name and question,
its Fact row and the notes under it, and on a race page where the points
are, the PowerUps and whether the organiser's figures agree with the course -
is its **Ride statement** ([CONTEXT.md](../CONTEXT.md)), built by
[`shared/utils/rideStatement`](../shared/utils/rideStatement/index.ts). The
page renders it and so does its document, which has no words of its own for
any of it; `documents.test.ts` builds each kind's statement on its own and
checks that every string the page prints from it in its body - the name,
the question, the Fact row and its notes, a race's own facts - is in the
document.

A ranking that is not there leaves the document serving the page's facts
with a note instead of the table: "temporarily paused" for the kill switch,
and "could not be computed" for a rider who stalls (an outcome of the
module) or any other failure (a throw). The note reads the same for both, so
a throw is also logged as one `markdown-ranking-error` JSON line naming the
course, its slug and the error - see [observability.md](observability.md).

Three things are said out loud that the page can leave to its UI:

- **Whose time this is.** Nobody chose 75 kg / 175 cm / 225 W, so every
  document names the default rider and points at the open JSON API for the
  reader's own.
- **What narrowed "fastest".** Road frames only, verified equipment only,
  upgrade stage 5, Halo frames excluded, one wheelset per frame, one row per
  frame however many paints Zwift sells it in. On a race, what the
  organiser's format bars outright is the page's own note under its Fact
  row, from the Ride statement.
- **What the number rests on.** The `Data` column carries `measured` or
  `estimated` per row, with the confidence note from the MCP formatter.

The table, the confidence column and that note are
[`server/utils/mcp/format.ts`](../server/utils/mcp/format.ts)'s, reused rather
than re-derived: MCP and markdown answer the same question for the same kind
of reader, so a fix to either lands in both. The one piece deliberately not
reused is the pagination line - it tells an MCP client to "call again with a
higher `offset`", and a document has no call to make.

## A race that has been run

A twin is the page (see **Twin** in [CONTEXT.md](../CONTEXT.md)), so whatever
the page says about its run state and whether it is indexed, the twin says
too. Once a race has been run (`hasBeenRun`), its page shows a notice above
its title and is `noindex, follow`; its twin begins with the same notice as a
blockquote above its title - the raced-on date, the season's next race as a
link (its page, its round on the season page when it has no page yet, the
next round with nothing announced once no race is left, or the events hub
once the season has nothing left), and the route on its own as a
link - and everything from the title down is the live twin's. The words come
from one builder both read, `runRaceNotice` in
[`shared/utils/runRaceNotice.ts`](../shared/utils/runRaceNotice.ts).

The document reports that its page is noindex alongside its markdown
(`RenderedMarkdown`), and the middleware sends `X-Robots-Tag: noindex, follow`
only then, rather than re-deriving the run state itself. Every other twin
reports `false` and its headers are what they always were.

"Run" is decided on the day the twin is rendered for, which is part of the
render context (`today`), so a test can hold it. A twin is never prerendered,
so the middleware supplies the real UTC day; on the dev server the pages'
`EVENTS_TODAY` pin applies to twins too, read through the same helper
(`eventsRenderDay`), so a browser journey can ask for the twin of a run race.
For up to a day after a race ends, the twin says it has been run while the
still-prerendered HTML does not, until the rider's clock or the next daily
build catches the page up: the twin is never staler than the page.

## Cost, and the rate limit

Rendering a ranking document runs the recommend pipeline, which is the
expensive thing on this site - so a markdown page request costs what an
`/api/recommend/**` request costs, while the HTML at the same URL costs
nothing, having been computed at build time.

**Neither rate limit caught that traffic as this feature was first written.**
A zone rule matched on `/api/recommend`, and the path check in the
Workers-binding middleware, both key on the request path - and a markdown
request arrives as `GET /routes/x`. The pipeline run it triggers is invisible
to the zone for a second and independent reason: it is a function call inside
the Worker that answered the page URL, so no request for it ever crosses the
edge.

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
real request and handed to the document, which passes it to the Ride ranking
module; the module refuses before reading its cache, and the document serves
its facts and says the ranking is paused. `site-flags-gate.ts` only guards
the endpoints, which a document never calls - the module's own check is the
one that counts, as it is for the MCP tools. Note this makes a paused ranking diverge
from the prerendered HTML at the same URL, which still shows the ranking it
was built with. That is accepted deliberately: the switch exists to stop
*live* computation during an incident, and of the two representations only
the markdown does any.

Beyond that, the ranking rides the module's edge cache
(`server/utils/recommendCache.ts`), so the pipeline runs once per Ride per
deploy per colo, not once per request - and not at all for a document whose
page's own request for the default rider has already been answered there,
since the two share an entry (see above). The document hands the module its request, so the cache write goes
out through that request's `waitUntil`, off the critical path.
`/llms.txt` touches no physics at all and carries a one-hour `Cache-Control`.

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
   to `markdownDocumentFor`. It returns its markdown and whether its page is
   noindex, which is `false` unless the page itself says otherwise.
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
5. Cover it in `documents.test.ts` - at minimum that its ranking reaches the
   same cache entry as the prerendered page's own request, which it will if
   it states the page's Ride and ranks it through `rankAsThePage`, and, for a
   Ranking page, that it says everything its page's Ride statement says.

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
