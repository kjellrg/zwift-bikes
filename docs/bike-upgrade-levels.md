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

ZwiftInsider bot-tests only **Stage 0 and Stage 5** for each individual frame,
but separately publishes the per-stage curve for each of the nine schemes. The
app combines the two:

```
fraction = schemeCurve[level] / schemeCurve[5]
gap(level) = gap0 + fraction × (gap5 − gap0)
```

The scheme curve is used only as a **shape**. Each frame stays pinned to its
own measured endpoints, so **Stage 0 and Stage 5 always reproduce the real
bot-test numbers exactly** — only the path between them comes from the scheme.

This matters because a frame's own total gain can differ from its scheme's
representative frame. The Liv Langma Advanced SL 2021 gains 41.3 s/hr on the
flat where its `duration-high` chart totals 49.3 s/hr; adding chart seconds
directly would overshoot its measured Stage 5 by 8 s/hr, while the ratio lands
on it exactly.

The resulting gap-seconds are then solved into CdA, mass and rolling
resistance — see
[physics-pipeline.md](./physics-pipeline.md#4-where-cda-and-bike-mass-come-from),
including why the stage-3 "drivetrain" upgrade is modelled as a Crr change and
not an efficiency change.

> **Only frames with real bot-test data get this treatment.** For the ~47
> frames ZwiftInsider hasn't tested (most gravel bikes, novelty bikes and a
> few road frames) there are no per-stage numbers to apply, so level has no
> effect and the UI says so rather than showing a control that does nothing.

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
| 1 | 1817.6 s | 1818.3 s | −4.9 s |
| 2 | 1817.1 s | 1817.9 s | −0.5 s |
| 3 | 1810.0 s | 1810.8 s | −7.1 s |
| 4 | 1810.0 s | 1810.8 s | **−0.0 s** |
| 5 | **1795.9 s** | **1796.8 s** | **−14.1 s** |

That last step is **53% of everything the upgrade is worth** on this route
(26.5 s total, 14.1 s of it at stage 5). Stage 4 is worth literally nothing.

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
| Ven-Top | 74.0 | **−7.05 s** (CFR wins) |
| Ven-10 | 78.0 | **−3.37 s** (CFR wins) |
| Road to Sky | 59.7 | **−3.28 s** (CFR wins) |
| La Reine | 53.5 | **−1.22 s** (CFR wins) |
| Mountain Mash | 57.9 | **−0.63 s** (CFR wins) |
| Valley to Mountaintop | 26.2 | +1.35 s |
| Zwift Gran Fondo | 12.2 | +56.4 s |
| London PRL FULL | 15.1 | +95.2 s |

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
2024** are all `Distance, High-End`. Because they share a scheme, they share a
curve — so their **order never changes with level**.

The Tron has integrated wheels that can't be swapped, and its bot test covers
the whole frame+wheel unit. The other two get the wheels a rider would
actually fit: an aero disc set on the flat, a lightweight set in the hills.
Give them anything less and the comparison flatters the Tron, because it always
has its own wheels while its rivals are stuck with whatever you picked.

Tempus Fugit (1.5 m/km) — road frames on DTSwiss ARC 1100 DICUT 85/Disc:

| Level | Concept Z1 | Tarmac SL9 | Aeroad 2024 |
|---|---|---|---|
| 0 | 1894.1 s | 1893.9 s | 1894.0 s |
| 3 | 1879.7 s | 1879.6 s | 1879.7 s |
| 5 | 1877.6 s | **1877.5 s** | 1877.6 s |

Achterbahn (20.9 m/km, hilly) — road frames on Princeton Wake 6560 Lava:

| Level | Concept Z1 | Tarmac SL9 | Aeroad 2024 |
|---|---|---|---|
| 0 | 5976.7 s | 5959.8 s | 5968.0 s |
| 3 | 5925.7 s | 5909.4 s | 5917.4 s |
| 5 | 5916.4 s | **5900.1 s** | 5908.0 s |

Road to Sky (59.7 m/km, mountainous) — same climbing wheels:

| Level | Concept Z1 | Tarmac SL9 | Aeroad 2024 |
|---|---|---|---|
| 0 | 3915.0 s | 3876.4 s | 3890.3 s |
| 3 | 3881.8 s | 3843.2 s | 3856.7 s |
| 5 | 3872.7 s | **3834.1 s** | 3847.4 s |

Once every bike has appropriate wheels the picture is what you'd expect: the
Tron is level with the best road frames on the flat and clearly behind them as
soon as the road goes up — 16 s on Achterbahn, 39 s on Road to Sky. Its
integrated wheels are fast but heavy, and it can't swap to climbing wheels the
way a Tarmac or Aeroad can.

What doesn't change is the *order between levels*: at every level on every
route these three sit in the same sequence. **Level is not a tiebreaker between
bikes on the same scheme** — it moves them together. What changes with terrain
is which bike wins, not which level does.

Note the road curve is also far kinder than the TT one: `distance-high` reaches
87% of its flat benefit by stage 3, where `duration-high` is at 46%. A
half-upgraded road bike is much closer to its potential than a half-upgraded TT
bike.

### Where level *does* reshuffle: different schemes

**Tarmac SL9** (`distance-high`) vs **Cannondale CAAD12** (`distance-entry`) on
Achterbahn, both on Princeton Wake 6560 Lava:

| Level | Tarmac SL9 | CAAD12 | Gap |
|---|---|---|---|
| 0 | 5959.8 s | 6058.2 s | 98.4 s |
| 2 | 5934.5 s | 6017.3 s | 82.8 s |
| 3 | 5909.4 s | **6000.4 s** | 91.0 s |
| 4 | 5904.6 s | **6000.4 s** | 95.8 s |
| 5 | 5900.1 s | **6000.4 s** | 100.3 s |

The CAAD12 is **done at stage 3** and flat thereafter, so the gap narrows to
82.8 s at level 2 and then widens back out as the SL9 keeps unlocking. That
narrowing-then-widening is invisible if you assume every bike gains evenly, and
it's the reason mid-level comparisons need the real curves.

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
- All frames in a scheme are assumed to share one curve. That's ZwiftInsider's
  own assumption ("essentially the same for bikes within a scheme"), and it's
  the largest remaining uncertainty in this model. Only per-frame bot tests at
  stages 1–4 would remove it.
