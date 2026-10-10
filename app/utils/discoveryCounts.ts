/** One counted noun of the count line, e.g. `{ value: 12, noun: 'climb' }` -> "12 climbs". Every noun these pages count takes a plain `-s`. */
export interface DiscoveryCount {
  value: number
  noun: string
}

/**
 * The line a discovery page prints over its list - "24 routes found", "12
 * climbs and 4 sprints found" - written once, so `DiscoveryStatus` and the
 * pages that print it beside their filters cannot drift apart. A zero is
 * reported rather than dropped: that a search matched climbs but no sprints
 * is worth reading.
 */
export function discoveryCountLine(counts: readonly DiscoveryCount[]): string {
  return `${counts.map(({ value, noun }) => `${value} ${noun}${value === 1 ? '' : 's'}`).join(' and ')} found`
}
