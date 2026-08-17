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

## Reporting bugs and wrong data

Every page has a **Report an issue** link in the footer (and a "something here
look wrong?" link under each results list). It fills in the report for you -
including the page, the active filters, the browser and, if you tick the box,
your rider profile - then opens it as either a prefilled GitHub issue or an
email. The site itself has no report endpoint: nothing is submitted, stored or
sent from the server, which is what keeps the privacy claims on the About page
true.

- **GitHub** (preferred, needs an account) - opens a prefilled
  [issue form](.github/ISSUE_TEMPLATE). The field `id`s in those YAML files
  are the URL prefill keys used by [`app/utils/report.ts`](app/utils/report.ts);
  renaming one there without updating the other silently drops that field
  from prefilled reports. Issues are public, which the form says up front.
- **Email** - `bugs [at] zwiftbikes.com`, for anyone who'd rather not use
  GitHub. Read privately by the maintainers. Written out that way on purpose:
  the site assembles its addresses at runtime so they never land in served
  HTML or a JS bundle ([`app/utils/report.ts`](app/utils/report.ts)), and a
  plain-text copy in a public README would hand harvesters what that care was
  spent avoiding. The **Email it instead** button on the report form fills the
  real address in for you.
- **Copy report** - for when neither of the above is convenient.

An emailed report is often worth filing as an issue so it can be tracked in
the open. When doing that, **never** put the reporter's email address in the
issue, and only name them if they asked to be credited - that's the promise
the About page makes on the site, so it holds for maintainers too.

Corrections to frame, wheel or route numbers need a source (a ZwiftInsider
speed test, an official changelog, another published test) - the whole
point of the data pipeline is that its numbers trace back to measurements
rather than impressions. Security issues go to
[private vulnerability reporting](https://github.com/kjellrg/zwift-bikes/security/advisories/new)
instead - see [SECURITY.md](SECURITY.md).

## Renovate integration

Install the [Renovate GitHub app](https://github.com/apps/renovate/installations/select_target)
on your repository and you are good to go.
