/** A world as the homepage's "Browse by world" row links it: its name and how many routes its World page lists. */
export interface WorldRouteCount {
  slug: string
  name: string
  routes: number
}

/**
 * The homepage's "Browse by world" row (#58): every one of the game's
 * worlds with its route count, most routes first and then by name - the
 * order the segments page gives its world groups, so the two Discovery
 * pages agree on which worlds are the big ones. All of them, whatever the
 * count: every world has a World page, and a size threshold would be one
 * more rule to explain (decided while grilling #58).
 *
 * Counted from the route cards the homepage already holds rather than served
 * alongside them: the counts are the cards, grouped, and a second copy in
 * the payload would only be a second number that could disagree with them.
 */
export function worldRouteCounts(cards: readonly { world: string }[], worlds: readonly { slug: string, name: string }[]): WorldRouteCount[] {
  const counts = new Map<string, number>()
  for (const card of cards) counts.set(card.world, (counts.get(card.world) ?? 0) + 1)
  return worlds
    .map(world => ({ slug: world.slug, name: world.name, routes: counts.get(world.slug) ?? 0 }))
    .sort((a, b) => b.routes - a.routes || a.name.localeCompare(b.name))
}
