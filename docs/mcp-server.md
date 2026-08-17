# MCP server

The app exposes its route catalog and its bike-ranking pipeline over the
[Model Context Protocol](https://modelcontextprotocol.io), so an LLM client can
answer "which bike is fastest for me on this route?" directly.

- **Endpoint:** `POST https://zwiftbikes.com/api/mcp`
- **Transport:** Streamable HTTP, JSON responses only (no SSE)
- **Auth:** none - the same public, read-only data the website serves

## Why this shape

**It is an adapter, not a second implementation.** Every tool reaches the
catalog and the ranking pipeline through the same HTTP endpoints the web app
uses, via Nitro's in-process `$fetch`. The recommend orchestration is subtle -
search must see the full candidate pool before any capping, and the reachable
window is re-ordered by real simulated time before pagination (see the comments
in [`server/api/recommend/[slug].get.ts`](../server/api/recommend/%5Bslug%5D.get.ts))
- and a second copy of that sequencing would drift. A filter added to an
endpoint is inherited by the MCP tools for free.

**Responses are plain JSON, never an SSE stream.** The MCP spec permits a
server to answer a POST with a single JSON-RPC message instead of opening a
stream, and that is what this deployment needs: the site runs on Azure Static
Web Apps, whose managed functions are a poor host for long-lived streaming
connections. Nothing is given up - every tool is a synchronous read over a
catalog baked into the bundle, so there is no progress to stream and no
server-initiated message to deliver. `GET /api/mcp` therefore answers `405`,
which clients read as "POST only".

**No SDK dependency.** The three JSON-RPC methods that matter (`initialize`,
`tools/list`, `tools/call`) are handled directly in
[`server/utils/mcp/protocol.ts`](../server/utils/mcp/protocol.ts). Taking
`@modelcontextprotocol/sdk` would have meant bypassing its default transport
anyway, to get the non-streaming behaviour above, in a project with nine
runtime dependencies.

## The rider profile

Finish-time prediction is the whole point of this app, and every predicted time
scales directly with the rider's weight, height and sustained power. Without
them the pipeline can only fall back to an abstract 0-100 score, which is a
much coarser signal. So the profile-dependent tools do not quietly degrade:
called with no profile, `recommend_for_route` and `recommend_for_segment`
return an `isError` result telling the model to ask the user for the three
values rather than returning score-ranked results that look like predictions.

There are two ways to supply it:

1. **`set_rider_profile` once per session.** The values are held against the
   MCP session id and reused by every later call.
2. **Inline `weightKg` / `heightCm` / `wkg`** on each recommend call, which
   overrides the stored profile.

Sessions live in the memory of whichever instance served the request. On Azure
Static Web Apps that instance cold-starts and scales out freely, so a stored
profile is a convenience, never a guarantee: a request landing on a fresh
instance gets a `404`, the spec's defined signal to re-initialize, and the
profile has to be set again. That is why option 2 exists - a client that never
wants to depend on server-side state can ignore `set_rider_profile` entirely.

Validation bounds are deliberately identical to the ones the HTTP endpoints use
to decide a profile is usable (`weightKg > 0`, `heightCm` 100-220, `wkg > 0`),
so the two can never disagree about what counts as a valid profile.

## Tools

| Tool | Purpose |
| --- | --- |
| `set_rider_profile` | Store weight/height/W-per-kg for the session |
| `get_rider_profile` | Read it back, so the model doesn't re-ask |
| `list_routes` | Search routes; resolves a route name to the slug the recommend tools need |
| `get_route` | One route's distance, lead-in, lappability, named climbs and surface mix |
| `list_segments` | Search the named climbs and sprints that can be ranked on their own |
| `list_bikes` | Search the frame catalog with categories and scores |
| `list_wheelsets` | Search the wheelset catalog with rolling-resistance classes |
| `recommend_for_route` | Rank frame + wheelset combos by predicted finish time over a whole route |
| `recommend_for_segment` | Same, for a single climb or sprint, simulated after a flat run-up |

Both recommend tools take `upgradeLevel` (0-5), defaulting to
`DEFAULT_UNOWNED_LEVEL` (5, fully upgraded) - the same constant
`useRiderProfile` and the endpoints read, so all three surfaces assume the same
stage. That matters more than a display detail: frames upgrade along different
per-stage schemes, so the assumed stage changes *which frame wins*, not just
the times. On Road to Sky, stage 0 puts the Tarmac SL9 on top and stage 5 puts
the Aethos S-Works there. Pass `upgradeLevel: 0` for bikes as they come out of
the drop shop.

Both recommend tools also take `draftMode` (`solo` | `ttt` | `race`), `tttRiders`
(2-8, default 8) and `tttClimbWkg` (optional). The default `solo` is a lone rider
with no draft - exactly how ZwiftInsider's bot tests ride, and byte-identical
to requests from before the option existed. `ttt` models a rotating Team Time
Trial paceline: the profile's `wkg` still means the rider's **own average over
a full rotation**, and the group rides at the speed that combined effort
produces (~1.38x a solo rider's power for an 8-rider team on the flat).
`tttClimbWkg` optionally paces climbs over ~3.5 minutes, where the paceline
breaks up, at a separate team climb W/kg. The response's `physics.ttt` block
carries the rider count, the rider's own watts, their pull and last-wheel
watts, and - on the first page - a simulated "saves X vs riding this alone at
the same effort" comparison, which the tools surface as an assumption line in
the header. See `shared/utils/physics/draft.ts` for the Pack Dynamics 4.1 data
behind it.

`race` models a mass-start bunch - any points or scratch race, group ride or
crit - and takes **no parameters of its own**, because it is one draft saving
calibrated against thirteen real ZwiftPower race fields rather than a pack model
(see [race-drafting.md](race-drafting.md)). Two things a model relaying it needs
to get right: the profile's `wkg` still means the rider's own **mechanical
average** power for the race, not their normalised power (feeding NP in
overstates the prediction by roughly 2%), and what comes back is a **typical
mid-pack** finish time, not a winning, breakaway or off-the-front one - a real
bunch spreads about ±1-2% around it. The response's `physics.race` block carries
the applied saving, the rider's own watts and the same "saves X vs riding solo"
comparison, again surfaced as a header assumption line.

They return at most 9 combos per call - the same cap the HTTP endpoint
enforces - with `offset` for paging, and **one row per frame**, paired with
that frame's fastest wheelset for the route. The web UI can afford to show a
frame's top few wheelsets side by side; in a chat answer those extra rows push
distinct *bikes* off the page, which is what was actually asked about. The cap
is applied after ranking (via `maxWheelsetsPerFrame`, which the endpoints now
accept) so it only narrows what is displayed, and is skipped entirely while
searching - a directed search should always be able to surface any real combo.

Times and gaps are formatted by `shared/utils/duration.ts`, the same code the
rider-facing pages use. Gaps keep two decimals below a minute: combos are
routinely separated by hundredths of a second, and rounding those to whole
seconds collapses genuinely different bikes onto one label (issue #61).
Absolute times stay rounded to the second, because hundredths on an hour-long
ride are noise.

Every ranked row carries a `measured` / `estimated` flag, mirroring the
"verified" badge in the web UI. This is not decoration: `measured` means the
frame's or wheel's performance was solved from real ZwiftInsider bot-test data,
and `estimated` means it came from a name/style heuristic. A model relaying a
prediction to a rider needs to be able to say which it has, so the distinction
is a table column rather than a footnote, and a combo is reported at the
confidence of its weaker half.

## Verified by default

`verifiedOnly` defaults to **true** on both recommend tools, matching what
`usePreferences` has always defaulted to in the web UI. A finish time built on
a name/style heuristic is a much weaker claim than one built on a bot test, and
presenting the two identically overstates what is known.

The cost is not evenly distributed, because the measured data is not:

| Category | Measured frames |
| --- | --- |
| tt | 24 / 25 |
| standard | 95 / 108 |
| gravel | **0 / 18** |
| funbike | **0 / 14** |
| handbike | 0 / 1 |

**No gravel or fun frame has bot-test data at all**, so the default removes
both categories outright. Since Zwift only lets gravel frames take
gravel/mountain wheels, that takes the entire off-road branch of the answer
with it. Filtering also has a real accuracy cost where it bites: on Road to
Sky the fastest verified bike is ~35 s slower than the fastest known bike, so
the default trades some predicted speed for a claim that can actually be
defended.

Two things keep that from becoming a silent wrong answer:

- Every verified-filtered response says so, and says how to widen.
- If the filter empties the result, the tools return an **error** naming
  `verifiedOnly: false` as the retry rather than an empty table - a bare "no
  results" would read as "no such bike exists" and end the model's attempt.

The HTTP endpoints default the same way (`verifiedOnly !== 'false'`), so an
unspecified call means verified everywhere. The rider-facing pages send the
flag explicitly in both directions rather than relying on omission, so the
endpoint default and the composable default cannot drift apart unnoticed.

## Connecting a client

Claude Desktop / Claude Code, via `mcp-remote`:

```json
{
  "mcpServers": {
    "zwift-bikes": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://zwiftbikes.com/api/mcp"]
    }
  }
}
```

Any client with native remote-MCP support can point at the URL directly.

Against a local `npm run dev`:

```sh
curl -s localhost:3000/api/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Known limits

- **No garage.** The website's "only show bikes I own" filter is backed by
  `localStorage`, which an MCP server has no access to, so the tools always
  rank the full catalog. `search` narrows to a named frame or wheelset, which
  covers "how fast would my bike be?".
- **No rate limiting.** Azure Static Web Apps provides none, and the endpoint is
  unauthenticated. The simulator is the expensive path here, so this is worth
  revisiting if the endpoint attracts real traffic.
- **Sessions are best-effort**, for the reasons above.
