# Bike upgrade levels: how they're calculated, and when they matter

Zwift unlocks a frame's performance over five upgrade stages as you ride it.
This app models where a rider actually is on that ladder rather than assuming
every bike is maxed out — which turns out to matter a lot more than it sounds,
because the progression is neither even nor the same for every bike.

For the plain-language overview see [physics-model.md](./physics-model.md); for
where this sits in the code see [physics-pipeline.md](./physics-pipeline.md).

## What Zwift actually does

Every frame is assigned one of **nine upgrade schemes**: a progression axis
crossed with a price tier.

| Axis | What you do to earn a stage | Which bikes |
|---|---|---|
| **Distance** | ride X km | almost all road and gravel frames |
| **Duration** | ride X hours | TT frames |
| **Elevation** | climb X metres | mountain bikes and climbing-specific road frames |

| Tier | Work for stage 1 (distance) |
|---|---|
| Entry-Level | 100 km |
| Mid-Range | 160 km |
| High-End | 200 km |
| Halo | 550 km |

Halo frames share High-End's *performance* curve — only their cost and unlock
distance differ — so the app models nine curves, not twelve.

Each stage upgrades **one specific thing**, and which thing depends on the tier:

| Tier | Stage 1 | Stage 2 | Stage 3 | Stage 4 | Stage 5 |
|---|---|---|---|---|---|
| Entry-Level | Aero | Weight | Drivetrain | *5% Drops* | *5% XP* |
| Mid-Range | Aero | Weight | Drivetrain | Aero¹ | *5% Drops* |
| High-End / Halo | Aero | Weight | Drivetrain | Aero¹ | Weight¹ |

¹ Duration-based frames swap these: stage 4 is Weight and stage 5 is Aero.

Two consequences fall straight out of that table:

- **Entry-level frames are fully upgraded at stage 3.** Stages 4 and 5 pay
  Drops and XP only. There is no performance left to unlock.
- **A stage only helps where its upgrade type helps.** A stage-1 aero upgrade
  does almost nothing on a climb; a stage-2 weight upgrade does almost nothing
  on the flat.

## How the app calculates a level

ZwiftInsider's sheet now bot-tests **all six stages** of every established
frame, and those measured curves are imported wholesale
(`flatGapSecByStage`/`climbGapSecByStage` in `frameSpeedData.ts`, via
[`import-stage-curves.mjs`](../scripts/upgrade-levels/import-stage-curves.mjs)).
For those frames — the entire current roster — a level isn't interpolated at
all: the app reads the frame's own measured gap at that exact stage.

Frames the sheet hasn't stage-tested yet (typically recent releases) carry
only the Stage 0/5 endpoints, and fall back to the per-scheme shape
ZwiftInsider publishes for each of the nine schemes:

```
fraction = schemeCurve[level] / schemeCurve[5]
gap(level) = gap0 + fraction × (gap5 − gap0)
```

The scheme curve is used only as a **shape**. Each frame stays pinned to its
own measured endpoints, so **Stage 0 and Stage 5 always reproduce the real
bot-test numbers exactly** in both tiers — only the path between them can come
from the scheme, and `validate-speed-data.mjs` fails the build if a measured
curve ever disagrees with its own endpoints.

The shape-not-seconds rule matters because a frame's own total gain can differ
from its scheme's representative frame. The Liv Langma Advanced SL 2021 gains
41.3 s/hr on the flat where its `duration-high` chart totals 49.3 s/hr; adding
chart seconds directly would overshoot its measured Stage 5 by 8 s/hr, while
the ratio lands on it exactly.

The resulting gap-seconds are then solved into CdA, mass and rolling
resistance — see
[physics-pipeline.md](./physics-pipeline.md#4-where-cda-and-bike-mass-come-from),
including why the stage-3 "drivetrain" upgrade is modelled as a Crr change and
not an efficiency change.

The bike drawer (open any result card) shows the whole six-stage curve for a
measured frame as two small stage-by-stage charts, flat and climb, marked at the stage the bike
is scored at - the same numbers `classifyBikeFrame` reads, carried on the
frame as `upgradeCurve`.

> **Only frames with real bot-test data get this treatment.** For the ~47
> frames ZwiftInsider hasn't tested (most gravel bikes, novelty bikes and a
> few road frames) there are no per-stage numbers to apply, so level has no
> effect and the UI says so rather than showing a control that does nothing.

## Where the numbers come from: two ZwiftInsider sources

The upgrade charts did not replace the pacing-bot speed tests. Both are used,
for different jobs, and the bot tests remain the authority.

| Source | What it provides | Granularity | Role |
|---|---|---|---|
| [Pacing bot speed tests](https://zwiftinsider.com/charts-frames/) → `frameSpeedData.ts` | **All six stages** (endpoints kept as separate authoritative anchors) | **per frame** | The answer at every level, for every stage-tested frame. |
| [Upgrade charts](https://zwiftinsider.com/upgrade-charts/) → `frameUpgradeSchemes.ts` | All 5 stages | **per scheme** (9 curves) | **Fallback shape** between the anchors, for frames the sheet hasn't stage-tested yet. |

For a stage-tested frame the bot test decides every level outright. For a
fallback frame it depends on the level:

| Level | Bot test | Chart |
|---|---|---|
| 0 | **is** the answer (fraction 0) | contributes nothing |
| 1–4 | sets the range | picks the position within it |
| 5 | **is** the answer (fraction 1) | contributes nothing |

That property is worth knowing when reviewing a change here: any edit that only
touches intermediate stages **must** leave levels 0 and 5 bit-identical. It's
the cheapest available regression check, and
[`compare-deployments.mjs`](../scripts/upgrade-levels/compare-deployments.mjs)
exists partly to run it.

### Do the two sources agree?

Each scheme's chart total should equal the measured Stage 0 → 5 gain of the
frames using it. Signed difference (chart minus bot test; positive means the
chart claims more gain than the bot found):

| Scheme | Frames | Flat bias | Climb bias |
|---|---|---|---|
| distance-entry | 12 | +0.50 | −0.10 |
| distance-mid | 34 | +0.60 | +0.40 |
| distance-high | 44 | −0.30 | +0.70 |
| duration-entry | 1 | +2.30 | +0.20 |
| duration-mid | 5 | +2.10 | −0.90 |
| duration-high | 18 | +2.20 | −0.50 |
| elevation-entry | 1 | +0.30 | −0.30 |
| elevation-mid | 2 | +2.40 | +0.60 |
| elevation-high | 2 | +0.50 | +0.90 |
| **all 119** | | **median +0.50** | **median +0.20** |

Comfortably inside ZwiftInsider's own stated tolerance ("accurate within 1-2
seconds"). There is a mild systematic bias — the charts read ~2.1–2.4 s/hr high
on the flat for three schemes, plausibly because each chart comes from a single
representative frame rather than a scheme average — but it cancels out, because
a constant offset present in both `curve[level]` and `curve[5]` disappears in
the division.

This comparison is also what proves the two sources share a **unit basis**.
Both are "seconds saved across 1 hour at 300 W" on the same two courses. If one
were per-course instead, the Alpe (~50 min) and Tempus Fugit (~27 min) would
produce 20–120% offsets, not sub-1 s/hr noise.

**When they conflict, the per-frame measurement wins.** The Liv Langma example
above is the extreme case: its own 41.3 s/hr is used, not its scheme's 49.3.

The starkest conflict found this way was a defect, not a disagreement: the
published `distance-entry` chart claims flat stage 2 delivers 23.1 s of the
27.8 s total (83%), while all 12 frames in the cohort measure ~59% — and 23.1
happens to be the CAAD12's *absolute* stage-2 gap on the sheet, i.e. the chart
graphic most likely copied the wrong cell. The code carries the cohort-implied
16.4 instead (issue #88; see `PUBLISHED_CHART_CORRECTIONS` in
[`verify-upgrade-data.mjs`](../scripts/upgrade-levels/verify-upgrade-data.mjs)).
Before the per-frame curves landed, that one number overestimated every
stage-2 entry-level frame by ~6.5 s/hr.

### An internal consistency check that catches typos

Stage 1 is an aero upgrade in all nine schemes, so seconds-saved per
watt-saved should be roughly constant across them. It is:

| Scheme | Stage-1 flat | Watts | s/W |
|---|---|---|---|
| distance-entry | 14.8 s | 3.3 W | 4.48 |
| distance-mid | 11.5 s | 2.6 W | 4.42 |
| distance-high | 11.6 s | 2.6 W | 4.46 |
| duration-entry | 34.0 s | 7.7 W | 4.42 |
| duration-mid | 8.7 s | 2.0 W | 4.35 |
| duration-high | 9.1 s | 2.1 W | 4.33 |
| elevation-entry | 7.4 s | 1.7 W | 4.35 |
| elevation-mid | 4.9 s | 1.1 W | 4.45 |
| elevation-high | 5.8 s | 1.3 W | 4.46 |

A 1.03x spread across nine independently-read chart pairs. This is a genuinely
useful guard: transcribing `elevation-high` stage 1 as 5.2 instead of 5.8 (an
easy misread, and a mistake that was actually made once) drops its ratio to
4.00 and widens the spread to 1.12x.
[`verify-upgrade-data.mjs`](../scripts/upgrade-levels/verify-upgrade-data.mjs)
fails the build on anything past 1.10x.

### Counterintuitive but correct: less power saved on the climbs

ZwiftInsider's power charts show something that looks backwards. For a
`distance-entry` frame at stage 3, the upgrade saves **36.2 s/hr on the climb
but only 27.8 s/hr on the flat** — yet the power saving is **3.3 W on the climb
versus 6.3 W on the flat**. More time saved, less power saved.

That's real, and it's their explanation: *"Power changes have a larger impact
on speed when climbing than on flats."* On a climb you're fighting gravity, so
speed is roughly linear in power and a small wattage saving buys a lot of time.
On the flat you're fighting air, where speed scales with roughly the cube root
of power, so it takes far more watts to buy the same time.

This is also exactly the reasoning that identified the stage-3 "drivetrain"
upgrade as a rolling-resistance change rather than an efficiency one — see
[physics-pipeline.md](./physics-pipeline.md#upgrade-stages-feed-the-solve).

### How the roster is distributed

Not every scheme matters equally. Of the 119 frames with measured data:

| Scheme | Frames | Share |
|---|---|---|
| distance-high | 44 | 37% |
| distance-mid | 34 | 29% |
| duration-high | 18 | 15% |
| distance-entry | 12 | 10% |
| duration-mid | 5 | 4% |
| elevation-mid / elevation-high | 2 each | 2% each |
| elevation-entry / duration-entry | 1 each | 1% each |

Three-quarters of the roster is distance-based, which is why the
`distance-high` and `distance-mid` curves do most of the work. The
`elevation-*` and `duration-entry` schemes are represented by one or two frames
each, so their curves rest on the thinnest evidence — worth remembering before
trusting a mid-level number for, say, the Zwift TT or Trek Emonda SL to the
nearest second.

## Worked example: TT frames

**Canyon Speedmax CFR** and **Cadex Tri** are both `Duration, High-End`, so
they share a curve. Their measured endpoints are close, with the CFR slightly
ahead on both axes:

| Frame | Flat L0 → L5 | Climb L0 → L5 |
|---|---|---|
| Canyon Speedmax CFR | 47.1 → 95.0 s/hr | 31.6 → 58.9 s/hr |
| Cadex Tri | 45.9 → 93.4 s/hr | 24.4 → 51.2 s/hr |

Their scheme's curve is where it gets interesting:

| Stage | Flat (s/hr) | % of flat total | Climb (s/hr) | % of climb total |
|---|---|---|---|---|
| 1 | 9.1 | 18% | 1.1 | 4% |
| 2 | 10.0 | 20% | 8.2 | 31% |
| 3 | 22.8 | 46% | 19.4 | 74% |
| 4 | 22.8 | **46%** | 23.5 | 89% |
| 5 | 49.3 | **100%** | 26.3 | 100% |

**Stage 4 delivers zero flat gain** (it's a weight upgrade) and **stage 5
delivers 54% of the entire flat aero benefit in one step.** ZwiftInsider put it
plainly: *"the big stage is the final one with its major aero upgrade, which
should save you around 6W on flat races. That's no joke in a time trial."*

On Tempus Fugit (17.2 km, 1.5 m/km), 75 kg at 3.5 W/kg, both on DTSwiss ARC
1100 DICUT 85/Disc:

| Level | Speedmax CFR | Cadex Tri | Gain from previous |
|---|---|---|---|
| 0 | 1822.5 s | 1823.1 s | — |
| 1 | 1817.8 s | 1818.3 s | −4.7 s |
| 2 | 1817.7 s | 1817.9 s | −0.1 s |
| 3 | 1810.4 s | 1810.8 s | −7.3 s |
| 4 | 1810.5 s | 1810.7 s | **+0.1 s** |
| 5 | **1795.9 s** | **1796.8 s** | **−14.6 s** |

That last step is **55% of everything the upgrade is worth** on this route
(26.5 s total, 14.6 s of it at stage 5). Stage 4 is worth literally nothing on
the flat — the CFR's own bot test even measures it a fraction *slower* (its
measured flat gap dips from 68.5 to 68.3 s/hr), which the per-frame stage
curves now reproduce instead of smoothing away.

## Why stage 5 is usually a dealbreaker — and when it isn't

The whole effect is aero, so it scales with how much of your race is spent
going fast on the flat. Compare the same bike on two routes:

| Route | m/km | Total upgrade worth | Of which at stage 5 |
|---|---|---|---|
| Tempus Fugit | 1.5 | 26.5 s | 14.1 s (**53%**) |
| Road to Sky | 59.7 | 37.0 s | 5.3 s (**14%**) |

On a flat TT course, a stage-4 Speedmax CFR is barely more than half-upgraded.
On the Alpe it's already 86% of the way there, because most of its remaining
value is weight, which it collected at stages 2 and 4.

### Can a stage-4 CFR beat a stage-5 Cadex Tri?

Yes — but only on genuinely mountainous routes. At stage 4 the CFR gives up
24 s/hr of flat aero to a maxed Cadex, but keeps a 4.8 s/hr climb advantage
(it's the better climber of the two to begin with). The climb advantage only
outweighs the aero deficit when the route is steep enough:

| Route | m/km | CFR @L4 vs Cadex @L5 |
|---|---|---|
| Ven-Top | 74.0 | **−6.71 s** (CFR wins) |
| Ven-10 | 78.0 | **−3.18 s** (CFR wins) |
| Road to Sky | 59.7 | **−2.99 s** (CFR wins) |
| La Reine | 53.5 | **−0.81 s** (CFR wins) |
| Epic Run | 42.2 | **−0.61 s** (CFR wins) |
| Mountain Mash | 57.9 | **−0.52 s** (CFR wins) |
| Valley to Mountaintop | 26.2 | +1.46 s |
| Zwift Gran Fondo | 12.2 | +58.9 s |
| London PRL FULL | 15.1 | +99.6 s |

**7 routes out of 298** — every one above 42 m/km. Below roughly 40 m/km the
maxed Cadex wins, and on long flat-ish routes it isn't close: over a minute and
a half on London PRL FULL.

So: if you ride flat or rolling routes, finishing that last CFR stage is worth
more than switching to any other TT frame you already own. If you exclusively
ride Alpe-grade climbs, it barely registers — and your stage-4 CFR is already
the faster bike.

Reproduce any of this with:

```sh
node scripts/upgrade-levels/compare-bike-levels.mjs \
  --crossover="Canyon Speedmax CFR@4,Cadex Tri@5"
```

## Worked example: road frames

**Zwift Concept Z1 (Tron)**, **Specialized Tarmac SL9** and **Canyon Aeroad
2024** are all `Distance, High-End`, and their measured stage curves are
near-identical in shape — so level moves them almost in lockstep, and any
mid-level reshuffling between them stays inside a few tenths of a second.

The Tron has integrated wheels that can't be swapped, and its bot test covers
the whole frame+wheel unit. The other two get the wheels a rider would
actually fit: an aero disc set on the flat, a lightweight set in the hills.
Give them anything less and the comparison flatters the Tron, because it always
has its own wheels while its rivals are stuck with whatever you picked.

Tempus Fugit (1.5 m/km) — road frames on DTSwiss ARC 1100 DICUT 85/Disc:

| Level | Concept Z1 | Tarmac SL9 | Aeroad 2024 |
|---|---|---|---|
| 0 | 1894.1 s | 1893.9 s | 1894.0 s |
| 3 | 1879.8 s | 1880.1 s | 1879.7 s |
| 5 | 1877.6 s | **1877.5 s** | 1877.6 s |

Achterbahn (20.9 m/km, hilly) — road frames on Princeton Wake 6560 Lava:

| Level | Concept Z1 | Tarmac SL9 | Aeroad 2024 |
|---|---|---|---|
| 0 | 5976.7 s | 5959.6 s | 5967.8 s |
| 3 | 5924.9 s | 5909.8 s | 5917.5 s |
| 5 | 5916.4 s | **5899.9 s** | 5907.8 s |

Road to Sky (59.7 m/km, mountainous) — same climbing wheels:

| Level | Concept Z1 | Tarmac SL9 | Aeroad 2024 |
|---|---|---|---|
| 0 | 3915.0 s | 3876.0 s | 3889.9 s |
| 3 | 3880.3 s | 3842.4 s | 3856.7 s |
| 5 | 3872.7 s | **3833.7 s** | 3847.1 s |

Once every bike has appropriate wheels the picture is what you'd expect: the
Tron is level with the best road frames on the flat and clearly behind them as
soon as the road goes up — 16 s on Achterbahn, 39 s on Road to Sky. Its
integrated wheels are fast but heavy, and it can't swap to climbing wheels the
way a Tarmac or Aeroad can.

Level still isn't much of a tiebreaker between these three: their measured
curves are so alike that upgrading moves them nearly together, and the
mid-level lead changes hands only by tenths of a second (on Tempus Fugit the
Aeroad actually noses ahead at levels 1–3 before the Tarmac retakes it at 5 —
real, measured, and far below the model's meaningful resolution). What changes
with terrain is which bike wins, not which level does.

Note the road curve is also far kinder than the TT one: `distance-high` reaches
87% of its flat benefit by stage 3, where `duration-high` is at 46%. A
half-upgraded road bike is much closer to its potential than a half-upgraded TT
bike.

### Where level *does* reshuffle: different schemes

**Tarmac SL9** (`distance-high`) vs **Cannondale CAAD12** (`distance-entry`) on
Achterbahn, both on Princeton Wake 6560 Lava:

| Level | Tarmac SL9 | CAAD12 | Gap |
|---|---|---|---|
| 0 | 5959.6 s | 6058.0 s | 98.4 s |
| 2 | 5935.3 s | 6024.3 s | 89.0 s |
| 3 | 5909.8 s | **5999.6 s** | 89.8 s |
| 4 | 5904.8 s | **5999.5 s** | 94.7 s |
| 5 | 5899.9 s | **6000.1 s** | 100.2 s |

The CAAD12 is **done at stage 3** and flat thereafter (its own bot test even
gives a fraction back at stage 5), so the gap narrows to 89 s and then widens
back out as the SL9 keeps unlocking. That narrowing-then-widening is invisible
if you assume every bike gains evenly, and it's the reason mid-level
comparisons need the real curves. An earlier revision of this table showed the
gap dipping all the way to 82.8 s at level 2 — that extra dip was the
published chart's stage-2 transcription defect (see above), not the bike.

## Practical guidance

- **Set your real levels in the garage.** An un-upgraded bike can be 30–60 s/hr
  off its maxed self; comparing your stage-2 frame against everyone else's
  stage-5 numbers is the single biggest source of "the app says X but I ride Y".
- **Unowned bikes default to level 5** on the Profile page. That's an
  aspirational comparison — useful for shopping, misleading for racing. Drop it
  to 0 if you want to see what you'd actually get on day one.
- **The last stage is worth the most on TT frames**, and disproportionately so
  on flat courses. Finish it before buying another TT bike.
- **On road frames, stage 3 is the value inflection.** Distance-based frames
  have 76–87% of their benefit by then.
- **Entry-level frames stop improving at stage 3.** Don't wait for stages 4 and
  5 to make you faster; they pay Drops and XP.

## Caveats

- Times here come from `estimateFinishTimeSec` at 75 kg / 180 cm / 3.5 W/kg,
  with each frame on terrain-appropriate wheels (DTSwiss ARC 1100 DICUT 85/Disc
  on flat and rolling routes, Princeton Wake 6560 Lava on hilly and
  mountainous ones — which is also what picking the outright fastest wheelset
  per frame and route produces). Fixed-wheel frames use their own integrated
  wheels. Ranked pages re-simulate the top of the list properly, so exact
  seconds will differ slightly — the *shape* is what matters.
- ZwiftInsider notes the per-scheme charts are representative and accurate
  "within 1-2 seconds" for any individual frame, so a single stage's absolute
  value can be a second or two out. The structure — which stage delivers what —
  is not noise.
- An earlier revision listed the shared-curve-per-scheme assumption as the
  largest remaining uncertainty here. That's resolved: the whole current
  roster now carries its own per-frame bot-tested stage curve, and the shared
  scheme shapes only ever apply to frames added before the sheet stage-tests
  them. For those fallback frames the old caveat still holds, hardest on the
  thinly-populated schemes — see
  [how the roster is distributed](#how-the-roster-is-distributed).
