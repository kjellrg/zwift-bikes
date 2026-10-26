# Supplements: routes, segments and tracks that are ahead of the package

A **supplement** is data that is live in Zwift before the catalog's upstream
package has it, kept in this repo until the package catches up. The catalog's
routes, segments and their tracks come from the `zwift-data` package; a
supplement adds to them so a new route can be ranked the week it opens, with a
normal deploy, rather than the week a release ships it.

Everything here is temporary by design. The package is always the base and
always wins: when it ships the same thing, the supplement entry is deleted.

This page covers routes, segments and their tracks. The older, hand-written
supplements work the same way and are described in their own files:

- frames: [`shared/data/frameSupplement.ts`](../shared/data/frameSupplement.ts)
- wheels: [`shared/data/wheelSupplement.ts`](../shared/data/wheelSupplement.ts)
- extra Host routes for a segment: [`shared/data/segmentHostSupplement.ts`](../shared/data/segmentHostSupplement.ts)
- a Strava segment id found by hand: [`shared/data/segmentStravaIdSupplement.ts`](../shared/data/segmentStravaIdSupplement.ts)

## What is stored

Three generated files, committed, under `shared/data/supplement/`:

| File | Holds |
|---|---|
| `routes.generated.json` | Routes the package lacks, in full, and corrections to routes it has |
| `segments.generated.json` | The same for segments |
| `streams.generated.json` | The recorded tracks (coordinates, distance and altitude) of the routes and segments above |

Each file records `source` (the commit it was extracted from, or `null` when it
is empty) and `zwiftDataVersion` (the installed package version it was built
against). Entries are sorted by identity (routes by `id`, segments and tracks
by slug), so a rerun gives a clean diff.

A **correction** is `{ "id": ..., "override": { ... } }` for a route and
`{ "slug": ..., "override": { ... } }` for a segment. It may only carry:

- routes: `name`, `segments`, `segmentsOnRoute`, `stravaSegmentId`,
  `stravaSegmentUrl`, `leadInDistance`, `leadInElevation`
- segments: `name`, `stravaSegmentId`, `stravaSegmentUrl`

`segments` and `segmentsOnRoute` only ever gain elements. A Host route or a
Placement the package has is never taken away.

## Precedence

The merge lives in [`shared/data/supplementMerge.ts`](../shared/data/supplementMerge.ts)
and is read through [`shared/data/catalogSources.ts`](../shared/data/catalogSources.ts)
(`getRoutes()`, `getSegments()`). With no entries, the result is the package's
own arrays.

| Entry | Who wins | When it is deleted |
|---|---|---|
| A route or segment the package lacks | The package, as soon as it ships the same id (routes) or slug (segments) | When the package ships it |
| An addition whose slug, or name in the same world, belongs to a different package record | The package. The entry is skipped and `validate` reports it | Fixed by hand |
| A correction | The supplement, until the package's value matches it | When the package matches it |
| A track for a record the package has no track for | The supplement | When the package ships its own |
| A track that goes with a correction | The supplement, until the package has the same one | When the package matches it |

Everything that reads routes, segments or tracks goes through the merge. A lint
rule (`no-restricted-imports`) bans importing them from the package anywhere
else, so a caller added later cannot miss the supplement. Frames and wheels
keep their own merge points; a script that compares them with the raw package
on purpose says so in an `eslint-disable` comment.

`streams.generated.json` is large and is read by scripts only
(`scripts/supplement/streams.mjs`). Nothing under `app/`, `server/` or
`shared/` imports it, and a test holds that.

## The flow

1. **Prepare the data in a local clone of the package**, built (`lib/` present).
   This repo only reads the clone: it never builds, edits, commits to or opens
   issues or pull requests on it. Sending the change upstream is done by hand.
2. **Rebase the clone onto the installed version.** The extractor refuses to run
   unless the clone's `package.json` version equals the installed one, so that
   everything that differs is the clone's own work.
3. **Extract:**

   ```sh
   npm run supplement:extract -- --source ../zwift-data
   ```

   It writes the three files. A difference a supplement cannot carry (a field
   outside the allow-list, a removed list element) is printed and left out, and
   the run exits 1 after writing. A route that cannot be ridden by bike
   (running only) is left out too: the catalog drops it anyway.
4. **Generate the derived data for each new route** and commit it with the
   extraction. A route without it is not allowed to ship:

   ```sh
   node scripts/route-surfaces/compute-route-surfaces.mjs --from-streams --only <slug>
   npm run segment-placements:compute
   npm run standings:compute -- --only <slug>,<slug>
   ```

   `--from-streams` reads the route's committed track instead of fetching it
   from Strava; the result is the same, with no token. Route surfaces are
   required (`validate` fails without them); a route missing from the standings
   keeps today's warning. If rankings could move, run the
   `physics-regression-check` agent too: a new route alone does not move any
   other route's ranking, but it does move the standings means.
5. **Validate** with `npm run validate`.
6. **Open the upstream pull request by hand.**
7. **After the package release that ships it** (Renovate bumps the version),
   `npm run validate` fails and names each entry the package now has. Run

   ```sh
   npm run supplement:prune
   ```

   and commit the result. It deletes every addition the package ships, every
   correction it now matches and the tracks that go with them, and needs no
   clone. Rerunning `supplement:extract` drops them as well.

## What `npm run validate` checks

`npm run validate:supplements` (`supplement:extract --check`, part of
`validate`) writes nothing and needs no clone. It fails, naming each entry, on:

- an entry the installed package now ships or matches, or a track it now has
  (run `supplement:prune`)
- an addition that collides with a different package record, a correction of a
  record the package does not have, an identity listed twice, a route naming a
  segment no catalog has, and a track no route or segment owns
- the same thing supplied twice: a Host route in `segmentHostSupplement.ts`, or
  a Strava id in `segmentStravaIdSupplement.ts`, that a generated entry also
  supplies. The generated one is kept, since that is the one going upstream; the
  hand-written one is deleted
- a supplemented route with no entry in `routeSurfaces.generated.json`

The spell dictionary (`scripts/spell/generate-zwift-dict.mjs`) reads the merged
lists, so supplemented names pass the spell check.

## Out of scope

- Frames and wheels from a clone: their hand-written supplements are unchanged.
- Loading supplements at runtime, without a deploy. A deploy also gives a new
  route its prerendered page, OG card, sitemap entry and standings.
- New worlds.
