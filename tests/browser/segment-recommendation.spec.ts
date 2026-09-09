import { expect, test, type Page, type Response } from '@playwright/test'

/**
 * The segment recommendation journey (issue #203): the same
 * recommendation-first page as a route, on a climb and on a sprint, with what
 * is specific to a segment - no lap controls or route-only panels, the sprint
 * ranked at the rider's separate sprint power, the timed-segment scope in the
 * answer, host-route navigation, and the missing-data states of a segment
 * whose position on its host route is unknown. Waits are for real signals
 * (hydration, a recommend response, the results region leaving its busy
 * state), never sleeps - see `route-recommendation.spec.ts`.
 *
 * Nothing here is committed as a screenshot; Playwright keeps failure
 * artefacts under `test-results/`, which is gitignored.
 */

/** An HC climb with a measured profile and positioned surfaces, hosted by Road to Sky among others. */
const CLIMB = '/segments/alpe-du-zwift'
/** A positional sprint on a measured host, so it has a profile - and it is ranked at sprint power. */
const SPRINT = '/segments/fuego-flats'
/** A membership-only sprint: no position on any host, so no profile and a borrowed surface mix. */
const UNPLACED = '/segments/acropolis-sprint'

/** A recommend listing response - the drill-down behind the wheel list is a different question. */
const isListingResponse = (response: Response) => response.url().includes('/api/recommend/') && !response.url().includes('wheelsForFrame')

async function ready(page: Page) {
  await page.waitForFunction(() => {
    const app = (document.querySelector('#__nuxt') as unknown as { __vue_app__?: { $nuxt?: { isHydrating?: boolean } } } | null)?.__vue_app__
    return app?.$nuxt?.isHydrating === false
  })
  await expect(page.locator('#ride-results')).toHaveAttribute('aria-busy', 'false')
}

async function visit(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' })
  expect(response?.ok(), `${path} answered ${response?.status()}`).toBe(true)
  await ready(page)
}

/** Runs `action`, waits for the listing response it triggers and for the page to apply it, and hands back the request and the body. */
async function rerank(page: Page, action: () => Promise<void>) {
  const responsePromise = page.waitForResponse(isListingResponse)
  await action()
  const response = await responsePromise
  expect(response.ok()).toBe(true)
  await ready(page)
  return {
    query: new URL(response.url()).searchParams,
    data: await response.json() as { combos: { frame: { name: string }, finishTimeSec?: number }[] }
  }
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
}

const recommendation = (page: Page) => page.locator('section:has(#ride-recommendation-heading)')
const briefing = (page: Page) => page.getByRole('region', { name: 'Ride briefing' })
const answer = (page: Page) => page.locator('section:has(#ride-answer-heading)')
const finishTime = (page: Page) => recommendation(page).locator('p.tabular-nums').first()
const riderStrip = (page: Page) => page.getByRole('group', { name: 'Rider' })

const normalise = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The FAQ answer in the page's JSON-LD, or undefined when there is none. */
async function structuredAnswer(page: Page) {
  return page.evaluate(() => {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      const schema = JSON.parse(script.textContent ?? '{}')
      if (schema['@type'] === 'FAQPage') return schema.mainEntity[0].acceptedAnswer.text as string
    }
    return undefined
  })
}

test.describe('segment recommendation', () => {
  test('lays a climb out like a route, without lap controls or route-only panels, and links its host routes', async ({ page, isMobile }) => {
    await visit(page, CLIMB)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Alpe du Zwift')
    await expect(recommendation(page)).toBeVisible()
    await expect(briefing(page)).toBeVisible()
    await expect(finishTime(page)).toHaveText(/^\d+:\d\d(:\d\d)?$/)

    const pick = await recommendation(page).boundingBox()
    const brief = await briefing(page).boundingBox()
    const answerBox = await answer(page).boundingBox()
    expect(pick && brief && answerBox).toBeTruthy()
    if (isMobile) {
      // Recommendation first in source order (a screen reader's order) and above the briefing.
      expect(await page.evaluate(() => {
        const rec = document.querySelector('#ride-recommendation-heading')!
        const brief = document.querySelector('#ride-briefing-heading')!
        return Boolean(rec.compareDocumentPosition(brief) & Node.DOCUMENT_POSITION_FOLLOWING)
      })).toBe(true)
      expect(pick!.y + pick!.height).toBeLessThanOrEqual(brief!.y + 1)
    } else {
      expect(pick!.x).toBeGreaterThanOrEqual(brief!.x + brief!.width - 1)
      expect(pick!.width).toBeGreaterThan(brief!.width)
    }
    expect(answerBox!.y).toBeGreaterThanOrEqual(Math.max(pick!.y + pick!.height, brief!.y + brief!.height) - 1)

    // A segment is ridden once: nothing on the page picks laps, and the
    // route-only occurrence lists have no place on it.
    await expect(page.getByRole('button', { name: 'Laps' })).toHaveCount(0)
    await expect(page.getByText(/Climbs on this route|Sprints on this route/)).toHaveCount(0)

    await expect(briefing(page)).toContainText('Climbing segment')
    await expect(briefing(page)).toContainText('Measured elevation profile')
    await expect(briefing(page)).toContainText('Also appears on')
    await expect(briefing(page).getByRole('link', { name: 'Road to Sky' })).toHaveAttribute('href', '/routes/road-to-sky')
    await expect(page.getByRole('link', { name: 'All segments' })).toHaveAttribute('href', '/segments')
    await expectNoHorizontalOverflow(page)
  })

  test('renders the same segment answer for riders and crawlers, from the server, with the host links', async ({ page, request }) => {
    await visit(page, CLIMB)
    const visible = normalise(await answer(page).locator('p').allInnerTexts().then(lines => lines.join(' ')))
    expect(visible).toMatch(/^Our model puts .+ fastest within the current filters for the Alpe du Zwift climb in Watopia: \d+:\d\d/)
    expect(visible).toContain('the timed segment, excluding warm-up')
    expect(normalise((await structuredAnswer(page)) ?? '')).toBe(visible)

    // The prerendered HTML, not the hydrated page: what a crawler gets.
    const html = await (await request.get(CLIMB)).text()
    const served = await page.evaluate((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      return {
        heading: doc.querySelector('h1')?.textContent?.trim(),
        answer: doc.querySelector('#ride-answer-heading + p')?.textContent,
        canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute('href'),
        hostLinks: [...doc.querySelectorAll('a[href^="/routes/"]')].map(link => link.getAttribute('href')),
        faq: [...doc.querySelectorAll('script[type="application/ld+json"]')]
          .map(script => JSON.parse(script.textContent ?? '{}'))
          .find(schema => schema['@type'] === 'FAQPage')?.mainEntity[0].acceptedAnswer.text as string | undefined
      }
    }, html)
    expect(served.heading).toBe('Alpe du Zwift')
    expect(served.answer).toMatch(/^Our model puts /)
    expect(served.faq).toMatch(/^Our model puts /)
    expect(served.canonical).toMatch(/\/segments\/alpe-du-zwift$/)
    expect(served.hostLinks).toContain('/routes/road-to-sky')
  })

  for (const [kind, path, expectSprint] of [['sprint', SPRINT, true], ['climb', CLIMB, false]] as const) {
    test(`ranks a ${kind} at the power the rider strip shows, once, with no lap count in the request`, async ({ page }) => {
      await visit(page, path)
      const strip = riderStrip(page)
      const powerLine = await strip.getByText(/^\d+ W/).innerText()
      const shownPowerW = Number.parseInt(powerLine)
      expect(shownPowerW).toBeGreaterThan(0)
      // A sprint is ridden at the rider's separate sprint power, and the strip says so.
      expect(powerLine.includes('sprint')).toBe(expectSprint)

      // A filter toggle refetches the same ride, which makes the request observable.
      const { query, data } = await rerank(page, () => page.getByRole('switch', { name: 'Include Halo bikes' }).click())
      expect(Number(query.get('powerW'))).toBe(shownPowerW)
      expect(query.has('laps')).toBe(false)
      expect(data.combos[0]?.finishTimeSec).toBeDefined()
      await expect(finishTime(page)).toHaveText(formatDuration(data.combos[0]!.finishTimeSec!))
      await expect(answer(page)).toContainText(`${shownPowerW} W`)
      await expect(answer(page)).toContainText('the timed segment, excluding warm-up')
    })
  }

  test('discloses an unplaced segment\'s missing position beside the time and in the briefing, and keeps the ride navigable', async ({ page }) => {
    await visit(page, UNPLACED)
    await expect(finishTime(page)).toHaveText(/^\d+:\d\d$/)
    await expect(recommendation(page)).toContainText('Limited route data: elevation and surface locations unavailable.')
    await expect(briefing(page)).toContainText('Sprint segment')
    await expect(briefing(page)).toContainText('Elevation profile unavailable')
    await expect(briefing(page)).toContainText('The exact position of this segment along its host routes isn\'t in our route data')
    await expect(briefing(page).getByRole('link', { name: 'Sugar Cookie' })).toHaveAttribute('href', '/routes/sugar-cookie')
    // Nothing to chart without a profile; the borrowed surface mix still shows, as a mix.
    await expect(page.getByLabel('Elevation profile chart')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Surface' })).toBeVisible()
  })

  test('answers an unknown segment with a 404, not an empty page', async ({ page, request, isMobile }) => {
    test.skip(isMobile, 'the status code is the same on every viewport')
    expect((await request.get('/segments/not-a-segment')).status()).toBe(404)
    const response = await page.goto('/segments/not-a-segment', { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('link', { name: 'All segments' })).toHaveCount(0)
  })
})

/** `formatDuration` as the pages render it - kept in step by the assertion above, not imported, so the spec stays free of app modules. */
function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`
}
