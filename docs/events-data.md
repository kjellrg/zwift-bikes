# Maintaining the Race Calendar

## In one sentence

The event pages are driven entirely by hand-curated JSON files under `shared/data/events/` — adding a race is answering the scaffolder's prompts (or editing one file) and letting the validator check it, and everything else (pages, prerendering, sitemap, navigation, homepage teaser, route-page cross-links) follows automatically.

## Why this is hand-curated

There is no API for any of it. WTRL publishes the Zwift Racing League calendar on its own site, Zwift announces each month's ZRacing theme, and ZwiftInsider writes both up in detail. All of it is prose intended for humans. So every field in a season file is typed in from those sources, every race carries a `sourceUrl` pointing back at where its details came from, and every season lists its `sources` with the date each was last checked.

That makes the failure mode worth naming up front, because it isn't a crash. **A wrong entry renders perfectly while being quietly wrong.** A mistyped route slug just 404s. A wrong lap count produces a believable distance, a believable finish time, and a bike recommendation computed over the wrong geometry — and nothing in a typecheck will notice. That is what the zod schema and `scripts/events/validate-events.mjs` exist to catch, in two layers:

1. **Schema** (`shared/utils/events.ts`): every season file is zod-parsed once at module init. Wrong types, unknown fields (the objects are strict — typos in field names fail), invalid powerup names, malformed dates and slugs all throw with the season slug and JSON path in the message. Because `nuxt.config.ts` imports this module for the prerender list, broken data cannot survive to a built site.
2. **Validator** (`scripts/events/validate-events.mjs`): everything zod can't know — route slugs against zwift-data, lap counts against the route's `lap` flag, published figures against this site's own computed totals, scoring-segment slugs against the segment catalog, dates against round ranges.

## Where things live

| Path | What it is |
|---|---|
| `shared/data/events/*.json` | The seasons themselves — the only files you edit to add or update races |
| `shared/data/events/index.ts` | The registry: one explicit import per season file |
| `shared/utils/events.ts` | The zod schema (field docs live here as comments), inferred types, and accessors (`getSeasons`, `getPublishableRaces`, `ttBikesAllowed`, …) |
| `shared/types/events.ts` | The API-response join types (`EventSeasonWithRoutes`, …) |
| `scripts/events/validate-events.mjs` | The validator — `npm run validate:events`, and the first step of `npm run build` |
| `scripts/events/add-race.mjs` | Interactive scaffolder — `npm run events:add` |
| `scripts/events/find-route.mjs` | Slug lookup — `npm run events:find-route -- "makuri"` (add `--segments` for scoring segments) |
| `app/pages/events/` | The three page types (hub, season, race) |
| `server/api/events/[season].get.ts` | Joins races to route data for the season calendar |

## The leaf-module rule

Nothing reachable from `shared/utils/events.ts` may import `shared/utils/catalog` — that module pulls in `routeSurfaces.generated.json` (~2 MB), and the events module is imported client-side by the pages and at config time by `nuxt.config.ts`. Races reference routes **by slug string only**; the join to real route data happens server-side in `server/api/events/[season].get.ts`. If you add a helper to the events module and it needs route data, it's in the wrong place.

## Category groups: the shape of the data

The single most important thing to know is that **a race is not one course**. Organisers publish per-category details that differ in two ways:

- **Different lap counts on the same route** — ZRL R1 Week 2 is Innsbruckring, 4 laps for A/B and 3 for C/D.
- **Genuinely different routes** — R1 Week 3 puts A/B on Makuri 40 and C/D on Urumaze.

So the route, the lap count and the published figures all live on a **category group**, not on the race. When every category rides the same thing, that's a single group — and the race page then shows no category selector and no comparison table, because there's nothing to compare.

Two ways to say who a group is for:

- `cats` — lettered pens, e.g. `["A", "B"]`. ZRL.
- `label` — a display string for series that don't use pens. ZRacing 2026 entries are racing-score ranges (Women-Only, Range 1, Range 2, Advanced), all riding the same course: one group, `"cats": []`, `"label": "All categories"`.

Every group needs one or the other (schema-enforced).

## Powerups

`powerups` is a race-level field with three meaningful states, and the distinction is rendered, so keep it honest:

| In the JSON | Meaning | On the page |
|---|---|---|
| field absent | organiser hasn't published powerup rules | **nothing at all** — no placeholder |
| `{ "allowed": [] }` | explicitly no powerups | a "No powerups" badge |
| `{ "allowed": ["feather", "ghost"] }` | the restricted set | one badge per powerup |

Valid names: `feather`, `aero`, `draft`, `ghost`, `anvil`, `steamroller`, `burrito` (schema-enforced). `note` carries placement detail as published ("PowerUps are disabled in TTTs").

## Field notes

- **`note` vs `curatorNote`**: `note` is the rider-facing tactical text — it is what keeps a race page from being a template with a route name swapped in. `curatorNote` is for future curators (mapping reasoning, source quirks, documented divergences) and never renders. They exist at season, race, group and scoring-segment level.
- **`date` / `endDate`**: single-day races (ZRL) set only `date`. Week-long stages (ZRacing) set both; a race is *past* once `endDate ?? date` is behind today, and the pages display the window as a range.
- **`officialDistanceKm` / `officialElevationM`**: exactly as the organiser publishes them, display-only. The physics always runs on the route's own geometry. When the two diverge the race page shows both — and when the divergence is over the validator's tolerance for a *known* reason (ZwiftInsider's ZRacing figures include an event-pen lead-in, ~2 km over route + lead-in), say so in the group's `curatorNote`: that is what downgrades the validator's error to a warning.
- **Scoring segments** (`falSegments` / `ftsSegments`): names exactly as published. Set `slug` **only when this site has a page for that segment** — the validator errors on a slug with no page (it would render a 404 link) and prints a note when an unlinked name gains a page. `scoringSegmentsTbd: true` means "checked the source, not published yet" — distinct from an empty list, which asserts the organiser lists none.
- **Race slugs** are stable within a season and deliberately route-free (organisers have swapped routes after publishing). Conventions per series — `round-{r}-week-{w}` for ZRL, `stage-{w}` for ZRacing — are generated by the scaffolder and checked as a warning. `raceDisplayName()` derives the heading ("Round 1 Week 3" / "Stage 2") from the slug.

## The publish gate

A race only gets a page once **all** of these hold: a `format` (the equipment rules derive from it — TT frames are legal, and draft, only in a TTT; see `ttBikesAllowed`), a non-empty `categories`, and **at least one** group whose `routeSlug` the catalog resolves. Only one group needs a resolvable route: ZRL sometimes runs a group on an unlisted "exclusive" route (R1 Week 6, C/D) — that group is still listed with its published figures and an explanation, rather than the whole race disappearing over it.

Until then the race appears on the season calendar as a TBC row — riders plan around dates long before routes are announced — but gets **no page, no prerendered HTML and no sitemap entry**. Two dozen date-and-placeholder pages is the pattern search engines treat as doorway pages.

Enforced in one place — `isRacePublishable()` — which the sitemap, the prerender list, the race page's own 404 check, the homepage teaser and the route-page cross-links all read, so none of them can drift.

## Adding a race

```bash
npm run events:add
```

The scaffolder walks season → round → dates → format → category groups → powerups → note/source, generates the slug, writes the entry in schema field order, stamps `updatedAt`, and runs the validator. Its route picker shows distance, elevation, lead-in and the `lap` flag inline, so a laps>1 mistake on a point-to-point route is caught at entry.

Doing it by hand instead: find slugs with `npm run events:find-route -- "name"` (zwift-data's spelling is authoritative, not the organiser's prose), edit the season file, bump `updatedAt` (it drives the sitemap's `lastmod` — never let it claim a change that didn't happen), then `npm run validate:events`.

## Retiring races and seasons

| Flag | Season calendar | Race page | Sitemap / prerender |
|---|---|---|---|
| `hidden: true` on a race | row disappears | 404s | dropped |
| `hidden: true` on a season | hub card and season page 404 | all 404 | all dropped |
| (nothing — race just becomes past) | moves into the collapsed "Past races" section client-side | stays up, "Completed" badge | stays |

`hidden` retires a page without deleting its data — the entry stays in the file as a record. Note that hiding an already-indexed race starts returning 404s for a URL search engines know; that's the intended outcome for genuinely obsolete pages, but it isn't free. The validator still validates hidden entries: `hidden` is a display decision, not a way to smuggle broken data past the build.

## Adding a season or a new series

1. Create `shared/data/events/<series>-<season>.json` and add one import line to `shared/data/events/index.ts`.
2. A new series needs: `seriesSlug`/`seriesName`/`organizer` (+ `organizerUrl` — we link back to the organiser prominently; the disclaimer, the hub badge and the race pages' "Official event info" link all use it), a slug convention entry in the scaffolder and validator if it has one, and a decision on categories (pens vs `label` groups).
3. ZRacing is modelled as **one season per calendar year**, each month a round (`number` = month number, `name` = "August: Makuri Madness"), weekly stages as races with `endDate`.
4. Check the race-format enum covers the series' formats; extend `raceFormatSchema` (and `RACE_FORMAT_LABELS`/`RACE_FORMAT_COLORS` in `app/utils/labels.ts`) if not.

## The validator's rules

Errors (build-blocking): unknown/duplicate race slugs or paths; `race.round` disagreeing with its round; dates outside the round's range; `endDate` before `date` or past the round's end; overlapping race windows within a round; a `routeSlug` zwift-data doesn't have; laps > 1 on a point-to-point route; a scoring-segment slug with no segment page; a pen listed in two groups; published distance >5% off computed totals **without** a documenting `curatorNote`; non-ascending dates within a round; a group with neither route slug nor route name.

Warnings: slug off the series convention; route name not matching the slug's route (mis-mapping signature); missing `routeName`; documented >5% distance divergence; elevation >10% off; a pen-based race not covering A–D; a points race with no scoring segments and no `scoringSegmentsTbd`; missing `note` or `sourceUrl` on a publishable race.

Everything the schema enforces (types, enums, strict fields, cats-or-label) fails before the validator's own checks even run.
