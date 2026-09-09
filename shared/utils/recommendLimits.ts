/**
 * The recommend endpoints' paging bounds, in the one place every side reads
 * them from: the zod schemas that enforce them (`server/utils/apiQuerySchemas.ts`),
 * the MCP adapter's pre-clamps and pagination wording (`server/utils/mcp/`),
 * and the browser, which asks for exactly one page at a time.
 *
 * A module of its own because the schemas can't be the source: they import
 * zod and the route catalog, and neither may reach a client chunk (issue
 * #151). The offset cap was once tightened 1000->100 on the schema while the
 * adapter's hardcoded copy was missed, leaving MCP forwarding offsets the
 * endpoint 400s - one definition makes that class of drift impossible.
 */

/**
 * The most rows one recommend request may return, and the page size the
 * result pages use - deliberately the same number: a page asks for a full
 * page, so the client's "nine rows" and the server's cap can't drift apart.
 * Nine rows is one hero card plus four rows of two.
 */
export const RECOMMEND_MAX_LIMIT = 9

/**
 * Offset feeds `offset + limit + SIMULATED_ORDER_MARGIN` simulations, so its
 * upper bound IS the per-request CPU bound: at the old max of 1000 a single
 * crafted request measurably rode the full 30s `cpu_ms` kill limit
 * (~$0.02/M CPU-ms, 30/min per IP allowed). 100 keeps ~11 "Show more" pages
 * reachable - deeper than any real browsing - at ~154 simulations worst case.
 */
export const RECOMMEND_MAX_OFFSET = 100
