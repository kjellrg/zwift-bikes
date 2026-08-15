# ZwiftBikes

A Nuxt 4 + Nuxt UI 4 app that recommends the best bike frame / wheelset combo
for a given [Zwift](https://www.zwift.com/) route, based on your rider
weight and power (W/kg).

## What it does?

- Browse Zwift routes and see an estimated surface breakdown (road / gravel /
  cobbles), climb profile, named climbs/sprint segments on the route, and lap
  info.
- For any route, get a ranked list of frame + wheelset combos scored on
  aero, climb, and off-road (rolling resistance) performance, with an
  estimated finish time for your rider weight/power - modeled on Zwift's own
  in-game physics (e.g. rolling resistance depends only on wheel class, not
  frame; TT frames use a different performance baseline than road frames),
  not idealized real-world cycling physics, since the two frequently diverge.
- Also get bike recommendations scoped to a single named climb or sprint
  segment, not just the whole route.
- Search and filter the recommendation list by name, bike category, "only
  verified" (real bot-test data only, no heuristic guesses), or "only my
  garage" (bikes *and* wheels) - so results reflect equipment you can
  actually ride.
- Track your own "Garage": which bikes/wheels you own (and frame upgrade
  level 1-5), so recommendations reflect what you can actually ride instead
  of every bike in the game. Bikes/wheels can also be added straight from a
  result card.
- Set a rider profile (weight, height, FTP) on the Profile page to drive the
  W/kg used in finish-time estimates, plus a default upgrade level assumed
  for bikes you don't yet own.

### Data sources

- Catalog data (routes, frames, wheels, segments) comes from the
  [`zwift-data`](https://www.npmjs.com/package/zwift-data) npm package.
- Aero/climb performance and rolling-resistance (Crr) figures are sourced
  from [ZwiftInsider](https://zwiftinsider.com/) bot-test data where
  available (marked with a "verified" badge in the UI); everything else
  falls back to a labeled heuristic estimate. Huge thanks to the ZwiftInsider
  team - their painstaking, publicly-shared bot testing of nearly every
  frame, wheel, and Crr surface value in the game is what makes this app's
  numbers possible at all, and their articles are just a genuinely great
  read on their own if you're into the game's mechanics.
- Route surface percentages (gravel/cobble %) are an app-computed estimate,
  not official Zwift data. Which *worlds* are known to contain gravel/cobble
  sections at all is cross-checked against community-mapped surface data
  adapted from [zwiftmap](https://github.com/andipaetzold/zwiftmap) (MIT
  licensed - see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).

## Setup

Install dependencies:

```bash
npm install
```

## Development Server

Start the development server (defaults to `http://localhost:3000`):

```bash
npm run dev
```

## Type-checking & linting

```bash
npm run typecheck
npm run lint       # add -- --fix to auto-fix
```

## Production

Build the application for production:

```bash
npm run build
```

Locally preview the production build:

```bash
npm run preview
```

## Deployment

Deployed as an [Azure Static Web App](https://learn.microsoft.com/azure/static-web-apps/)
via the GitHub Actions workflow in
[`.github/workflows`](.github/workflows). Pushes to `main` deploy to
production; pushes to `devel` deploy to a separate staging environment.

## Renovate integration

Install the [Renovate GitHub app](https://github.com/apps/renovate/installations/select_target)
on your repository and you are good to go.
