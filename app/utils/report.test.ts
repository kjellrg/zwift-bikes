import { describe, expect, it } from 'vitest'
import { buildReport, formatRideLine } from './report'

describe('formatRideLine', () => {
  it('says what a route ranking was ridden as: laps, power and draft', () => {
    expect(formatRideLine({
      ride: { laps: 3 },
      rider: { powerW: 250, draftMode: 'solo', tttRiders: 4 }
    })).toBe('3 laps, 250 W, Solo')
  })

  it('names the sprint power as such, and the subject a URL cannot say', () => {
    expect(formatRideLine({
      subject: 'Sprint segment',
      ride: { power: 'sprint' },
      rider: { powerW: 800, draftMode: 'solo', tttRiders: 4 }
    })).toBe('Sprint segment, 800 W sprint power, Solo')
  })

  it('carries the two rules a race can impose, which no stored setting shows', () => {
    // Drafting barred forces the applied mode to solo (`rideDraftMode`), so
    // the line says whose decision that was rather than leaving "Solo" to
    // read as the rider's own choice.
    expect(formatRideLine({
      subject: 'Category B',
      ride: { laps: 1, ttFramesAllowed: false, draftingAllowed: false },
      rider: { powerW: 300, draftMode: 'solo', tttRiders: 4 }
    })).toBe('Category B, 1 lap, 300 W, Solo (this race bars drafting), TT frames barred')
  })

  it('spells out the team size a TTT ranking was paced by', () => {
    expect(formatRideLine({
      ride: { laps: 2 },
      rider: { powerW: 260, draftMode: 'ttt', tttRiders: 6 }
    })).toBe('2 laps, 260 W, TTT paceline (6 riders)')
  })
})

/** The prefill keys out of a built GitHub URL, so a field id can be asserted by name. */
const githubParams = (url: string) => Object.fromEntries(new URL(url).searchParams)

/** The message a mail client would open, decoded out of the `mailto:` URL. */
const mailtoBody = (url: string) => new URL(url).searchParams.get('body') ?? ''

describe('buildReport', () => {
  it('maps a data correction onto the field ids data-correction.yml declares', () => {
    const { githubUrl } = buildReport({
      kind: 'data',
      title: 'Tron is ranked too low',
      item: 'Zwift Concept Z1',
      shown: 'Ranked 40th',
      expected: 'Top five',
      source: 'https://zwiftinsider.com/tron',
      context: 'Page:     https://zwiftbikes.com/'
    })
    expect(githubParams(githubUrl)).toEqual({
      'template': 'data-correction.yml',
      'title': 'Tron is ranked too low',
      'item': 'Zwift Concept Z1',
      'shown': 'Ranked 40th',
      'expected': 'Top five',
      'source': 'https://zwiftinsider.com/tron',
      'app-context': 'Page:     https://zwiftbikes.com/'
    })
  })

  it('maps a bug onto bug.yml, and carries no field that template has no id for', () => {
    const { githubUrl } = buildReport({
      kind: 'bug',
      title: 'Filter shows nothing',
      whatHappened: 'Picked gravel, got an empty list',
      expected: 'Some gravel bikes',
      // Data-correction fields on a bug draft: dropped rather than emitted as junk.
      item: 'Alpe du Zwift',
      shown: 'Nothing',
      source: 'https://example.com',
      context: 'Build:    abc123'
    })
    expect(githubParams(githubUrl)).toEqual({
      'template': 'bug.yml',
      'title': 'Filter shows nothing',
      'what-happened': 'Picked gravel, got an empty list',
      'expected': 'Some gravel bikes',
      'app-context': 'Build:    abc123'
    })
  })

  it('titles an untitled report by its kind, so nothing is filed nameless', () => {
    expect(buildReport({ kind: 'bug', title: '   ' }).title).toBe('Bug report')
    expect(buildReport({ kind: 'data', title: '' }).title).toBe('Wrong data')
  })

  it('drops the auto-captured context before a single word the rider wrote', () => {
    const prose = 'The gravel filter is empty on every route. '.repeat(20)
    const browser = 'u'.repeat(2000)
    const report = buildReport({
      kind: 'bug',
      title: 'Gravel filter',
      whatHappened: prose,
      // Over the mailto budget on its own, comfortably inside GitHub's.
      context: `Browser:  ${browser}`
    })
    expect(report.truncated).toBe(true)
    // The rider's own words survive intact in both hand-offs...
    expect(mailtoBody(report.mailtoUrl)).toContain(prose.trim())
    expect(githubParams(report.githubUrl)['what-happened']).toBe(prose.trim())
    // ...while the block this code gathered itself is what the tighter of the
    // two budgets sheds, replaced by a pointer at "Copy report".
    expect(mailtoBody(report.mailtoUrl)).not.toContain(browser)
    expect(mailtoBody(report.mailtoUrl)).toContain('Copy report')
    // Each URL is fitted on its own budget, so the roomier one keeps it.
    expect(githubParams(report.githubUrl)['app-context']).toContain(browser)
    // The clipboard version is always the complete one.
    expect(report.plainText).toContain(browser)
  })

  it('clips the rider\'s prose only once dropping the context was not enough', () => {
    const report = buildReport({
      kind: 'bug',
      title: 'Very long report',
      whatHappened: 'w'.repeat(7000)
    })
    expect(report.truncated).toBe(true)
    // 1200 characters of prose plus the ellipsis that says it was cut.
    expect(githubParams(report.githubUrl)['what-happened']).toBe(`${'w'.repeat(1200)}...`)
    // The clipboard version is never cut - it is what the notices point at.
    expect(report.plainText).toContain('w'.repeat(7000))
  })

  it('leaves a report that fits alone, and says so', () => {
    const report = buildReport({
      kind: 'bug',
      title: 'Small one',
      whatHappened: 'It broke',
      context: 'Build:    abc123'
    })
    expect(report.truncated).toBe(false)
    expect(githubParams(report.githubUrl)['app-context']).toBe('Build:    abc123')
    expect(mailtoBody(report.mailtoUrl)).toContain('## App context\n\nBuild:    abc123')
  })
})
