# Maintaining the Race Calendar

## In one sentence

The event pages are driven entirely by hand-typed data files under `shared/data/events/` — adding a round is editing one file and running one validator, and everything else (pages, prerendering, sitemap, navigation) follows automatically.

## Why this is hand-curated

There is no API for any of it. WTRL publishes the Zwift Racing League calendar on its own site, and ZwiftInsider writes up each round in detail. Both are prose intended for humans. So every field in a season file is typed in from those two sources, and every race carries a `sourceUrl` pointing back at where its details came from.

That makes the failure mode worth naming up front, because it isn't a crash. **A wrong entry renders perfectly while being quietly wrong.** A mistyped route slug just 404s. A wrong lap count produces a believable distance, a believable finish time, and a bike recommendation computed over the wrong geometry — and nothing in a typecheck or a build will notice. That is what `scripts/validate-events.mjs` exists to catch.

## Where things live

| Path | What it is |
|---|---|
| `shared/data/events/zrl-2026-27.ts` | The season itself — the only file you edit to add or update races |
| `shared/types/events.ts` | Field definitions, each with a comment explaining why it exists |
| `shared/utils/events.ts` | Accessors (`getSeasons`, `getPublishableRaces`, `ttBikesAllowed`, …) |
| `scripts/validate-events.mjs` | The validator, run by `npm run validate:events` and by `npm run build` |
| `app/pages/events/` | The three page types (hub, season, race) |
| `server/api/events/[season].get.ts` | Joins races to route data for the season calendar |

## Category groups: the shape of the data

The single most important thing to know is that **a race is not one course**. WTRL publishes A/B and C/D separately, and they differ in two ways:

- **Different lap counts on the same route** — Round 1 Week 2 is Innsbruckring, 4 laps for A/B and 3 for C/D.
- **Genuinely different routes** — Round 1 Week 3 puts A/B on Makuri 40 and C/D on Urumaze. Week 6 does it again.

So the route, the lap count and the published figures all live on a **category group**, not on the race. When all four categories ride the same thing, that's a single group listing all four cats — and the race page then shows no category selector at all, because there's nothing to choose between.

## The publish gate

A race only gets a page once **all of** these hold:

- `format` — otherwise the equipment rules are unknown (see below)
- `categories` is non-empty — otherwise there are no laps, and the distance shown (and the geometry the physics runs on) would silently be one lap of a route raced over six
- **at least one** group has a `routeSlug` the catalog resolves — otherwise there's nothing to recommend a bike for

Only *one* group needs a resolvable route, not all of them. ZRL sometimes runs a group on an unlisted "exclusive" route that isn't in the public catalog — Round 1 Week 6 does this to C/D. That group still gets listed with its published name and figures, and the page explains why it has no ranking, rather than the whole race disappearing over it.

Until then the race still appears on the season calendar as a `TBC` row, which is the point: riders plan around the dates long before the routes are announced. But it gets **no page, no prerendered HTML and no sitemap entry**. A page containing a date and two placeholders is a thin page, and twenty-four of them is the pattern search engines treat as doorway pages.

This is enforced in one place — `isRacePublishable()` in `shared/utils/events.ts` — which both the sitemap and the prerender list read, so the two can't drift.

## Adding a round when it's announced

### 1. Find the route slug

Route slugs come from the `zwift-data` package, and its spelling is authoritative — not WTRL's or ZwiftInsider's prose. Look one up by name:

```bash
node -e "const{routes}=require('zwift-data');console.log(routes.filter(r=>r.name.toLowerCase().includes('hell')).map(r=>({slug:r.slug,world:r.world,lap:r.lap,distance:r.distance,elevation:r.elevation})))"
```

Note `lap` in the output. A route with `lap: false` is point-to-point and can only ever be ridden once — setting more than one lap on it is a validator error, not a rounding problem.

### 2. Fill in the race

**File:** `shared/data/events/zrl-2026-27.ts` — this is the only file you edit. Everything else in this section happens on its own.

Inside it, find the round you're filling in (`rounds` → the entry with the matching `number`) and, in that round's `races` array, the placeholder line for the week you want. Every race already exists as a one-line entry with its slug, round, week and date filled in:

```ts
{ slug: 'round-2-week-1', round: 2, week: 1, date: '2026-11-17', categories: [], updatedAt: CHECKED },
```

Expand that line into the published details:

```ts
{
  slug: 'round-2-week-1',
  round: 2,
  week: 1,
  date: '2026-11-17',
  format: 'points',
  categories: [
    { cats: ['A', 'B'], routeSlug: 'makuri-40', routeName: 'Makuri 40', laps: 1, officialDistanceKm: 40.3, officialElevationM: 312.9 },
    { cats: ['C', 'D'], routeSlug: '4092230492', routeName: 'Urumaze', laps: 1, officialDistanceKm: 24.8, officialElevationM: 193.4 }
  ],
  powerups: 'None',
  note: 'The two halves of the field ride genuinely different races this week...',
  sourceUrl: R1_SCHEDULE,
  updatedAt: '2026-08-18'
}
```

When every category rides the same course, collapse it to one group and no selector appears:

```ts
categories: [
  { cats: ['A', 'B', 'C', 'D'], routeSlug: 'green-to-screen', routeName: 'Green to Screen', laps: 1, officialDistanceKm: 28.7, officialElevationM: 211.8 }
]
```

And when a group races something the catalog doesn't have, give it the published name and omit the slug:

```ts
{ cats: ['C', 'D'], routeName: 'ZRL Exclusive Route', laps: 1, officialDistanceKm: 24.0, officialElevationM: 283.5 }
```

Leave `slug`, `round`, `week` and `date` alone — they're already correct, and the validator cross-checks that the slug matches its own round and week numbers and that the date falls inside the round.

Note that the placeholders share a `CHECKED` constant for `updatedAt`, which just records when the calendar was transcribed. Once you fill a race in, give it its own literal date instead — that race's details now changed on a different day from the rest.

### 3. Validate

```bash
npm run validate:events
```

### 4. Check it in the browser

```bash
npm run dev
```

Then open the race page and confirm the distance, the category toggle and the equipment callout all read the way the published schedule does. If the groups are on different routes, switch the selector and check the second one loads its own route, elevation profile and ranking.

Note that WTRL's schedule page renders in JavaScript, so fetching its HTML gets a skeleton full of `TBC` — the real table is only visible in a browser.

## The fields that carry real weight

### `format` — this is what makes an event page worth having

Zwift **disables TT frames entirely** for points and scratch races, and enables them (with draft) only for team time trials. The format drives that rule rather than it being stored separately, via `ttBikesAllowed()`.

This is not cosmetic. On a points race the un-filtered ranking returns nine TT bikes at the top — every one of which Zwift will not let a rider start on. Getting `format` wrong doesn't produce a slightly-off page; it produces a page recommending illegal equipment.

| `format` | Label shown | TT bikes |
|---|---|---|
| `'ttt'` | Team time trial | Allowed, and drafted |
| `'points'` | Points race | Disabled |
| `'scratch'` | Scratch race | Disabled |

### `categories` — the page's primary control

This becomes the category selector on the race page. Changing it can change the lap count, the distance, the climbing — and sometimes the route itself — and therefore which combo comes out fastest. List the groups in the order WTRL does; **the first is the default**, and is what the page title, the canonical route link and the structured data are built from.

### `routeName` — always set it, even when the slug resolves

It's the course name exactly as the organiser publishes it, and it does two jobs. It's what the slug was mapped *from*, so the validator can compare the two and warn when they diverge — which is how a mis-mapped slug gets caught. And it gives the page a human name without joining to the catalog, which matters more than it sounds: `zwift-data` has routes whose slug is a bare numeric id (Urumaze is `4092230492`), and without `routeName` the page would show riders that number.

### `officialDistanceKm` / `officialElevationM` — display only, and per group

These live on the group, because they depend on that group's route and laps.

They usually agree closely with this site's own totals (lead-in plus laps of real route data), and agreement is a good sign the mapping is right — every one of ZRL 2026/27 Round 1's eight group entries matched to within **0.2% on distance and 0.3% on elevation**, which is what cross-checked the slugs and lap counts when it was transcribed.

But they don't always. Measured across ZRL 2025/26 Round 4:

| Race | Our totals | Published | Delta |
|---|---|---|---|
| Croissant, 4 laps | 40.3 km / 219 m | 40.4 km / 219 m | ~0 |
| The Classic, 6 laps | 33.2 km / 304 m | 32.3 km / 310 m | +0.9 km |
| Double Span Spin, 5 laps | 41.8 km / 445 m | 40.6 km / 531 m | +1.2 km / **−86 m** |

So these two fields are shown as the organiser's figures, attributed to them, and **never fed into the physics**. The model always runs on the route's own verified geometry. When the two differ the race page shows both rather than quietly picking one — the published number is what riders see in the event listing, and ours is what the finish times below it were computed from.

### `falSegments` / `ftsSegments` — where the points are

Points races score at intermediate segments, two ways, and usually at the same ones: **FAL** ("first across the line") ranks riders by the order they cross it, **FTS** ("fastest through segment") by elapsed time across it. The organiser publishes them in two columns; record them as two lists and the race page merges them into one row per segment.

They belong to the **group**, like everything else — in Round 1 Week 3 the A/B route has five scoring sprints and the C/D route has none.

An absent or empty list means *the organiser lists none*, which is a real published state — three of Round 1's races are like that — and the page says so explicitly rather than rendering an empty table. The validator emits a note for any points race with nothing listed, since that's also what a missed column looks like.

**`slug` means "this site has a page for it", not "this segment exists."** The segment catalog is built from routes that publish positional `segmentsOnRoute` data, and 51 of 335 routes don't — Makuri 40 among them. Its five scoring sprints are real, and in `zwift-data`, but have no page here, so they're listed without links and the page explains why. Set `slug` only when a page exists; the validator errors if it doesn't, and notes when a segment has since gained one so the link can be added.

### `note` — not optional in spirit

Two or three hand-written sentences about how the race tends to play out. The type marks it optional and the validator only warns, but it is the field that keeps a race page from being a template with a route name swapped into it. Everything else on the page is derived; this is the only part a route page couldn't have produced by itself.

### `updatedAt`

Drives `lastmod` in the sitemap. **Bump it whenever you change a race's details, and only then** — a date that moves on every build is exactly the kind of inaccuracy that gets `lastmod` ignored altogether.

## Retiring a race or a season

Set `hidden: true` to take something down without deleting it. The details stay in the file as a record of what was scheduled; they just stop being shown.

**One race** — for a race that was cancelled, moved onto a different route, or is simply too old to be worth showing:

```ts
{ slug: 'round-1-week-2', round: 1, week: 2, date: '2026-09-29', hidden: true, /* ... */ }
```

**A whole season** — the usual case for an old season, rather than hiding two dozen races one at a time. Set it alongside `slug` and `label`:

```ts
export const zrl202627: EventSeason = {
  slug: 'zrl-2026-27',
  label: '2026/27',
  hidden: true,
  // ...
}
```

Either way the effect is the same, and it's complete:

| | Hidden race | Hidden season |
|---|---|---|
| Season calendar | Row disappears | — |
| Events hub | — | Card disappears |
| Its page | 404 | Season **and** every race page 404 |
| Sitemap | Dropped | All of its URLs dropped |
| Prerendered HTML | Not generated | Not generated |
| "Next race" highlight | Skipped | — |

This works through the same `isRacePublishable()` gate that governs unannounced races, so there's no separate list to keep in sync, and hidden races never reach the client at all — they're filtered server-side rather than being sent and then not drawn.

Two things worth knowing:

- **Hidden entries are still validated.** `hidden` is a display decision, not a way to park broken data — a retired race with a route slug that doesn't exist still fails the build. The checks that are skipped are the ones about the quality of a page it no longer has (distance divergence, missing `note`, missing `sourceUrl`).
- **Hiding an indexed page starts returning 404s** for a URL search engines already know. That's the right outcome for something genuinely obsolete, but it isn't free — for a race that simply happened and is now in the past, leaving it up is usually better. Past races still answer "what did we ride for Round 1 Week 2", and they keep accruing the authority that helps the next round rank.

## What the validator checks

Run by `npm run validate:events`, and automatically as the first step of `npm run build` — so a bad entry fails before the ~9-minute build rather than after it.

**Errors** (exit 1, build stops):

- a `routeSlug` that doesn't exist in `zwift-data`
- a group with neither a `routeSlug` nor a `routeName` — nothing to show at all
- a group listing no categories, or the same category appearing in two groups
- laps > 1 on a route that isn't lap-based, or a lap count below 1
- a race slug that doesn't match its own round/week numbers, or repeats within a season
- a `race.round` that disagrees with the round it sits in
- a date that isn't `YYYY-MM-DD`, or falls outside its round
- race dates out of calendar order within a season
- published distance more than **5%** off our own totals, per group

**Warnings** (exit 0, build continues):

- published elevation more than **10%** off our own totals — a known real divergence rather than necessarily a typo, but worth confirming the lap count
- a `routeName` that doesn't match what its `routeSlug` resolves to (compared ignoring case and punctuation) — the signature of a mis-mapped slug
- a group with a slug but no `routeName`, so nothing cross-checks the mapping
- a category (A, B, C or D) that no group covers — a rider in it has no answer on the page
- a publishable race with no `note`
- a publishable race with no `sourceUrl`

**Notes** (informational): races that aren't published yet, and why — unannounced, incomplete, or hidden.

## What happens automatically

Once a race passes the publish gate, nothing else needs wiring up:

- **Its page exists** at `/events/<season>/<race>` — the route is file-based
- **It prerenders** to static HTML, enumerated in `nuxt.config.ts` from `getPublishableRaces()`
- **It enters the sitemap** with its `updatedAt` as `lastmod`
- **The season calendar links to it**, replacing the `TBC` row
- **Structured data** (`SportsEvent`, `BreadcrumbList`, `FAQPage`) is generated from the fields

## Adding a whole new season

1. Copy `shared/data/events/zrl-2026-27.ts` to a new file and update `slug`, `label`, the round names and dates, and the race dates.
2. Register it in the `seasons` array at the top of `shared/utils/events.ts`.

Everything else — the hub card, the season page, prerendering, the sitemap — follows from that array.

## Adding a different series

The types are already series-agnostic (`seriesSlug`, `seriesName`, `organizer`), so a WTRL TTT or Zwift Games season is a new data file registered the same way. Two things would need thought first:

- `RaceFormat` is currently the three ZRL formats. A series with different formats needs the union extended, plus label/colour entries in `app/utils/labels.ts` and a matching rule in `ttBikesAllowed()`.
- `RaceCategory` is `A | B | C | D`. Series using different category names would need that widened.

## The one rule that isn't obvious

`shared/data/events/` and `shared/utils/events.ts` must stay **leaf modules** — plain dates, strings and numbers, with no import of `shared/utils/catalog`.

Catalog transitively pulls in `routeSurfaces.generated.json`, which is about 2 MB. The event pages import the calendar directly (it's tiny), so an innocuous-looking `import { getRouteBySlug }` added to one of these files would drag that entire dataset into the client bundle. Any join to real route data belongs in `server/api/events/[season].get.ts`, which is exactly why that endpoint exists — and why it returns a deliberately narrow route shape rather than the full `RouteSummary`, which carries each route's complete elevation profile and surface segments (~10 KB per race, none of which a calendar row displays).
