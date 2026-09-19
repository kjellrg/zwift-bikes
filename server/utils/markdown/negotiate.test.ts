import { describe, expect, it } from 'vitest'
import { estimateTokens, prefersMarkdown } from './negotiate'

/**
 * The contract this module exists for: an agent that asks for markdown gets
 * it, and nothing that did not ask does. The browser headers below are real
 * ones - the wrong answer to any of them serves markdown to a person.
 */
describe('prefersMarkdown', () => {
  it('answers markdown when it is what was asked for', () => {
    expect(prefersMarkdown('text/markdown')).toBe(true)
    expect(prefersMarkdown('text/markdown, text/html;q=0.9')).toBe(true)
    expect(prefersMarkdown('text/html;q=0.8, text/markdown;q=0.9')).toBe(true)
    // Listed at all beats a catch-all that would otherwise take everything.
    expect(prefersMarkdown('text/markdown, */*;q=0.1')).toBe(true)
  })

  it('leaves every browser on HTML', () => {
    // Chrome, Firefox and Safari respectively.
    expect(prefersMarkdown('text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8')).toBe(false)
    expect(prefersMarkdown('text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8')).toBe(false)
    expect(prefersMarkdown('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')).toBe(false)
  })

  it('leaves a caller that stated no preference on HTML', () => {
    expect(prefersMarkdown(undefined)).toBe(false)
    expect(prefersMarkdown('')).toBe(false)
    // curl's default. A wildcard is not a request for markdown.
    expect(prefersMarkdown('*/*')).toBe(false)
    expect(prefersMarkdown('text/*')).toBe(false)
  })

  it('respects a caller that ranked markdown below HTML', () => {
    expect(prefersMarkdown('text/html, text/markdown;q=0.5')).toBe(false)
    expect(prefersMarkdown('text/markdown;q=0.5, */*')).toBe(false)
    // Explicitly refused.
    expect(prefersMarkdown('text/markdown;q=0, text/html')).toBe(false)
    expect(prefersMarkdown('text/markdown;q=0')).toBe(false)
  })

  it('reads the header the way HTTP is written, not the way it is typed', () => {
    expect(prefersMarkdown('TEXT/MARKDOWN')).toBe(true)
    expect(prefersMarkdown('  text/markdown ;  q=1.0  ')).toBe(true)
    // A q nobody can parse is still a type somebody named on purpose.
    expect(prefersMarkdown('text/markdown;q=high')).toBe(true)
  })

  it('is not fooled by a type that merely contains the word', () => {
    expect(prefersMarkdown('text/markdown-ish')).toBe(false)
    expect(prefersMarkdown('application/vnd.markdown')).toBe(false)
  })
})

describe('estimateTokens', () => {
  it('never reports zero for a document with content', () => {
    expect(estimateTokens('#')).toBe(1)
    expect(estimateTokens('')).toBe(0)
  })

  it('scales with the document', () => {
    expect(estimateTokens('x'.repeat(4000))).toBe(1000)
  })
})
