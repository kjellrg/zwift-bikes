# ZwiftBikes

Ranks every Zwift frame and wheelset by how fast it would carry a specific rider over a specific route, segment or race. One context: the same vocabulary holds on the server, in the browser and in the MCP tools.

## Language

**Ride**:
The thing being ranked, together with everything the page knows about it that the rider's stored profile does not: the route or segment, the lap count, whether TT frames are barred, and any rider-side substitution the ride itself demands (a sprint segment is ridden at sprint power; a race with drafting off is ridden solo). One Ride is what a page hands to the recommendation request, and what the server's pipeline receives from an endpoint.
The type is `Ride` in `app/utils/recommendRequest.ts`; a page hands one to `useRecommendRequest` and owns nothing else about the request.
_Avoid_: context, request options, page config, ride params

**Shared view**:
The values a link to a ranking page carries so that the recipient sees what the sender saw: the bike search, the bike category, the draft mode, and whatever the page ranks by beyond the Ride's identity (the lap count on a route, the category group on a race). A shared view applies for that visit only and never changes the rider's stored preferences; a view that only shows the defaults has nothing to carry, so its link stays clean.
The URL carries a shared view's non-default values. The homepage filters are not a shared view: that page ranks nothing.
_Avoid_: URL state, per-visit knobs, query params, visit override
