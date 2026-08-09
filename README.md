# Zwift Best Bike

A Nuxt 4 + Nuxt UI 4 app that recommends the best bike frame / wheelset combo
for a given [Zwift](https://www.zwift.com/) route, based on your rider
weight and power (W/kg).

## What it does

- Browse Zwift routes and see an estimated surface breakdown (road / gravel /
  cobbles), climb profile, and lap info.
- For any route, get a ranked list of frame + wheelset combos, scored on
  aero, climb, and off-road (rolling resistance) performance, with an
  estimated finish time for your rider weight/power.
- Track your own "Garage": which bikes/wheels you own (and frame upgrade
  level 1-5), so recommendations reflect what you can actually ride instead
  of every bike in the game.
- Set a rider profile (weight, FTP) on the Profile page to drive the W/kg
  used in finish-time estimates.

### Data sources

- Catalog data (routes, frames, wheels) comes from the
  [`zwift-data`](https://www.npmjs.com/package/zwift-data) npm package.
- Aero/climb performance and rolling-resistance (Crr) figures are sourced
  from [ZwiftInsider](https://zwiftinsider.com/) bot-test data where
  available (marked with a "verified" badge in the UI); everything else
  falls back to a labeled heuristic estimate.
- Route surface percentages (gravel/cobble %) are an app-computed estimate,
  not official Zwift data.

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
