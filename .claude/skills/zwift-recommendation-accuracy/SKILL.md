---
name: zwift-recommendation-accuracy
description: Use when adding/changing bike frame or wheel data, scoring/ranking logic (shared/utils/scoring.ts), physics/finish-time calculations (shared/utils/finishTime.ts, shared/utils/physics/*), classifiers (classifyBikeFrame.ts, classifyWheel.ts), or any persisted user preference/setting. Captures hard-won rules from this codebase's history about data verification, Zwift-vs-real-world physics fidelity, and avoiding regressions in the recommendation pipeline.
---

# Zwift Bikes: recommendation accuracy

This app's entire value proposition is one sentence: **given a route and a rider's real weight/height/power, predict as accurately as possible what their finish time will be on each frame+wheelset combo, using whatever real metrics are available.** Every rule below exists to protect that goal. When a change trades away accuracy for simplicity, elegance, or "looks nicer," it's the wrong change.

## 1. Frame/wheel data must be verified against ZwiftInsider, and confidence must be flagged

- The only real (non-heuristic) source of truth for frame/wheel aero and climb performance is ZwiftInsider's public bot-test data: `https://zwiftinsider.com/charts-frames/`, `/charts-tt/`, `/charts-wheels/`, and the public Google Sheet those pages cite. Before trusting or adding a number to `shared/data/frameSpeedData.ts` or `shared/data/wheelSpeedData.ts`, pull the live sheet (CSV export) and cross-check it - don't trust a remembered figure or a single AI-paraphrased summary of a page (those have been wrong/incomplete in ways that mattered - e.g. missing the fact that the sheet has separate 150W/300W test rows per bike, which silently corrupts a naive parse).
- `Crr` (rolling resistance) is the one exception: it's an official, closed-form Zwift game value per wheel-class/surface (`https://zwiftinsider.com/crr/`), not a bot-test estimate - treat `shared/utils/classifyWheel.ts`'s `CRR_GRAVEL_SCORE`/`CRR_COBBLE_SCORE` as authoritative, not heuristic.
- Every frame/wheel classifier must keep reporting `confidence: 'measured' | 'estimated'` (see `ScoreConfidence` in `shared/types/catalog.ts`) exactly as it does today - `'measured'` only when the number traces to real ZwiftInsider data, `'estimated'` for name/style-based heuristics. Never silently upgrade a guess to `'measured'`, and never remove the "verified" badge/filter (`verifiedOnly`) this powers in the UI.
- If you add a new frame/wheel name mapping, double check it against the actual name `zwift-data` uses (`node_modules/zwift-data/lib/cjs/bikeFrames.js` etc.), not ZwiftInsider's spreadsheet spelling - the two frequently differ (e.g. sheet says "Van Rysel RCR Pro", the game/`zwift-data` says "VanRysel RCR Pro"; sheet says "Specialized S-Works Tarmac SL9", the game says "Specialized Tarmac SL9"). A lookup keyed on the wrong spelling silently falls back to the heuristic estimate with no error.

## 2. Model Zwift's actual physics, not real-world cycling physics, wherever they diverge

Real-world cycling intuition is a false friend in several specific, confirmed ways in this game:

- **Rolling resistance on gravel/cobbles is 100% determined by the wheel's Crr class (Road/Gravel/Mountain), never the frame.** A Specialized Roubaix and a Trek Emonda with the same wheel roll identically on cobbles - real-world "endurance bike" marketing does not apply. Don't reintroduce a frame-based off-road score into the ranking blend (`OFFROAD_FRAME_WEIGHT` in `scoring.ts` is `0` for exactly this reason).
- **Counterintuitively, Road-class wheels have the *lowest* Crr on cobblestones**, and Gravel-class wheels have the lowest Crr on gravel/dirt - gravel wheels are not just "worse on road, better everywhere off-road."
- **Frame category gates which wheels can even be equipped**: gravel frames only take gravel/mountain-class wheels, road/TT frames only take road-class wheels. This is enforced in Zwift's garage, not just a performance difference - see `isWheelsetCompatible` in `scoring.ts`.
- **TT frame/climb and TT frame/aero scores are measured against a different baseline** ("Zwift TT" vs "Zwift Carbon") than standard frames - never compare a raw TT score to a raw standard score without going through the existing cross-baseline correction constants in `finishTime.ts` (`TT_CDA_MULTIPLIER`, `TT_CLIMB_MASS_MULTIPLIER`).
- When real-world intuition and Zwift's modeled behavior conflict, **Zwift's behavior wins**, and the reasoning should be written down as a code comment with a citation, the way the existing constants in `finishTime.ts` and `classifyWheel.ts` already do. Don't "fix" a result just because it looks wrong to a real cyclist - verify what Zwift itself does first.

## 3. Any real signal (like real finish time) must never be shadowed by a coarser proxy

This bit the project hard, twice, in the same session:

- `scoring.ts`'s abstract 0-100 `score` is a cheap proxy for ranking when no rider profile is known. The instant a rider profile *is* known, `estimateFinishTimeSec` (cheap, closed-form) is strictly more accurate and must be the ranking/selection key - `score` must never be used to decide what enters a results page or what's reachable by search once a better signal exists.
- Any function that trims/dedupes a candidate list for display tidiness (e.g. `capWheelsetsPerFrame`'s "max 3 wheel colourways per frame") must run **only on the final, already fully-ranked/searched list**, never earlier. Applying it before ranking/search silently deletes candidates from existence - this exact bug hid Tarmac SL9 from search, then hid 78 of 79 road wheels the same way one layer deeper. When adding any new "keep top N" or "dedupe ties" logic, ask: could this run before search/ranking sees the full pool? If yes, move it later.
- When `search` (or any user-directed lookup) is active, skip cosmetic capping/deduping entirely - a directed search should always be able to find any real, valid combo.

## 4. Don't overcomplicate changes

- Prefer the smallest change that fixes the actual reported behavior. Most real bugs in this codebase have been one-line-cause / one-line-fix once correctly diagnosed (a hardcoded weight constant, an unscaled bonus, a filter applied one step too early) - resist the urge to redesign the whole pipeline when a scoped fix will do.
- Don't add new abstractions, config flags, or generalized systems for a problem that's only ever shown up once. Three similar lines beat a premature helper.
- Before changing a scoring/physics constant, write a small throwaway script (see `/tmp/.../scratchpad`, using `jiti` to run the real `.ts` modules directly) to numerically verify the before/after effect on a few real routes across route archetypes (pure flat, pure climb, pure cobble/gravel, mixed) - don't reason about it purely on paper. This caught several regressions before they shipped.
- Always re-run `npx eslint <touched files>` after edits. This repo currently carries real pre-existing lint debt in some files from in-progress work - don't try to fix unrelated pre-existing violations opportunistically; just make sure your own diff doesn't add new ones beyond what the surrounding code already does.

## 5. All user preferences/settings must persist to localStorage, client-side only

There is no backend/account system - `useGarage`, `useRiderProfile`, and `usePreferences` all follow the same pattern: a `useState` reactive ref, a `load()` that reads `localStorage` guarded by `import.meta.client`, and setters that update state then call a `persist()` writing back to `localStorage`. Any new setting (a new filter, a new default, a new toggle) must follow this exact pattern:

- Add it to the relevant composable (or a new one if it's a genuinely new domain), not component-local `ref()` state, if it needs to survive a page reload.
- Wire `load()` into the page's `onMounted`.
- Wire a `watch(...)` on the new state if it should trigger a data refresh (see how `myBikesOnly`/`owned`/`ownedWheels` are watched in `routes/[slug].vue` and `segments/[slug].vue`).
- Never assume a default level/value at the API layer that could silently diverge from what a composable already exposes (e.g. quick-add-to-garage must reuse `defaultUnownedLevel` from `useRiderProfile`, not hardcode `1`).

## 6. Other lessons worth carrying forward

- **Round every user-facing derived number.** A score, a percentage, anything shown as a whole-feeling metric should be `Math.round`ed at the point it's computed, not left to accumulate fractional remainders from intermediate multipliers (a scaled bonus term silently reintroduced decimals into `score` once - see the `Math.round(...)` wrapping the whole sum in `scoreCombo`).
- **A classifier/heuristic decision documented with real citations in a code comment is a decision someone already made carefully** - before "fixing" something like a frame's category or a fixed-wheel special case, read the surrounding comment. Several apparent bugs reported in this project turned out to be intentional, already-verified behavior (e.g. Specialized PROJECT 74 correctly living in the `standard` category, matching Zwift's own drop-shop categorization, not a misclassification).
- **`zwift-data` (the npm package) is the source of truth for names/IDs/categories** (`isTT`, frame/wheel names) - it's deliberately minimal (no aero/weight ratings), which is exactly why this app's classifiers/heuristics exist. Don't assume it has more fields than it does; check `node_modules/zwift-data/lib/types/types.d.ts` directly rather than guessing.
- **Watch for `LOC_ENTITLEMENT_...` raw strings** leaking through as a frame name - that means `zwift-data` hasn't shipped a localized name yet for a very recent release; it's an upstream data gap, not a bug in this app.
- When a fix changes what a "representative"/placeholder value can be (e.g. a throwaway wheelset for fixed-wheel frames), check whether removing/filtering the source list that placeholder comes from could ever leave it empty - prefer making the placeholder truly optional (`Wheelset | undefined`) over assuming the pool is always non-empty.
