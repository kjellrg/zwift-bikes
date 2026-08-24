# Contributing

ZwiftBikes is a spare-time hobby project, and contributions of every size are
welcome — bug reports, data corrections and pull requests alike. For local
setup and the usual commands, see the [Development](README.md#development)
section of the README.

## Making changes

- **Where things live**: [shared/](shared/) holds the data tables and the
  physics/scoring logic, [app/](app/) the UI, [server/](server/) the API
  routes. Deeper background (physics model, events data, upgrade levels)
  lives in [docs/](docs/).
- **Checks a PR must pass**: `npm run lint`, `npm run typecheck`,
  `npm run validate` (the data/physics validators) and `npm test`. CI runs
  the same set on every push ([checks.yml](.github/workflows/checks.yml)),
  and the deploy workflow runs the full production build.
- **The pre-commit hook** runs those checks plus secret scanning
  ([trufflehog](https://github.com/trufflesecurity/trufflehog)) and workflow
  auditing ([zizmor](https://github.com/zizmorcore/zizmor)) — roughly half a
  minute in total, but it does need both of those tools installed.
- **Speed-data edits** come with an extra step: the precomputed physics
  table must be regenerated (`npm run equipment-physics:compute`), or
  `npm run validate` fails the build on the drift it detects. Any change to
  frame/wheel/route numbers also needs a verified source — see below.

## Reporting bugs and wrong data

Every page has a **Report an issue** link in the footer (and a "something here
look wrong?" link under each results list). It fills in the report for you —
including the page, the active filters, the browser and, if you tick the box,
your rider profile — then opens it as either a prefilled GitHub issue or an
email. The site itself has no report endpoint: nothing is submitted, stored or
sent from the server, which is what keeps the privacy claims on the About page
true.

- **GitHub** (preferred, needs an account) — opens a prefilled
  [issue form](.github/ISSUE_TEMPLATE). The field `id`s in those YAML files
  are the URL prefill keys used by [`app/utils/report.ts`](app/utils/report.ts);
  renaming one there without updating the other silently drops that field
  from prefilled reports. Issues are public, which the form says up front.
- **Email** — `bugs [at] zwiftbikes.com`, for anyone who'd rather not use
  GitHub. Read privately by the maintainers. Written out that way on purpose:
  the site assembles its addresses at runtime so they never land in served
  HTML or a JS bundle ([`app/utils/report.ts`](app/utils/report.ts)), and a
  plain-text copy in a public repo would hand harvesters what that care was
  spent avoiding. The **Email it instead** button on the report form fills the
  real address in for you.
- **Copy report** — for when neither of the above is convenient.

Security issues don't belong in any of the above — report them through
[private vulnerability reporting](https://github.com/kjellrg/zwift-bikes/security/advisories/new)
instead; see [SECURITY.md](SECURITY.md).

## Data corrections need a source

Corrections to frame, wheel or route numbers need a source (a ZwiftInsider
speed test, an official changelog, another published test) — the whole point
of the data pipeline is that its numbers trace back to measurements rather
than impressions.

## Maintainer notes

An emailed report is often worth filing as an issue so it can be tracked in
the open. When doing that, **never** put the reporter's email address in the
issue, and only name them if they asked to be credited — that's the promise
the About page makes on the site, so it holds for maintainers too.

---

However you contribute — a typo fix, a corrected Crr value or a whole
feature — thank you. Ride on!
