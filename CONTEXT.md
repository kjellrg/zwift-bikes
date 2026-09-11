# ZwiftBikes

Ranks every Zwift frame and wheelset by how fast it would carry a specific rider over a specific route, segment or race. One context: the same vocabulary holds on the server, in the browser and in the MCP tools.

## Language

**Ride**:
The thing being ranked, together with everything the page knows about it that the rider's stored profile does not: the route or segment, the lap count, whether TT frames are barred, and any rider-side substitution the ride itself demands (a sprint segment is ridden at sprint power; a race with drafting off is ridden solo). One Ride is what a page hands to the recommendation request, and what the server's pipeline receives from an endpoint.
One Ride has two representations, one on each side of the request. `Ride` in `app/utils/recommendRequest.ts` is what the page knows; a page hands one to `useRecommendRequest` and owns nothing else about the request. `RecommendRide` is the same Ride resolved against the catalog and ready to be timed: the route to rank against, the laps, the TT-frame rule, and how one combo is timed on it (a segment is entered at speed off a warm-up, a route from its lead-in). The rider-side substitutions never reach the server as part of the Ride; they arrive already applied, as a power figure and a draft mode.
_Avoid_: context, request options, page config, ride params

**Category group**:
The set of racing categories an organiser runs together over one course, written the way they write it: WTRL's `A/B` and `C/D`, or a single group covering all four. It fixes the route and the lap count, which is what makes it the thing a race page ranks by. It belongs to the race, never to the rider: a rider says which group they are in, and the laps arrive with it rather than being picked. A link carries the chosen group as its Shared view's selection, the way a route's carries a lap count. It is not the bike category (road, TT, gravel), which is a persisted equipment preference and sits a viewport away on the same page.
_Avoid_: category, class, pen, division

**Shared view**:
The values a link to a ranking page carries so that the recipient sees what the sender saw: the bike search, the bike category, the draft mode, and whatever the page ranks by beyond the Ride's identity (the lap count on a route, the category group on a race). A shared view never changes the rider's stored preferences. It lasts for the visit: a category or draft mode a link supplied follows the rider to the next ranking page, and is written into that page's link so a reload reproduces it, until the rider chooses that value through a control (which stores it) or restores their saved one; the bike search and the page's own selection - a route's lap count, a race's Category group - belong to the page and stay behind. A fresh visit starts from the stored preferences. A view that only shows the defaults has nothing to carry, so its link stays clean.
The URL carries a shared view's non-default values. The homepage filters are not a shared view: that page ranks nothing.
_Avoid_: URL state, per-visit knobs, query params, visit override

**Directed search**:
A term typed on a ranking page, which reaches the whole eligible catalog rather than narrowing the rows already on screen. The pool's tidiness rules are lifted for it: the one-row-per-frame cap, the collapsing of a cosmetic re-skin into the bike it re-skins, and the hiding of the purchasable Halo frames - a rider who typed a bike's name is asking for that bike, not for a tidy list. Eligibility itself still applies (category, verification, the garage, compatibility), so a directed search can legitimately find nothing.
_Avoid_: filter, query, list search, bike filter

**Garage fallback**:
What "my garage only" does when half the garage is empty. Frames and wheels fall back independently: owned frames and no owned wheels ranks the rider's frames against every compatible wheel, the mirror case does the reverse, and an empty garage ranks everything. A restriction the rider cannot see is one they will blame the ranking for, so which of the four cases applies is always stated.
_Avoid_: owned-only filter, garage filter, my bikes

**Ride-only**:
Information that is a property of the Ride alone - the course's elevation, surfaces and mapped occurrences, and the terms the rider chose - so it exists with zero equipment matches and through a results refresh. Equipment-dependent analysis (the speed chart, the TTT plan) is not Ride-only: it describes one ranked setup.
_Avoid_: static content, course info, non-equipment data

**Sector**:
A stretch of a Ride where a TTT paceline is likely to split or slow: a sustained climb, where draft gives almost nothing, or a sustained rough surface, priced as the extra watts the recommended wheels need there over tarmac. A Ride with no sectors flagged is not a Ride with an uninterrupted paceline; the model only flags what it can measure.
_Avoid_: danger, race plan item, hazard

**TTT plan**:
The Ride's sectors in ride order for the recommended setup, with the coverage the model could not analyse disclosed beside them. It exists under TTT drafting only; race drafting models a bunch, not a paceline, and has no plan. The briefing's TTT line and the plan itself read one result.
_Avoid_: race plan, sector list, paceline analysis

**Overlay**:
Content shown over the page the rider is on, without leaving it. When that content also exists as a page of its own (about, profile, garage, report), the overlay is only the plain-click convenience: its opener keeps the page as a real destination, so a modifier-click, a middle-click, a crawler or a bookmark reaches the page, and the page, not the overlay, is what is server-rendered. The equipment drawer is an overlay with no page behind it, so its opener is a button. Only one overlay is open at a time; an overlay that opens another closes first.
_Avoid_: modal, dialog, slideover, popup

**Applied**:
The rider values and Ride that the results on screen were computed from: weight, height, the power the ride was ridden at, the draft mode, the lap count and the category once made legal for the ride. The controls can run ahead of them - between a slider's release and the response that answers it, the live value and the applied value differ - and everything that explains a finish time (the rider strip, the answer, the equipment-dependent analysis) reads the applied value, so a time is never explained by inputs it was not computed from. The applied values catch up exactly when the times do; a failed refresh leaves them where they were.
_Avoid_: current settings, live values, pending values, request inputs

**Discovery page**:
A page that lists Rides to choose from and ranks nothing: the homepage lists routes, the segments page lists climbs and sprints, the events hub lists Seasons and a season page lists its Races. When a discovery page has search or filters they belong to the page and are kept in its URL so that returning to it restores them; they are never a Shared view and never touch the rider's stored preferences. The events pages have none. What a discovery page shows about a Ride is its identity and the numbers a rider scans to choose it, not anything a ranking would answer.
_Avoid_: hub, list page, index page, landing page

**Season**:
One organiser's run of rounds under a series name, with the dates the rounds span and the organiser's own note on where the season stands. It is what the events hub lists and what a season page schedules, round by round. A season is past once its last Race has been run, and a past season is still a page: its races keep their rankings.
_Avoid_: series (the name a season runs under, not the season), calendar, event

**Round**:
An organiser's block of Races inside a Season, with its own dates and usually its own name - "Fresh & Fast", "August: Makuri Madness". It is how a season page groups its calendar and what a Season card on the events hub links into. A round is still to come until its first Race is run, ongoing from then until its last one has been, and past after that - the three states a Season card shows on the events hub, where a past round is no longer a way in. A past round stops being listed among what is still to come; its races stay, under their round, among the past ones.
_Avoid_: week (one race's slot inside a round), block, phase

**Race**:
A Ride an organiser has put on a Season's calendar: a date, a format, its Category groups and the rules those fix. A race stays upcoming until its last day has passed, so a week-long stage is upcoming all week; the first upcoming race in a season is its next race. A race with no format or no known course is on the schedule but has no page yet, and says so where it is listed.
_Avoid_: event (the section's name, not a thing on it), stage (an organiser's word for a week-long race)

**Garage**:
The frames and wheels a rider has told the site they own, with an upgrade stage per frame. It lives only in the rider's own browser, like the profile: no account, nothing follows them to another device. Ranking pages read it through Garage fallback, and a garage change refreshes what is already on screen rather than starting the list over, because the controls that change it sit on the results themselves. The garage is edited in an Overlay or on its own page; both edit the same thing.
_Avoid_: owned bikes, my bikes, inventory, collection

**Upgrade stage**:
Where a frame stands on Zwift's five-step upgrade ladder. Stage 0 is the frame as bought, stage 5 is fully upgraded, and each stage is earned by riding it. A frame in the garage is ranked at the stage the rider set; a frame outside it at the stage the profile assumes for unowned frames, which is 5 unless changed and flatters a bike the rider might buy. Wheels have no stages. A frame nobody has bot-tested has no per-stage numbers, so its stage cannot be set.
_Avoid_: level, upgrade level, tier (a frame's price class, a different axis)

**Ranking**:
Every eligible setup for a Ride, ordered by the finish time the Applied rider gets on it, fastest first. It is one list: the Recommendation is its rank 1 shown large, and the rows beneath it continue from rank 2, so no setup appears twice. A Directed search, a filter change or a Garage change produces a new ranking rather than narrowing this one, and a ranking of a single setup is a recommendation with nothing beneath it. The comparison picks from anywhere in the ranking, rank 1 included.
_Avoid_: results list, alternatives list, the field, matches

**Recommendation**:
Rank 1 of the Ranking, shown as the page's answer: the setup, its estimated finish time, and the paths deeper into it. It is not a judgement separate from the ranking; whatever the ranking puts first is the recommendation, so anything that reorders the ranking moves the recommendation with it. It carries everything a lower rank carries, the comparison pick included.
_Avoid_: top combo, hero card, winner, best bike

**Palette**:
The one primary and one neutral scale the whole site is drawn in, shared by both Colour modes: every badge, button, chart and share card takes its colour from a semantic name that resolves into the palette, never from a colour of its own. A palette change is therefore a change to those two scales and to the brand assets that were painted from them, and it leaves no page looking different from the share card that announces it. It is not the light/dark switch; both modes are drawn in the same palette.
_Avoid_: theme, colour scheme, skin, colours (which mode or which scale?)

**Colour mode**:
Light or dark, the rider's choice of ground for the page. The dark mode is the one the site is designed on and the one a first visit gets, whatever the device prefers, until the rider switches; the light mode is the same Palette on a white ground, which is why it takes its own shades of the primary, the status colours and the muted text rather than colours of its own. Both modes are checked whenever a page or the palette changes.
_Avoid_: theme, dark theme, light theme, both themes
