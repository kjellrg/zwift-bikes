import { describe, expect, it } from 'vitest'
import { sitemapUrls } from './sitemapUrls'

/**
 * The sitemap's race pages on a given day (issue #277), against the curated
 * calendars: a run race keeps its page but leaves the sitemap, and a race
 * still to run stays in it. The same rule as the prerender list
 * (`getIndexedRaces`, tested in `shared/utils/events.test.ts`); this is the
 * seam the sitemap itself reads.
 */
describe('the sitemap on a given day', () => {
  const locs = (today: string) => sitemapUrls(today).map(url => url.loc)

  it('leaves out a race that has been run and keeps one still to run', () => {
    // ZRL Round 1 Week 1 was raced on Tue 22 Sept, week 2 is on Tue 29 Sept.
    expect(locs('2026-09-25')).not.toContain('/events/zrl-2026-27/round-1-week-1')
    expect(locs('2026-09-25')).toContain('/events/zrl-2026-27/round-1-week-2')
  })

  it('keeps a race through its own day, and drops it the day after', () => {
    expect(locs('2026-09-29')).toContain('/events/zrl-2026-27/round-1-week-2')
    expect(locs('2026-09-30')).not.toContain('/events/zrl-2026-27/round-1-week-2')
  })

  it('keeps the pages that are not races, whatever the day', () => {
    const urls = locs('2027-05-01')
    expect(urls).toContain('/events')
    expect(urls).toContain('/events/zrl-2026-27')
    expect(urls).toContain('/routes/hilly-route')
    expect(urls).toContain('/segments/alpe-du-zwift')
    expect(urls.filter(loc => /^\/events\/[^/]+\/[^/]+$/.test(loc))).toEqual([])
  })

  it('dates a race by its curated entry, not by the day it is built', () => {
    const week2 = sitemapUrls('2026-09-25').find(url => url.loc === '/events/zrl-2026-27/round-1-week-2')
    // Week 2's entry was last revised on 14 Aug.
    expect(week2?.lastmod).toBe('2026-08-14')
  })
})
