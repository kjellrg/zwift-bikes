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

const counted = (value: number, noun: string) => `${value} ${noun}${value === 1 ? '' : 's'}`

/**
 * The line under a World page's heading (#58) - "110 routes, 28 climbs and
 * sprints" - which states the whole world rather than a result, so it has no
 * "found". A world with only one kind of segment names that kind ("1
 * climb"), and one with none says nothing about segments: a "0 climbs and
 * sprints" clause would announce a section the page does not have.
 */
export function worldCountLine({ routes, climbs, sprints }: { routes: number, climbs: number, sprints: number }): string {
  const segments = climbs && sprints
    ? `${climbs + sprints} climbs and sprints`
    : climbs ? counted(climbs, 'climb') : sprints ? counted(sprints, 'sprint') : undefined
  return [counted(routes, 'route'), segments].filter(Boolean).join(', ')
}
