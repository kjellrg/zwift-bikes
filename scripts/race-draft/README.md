# Race draft calibration

Working data and tools behind [`docs/race-drafting.md`](../../docs/race-drafting.md)
§5 — the field measurement that sets race mode's expected draft saving, which
ships as `RACE_DRAFT_SAVING` in
[`shared/utils/physics/draft.ts`](../../shared/utils/physics/draft.ts).

Nothing here runs in the app or in CI. It is re-run by hand when new race
results are added, and its output goes into the doc.

## Files

| File | What it is |
|---|---|
| `field-results.json` | **Local only — gitignored, never committed.** Anonymised ZwiftPower results for thirteen mass-start races (1313 riders). Category, finishing position, finish time, average and normalised power, weight and height — no names, teams, ages or heart rates. |
| `field-results.sample.json` | A tiny synthetic sample, committed, documenting the exact format the analyzer reads. Invented numbers; no real rider rows. |
| `parse-zwiftpower-paste.mjs` | Turns a raw ZwiftPower results paste into one race block of the dataset, discarding names as it parses and validating what it kept. |
| `parse-zwiftpower-paste.fixture.txt` | Fake paste for the parser's test — the one place fake rider names exist in this repo, and they are obviously fake. |
| `test-parse-zwiftpower-paste.mjs` | Round-trips the fixture through the parser: exact expected JSON, plus an assertion that no name-line word reaches the output. |
| `analyze-field-draft.mjs` | Solves, per rider, the draft saving that makes the simulator reproduce their real finish time, and reports the distribution. This is what sets the constant. |
| `spot-check-shipped-race-mode.mjs` | The other direction: runs the *shipped* `racePowerScaleAtSpeed` over the same riders and reports how far its predicted finish times land from reality. |
| `validate-race-draft.mjs` | Dataset-free checks on the shipped code — the transform's anchor values, the solo-vs-race magnitudes per route archetype, estimate/simulator agreement, and every route in the catalog swept for non-finite speeds. |
| `validate-dataset-routes.mjs` | Shared guard: every race in the dataset must name a route the catalog still resolves. Both the analyzer and the spot-check refuse to run otherwise, because a slug that rots silently shrinks the calibration set while the report still claims the full one. |
| `segment-efforts.json` | **Local only — gitignored, never committed.** The distance-exact validation set: one rider's time and power over a Strava route-lap segment. |
| `segment-efforts.sample.json` | Committed synthetic sample documenting that format. |
| `add-segment-effort.mjs` | Builds a record, either from a Strava activity (reads its segment efforts, keeps the ones that are a route lap) or from numbers reported by hand. |
| `check-segment-efforts.mjs` | Runs the shipped model against each effort over exactly the lap the segment covers. The report to believe when it disagrees with the field results. |
| `render-savings-chart.mjs` | Renders `docs/assets/race-draft-field-savings.svg` from the analyzer's `--json` output. |
| `render-alpe-chart.mjs` | Renders `docs/assets/race-draft-alpe-finishes.svg` (the Road to Sky finishes vs the solo model, docs §5) from the analyzer's `--json --race road-to-sky-2025-03` output. |

## Where the data lives

**The per-rider dataset never enters the repository.** `field-results.json` is in
`.gitignore`; what travels is the aggregate — every table, statistic and chart in
docs §5, all of which are anonymous. The rows themselves stay on the machine that
built them.

That is why `parse-zwiftpower-paste.mjs` exists: it makes the dataset
*rebuildable* from public result lists without anyone having to keep a file of
names around. Names, teams, age groups, heart rates and points are dropped during
parsing and never reach the output, the summary line, or an error message —
errors identify a row by category and position only.

If `field-results.json` is missing, `analyze-field-draft.mjs` and
`spot-check-shipped-race-mode.mjs` say so and point here.
`validate-race-draft.mjs` needs no dataset at all.

## Running it

```sh
# Checks on the shipped code - no dataset needed.
node scripts/race-draft/validate-race-draft.mjs
node scripts/race-draft/test-parse-zwiftpower-paste.mjs

# Calibration and its cross-check - need the local dataset.
node scripts/race-draft/analyze-field-draft.mjs                 # the report in docs §5
node scripts/race-draft/analyze-field-draft.mjs --race la-boucle
node scripts/race-draft/analyze-field-draft.mjs --tarmac        # surface sensitivity
node scripts/race-draft/analyze-field-draft.mjs --dt 0.1        # timestep sensitivity
node scripts/race-draft/spot-check-shipped-race-mode.mjs        # shipped code vs real finish times
node scripts/race-draft/spot-check-shipped-race-mode.mjs --all  # including the excluded races

node scripts/race-draft/analyze-field-draft.mjs --json > /tmp/field.json
node scripts/race-draft/render-savings-chart.mjs /tmp/field.json > docs/assets/race-draft-field-savings.svg
```

The full analyzer run takes about two minutes: every rider is solved by
bisection, and each bisection step is a full route simulation.

## Adding a race

```sh
node scripts/race-draft/parse-zwiftpower-paste.mjs \
  --slug la-boucle --label "La Boucle" \
  --route france-la-boucle --laps 1 --event-km 24.4 \
  --distance-note "matches zwift-data route + lead-in" \
  --append ./scripts/race-draft/field-results.json  < paste.txt
```

Without `--append` the race block prints to stdout. `--append` refuses to
overwrite an existing slug unless you pass `--force`. The parser exits non-zero
if any row's `avgW / weightKg` disagrees with the w/kg the paste publishes (by
more than 0.055, since the source rounds to 0.1), if positions are not
consecutive, or if finish times go backwards within a category — pass
`--allow-mismatch` only when the source genuinely is like that.

**Read the exclusion rules first**, because five kinds of race must not be
pooled into the constant:

- **Event-only routes whose lead-in has not been verified.** `zwift-data`'s
  `leadInDistance` is the event lead-in and is usually right (La Boucle carries
  3.185 km there), but for some event-only routes it is a placeholder: Urumaze
  and Mech Isle Mayhem both record 85 m and both ride roughly 2 km more. That
  missing distance is indistinguishable from a surface penalty in a field
  result, and it cost this project a week — see docs §5, "What sand turned out
  not to be". Verify with a segment effort (`add-segment-effort.mjs`) before
  adding an event-only route, or leave it out.

- **Routes without a measured elevation profile.** `geometryForRouteLaps` falls
  back to a synthesised rolling profile for those, and the implied saving then
  measures the approximation as much as the draft.
- **Loose-surface races cannot calibrate the constant.** They are worth adding
  as evidence, but on dirt the implied saving is dominated by `SURFACE_CRR` and
  by the rider's unpublished wheel Crr class - see docs §4. Keep them out of the
  pooled number.
- **Sustained-climb races cannot separate draft from physics.** On the Alpe the
  whole field beats the solo model by a uniform ~7%, and race mode's own draft
  term accounts for 2.5-5.7% of that; one route cannot tell the two apart - see
  docs §5.
- **Races whose ridden distance is uncertain.** Implied saving goes as `v³`, so
  a 5% distance error is a ~15% power error. If the published event distance
  disagrees with `zwift-data`'s route + lead-in, resolve it before adding the
  race, or leave it out.

Keep names out of the file. The results lists are public, but nothing here needs
a name to work, and the rows are more useful without one.

## Recalibrating the constant

```
paste -> parse-zwiftpower-paste.mjs -> analyze-field-draft.mjs
      -> compare the pooled bunch median to RACE_DRAFT_SAVING
      -> if it moved >= 1 percentage point: change the constant (one line),
         update docs §5 and §10's numbers, re-render the charts
      -> validate-race-draft.mjs && spot-check-shipped-race-mode.mjs
```

**Only move the constant on a ≥1-point shift.** Individual race medians span
27.7–37.2% (docs §5), so a couple of new races legitimately wobble the pooled
number by fractions of a point; chasing that makes it less stable, not more
accurate.

**And recalibrate before changing the formula, not after.** The constant was
bisected per rider under `racePowerScaleAtSpeed`'s exact transform, applied per
timestep against `simulateRoute`. A different speed curve, a different
application point, or an extra term silently invalidates 31% —
`validate-race-draft.mjs` fails loudly on the anchor values for exactly this
reason.
