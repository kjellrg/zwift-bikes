import { describe, expect, it } from 'vitest'
import { COMPARISON_LIMIT, comboKey, toggleComparison } from './comparison'

describe('toggleComparison', () => {
  it('adds an unselected key and removes a selected one', () => {
    expect(toggleComparison([], 'a')).toEqual(['a'])
    expect(toggleComparison(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('keeps selection order and refuses a fourth setup', () => {
    expect(COMPARISON_LIMIT).toBe(3)
    const full = toggleComparison(toggleComparison(toggleComparison([], 'a'), 'b'), 'c')
    expect(full).toEqual(['a', 'b', 'c'])
    expect(toggleComparison(full, 'd')).toEqual(['a', 'b', 'c'])
    // Deselecting still works at the limit.
    expect(toggleComparison(full, 'b')).toEqual(['a', 'c'])
  })

  it('never mutates the list it was given', () => {
    const selected = ['a']
    toggleComparison(selected, 'b')
    expect(selected).toEqual(['a'])
  })
})

describe('comboKey', () => {
  it('keys a combo by frame and wheelset, and a fixed-wheel frame by frame alone', () => {
    expect(comboKey({ frame: { id: 7 }, wheelset: { key: 'zipp-808' } })).toBe('7-zipp-808')
    expect(comboKey({ frame: { id: 7 } })).toBe('7-fixed')
  })
})
