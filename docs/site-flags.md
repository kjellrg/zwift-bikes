# Runtime site flags

A tiny ops config in Workers KV that changes site behavior in **seconds**
instead of riding the ~7-minute build: a site-wide MOTD banner, hiding the
events section, and kill switches for the expensive API endpoints. Built for
the moments a build cycle is too slow - a Zwift rebalance makes the rankings
temporarily wrong, a season ends, an endpoint is being abused.

Everything in the flags is **public by construction** (the client renders
from `/api/site-flags`), so no secrets, ever. And the whole feature is
**fail-open**: no KV binding (dev, tests, prerender), no key yet, or a
value that fails to parse all mean "defaults" - everything on, no MOTD. A broken
flags push degrades to normal service; it can never take the site down.

## Editing flags

The values are deliberately **not in git** - KV is the source of truth, and a
commit would trigger the exact build loop this bypasses. The local editing
copy is `infra/site-flags.json` (gitignored; `infra/site-flags.example.json`
shows every field):

```sh
npm run flags:pull      # fetch the live flags into infra/site-flags.json
# edit infra/site-flags.json
npm run flags:push      # validate + write to KV
npm run flags:diff      # show local-vs-live drift
```

Every command targets the **preview** namespace unless `-- --prod` is passed,
so the rehearsal flow is: push, eyeball the result on any open PR's
workers.dev URL, then `npm run flags:push -- --prod`. Changes are live within
~60s (KV edge cache + the Worker's own 60s read memo, both set in
`server/utils/siteFlags.ts`).

`push` validates against the *strict* schema (`shared/utils/siteFlags.ts`) -
unknown keys are typos and reject. The Worker's runtime parse is lenient the
other way (unknown keys ignored) so an older deploy survives a newer config.
`push` also stamps `updatedAt`, which is the audit trail the git history no
longer provides.

## The fields

| Field | Effect |
|---|---|
| `motd` | Site-wide banner under the header (`SiteMotdBanner.vue`). `id` keys dismissal - a new message needs a new id or riders who dismissed the old one won't see it. `tone` is `info`/`warning`/`error`; `expiresAt` self-removes it. |
| `sections.events.mode: "hidden"` | Hides the Events nav entries and the homepage teaser, swaps the three events pages' content for an unavailable notice (with `notice` as its wording), and 503s `/api/events/**`. |
| `killSwitches.recommend` | 503s `/api/recommend/**` - for when serving wrong rankings (mid-rebalance) is worse than serving none. |
| `killSwitches.mcp` | 503s `/api/mcp`. |

## How it hangs together

- `shared/utils/siteFlags.ts` - schema (loose + strict), defaults, parsing.
- `server/utils/siteFlags.ts` - the KV read (`SITE_FLAGS` binding, key
  `site-flags`), 60s-memoized, fail-open.
- `server/middleware/site-flags-gate.ts` - the *authoritative* enforcement:
  503 + `Retry-After` on gated endpoints.
- `server/api/site-flags.get.ts` - the public projection (`motd` +
  `sections`; kill switches stay server-only).
- `app/composables/useSiteFlags.ts` - fetched once post-mount. The events
  pages are **prerendered**, served straight from static assets without the
  Worker running - so the served HTML always carries the default state and
  the client applies the real flags after mount, the same hydration
  discipline the preferences follow. Client hiding is presentation; the
  middleware is what actually stops requests.

## Boundaries

- **Not for secrets** - the config is public.
- **Not real-time** - ~60s propagation is the contract.
- **Not a CMS** - the MOTD is one short string. Rich content is a page.
- Hiding events doesn't touch the build-time sitemap or the prerendered
  files; that's fine for temporary hiding, but *permanently* removing a
  section still means a real code change and build.
- The wrangler.jsonc `env.preview` block must keep its own copy of the
  `kv_namespaces` binding (pointing at the preview namespace) - wrangler
  doesn't inherit bindings into environments, same trap as `ratelimits`.
