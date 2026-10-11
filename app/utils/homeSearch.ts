/**
 * The homepage search (#331): one set of rules for the route grid, the
 * search's Routes group and its Climbs and sprints group, so a route the
 * dropdown offers is always a card the grid keeps.
 */

/** What the search reads of a route card or a segment: its name and its world's. */
export interface SearchableRide {
  name: string
  worldName: string
}

/** Text in lower case with its accents dropped: "Élysées" is "elysees". */
const plain = (text: string) => text
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .toLowerCase()

/**
 * Text as the search compares it: plain, its words one space apart. An
 * apostrophe or a full stop is part of its word and goes - "Queen's" is
 * "queens", "R.G.V." is "rgv" - and any other punctuation parts words, as a
 * hyphen does: "Champs-Élysées" and "champs elysees" are both "champs
 * elysees". The spaces stay so a word typed is never found across two:
 * "alp" is in Alpe du Zwift, not in Royal Pump Room.
 */
const searchText = (text: string) => plain(text)
  .replace(/['’.]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()

/** Text with nothing but its letters and digits, for comparing a misspelling's letter pairs. */
const compact = (text: string) => searchText(text).replace(/ /g, '')

/** The words of what the rider typed; none for a blank term. */
const searchWords = (term: string) => searchText(term).split(' ').filter(Boolean)

/**
 * Whether a ride answers the term: every word typed is in its name or its
 * world's name, punctuation and accents aside. A blank term matches all.
 */
export function matchesSearch(ride: SearchableRide, term: string): boolean {
  const name = searchText(ride.name)
  const world = searchText(ride.worldName)
  return searchWords(term).every(word => name.includes(word) || world.includes(word))
}

/**
 * How well a matching ride answers the term, best first: 0 when its name
 * starts with what was typed, 1 when every word is in its name, 2 when a
 * word was only found in its world's name.
 */
function matchRank(ride: SearchableRide, words: readonly string[]): number {
  const name = searchText(ride.name)
  if (name.startsWith(words.join(' '))) return 0
  return words.every(word => name.includes(word)) ? 1 : 2
}

/**
 * The rides the search's dropdown offers for a term, at most `limit` of them:
 * names that start with it first, then names that hold it, then rides that
 * matched by their world, each tier in the order given. Nothing for a blank
 * term - the dropdown has nothing to answer.
 */
export function rankedMatches<T extends SearchableRide>(rides: readonly T[], term: string, limit: number): T[] {
  const words = searchWords(term)
  if (!words.length) return []
  return rides
    .filter(ride => matchesSearch(ride, term))
    .map((ride, index) => ({ ride, index, rank: matchRank(ride, words) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit)
    .map(entry => entry.ride)
}

/** The pairs of neighbouring characters in compacted text, once each. */
const bigrams = (text: string) => new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, index) => text.slice(index, index + 2)))

/** How much of a misspelling's letter pairs a name has before it is offered as what the rider meant. */
const NEAR_MATCH_SHARE = 0.6

/**
 * The ride names a term that found nothing was closest to, for the empty
 * state to offer - "rod to skye" offers Road to Sky. A name is close when it
 * holds most of the term's pairs of neighbouring letters; the closest come
 * first, and of two as close the one nearer the term's length. A term under
 * three letters says too little to guess from, and offers nothing.
 */
export function nearMatches<T extends SearchableRide>(rides: readonly T[], term: string, limit: number): T[] {
  const typed = compact(term)
  if (typed.length < 3) return []
  const pairs = bigrams(typed)
  return rides
    .map((ride) => {
      const name = bigrams(compact(ride.name))
      const shared = [...pairs].filter(pair => name.has(pair)).length
      // Dice's coefficient breaks a tie in favour of the name the term
      // resembles as a whole, not the long one that happens to hold it.
      return { ride, share: shared / pairs.size, dice: (2 * shared) / (pairs.size + name.size) }
    })
    .filter(entry => entry.share >= NEAR_MATCH_SHARE)
    .sort((a, b) => b.share - a.share || b.dice - a.dice)
    .slice(0, limit)
    .map(entry => entry.ride)
}

/** How many near matches the empty state offers, in the dropdown and over the grid alike. */
export const NEAR_MATCH_LIMIT = 3

/**
 * The empty state's first line, which the search's live status reads out
 * too. `namesSegments` is whether it may say no segment has the name either:
 * not before the segments have been fetched, and not when some do.
 */
export function noMatchHeadline(term: string, namesSegments: boolean): string {
  return `No route${namesSegments ? ' or segment' : ''} named “${term.trim()}”.`
}
