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
the routes where the bike or wheelset is the fastest; the count is a button
that opens an Overlay listing those routes with their world and terrain (only
the ones the filters leave, so the list matches the count), each linking to
its page - with `?category=tt` when the Time trial switch is on. A count of zero is plain text.

On the Bikes page the bike's name opens a second Overlay (the Wheels page has
none). It has two halves. The first is worked out in the browser from the
payload already loaded, over the filtered routes: the rank, the mean gap as a
share and in seconds, the bikes ranked just ahead and just behind it, the mean
gap by terrain class, and the three routes the bike is closest to and furthest
from the fastest on (each linking to its page). Each neighbour is told from
its own side: how far ahead or behind it is on mean share, how many seconds
faster or slower it is per route on average, and on how many of the routes
both are timed on it is faster, slower and level. The closest and furthest
lists leave out routes the bike is the fastest on, which are no near-miss. The
fastest bike cannot be measured against itself, so for it the same two lists
are its margins to the runner-up instead, smallest and largest, as "ahead" or
"behind", over the routes both have a time on - the Overlay says how many of
the routes that is. The seconds are a plain average over routes of different
lengths: a feel for the size of the share, which is what ranks the bikes.

The second half is the frame itself, fetched when the Overlay opens from
`/api/bikes/{id}` (the standings entry's id is the frame's id), which is
cached like `/api/bikes`: its category, style, ratings, whether its wheels are
fixed, whether ZwiftInsider bot-tested it ("Bot-tested") or its numbers are
estimated ("Estimated"), the Garage add/remove control, and its upgrade
curve - small flat and climb charts, a stage table, and what full upgrading
saves per hour. Everything is at upgrade stage 5, the stage every standing is
timed at (`DEFAULT_UNOWNED_LEVEL`), so there is no stage picker; the rider's
own stage applies on each route's page. The upgrade numbers are ZwiftInsider's
flat and climb bot tests per stage, not a per-route simulation - per-route
upgrade times would multiply the compute and the payload by six, and the
route page's Equipment drawer already has them. The "Upgrades" column of the
stage table (`app/utils/upgradeStages.ts`) is checked against the published
charts by `upgradeStages.test.ts`. While the frame loads the Overlay shows a
skeleton, and if the fetch fails a "Try again" button.

Both Overlays close once a route link in them has been followed
(`useCloseOverlaysOnNavigate`): they are mounted in `app.vue`, so they would
otherwise stay open over the route page.

## Where the times come from

`scripts/standings/compute-standings.mjs` runs, for every catalog route and
each rider in `STANDINGS_RIDERS` (`shared/utils/standingsRiders.ts`), the
query that rider's route page sends (`buildRecommendQuery`). Two things are
changed: the category is opened to
every frame, and the page is opened to the whole pool. The query goes through
the recommend pipeline itself (`runRecommendPipeline`), followed by the Wheel
alternatives of the fastest road and TT frames that take wheels. The
standings are therefore the route pages' own rankings for two riders, each
with verified equipment only and 175 cm:

- the **default rider** (`DEFAULT_RIDER_INPUTS`): 75 kg, 225 W, solo. This
  table is prerendered with each page.
- the **race rider**: 80 kg, 280 W, race draft, picked with the "Race rider"
  chip (`?rider=race`). On a route that does not allow drafting the ride
  falls back to solo, as a route page's does. Its table is fetched from
  `/api/standings/{bikes,wheels}?rider=race` the first time the chip is
  pressed, then kept.

`server/utils/standings.test.ts` checks a flat route and a climb against a
live ranking, time for time, for each rider.

It is precomputed because it cannot be answered per request. It costs about
750 simulations per route, 1 to 8 CPU-seconds each on a recent laptop, while
a request is limited to 30 CPU-seconds (see `shared/utils/recommendLimits.ts`).
For the same reason the standings stay with those two riders rather than
following a stored profile, a Garage or a Draft, and the pages say so.

## Keeping it current

- `npm run standings:compute` regenerates `shared/data/standings.generated.json`
  (the default rider) and `shared/data/standings.race.generated.json` (the
  race rider).
  It spreads the routes over worker threads and takes ~4-6 minutes per rider on 8
  cores. `--only slug,slug` refreshes a few routes and keeps the rest;
  `--profile default|race` does one rider; `--workers N` sets the thread count.
- `npm run validate:standings`, part of `npm run validate` and so of the
  pre-commit hook and the build, is a cheap fingerprint check. It covers the
  equipment physics table, the measured frames and wheels, and each table's
  rider. A speed-data edit fails it until the tables are regenerated.
- Code is not fingerprinted. A change to the physics or the ranking that
  moves a time fails the test above instead. Rerun the compute after one.
- A route the catalog gains is not a failure. The check warns, the route is
  left out until the next run, and the pages say how many routes are not
  counted yet.

## Payload

Each page carries its own half of the default rider's table (the bikes or the
wheels) in its
prerendered payload: ~84 KB gzip, under the homepage's 100 KB budget, which a test
holds it to - and holds the race rider's table to as well, though that one
travels only on request. Each route's gaps travel as one comma-separated string, since
the payload format gives every array element a slot of its own. The filters -
the homepage's own, through `useRouteFilters` and
`RouteFilterBar` - and the Road / TT switch then work in the browser, without
a request.

## Possible next steps

- Standings for more riders, for example a few W/kg bands. Each would cost
  another full run and another committed table.
- Markdown Twins for the two pages.
