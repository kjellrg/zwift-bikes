# Standings

The Bikes (`/bikes`) and Wheels (`/wheels`) pages rank equipment across
routes instead of on one route: every bike, or every wheelset, by how far
behind the fastest it finishes on average over the routes a rider filters to.
**Standings** in [CONTEXT.md](../CONTEXT.md) is the definition; this page is
how the numbers are made and kept current.

## What is ranked

- **Bikes** - every bot-tested road and TT frame (Colourways once, the
  purchasable Halo bikes left out, every frame at Upgrade stage 5). On each
  route a frame is timed on its own fastest wheels and compared with the
  fastest frame of its category there. That is its row in the route page's
  Ranking.
- **Wheels** - every bot-tested wheelset, timed on each route's fastest road
  (or TT) frame that takes wheels, and compared with the fastest wheels on
  that frame. That is the Wheel alternatives list rank 1 opens on the route
  page. The Concept Z1 has fixed wheels, so where it wins, the next frame down
  stands in. Wheels that time identically on every route are listed once, as
  that list collapses them.

The rank is the **mean of each route's gap as a share of that route's fastest
time**, so every route weighs the same. A mean of seconds would let one
100 km route outweigh ten 10 km ones. The "≈ s per hour" figure beside each
mean is the same share as seconds over an hour of riding. "Fastest on" counts
the routes where the bike or wheelset is the fastest.

## Where the times come from

`scripts/standings/compute-standings.mjs` runs, for every catalog route, the
query a fresh visitor's route page sends (`buildRecommendQuery` with
`DEFAULT_RIDER_INPUTS`). Two things are changed: the category is opened to
every frame, and the page is opened to the whole pool. The query goes through
the recommend pipeline itself (`runRecommendPipeline`), followed by the Wheel
alternatives of the fastest road and TT frames that take wheels. The
standings are therefore the route pages' own rankings for the default rider:
75 kg, 175 cm, 225 W, solo, verified equipment only.
`server/utils/standings.test.ts` checks a flat route and a climb against a
live ranking, time for time.

It is precomputed because it cannot be answered per request. It costs about
750 simulations per route, 1 to 8 CPU-seconds each on a recent laptop, while
a request is limited to 30 CPU-seconds (see `shared/utils/recommendLimits.ts`).
For the same reason the standings stay with the default rider rather than
following a stored profile, a Garage or a Draft, and the pages say so.

## Keeping it current

- `npm run standings:compute` regenerates `shared/data/standings.generated.json`.
  It spreads the routes over worker threads and takes ~3.5 minutes on 8
  cores. `--only slug,slug` refreshes a few routes and keeps the rest;
  `--workers N` sets the thread count.
- `npm run validate:standings`, part of `npm run validate` and so of the
  pre-commit hook and the build, is a cheap fingerprint check. It covers the
  equipment physics table, the measured frames and wheels, and the default
  rider. A speed-data edit fails it until the table is regenerated.
- Code is not fingerprinted. A change to the physics or the ranking that
  moves a time fails the test above instead. Rerun the compute after one.
- A route the catalog gains is not a failure. The check warns, the route is
  left out until the next run, and the pages say how many routes are not
  counted yet.

## Payload

Each page carries its own half of the table (the bikes or the wheels) in its
prerendered payload: ~84 KB gzip, under the homepage's 100 KB budget, which a test
holds it to. Each route's gaps travel as one comma-separated string, since
the payload format gives every array element a slot of its own. The filters -
the homepage's own, through `useRouteFilters` and
`RouteFilterBar` - and the Road / TT switch then work in the browser, without
a request.

## Possible next steps

- Standings for riders other than the default one, for example a few W/kg
  bands. Each band would cost another full run.
- Markdown Twins for the two pages.
