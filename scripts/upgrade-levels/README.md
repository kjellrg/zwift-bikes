# Bike upgrade level diagnostics

Throwaway-style comparison and verification tools for the frame upgrade
level model. **Nothing in `app/`, `server/`, or the Nuxt build runs these** -
they exist to check data and to compare behaviour before/after a change.

See [docs/bike-upgrade-levels.md](../../docs/bike-upgrade-levels.md) for what
the model actually does, and
[shared/data/frameUpgradeSchemes.ts](../../shared/data/frameUpgradeSchemes.ts)
for the data itself.

## `verify-upgrade-data.mjs`

```sh
node scripts/upgrade-levels/verify-upgrade-data.mjs
```

Run this after touching `frameUpgradeSchemes.ts` or `frameSpeedData.ts`. Exits
non-zero on failure. Four checks:

1. **Every `STAGE_CHARTS` value matches ZwiftInsider's published tables.** The
   reference copy is inline in the script - re-fetch
   <https://zwiftinsider.com/upgrade-charts/> and update both together if the
   source ever changes.
2. **Scheme coverage.** Every measured frame has a scheme, and every scheme key
   matches a real `zwift-data` frame name. A key with the wrong spelling is
   dead data: the lookup silently misses and the frame quietly falls back to
   linear interpolation with no error.
3. **Unit basis.** Both sources are "seconds saved across 1 hour at 300 W", so
   each scheme's chart total must match the measured Stage 0→5 gain of the
   frames using it. A mismatched basis (per-course instead of per-hour) would
   show up here as a large systematic offset rather than the ~0.6 s/hr noise
   that's actually there.
4. **Stage-1 consistency.** Stage 1 is an aero upgrade in all nine schemes, so
   seconds-saved-per-watt-saved should be nearly constant. It sits at ~4.4 with
   a 1.03x spread. This is what catches a single mistranscribed digit - the
   `elevation-high` 5.8-vs-5.2 mix-up pushes the spread to 1.12x.

## `compare-bike-levels.mjs`

```sh
# one or more routes, every level, for a few bikes
node scripts/upgrade-levels/compare-bike-levels.mjs \
  --route=road-to-sky --bikes="Canyon Speedmax CFR,Cadex Tri"

# every route where one bike at one level beats another bike at another
node scripts/upgrade-levels/compare-bike-levels.mjs \
  --crossover="Canyon Speedmax CFR@4,Cadex Tri@5"
```

Options: `--weight` `--height` `--wkg` `--top` `--wheels`.

### Wheels matter as much as the frame

By default each frame gets the wheels a rider would actually fit for that
route:

| Terrain | Wheelset |
|---|---|
| flat, rolling | DTSwiss ARC 1100 DICUT 85/Disc |
| hilly, mountainous | Princeton Wake 6560 Lava |

This is not cosmetic. Giving every frame one fixed wheelset skews the result
towards whichever frame that wheelset happens to suit, and it especially
flatters **fixed-wheel frames** — the Tron, Espada and PROJECT 74 are measured
as a frame+wheel unit, so they always have their own wheels while every
swappable frame is stuck with your choice. Comparing a Tron against a Tarmac
SL9 on mid-tier climbing wheels makes the Tron look like the better climber; on
proper climbing wheels the Tarmac beats it by 16 s on Achterbahn and 39 s on
Road to Sky.

`--wheels=auto` instead gives every frame its outright fastest measured road
wheelset for that route, which is the closest match to what the app's ranked
pages show. On the routes checked so far it agrees with the terrain default —
it picks Princeton Wake 6560 *White*, the same wheelset as *Lava* in a
different colourway, for identical times. `--wheels="<exact name>"` forces one.

Bike names must be the exact `zwift-data` spelling; the script fails loudly
rather than silently falling back if a name has no measured data.

## `compare-deployments.mjs`

```sh
node scripts/upgrade-levels/compare-deployments.mjs \
  --old=https://zwiftbikes.photic.net \
  --new=https://<pr-preview>.azurestaticapps.net \
  --level=3
```

Diffs the public recommend API of two running deployments across a spread of
terrain types. Options: `--routes` `--weight` `--height` `--wkg` `--quiet`.

Run it at **level 0 and level 5 as well as the levels you expect to move**.
Those two are the bot-tested anchors, so any change that only affects
intermediate stages must leave them identical - that is the regression check.
When this PR was validated, level 0 came back `0/72 rows changed, +0.0s` while
level 3 moved 28/49 rows by up to 12.5 s.

Rows are keyed on frame **and** wheelset: the same frame legitimately appears
several times with different wheels, so keying on frame alone compares
unrelated rows and invents rank changes that aren't real.
