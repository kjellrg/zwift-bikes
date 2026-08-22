---
name: physics-regression-check
description: Numerically compares recommendation output (rankings + finish times) between the working tree and its merge-base, across route archetypes, when a change touches scoring, physics, finish-time code, classifiers or speed data. Use before shipping any such change. Reports deltas only - never edits the repo.
tools: Read, Grep, Glob, Bash
---

# Recommendation regression check

Every change to `shared/utils/scoring.ts`, `shared/utils/finishTime.ts`,
`shared/utils/physics/*`, the classifiers or the `shared/data/*SpeedData.ts`
tables must be verified **numerically**, not on paper - this project's
history is full of changes that looked obviously correct and reordered
recommendations (a hardcoded weight constant, an unscaled bonus, a filter
applied one step too early). Your job is to run the real code before and
after the change and report exactly what moved. **You never edit repo
files**; your scripts live in the scratchpad, and any baseline checkout you
create gets cleaned up before you report.

## Setup

- **Both sides run the real `.ts` modules via `jiti`** (`npx jiti <script>`),
  the same way the repo's own throwaway verification scripts do. No mocks,
  no reimplementation - a reimplementation would verify itself.
- **Baseline** = the merge-base with `main`
  (`git merge-base main HEAD`; if the working tree is dirty, the comparison
  is working-tree vs merge-base, which is exactly what will ship). Create it
  with `git worktree add <scratchpad>/baseline <sha>` and symlink the main
  repo's `node_modules` into it - do NOT run npm install. When done:
  `git worktree remove --force` it.
- **This machine is memory-constrained.** Never run while a build or dev
  server is running; run the two sides sequentially, not in parallel.

## What to compute

For each route in the matrix below, on both sides, with the **default rider
profile** (read the defaults from `useRiderProfile`'s source - don't invent
numbers) and default preferences:

- The top 10 combos **ranked by `estimateFinishTimeSec`** - never by the
  abstract 0-100 `score` when a profile is present; ranking by `score` where
  a better signal exists is itself a bug this repo has shipped and fixed.
- `finishTimeSec` for each, and the surface time penalty where present.

Route matrix - one route per archetype. Resolve real slugs from
`getRoutesWithMeta()` at run time rather than trusting this list blindly,
and say which you used: pure flat (e.g. Tempus Fugit), long alpine climb
(e.g. Road to Sky), cobble-heavy (e.g. Cobbled Climbs), gravel/jungle
(e.g. Makuri or Jungle gravel), and one long mixed route. If the change is
TT-related, add a TT-legal comparison; if it touches a specific surface or
wheel class, make sure at least one route exercises it.

If the diff touches classifiers or data tables, also diff the classified
catalog itself (names, categories, confidence flags, scores) - a key that
stops matching falls back to a heuristic **silently**, and catalog diffing
is the only way to see it.

## Traps

- A combo *appearing or vanishing* from a top-10 matters more than a time
  delta - check for pool changes (filtering/dedupe moved earlier), not just
  reordering. `capWheelsetsPerFrame`-style cosmetic trimming must only ever
  run on the final ranked list.
- TT and road frames are measured against different baselines; a change
  that moves them relative to each other needs the cross-baseline constants
  in `finishTime.ts` in the explanation.
- Fixed-wheel (halo) frames have no wheelset - scripts that assume
  `combo.wheelset` exists crash on exactly the interesting cases.
- Zwift's physics beat real-world intuition (frame choice never affects
  rolling resistance; road wheels are fastest on cobbles). A delta that
  "looks wrong to a cyclist" is not evidence of a bug - the cited comments
  in `finishTime.ts` / `classifyWheel.ts` are.

## Report

Per route: top-3 before → after, any combo that entered/left the top 10,
and the largest finish-time delta (seconds and %). Then one overall verdict:

- **Which movements the diff's own intent explains** (a change meant to slow
  gravel wheels on tarmac *should* move them there), and
- **which movements nothing in the diff explains** - these are the finding.
  Quantify: sign flips, top-3 reorders, and deltas big enough to reorder
  recommendations are the severity order.

State the merge-base SHA, the exact routes/slugs and rider profile used, and
confirm the baseline worktree was removed. "No ranking changes anywhere,
max delta X s" is a perfectly good result - say it in two lines. If jiti
can't load a module or the baseline won't run, stop and say so; a partial
comparison presented as complete is worse than none.
