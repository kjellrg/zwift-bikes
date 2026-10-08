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

  it('keeps a season page until its last race has been run, and drops it the day after', () => {
    // ZRL 2026/27's last race is Round 4 Week 6, on Tue 6 Apr 2027. The page
    // stays up, noindex, so the sitemap must not ask for it to be crawled.
    expect(locs('2027-04-06')).toContain('/events/zrl-2026-27')
    expect(locs('2027-04-07')).not.toContain('/events/zrl-2026-27')
  })

  it('keeps the pages that are neither races nor seasons, whatever the day', () => {
    const urls = locs('2027-05-01')
    expect(urls).toContain('/events')
    expect(urls).toContain('/routes/hilly-route')
    expect(urls).toContain('/segments/alpe-du-zwift')
    expect(urls.filter(loc => /^\/events\/[^/]+\/[^/]+$/.test(loc))).toEqual([])
  })

  it('lists a re-slugged route under its readable slug only, never the retired numeric one', () => {
    const urls = locs('2026-10-08')
    expect(urls).toContain('/routes/urumaze')
    expect(urls).not.toContain('/routes/4092230492')
    expect(urls.filter(loc => /^\/routes\/\d+$/.test(loc))).toEqual([])
  })

  it('dates a race by its curated entry, not by the day it is built', () => {
    const week2 = sitemapUrls('2026-09-25').find(url => url.loc === '/events/zrl-2026-27/round-1-week-2')
    // Week 2's entry was last revised on 14 Aug.
    expect(week2?.lastmod).toBe('2026-08-14')
  })
})
