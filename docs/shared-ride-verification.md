# Shared ride verification (#199)

## Scope and approved changes

`rideForRoute` and `rideForSegment` own resolved ride construction, timing
metadata and memoised plan geometry. Both endpoints and all three ranking
pages use them. Shared types live in `shared/types/recommendRide.ts`; the
server modules re-export their existing public types.

The original plan required a byte-identical extraction followed by the #184
legacy geometry fix. Both were verified independently:

| Commit | Comparison | Result |
| --- | --- | --- |
| `07943d9` | `npm run parity:recommend -- main` (`4a24026`) | 242/242 cases byte-identical, including timing metadata |
| `66f3719` | `npm run parity:recommend -- 07943d9` | 241/242 identical; only `segment--alpe-du-zwift--ttt-legacy` changed |

For #184, the first Alpe legacy-TTT combo changed from 3354.9119428046647 s to
3358.492014289893 s. The unmeasured `the-clyde-kicker` legacy-TTT case was
byte-identical. Legacy means the old finish-time model, not old geometry.

## Warm-up invariant

The requested builder test revealed a pre-existing production defect:
changing warm-up distance from 2 to 3 or 4 km changed the stock Zwift Carbon
and Zwift 32mm Carbon combo's solo time by 0.115922 s on Alley Sprint and
0.490661 s on Alpe du Zwift, exceeding the required 0.1 s tolerance.

The maintainer approved expanding scope to fix production integration.
Tightening the steady-state shortcut alone left 0.142004 s of drafted-climb
variation. A fixed 0.05 s step still failed (0.125986 s); 0.02 s passed but
cost 3.3-5.1 times as much per segment request in local measurements.

The maintainer then explicitly approved replacing subtraction with exit-speed
handoff: simulate the flat warm-up, then simulate the unshifted segment using
the warm-up's `finalSpeedMps`. The warm-up alone uses a 0.000001 m/s^2
steady-state acceleration tolerance rather than the route default of 0.002.
The timed run keeps the normal timestep and shortcut. There are still two
counted integrations per combo; the segment's plan no longer needs shifting.
`prependWarmup` remains exported for the race-draft scripts.

The invariant test runs the real simulator at 75 kg and 175 cm, using 1000 W
on Alley Sprint and 225 W on Alpe, Clyde Kicker and 23rd St, both solo and
six-rider TTT with 3.5 W/kg climb pacing, across 2000/3000/4000 m warm-ups.
This tolerance is not a guarantee for arbitrarily short warm-ups, which cannot
reach cruising speed, or for every possible rider and equipment combination.

## Final handoff evidence

`npm run parity:recommend -- 66f3719` compared 242 cases: 177 identical and
65 changed. No route cases changed. Changes cover simulated segment results,
their two MCP responses, seeded drill-down/garage requests, and a stalled
segment's error coordinates (23 m of 12228 m rather than warm-up-inclusive
2023 m of 14228 m; the 422 status is unchanged). The two changed legacy
drill-down cases are seeded with different frame IDs after dynamic winners
move; same-input legacy results are unchanged by the handoff.

The final `physics-regression-check` run compared routes against `4a24026`
and segments against `66f3719`. At 75 kg, 175 cm and 225 W, route estimates,
surface penalties, top-ten simulations and rankings were exactly unchanged
on Tempus Fugit (road and TT), Road to Sky, Cobbled Climbs, Heart of
Montmartre, Jungle Circuit and The Uber Pretzel.

Stock Carbon/32mm Carbon, warm-ups 2000/3000/4000 m; seconds rounded to six
decimals. Alley uses 1000 W; other segments use 225 W. TTT uses six riders
and 3.5 W/kg climb pacing. Every final spread was exactly zero.

| Segment/mode | Old 2 km time | Final time | Old warm-up spread |
| --- | ---: | ---: | ---: |
| Alley solo | 29.054871 | 29.118387 | 0.115922 |
| Alley TTT | 24.982100 | 25.020433 | 0.073982 |
| Alpe solo | 4119.328274 | 4119.717560 | 0.490661 |
| Alpe TTT | 3483.958313 | 3484.444157 | 0.390378 |
| Clyde solo | 45.426455 | 45.817333 | 0.581057 |
| Clyde TTT | 41.215719 | 41.573775 | 0.499847 |
| 23rd solo | 93.249705 | 93.398568 | 0.649539 |
| 23rd TTT | 88.936305 | 89.060569 | 0.502055 |

Median of eight warmed sequential pipeline requests, without HTTP/network
overhead: final/baseline latency was 0.830x/0.910x for Alley solo/TTT,
0.987x/0.986x for Alpe and 0.762x/0.838x for Clyde. Candidate pools and
integration counts were unchanged. These are local measurements, not
deployed CPU guarantees.

Alley retains its top three but swaps sixth/seventh; Alpe retains its top
three but swaps fourth/fifth; Clyde solo changes its top three from LAB71
Team/LAB71/SL9 to SL9/LAB71 Team/S-Works SL8. Clyde TTT retains its top-three
frames but changes the LAB71 Team wheel pick. The largest sampled matched
combo time delta was 0.501690 s on Alpe solo. Near ties remain timestep
sensitive: Alpe solo's SL8 leads Emonda SL by 0.041 s at the default timestep
but trails by 0.323 s at 0.005 s. That residual integration uncertainty is
not a warm-up dependency and is not fixed by this change.

## PR closure

The PR should include `Fixes #199` and `Fixes #184`, and link this evidence.
No issue closure or remote publication is performed by the implementation.