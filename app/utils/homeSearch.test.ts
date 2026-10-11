import { describe, expect, it } from 'vitest'
import { matchesSearch, nearMatches, noMatchHeadline, rankedMatches } from './homeSearch'

const ride = (name: string, worldName = 'Watopia') => ({ name, worldName })

describe('matchesSearch', () => {
  it('ignores case, accents, hyphens and other punctuation', () => {
    expect(matchesSearch(ride('Champs-Élysées', 'Paris'), 'champs elysees')).toBe(true)
    expect(matchesSearch(ride('Casse-Pattes', 'France'), 'casse pattes')).toBe(true)
    expect(matchesSearch(ride('Casse-Pattes', 'France'), 'CASSE-PATTES')).toBe(true)
    expect(matchesSearch(ride('Queen\'s Highway'), 'queens highway')).toBe(true)
    expect(matchesSearch(ride('R.G.V.', 'Watopia'), 'rgv')).toBe(true)
    expect(matchesSearch(ride('Peaky Pavé', 'Yorkshire'), 'peaky pave')).toBe(true)
    expect(matchesSearch(ride('Road to Sky'), 'road to skye')).toBe(false)
  })

  it('matches inside a word, never across two', () => {
    expect(matchesSearch(ride('Alpe du Zwift'), 'alp')).toBe(true)
    expect(matchesSearch(ride('Royal Pump Room 8', 'Yorkshire'), 'alp')).toBe(false)
  })

  it('matches the world\'s name, alone or alongside words of the ride\'s own', () => {
    expect(matchesSearch(ride('Temple Trek', 'Makuri Islands'), 'makuri')).toBe(true)
    expect(matchesSearch(ride('Temple Trek', 'Makuri Islands'), 'makuri temple')).toBe(true)
    expect(matchesSearch(ride('Temple Trek', 'Makuri Islands'), 'watopia temple')).toBe(false)
  })

  it('matches everything on a blank term', () => {
    expect(matchesSearch(ride('Tempus Fugit'), '')).toBe(true)
    expect(matchesSearch(ride('Tempus Fugit'), '  - ')).toBe(true)
  })
})

describe('rankedMatches', () => {
  const rides = [
    ride('Watopia Flat Route'),
    ride('Volcano Circuit'),
    ride('Big Loop'),
    ride('Loop de Loop'),
    ride('Temple Trek', 'Makuri Islands'),
    ride('Castle to Castle', 'Makuri Islands'),
    ride('Makuri 40', 'Makuri Islands')
  ]
  const names = (found: { name: string }[]) => found.map(entry => entry.name)

  it('puts names that start with the term first, then names that hold it, keeping the catalog order within each', () => {
    expect(names(rankedMatches(rides, 'loop', 6))).toEqual(['Loop de Loop', 'Big Loop'])
  })

  it('lists a name match before a ride that only matched by its world', () => {
    expect(names(rankedMatches(rides, 'makuri', 6))).toEqual(['Makuri 40', 'Temple Trek', 'Castle to Castle'])
    expect(names(rankedMatches(rides, 'watopia', 6))).toEqual(['Watopia Flat Route', 'Volcano Circuit', 'Big Loop', 'Loop de Loop'])
  })

  it('finds a climb by its name the way it finds a route', () => {
    const segments = [
      { slug: 'epic-kom', name: 'Epic KOM', type: 'climb', worldName: 'Watopia' },
      { slug: 'alpe-du-zwift', name: 'Alpe du Zwift', type: 'climb', worldName: 'Watopia' },
      { slug: 'fuego-flats-sprint', name: 'Fuego Flats Sprint', type: 'sprint', worldName: 'Watopia' }
    ]
    expect(rankedMatches(segments, 'alpe', 4).map(segment => segment.slug)).toEqual(['alpe-du-zwift'])
    expect(rankedMatches(segments, 'Fuego-flats', 4).map(segment => segment.slug)).toEqual(['fuego-flats-sprint'])
  })

  it('stops at the limit and offers nothing for a blank term', () => {
    expect(names(rankedMatches(rides, 'watopia', 2))).toEqual(['Watopia Flat Route', 'Volcano Circuit'])
    expect(rankedMatches(rides, '  ', 6)).toEqual([])
  })
})

describe('nearMatches', () => {
  const rides = [
    ride('Road to Ruins'),
    ride('Road to Sky'),
    ride('Tempus Fugit'),
    ride('Volcano Circuit'),
    ride('2022 Cycling Esports World Championships Route', 'New York')
  ]
  const names = (found: { name: string }[]) => found.map(entry => entry.name)

  it('offers the names a misspelling was closest to, closest first', () => {
    expect(names(nearMatches(rides, 'rod to skye', 3))[0]).toBe('Road to Sky')
    expect(names(nearMatches(rides, 'tempus fugitt', 3))).toEqual(['Tempus Fugit'])
    expect(names(nearMatches(rides, 'volcanoe circut', 3))).toEqual(['Volcano Circuit'])
  })

  it('offers nothing when nothing is close, nor for a term too short to judge', () => {
    expect(nearMatches(rides, 'xyz', 3)).toEqual([])
    expect(nearMatches(rides, 'qwerty uiop', 3)).toEqual([])
    expect(nearMatches(rides, 'ro', 3)).toEqual([])
  })

  it('stops at the limit', () => {
    expect(nearMatches(rides, 'road to', 1)).toHaveLength(1)
  })
})

describe('noMatchHeadline', () => {
  it('names the term, and segments too only once they were searched and none matched', () => {
    expect(noMatchHeadline('  xyz ', true)).toBe('No route or segment named “xyz”.')
    expect(noMatchHeadline('alpe', false)).toBe('No route named “alpe”.')
  })
})
