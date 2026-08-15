# TTT drafting: what it models, what it's built on, and how far to trust it

Reference for the Team Time Trial draft mode (issue #33). All of it lives in
[`shared/utils/physics/draft.ts`](../shared/utils/physics/draft.ts); this
document is the reasoning and the evidence behind those constants.

## 1. What the rider is being asked for

**Your W/kg means your own average over a full rotation** — the same thing it
means in solo mode: what you can actually sustain for the effort. It is not
your pull power and not the front rider's power.

From that one number everything else is derived. In a rotation you push well
above your average while pulling and sit well below it in the wheels, and the
group travels at the speed that combined effort produces. For a 75 kg rider
entering 3.2 W/kg (240 W) in an 8-rider team:

| | Power |
|---|---|
| Entered (your rotation average) | 240 W |
| What you hold while pulling on the front | ~331 W |
| What you sit at in the last wheel | ~219 W |
| Speed the group holds | that of a solo rider at ~331 W |

## 2. Why not "the front rider's watts"

The first implementation took the entered watts to be the front rider's power.
That is defensible physics — Zwift gives the front of a paceline no draft
whatsoever — but it is useless as a tool: if your number *is* the front
rider's power, the group by definition travels at exactly your solo speed, and
TTT mode produces identical times to solo mode. It was rejected for that
reason.

The current framing also matches how every real Zwift TTT calculator works.
[ZwiftInsider's own calculator](https://zwiftinsider.com/zwift-ttt-calculator/),
Target Watts and the community tools all take each rider's FTP or sustainable
effort as input and *derive* the per-position pull targets — never the reverse.

## 3. The data it's built on

### Per-position power savings

From ZwiftInsider's 4-bot single-file TTT test on TT bikes under **Pack
Dynamics 4.1**, the current pack model:
<https://zwiftinsider.com/tt-drafting-pd41/>

| Position | Power at 300 W on the front | Saving vs front |
|---|---|---|
| 1 (front) | 300 W | — |
| 2 | 234 W | 22% |
| 3 | 214 W | 28.7% |
| 4 | 198 W | 34% |

PD4.1 deliberately trimmed the draft back from PD4 (24 / 30 / 35%) while
remaining far stronger than PD3. An earlier draft of this feature used the PD4
numbers; they were replaced once the newer test was found. The PD3-era article
is explicitly marked outdated by ZwiftInsider itself and is not used.

**Cross-check.** ZwiftInsider states that with all four riders taking equal
pulls at those wattages, "each rider would average 237 W". Our rotation
average for four riders is 0.78825, and 0.78825 × 300 = 236.5 W. That
agreement is the check that the position numbers were read correctly rather
than paraphrased from a summary.

### Speed dependence

Drafting is an aerodynamic effect, so the saving collapses at climbing speeds
and grows on descents. ZwiftInsider measured single-rider draft savings of
~25% on the flat (~42 km/h), ~10–11% on a moderate climb (~27 km/h), 2–3% on a
steep climb (~18 km/h) and up to ~46% on a fast descent:
<https://zwiftinsider.com/draft-savings/>

Normalised against the flat value, those become a scaling factor on the
position savings, fitted as `(v / 11.7)²` clamped to `[0, 1.4]`:

| Speed | Fit | Anchor |
|---|---|---|
| 42 km/h | 0.99 | 1.00 |
| 27 km/h | 0.41 | ~0.43 |
| 18 km/h | 0.18 | ~0.10 |
| 55 km/h | 1.40 (capped) | up to ~1.8 measured |

The descent cap is deliberately conservative: the ~46% figure came from a
supertuck-speed descent, and extrapolating it fully would overstate ordinary
fast descents.

## 4. How the numbers are produced

**Rotation average.** Each rider spends 1/N of the time in each position, so
the group's average power as a fraction of the front rider's is the mean of the
per-position requirements. Team size keeps mattering past the 4th wheel even
though the per-position saving plateaus there, because a bigger team means a
smaller *share* of time on the front — which is where the entire cost sits:

| Riders | Rotation average | Group speed vs riding alone |
|---|---|---|
| 2 | 0.890 | ×1.12 |
| 3 | 0.831 | ×1.20 |
| 4 | 0.788 | ×1.27 |
| 6 | 0.746 | ×1.34 |
| 8 | 0.724 | ×1.38 |

**In the simulator.** `tttPowerScaleAtSpeed` = `1 / averageFactor(speed)` is
applied as a multiplier on the rider's power at both midpoint-integration
velocities of every timestep. Because it reads the *current* speed, the benefit
fades on a climb and grows on a descent by itself, with no per-grade
bookkeeping. It is a feedback loop (more power → more speed → more draft) but a
stable one: the scale saturates while aerodynamic drag keeps growing with v³.

**In the cheap estimate.** `estimateFinishTimeSec` is the ranking key over the
full ~11k-combo pool and has to agree with the simulator or the displayed order
drifts. Since draft depends on speed and speed depends on draft, it solves a
4-iteration fixed point (`tttGroupSpeedMps`) instead of a single bisection.

**Climb pacing.** The optional team climb W/kg applies to climbs of ≥3% average
grade lasting ≥3.5 estimated minutes, where a real paceline breaks up. Blocks
are detected on the route's own geometry, merged across sub-200 m gaps, and
ridden at that power via the simulator's `powerSegmentsW`. The plan is built
**once per request** and shared across every combo — a per-combo plan would
poison `orderBySimulatedTime`'s physics-keyed dedupe cache.

## 5. Why it can be trusted

Each of these was measured, not assumed:

- **Self-consistency.** On a flat route an 8-rider TTT finishes in 1670 s;
  a solo rider at the derived pull power of 331 W finishes in 1671 s — 0.1%
  apart. The model reproduces its own premise.
- **Source agreement.** The rotation average reproduces ZwiftInsider's
  published equal-pulls figure to within 0.5 W (§3).
- **Sane magnitudes**, for a 75 kg rider at 240 W:

  | Route | Solo | 8-rider TTT | Gain |
  |---|---|---|---|
  | Tempus Fugit (flat) | 31.3 min | 27.8 min | 11.2% |
  | Greatest London Loop (rolling) | 50.1 min | 45.9 min | 8.4% |
  | Road to Sky (climb) | 77.3 min | 75.1 min | 2.8% |

  The climb route collapsing to 2.8% is the speed-dependence doing its job —
  drafting is worth almost nothing at 8.4% grade.
- **Monotonic in team size**, 2 → 8 riders, on every route tested.
- **Zero regression in solo mode.** `simulateRoute` and `estimateFinishTimeSec`
  were captured for 3 combos × 5 route archetypes before any of this work and
  re-checked after: **bit-identical**. Solo requests also omit the TTT query
  parameters entirely, so SSR and prerendered payloads are unchanged.
- **No ranking drift.** With TTT active (and with a climb pace set), the
  simulator's true first page never sat deeper than rank 8 in the estimate's
  ordering, against a re-ordering margin of 54 — checked on flat, rolling and
  climb routes.
- **No route-specific blowups.** The speed/surface chart was run solo vs TTT on
  all 335 routes: no exceptions, no route where one mode produced data and the
  other didn't, no non-finite samples.
- **Panel agreement.** The race plan's surface cost is computed the same way
  the speed/surface chart computes its own, and the two agree on shared
  stretches (Road to Sky's dirt sector: +139 W in both).

## 6. What it does *not* model

Stated plainly, because these are the limits of the claim:

- **Positions 5–8 are an assumption, not data.** ZwiftInsider tests four bots;
  deeper positions are assumed to plateau at the 4th wheel's 34%. If the real
  curve keeps improving, large teams are slightly understated here.
- **The speed-dependence curve is a 4-anchor fit**, not per-position measured
  data. It is isolated in one function so better data can replace it without
  touching any caller.
- **An even rotation is assumed.** Every rider takes an equal share on the
  front. Real teams give stronger riders longer pulls, which is exactly what
  the dedicated TTT calculators optimise — this app does not.
- **One rider profile stands for the whole team.** Everyone is assumed to have
  the same W/kg, weight and equipment.
- **No fatigue and no rotation dynamics** — no pull-length modelling, no cost
  of accelerating back onto the rear of the line after a turn, no rider being
  dropped.
- **No pack churn or sticky draft.** This is a clean paceline, not Zwift's
  full mass-start pack behaviour. A future race-draft mode should extend this
  module rather than duplicate it; the speed dependence and the
  power-multiplier plumbing are the reusable parts.
- **Equipment data stays draft-free.** The solvers in `equipment.ts` invert
  ZwiftInsider's *no-draft* bot protocol and must never see a draft factor, or
  every frame and wheel rating in the app becomes wrong.

## 7. Where the code is

| Concern | Location |
|---|---|
| Constants, factors, speed scaling, climb detection | `shared/utils/physics/draft.ts` |
| Per-timestep application | `powerScaleAtSpeed` in `shared/utils/physics/simulator.ts` |
| Ranking-key equivalent | `estimateFinishTimeSec` in `shared/utils/finishTime.ts` |
| Request wiring, "saves vs solo" comparison | `server/api/recommend/[slug].get.ts`, `.../segments/[slug].get.ts` |
| Speed chart + solo overlay | `shared/utils/physics/routeSurfaceSpeedProfile.ts` |
| Race plan | `shared/utils/physics/racePlan.ts` |
