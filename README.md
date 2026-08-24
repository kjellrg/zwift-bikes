# ZwiftBikes

[![Checks](https://github.com/kjellrg/zwift-bikes/actions/workflows/checks.yml/badge.svg)](https://github.com/kjellrg/zwift-bikes/actions/workflows/checks.yml)
[![License: MIT](https://img.shields.io/github/license/kjellrg/zwift-bikes)](LICENSE)
[![Website](https://img.shields.io/website?url=https%3A%2F%2Fzwiftbikes.com&label=zwiftbikes.com)](https://zwiftbikes.com)

**[zwiftbikes.com](https://zwiftbikes.com)** — pick a [Zwift](https://www.zwift.com/)
route, tell it your weight and power, and it ranks every bike frame and
wheelset by how fast it would get *you* to the finish. When Zwift ships new
frames or wheels, we aim to add them as soon as possible.

This is a hobby project, built and run in spare time by fellow cyclists and
Zwifters, for the fun of it. Bug reports, data corrections and pull requests
are all very welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

![Sliders for rider weight, height and power above a route's top bike recommendations, ranked with match scores, estimated finish times and verified badges](docs/assets/screenshots/bikes-light.png#gh-light-mode-only)
![Sliders for rider weight, height and power above a route's top bike recommendations, ranked with match scores, estimated finish times and verified badges](docs/assets/screenshots/bikes-dark.png#gh-dark-mode-only)

*The heart of the site: set your weight, height and power, and any route
gives you its top frame + wheelset combos — with estimated finish times,
match scores and badges showing which numbers are backed by verified test
data.*

## What it does

- **Find the fastest bike for any route.** Every route gets a ranked list of
  frame + wheelset combos with an estimated finish time for your weight and
  power. The rankings aim to reflect how equipment actually behaves in-game —
  which often differs from real-world cycling.
- **Explore routes and segments.** See each route's surface breakdown
  (road / gravel / cobbles), climb profile and lap info, plus its named
  climbs and sprints — and get recommendations scoped to a single climb or
  sprint, not just the whole route.
- **Ride what you own.** Keep a Garage of your bikes, wheels and frame
  upgrade levels, and filter recommendations down to it — or to "verified
  only" results backed by real test data rather than estimates.
- **Browse race events** on the events calendar — a hand-picked selection of
  race series (not every event on Zwift), with bike recommendations for each
  event's route.
- **Set a rider profile once** (weight, height, FTP) and every estimate uses
  it. It's stored only in your browser — nothing is sent to a server.

![Speed and surface chart for a route, showing estimated speed over the elevation profile, surface segments and their watt penalties](docs/assets/screenshots/terrain-light.png#gh-light-mode-only)
![Speed and surface chart for a route, showing estimated speed over the elevation profile, surface segments and their watt penalties](docs/assets/screenshots/terrain-dark.png#gh-dark-mode-only)

*Each route's speed & surface chart: your estimated speed over the elevation
profile, where the surface changes, and what each surface costs you in watts.*

## Where the numbers come from

- Aero/climb performance and rolling-resistance (Crr) figures are sourced
  from [ZwiftInsider](https://zwiftinsider.com/) bot-test data where
  available (marked with a "verified" badge in the UI); everything else
  falls back to a labeled heuristic estimate. Huge thanks to the ZwiftInsider
  team — their painstaking, publicly shared bot testing of nearly every
  frame, wheel and Crr surface value in the game is what makes this app's
  numbers possible at all, and their articles are just a genuinely great
  read on their own if you're into the game's mechanics.
- Catalog data (routes, frames, wheels, segments) comes from the
  [`zwift-data`](https://www.npmjs.com/package/zwift-data) npm package.
- Route surface percentages (gravel/cobble %) are an app-computed estimate,
  not official Zwift data. Which *worlds* are known to contain gravel/cobble
  sections at all is cross-checked against community-mapped surface data
  adapted from [zwiftmap](https://github.com/andipaetzold/zwiftmap) (MIT
  licensed — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).

## Development

ZwiftBikes is a [Nuxt](https://nuxt.com/) app, so the usual commands apply:

```bash
npm install        # install dependencies
npm run dev        # dev server on http://localhost:3000
npm run typecheck  # TypeScript checks
npm run lint       # add -- --fix to auto-fix
npm run build      # production build; npm run preview to serve it locally
```

## Reporting bugs and wrong data

Use the **Report an issue** link in the footer of any page (or the "something
here look wrong?" link under each results list) — it prefills the report for
you and opens it as a GitHub issue (preferred) or an email. Corrections to
frame, wheel or route numbers need a source (a ZwiftInsider speed test, an
official changelog, another published test) — the numbers here trace back to
measurements, not impressions.

Security issues go to
[private vulnerability reporting](https://github.com/kjellrg/zwift-bikes/security/advisories/new)
instead — see [SECURITY.md](SECURITY.md). Full reporting details and
maintainer guidelines live in [CONTRIBUTING.md](CONTRIBUTING.md).

## Not affiliated

ZwiftBikes is an unofficial fan project. It is not affiliated with, endorsed
by, or sponsored by Zwift, Inc. — Zwift is a trademark of Zwift, Inc. It is
likewise not affiliated with ZwiftInsider, `zwift-data`, or zwiftmap; their
publicly shared data is used with attribution and gratitude. The code is
open source under the MIT license ([LICENSE](LICENSE)).
