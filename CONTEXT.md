# ZwiftBikes

Ranks every Zwift frame and wheelset by how fast it would carry a specific rider over a specific route, segment or race. One context: the same vocabulary holds on the server, in the browser and in the MCP tools.

## Language

**Ride**:
The thing being ranked, together with everything the page knows about it that the rider's stored profile does not: the route or segment, the lap count, whether TT frames are barred, and any rider-side substitution the ride itself demands (a sprint segment is ridden at sprint power; a race with drafting off is ridden solo). One Ride is what a page hands to the recommendation request, and what the server's pipeline receives from an endpoint. A TT-frame bar can come from a Race format the page was told as readily as from a race the page is.
A Ride names its course - which route or which segment - rather than describing it; the course's geometry is the Ride's to know (see Ride-only), and an Applied Ride comes back knowing the course its times were computed over, so nothing that explains a time has to work out afterwards which course the ranking was for. Where the ranking is fetched from is derived from the course, never part of what a page says.
One Ride has two representations, one on each side of the request. `Ride` in `app/utils/recommendRequest.ts` is what the page knows; a page hands one to `useRecommendRequest` and owns nothing else about the request. `RecommendRide` is the same Ride resolved against the catalog and ready to be timed: the route to rank against, the laps, the TT-frame rule, and how one combo is timed on it (a segment is entered at speed off a warm-up, a route from its lead-in). The rider-side substitutions never reach the server as part of the Ride; they arrive already applied, as a power figure and the Draft the Ride is timed under.
_Avoid_: context, request options, page config, ride params

**Draft**:
How a Ride is ridden relative to other riders: alone, in a rotating paceline of a chosen size with an optional climb pace, or in a mass-start bunch. The rider chooses it and it is kept with their other preferences; a Ride whose Race format has no draft is ridden solo whatever was chosen. Everything timed on one Ride - the Ranking, the "saves vs solo" comparison, the speed chart, the TTT plan - is timed under the same draft, and "the same ride solo" means the same rider, the same power and the same climb pacing with only the draft removed. A draft has no course of its own: what it is worth depends on the course it is applied to, which is the Ride's to know. The draft mode - solo, TTT or race - is the choice itself; the paceline's size and climb pace belong to the TTT choice.
_Avoid_: drafting, draft settings, draft options

**Category group**:
The set of racing categories an organiser runs together over one course, written the way they write it: WTRL's `A/B` and `C/D`, or a single group covering all four. It fixes the route and the lap count, which is what makes it the thing a race page ranks by. It belongs to the race, never to the rider: a rider says which group they are in, and the laps arrive with it rather than being picked. A link carries the chosen group as its Shared view's selection, the way a route's carries a lap count. It is not the bike category (road, TT, gravel), which is a persisted equipment preference and sits a viewport away on the same page.
_Avoid_: category, class, pen, division

**Shared view**:
The values a link to a ranking page carries so that the recipient sees what the sender saw: the bike search, the bike category, the draft mode, and whatever the page ranks by beyond the Ride's identity (the lap count on a route, the category group on a race). A shared view never changes the rider's stored preferences. It lasts for the visit: a category or draft mode a link supplied follows the rider to the next ranking page, and is written into that page's link so a reload reproduces it, until the rider chooses that value through a control (which stores it) or restores their saved one; the bike search and the page's own selection - a route's lap count, a race's Category group - belong to the page and stay behind. A fresh visit starts from the stored preferences. A view that only shows the defaults has nothing to carry, so its link stays clean.
The URL carries a shared view's non-default values. A page's own selection is a bounded integer (a lap count, a Category group) or one of a fixed set of words (the Race format a segment is ridden under); either way one page has one, and the value a clean link omits is the hard default. The homepage filters are not a shared view: that page ranks nothing.
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
The Ride's sectors in ride order for the recommended setup, with the coverage the model could not analyse disclosed beside them. It exists under TTT drafting only; race drafting models a bunch, not a paceline, and has no plan. The fact row's TTT line and the plan itself read one result.
_Avoid_: race plan, sector list, paceline analysis

**Overlay**:
Content shown over the page the rider is on, without leaving it. When that content also exists as a page of its own (about, profile, garage, report), the overlay is only the plain-click convenience: its opener keeps the page as a real destination, so a modifier-click, a middle-click, a crawler or a bookmark reaches the page, and the page, not the overlay, is what is server-rendered. The equipment drawer is an overlay with no page behind it, so its opener is a button. Only one overlay is open at a time; an overlay that opens another closes first. An overlay is dismissed the way a rider leaves a page - the browser's back gesture and a swipe in the direction that reverses its entrance, as well as Esc, the close control and the backdrop - and dismissing it leaves the rider on the page it was opened over, at every viewport.
_Avoid_: modal, dialog, slideover, popup

**Applied**:
The rider values and Ride that the results on screen were computed from: weight, height, the power the ride was ridden at, the draft mode, the lap count and the category once made legal for the ride. The controls can run ahead of them - between a slider's release and the response that answers it, the live value and the applied value differ - and everything that explains a finish time (the rider strip, the answer, the equipment-dependent analysis) reads the applied value, so a time is never explained by inputs it was not computed from. The applied values catch up exactly when the times do; a failed refresh leaves them where they were.
_Avoid_: current settings, live values, pending values, request inputs

**Applied Ranking**:
The Ranking accepted for display, together with the rider and Ride, Directed search, eligibility restrictions, Garage fallback and supporting information that produced and explain it. Its rows and explanations belong together even while the controls move ahead or a refresh fails; live controls and Ride-only information are not part of it.
_Avoid_: current results, result snapshot, accepted response

**Discovery page**:
A page that lists Rides to choose from and ranks nothing: the homepage lists routes, the segments page lists climbs and sprints, the events hub lists Seasons and a season page lists its Races. When a discovery page has search or filters they belong to the page and are kept in its URL so that returning to it restores them; they are never a Shared view and never touch the rider's stored preferences. The events pages have none. What a discovery page shows about a Ride is its identity and the numbers a rider scans to choose it, not anything a ranking would answer.
_Avoid_: hub, list page, index page, landing page

**Season**:
One organiser's run of rounds under a series name, with the dates the rounds span and the organiser's own note on where the season stands. It is what the events hub lists and what a season page schedules, round by round. A season has been run once every one of its Rounds has been, and then it is not listed: the events hub leaves it out, and its season page says in one sentence that it has finished and points to the hub.
_Avoid_: series (the name a season runs under, not the season), calendar, event

**Round**:
An organiser's block of Races inside a Season, with its own dates and usually its own name - "Fresh & Fast", "August: Makuri Madness". It is how a season page groups its calendar and what a Season card on the events hub links into. A round is still to come until its first Race is run, ongoing from then until its last one has been, and past after that. A round with no races yet is still to come however long ago it was announced: its dates are all a rider planning a season has to go on. A past round is not listed: it leaves its season page, heading and all, and its tile leaves the events hub. A round is announced once the organiser has published anything of one of its races, a format or a course; a season page lists an announced round under its own heading, a race to a row, and a round with nothing announced as one line under "Not announced yet".
_Avoid_: week (one race's slot inside a round), block, phase

**Race**:
A Ride an organiser has put on a Season's calendar: a date, a format, its Category groups and the rules those fix. A race stays upcoming until its last day has passed, so a week-long stage is upcoming all week; after that it has been run. The first upcoming race in a season is its next race. A race that has been run is not listed anywhere on the events pages. That is decided twice with the same rule: a page is rendered with the server's day (a prerendered page's is its build's), so the served HTML already leaves out what ended before it, and after load the rider's own clock removes what has ended since. Its own page stays at its URL, so a link to it still lands: it says above its title that the race has been run, points to its season's next race and to its route, and is not indexed. A race with no format or no known course is on the schedule but has no page yet, and says so where it is listed.
_Avoid_: event (the section's name, not a thing on it), stage (an organiser's word for a week-long race)

**Race format**:
The organiser's word for how a race is run - a team time trial, a points race, a scratch race, WTRL's Race of Truth - and the one field every equipment rule is derived from: whether TT frames may be started on, and whether there is a draft at all. A format can travel without the race it belongs to: a ranking page that is not a race page can be told one, and then ranks under those rules, so a scoring sprint opened from a race is ranked as that race is raced. Being told a format is not being told which race; the page carries the rules, never the race's identity. A page told no format is not riding a race, and every frame is legal there - which is a different thing from a race whose format the organiser hasn't published yet, where the rules are unknown and TT frames are assumed barred.
_Avoid_: race type, event format, ride rules, race rules

**Garage**:
The frames and wheels a rider has told the site they own, with an upgrade stage per frame. It lives only in the rider's own browser, like the profile: no account, nothing follows them to another device. Ranking pages read it through Garage fallback, and a garage change refreshes what is already on screen rather than starting the list over, because the controls that change it sit on the results themselves. The garage is edited in an Overlay or on its own page; both edit the same thing.
_Avoid_: owned bikes, my bikes, inventory, collection

**Upgrade stage**:
Where a frame stands on Zwift's five-step upgrade ladder. Stage 0 is the frame as bought, stage 5 is fully upgraded, and each stage is earned by riding it. A frame in the garage is ranked at the stage the rider set; a frame outside it at the stage the profile assumes for unowned frames, which is 5 unless changed and flatters a bike the rider might buy. Wheels have no stages. A frame nobody has bot-tested has no per-stage numbers, so its stage cannot be set.
_Avoid_: level, upgrade level, tier (a frame's price class, a different axis). The API query key `defaultUnownedLevel` and the MCP `upgradeLevel` argument keep the old word on purpose - they are a published contract, not drift.

**Ranking**:
Every eligible setup for a Ride, ordered by the finish time the Applied rider gets on it, fastest first. It is one list, shown whole as a table from rank 1 down: the Recommendation above it is rank 1 shown as the page's answer, and rank 1's own row stays in the table so the fastest and the rest can be read together. A row carries what belongs to a row - the comparison pick, its disclosure and its Wheel alternatives - so those exist once, on the row. A Directed search, a filter change or a Garage change produces a new ranking rather than narrowing this one, and a ranking of a single setup is a recommendation with one row beneath it.
_Avoid_: results list, alternatives list, the field, matches

**Recommendation**:
Rank 1 of the Ranking, shown as the page's answer: the setup, its estimated finish time, the evidence lines that say what the time rests on, and the paths deeper into it (the Equipment drawer, the Garage, the note on a quicker setup the rules exclude, the Climb trade). It is not a judgement separate from the ranking; whatever the ranking puts first is the recommendation, so anything that reorders the ranking moves the recommendation with it. The controls that belong to a row - comparison, disclosure, Wheel alternatives - are on rank 1's row in the table, not repeated here.
_Avoid_: top combo, hero card, winner, best bike

**Climb time**:
How long one setup takes over one pass of a named climb on a Ride, cut from the same timing that gives its finish time rather than timed on its own. A climb ridden on every lap has one per lap, and a climb in the lead-in has one more.
_Avoid_: climb split (a split is the field breaking up), segment time, KOM time

**Climb trade**:
The note beside the Recommendation that names one setup slower over the whole Ride but quicker over a named climb's last pass, with both numbers, and hands the choice to the rider. It exists only under race drafting, where staying with the bunch is what the times assume and a climb is where a rider loses it. It never reorders the Ranking or changes a finish time. The setups it may name are the frames in the rider's Garage if it holds any, otherwise the ranked rows, and in either case rank 1's own frame on the lighter kind of wheels. It names one setup at most.
_Avoid_: climb check, climb bike, climbing alternative

**Wheel close call**:
The sentence in "Why this bike wins here" saying that rank 1's own wheels and the fastest wheels of the other kind - disc against regular - finish the Ride within a whisker of each other on rank 1's frame, with the gap and the difference in weight. On most road rides they do, which is the news: a disc is rarely the clear win riders expect. It states the fact; the numbers behind any advice about the climbs belong to the Climb trade.
_Avoid_: disc note, wheel tip, disc or regular

**Ranking results**:
Everything a page shows about its Applied Ranking: the Recommendation, the evidence lines that say what its time rests on, the answer the page's title asks for, the ranking beneath it, and what all of that looks like while it is refreshing or when nothing matched. It is one thing, shown the same way wherever a ride is ranked, so what a rider learns on a route page is true on a segment or a race page. What a page states on its own is not part of it - its header, its selection control, its fact row, its course hero, its course analysis, and the decision of whether there is a ranking to show at all.
_Avoid_: the results column, results section, results area, recommendation block

**Wheel alternatives**:
The wheelsets a frame could be ridden with on the Ride, ranked fastest first under the Applied Ranking's own request, so their times come out of the same pipeline, rider, laps, draft mode and rules as the row that asked. They always include the fastest disc and the fastest regular wheels the frame takes, so any wheel a Wheel close call names can be found on the row. A row's disclosure shows them; the Equipment drawer takes its upgrade curve from the fastest of them. They answer for one Ranking: once that Ranking is replaced they describe nothing on screen and are not shown.
_Avoid_: drill-down, wheel options, wheel list, frame combos

**Equipment drawer**:
The Overlay that shows everything known about one ranked setup: its numbers on the Ride, its physics, its bot-test and route upgrade curves, and its Garage controls. It reads the Applied Ranking on screen and follows its setup through refreshes; when the setup is on no loaded row it says whether the setup lost or was never allowed to start, and keeps the numbers from the last ranking it found the setup in.
_Avoid_: bike drawer, bike detail, slideover, modal

**Rider card**:
The Applied rider beside the Recommendation on every ranking page: the weight, height, power, draft mode, lap count and frame category the times on screen were computed for, whether they are the defaults or the rider's own, and the levers that change them. A lever writes the stored profile the moment it is released, so the card, the profile Overlay and the profile page edit one rider; there is no unsaved state to explain. While a refresh is in flight the card says so and keeps showing the Applied values until the times change. A value a link supplied is marked as the link's, with the way back to the rider's own.
_Avoid_: rider strip, adjust effort, slider box, settings panel

**Fact row**:
The plain-text numbers a rider chooses a Ride by, set under the page's heading: distance, elevation, climb ratio, surface shares, climb count, and the Ride-only notes beneath them (a segment's timing scope and host routes, a lap count with its lead-in, the TTT line). It renders from the Ride alone, so it is there with zero matches and during a refresh, and it carries no badges: classification is text, only status is coloured.
_Avoid_: ride briefing, stats row, header stats, badges

**Course hero**:
The Ride's elevation profile drawn large at the top of a ranking page, in the neutral ink, with its surfaces on a strip beneath, its named climbs marked as bands and its sprints marked, for the Applied lap count with the lead-in once. On a segment page it draws the segment itself; on a race page the scoring segments are starred. A Ride with no measured profile has no hero, only the fact row and a line saying its terrain is approximated. The hero is Ride-only and never waits for a Ranking.
_Avoid_: elevation chart, profile chart, banner, header image

**Silhouette**:
The small, unlabeled drawing of a route or segment's profile that stands for it wherever it is listed: Discovery cards, related rides, race rows and share cards. Every silhouette of one Ride is the same shape, drawn from one geometry, with a floor on its vertical span so a flat route stays visibly flat rather than becoming noise. It is an outline, not the measured profile: every listing draws the same outline, a larger drawing of the same Ride (a share card, the homepage's example) draws it finer, and none of them carries anything a pointer could read off. The measured detail belongs to the Course hero.
_Avoid_: sparkline, thumbnail, mini chart, icon

**Palette**:
The one primary and one neutral scale the whole site is drawn in, shared by both Colour modes: every badge, button, chart and share card takes its colour from a semantic name that resolves into the palette, never from a colour of its own. A palette change is therefore a change to those two scales and to the brand assets that were painted from them, and it leaves no page looking different from the share card that announces it. It is not the light/dark switch; both modes are drawn in the same palette.
_Avoid_: theme, colour scheme, skin, colours (which mode or which scale?)

**Colour mode**:
Light or dark, the rider's choice of ground for the page. The dark mode is the one the site is designed on and the one a first visit gets, whatever the device prefers, until the rider switches; the light mode is the same Palette on a white ground, which is why it takes its own shades of the primary, the status colours and the muted text rather than colours of its own. Both modes are checked whenever a page or the palette changes.
_Avoid_: theme, dark theme, light theme, both themes
