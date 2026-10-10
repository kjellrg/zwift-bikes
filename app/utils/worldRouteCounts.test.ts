import { describe, expect, it } from 'vitest'
import { worldRouteCounts } from './worldRouteCounts'

const WORLDS = [
  { slug: 'watopia', name: 'Watopia' },
  { slug: 'richmond', name: 'Richmond' },
  { slug: 'london', name: 'London' },
  { slug: 'bologna', name: 'Bologna' }
]
const card = (world: string) => ({ world })

describe('worldRouteCounts', () => {
  it('counts each world\'s cards, most routes first and then by name', () => {
    const cards = [card('richmond'), card('london'), card('watopia'), card('watopia'), card('london'), card('richmond'), card('watopia')]
    expect(worldRouteCounts(cards, WORLDS)).toEqual([
      { slug: 'watopia', name: 'Watopia', routes: 3 },
      { slug: 'london', name: 'London', routes: 2 },
      { slug: 'richmond', name: 'Richmond', routes: 2 }
    ])
  })

  it('leaves out a world with no routes, which would be a link to an empty list', () => {
    expect(worldRouteCounts([card('bologna')], WORLDS)).toEqual([{ slug: 'bologna', name: 'Bologna', routes: 1 }])
    expect(worldRouteCounts([], WORLDS)).toEqual([])
  })
})
