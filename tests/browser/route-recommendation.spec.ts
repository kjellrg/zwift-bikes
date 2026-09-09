import { expect, test, type Page, type Response } from '@playwright/test'

/**
 * The route recommendation journey (issue #202): the recommendation-first
 * hierarchy on desktop and mobile in both themes, real results through the
 * page's own request, lap-aware totals, alternatives, comparison, the wheel
 * drill-down, catalog-wide search, basic keyboard access, and the
 * server-rendered answer a crawler reads. Every wait is for a real signal -
 * hydration, a recommend response, the results region leaving its busy
 * state - never a sleep, because a cold dev-server request takes ~20 s and
 * a warm one ~5 s.
 *
 * Nothing here is committed as a screenshot; Playwright keeps failure
 * artefacts under `test-results/`, which is gitignored.
 */

const ROUTE = '/routes/hilly-route'

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

/** Runs `action`, waits for the listing response it triggers and for the page to apply it, and hands back the response body. */
async function rerank(page: Page, action: () => Promise<void>) {
  const responsePromise = page.waitForResponse(isListingResponse)
  await action()
  const response = await responsePromise
  expect(response.ok()).toBe(true)
  await ready(page)
  return response.json() as Promise<{ combos: { frame: { name: string }, finishTimeSec?: number }[] }>
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
}

const recommendation = (page: Page) => page.locator('section:has(#ride-recommendation-heading)')
const briefing = (page: Page) => page.getByRole('region', { name: 'Ride briefing' })
const answer = (page: Page) => page.locator('section:has(#ride-answer-heading)')
const finishTime = (page: Page) => recommendation(page).locator('p.tabular-nums').first()
const rows = (page: Page) => page.getByRole('list', { name: 'Ranked setups' }).getByRole('listitem')

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

test.describe('route recommendation', () => {
  test('puts the recommendation beside the briefing on desktop and first on mobile, with the answer beneath both', async ({ page, isMobile }) => {
    await visit(page, ROUTE)
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
      // The whole pair fits well inside a screen: the answer's move out of the column was the point.
      expect(Math.max(pick!.height, brief!.height)).toBeLessThan(700)
    }
    expect(answerBox!.y).toBeGreaterThanOrEqual(Math.max(pick!.y + pick!.height, brief!.y + brief!.height) - 1)
    await expectNoHorizontalOverflow(page)
  })

  test('renders the same answer for riders and crawlers, from the server', async ({ page, request }) => {
    await visit(page, ROUTE)
    const visible = normalise(await answer(page).locator('p').allInnerTexts().then(lines => lines.join(' ')))
    expect(visible).toMatch(/^Our model puts .+ fastest within the current filters for Watopia Hilly Route in Watopia: \d+:\d\d/)
    expect(normalise((await structuredAnswer(page)) ?? '')).toBe(visible)

    // The prerendered HTML, not the hydrated page: what a crawler gets.
    const html = await (await request.get(ROUTE)).text()
    const served = await page.evaluate((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      return {
        heading: doc.querySelector('h1')?.textContent?.trim(),
        answer: doc.querySelector('#ride-answer-heading + p')?.textContent,
        canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute('href'),
        segmentLinks: [...doc.querySelectorAll('a[href^="/segments/"]')].map(link => link.getAttribute('href')),
        faq: [...doc.querySelectorAll('script[type="application/ld+json"]')]
          .map(script => JSON.parse(script.textContent ?? '{}'))
          .find(schema => schema['@type'] === 'FAQPage')?.mainEntity[0].acceptedAnswer.text as string | undefined
      }
    }, html)
    expect(served.heading).toBe('Watopia Hilly Route')
    expect(served.answer).toMatch(/^Our model puts /)
    expect(served.faq).toMatch(/^Our model puts /)
    expect(served.canonical).toMatch(/\/routes\/hilly-route$/)
    expect(served.segmentLinks).toContain('/segments/zwift-kom')
  })

  test('recomputes totals, the time and the answer for a second lap, and carries it in the URL', async ({ page }) => {
    await visit(page, ROUTE)
    const distanceBefore = Number.parseFloat(await page.getByText('Total distance').locator('..').locator('dd').innerText())
    const timeBefore = await finishTime(page).innerText()

    const data = await rerank(page, async () => {
      // The lap picker is a `USelectMenu`: its trigger is a button carrying the label.
      await page.getByRole('button', { name: 'Laps' }).click()
      await page.getByRole('option', { name: '2 laps', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Laps' })).toHaveText('2 laps')
    })
    const distanceAfter = Number.parseFloat(await page.getByText('Total distance').locator('..').locator('dd').innerText())
    // One more lap of 9.2 km on top of the lead-in: more than 1.9x the single-lap total, less than 2x.
    expect(distanceAfter).toBeGreaterThan(distanceBefore * 1.9)
    expect(distanceAfter).toBeLessThan(distanceBefore * 2)
    await expect(finishTime(page)).not.toHaveText(timeBefore)
    expect(data.combos[0]?.finishTimeSec).toBeDefined()
    await expect(finishTime(page)).toHaveText(formatDuration(data.combos[0]!.finishTimeSec!))
    await expect(answer(page)).toContainText('2 laps, including any lead-in once')
    expect(new URL(page.url()).searchParams.get('laps')).toBe('2')
    await expect(briefing(page)).toContainText('2 laps')
  })

  test('compares up to three setups side by side', async ({ page }) => {
    await visit(page, ROUTE)
    expect(await rows(page).count()).toBeGreaterThanOrEqual(4)
    for (const index of [0, 1, 2]) await rows(page).nth(index).getByRole('checkbox').check()
    await expect(rows(page).nth(3).getByRole('checkbox')).toBeDisabled()

    const comparison = page.getByRole('region', { name: /Selected setups/ })
    await expect(comparison.getByRole('article')).toHaveCount(3)
    await expect(comparison.getByRole('article').first()).toContainText('Fastest in results')
    await expect(comparison.getByRole('article').nth(1)).toContainText(/\+\d+\.\d\ds|\+\d+:\d\d/)

    await comparison.getByRole('button', { name: /Remove .* from comparison/ }).first().click()
    await expect(comparison.getByRole('article')).toHaveCount(2)
    await expect(rows(page).nth(3).getByRole('checkbox')).toBeEnabled()
    await comparison.getByRole('button', { name: 'Clear comparison' }).click()
    await expect(comparison).toHaveCount(0)
  })

  test('opens the details drawer from the keyboard and returns focus to the name', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard access is a desktop journey')
    await visit(page, ROUTE)
    const name = recommendation(page).getByRole('button', { name: /^Details for / }).first()
    // Read before opening: a modal dialog hides the rest of the page from the accessibility tree.
    const frameName = await name.innerText()
    await name.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(frameName)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(name).toBeFocused()
    // The next stop is the recommendation's own next control (which one depends on whether a
    // fastest-overall reveal is showing), never something off in the header or the list below.
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.querySelector('section:has(#ride-recommendation-heading)')?.contains(document.activeElement))).toBe(true)
  })

  test('loads the frame\'s wheel alternatives on demand with the frame\'s own fastest as the baseline', async ({ page }) => {
    await visit(page, ROUTE)
    const wheelsResponse = page.waitForResponse(response => response.url().includes('wheelsForFrame'))
    await recommendation(page).getByRole('button', { name: /^Wheel alternatives/ }).click()
    expect((await wheelsResponse).ok()).toBe(true)
    const list = recommendation(page).locator('[aria-busy]')
    await expect(list).toHaveAttribute('aria-busy', 'false')
    await expect(list).toContainText('Gaps are against the fastest wheels for this frame')
    await expect(list.getByText('picked')).toBeVisible()
    expect(await list.locator('span.tabular-nums').count()).toBeGreaterThan(1)
  })

  test('shows more matches from the same ranking', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers pagination')
    await visit(page, ROUTE)
    const before = await rows(page).count()
    const nextPage = page.waitForResponse(response => isListingResponse(response) && response.url().includes('offset='))
    await page.getByRole('button', { name: 'Show more matches' }).click()
    expect((await nextPage).ok()).toBe(true)
    await expect.poll(() => rows(page).count()).toBeGreaterThan(before)
  })

  test('search reaches a Halo bike the default filter hides, and clearing it restores the ranking', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers search')
    await visit(page, ROUTE)
    await expect(rows(page).first()).not.toContainText('PROJECT 74')
    const found = await rerank(page, () => page.getByRole('textbox', { name: 'Search all frames and wheels' }).fill('PROJECT 74'))
    expect(found.combos[0]?.frame.name).toContain('PROJECT 74')
    await expect(rows(page).first()).toContainText('PROJECT 74')
    await expect(answer(page)).toContainText('Halo bikes included; search: PROJECT 74')
    expect(new URL(page.url()).searchParams.get('bike')).toBe('PROJECT 74')

    await rerank(page, () => page.getByRole('button', { name: 'Clear search' }).click())
    await expect(rows(page).first()).not.toContainText('PROJECT 74')
    await expect(answer(page)).toContainText('unowned Halo bikes excluded')
  })

  test('keeps a long route name and the dark theme within the viewport', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('nuxt-color-mode', 'dark'))
    await visit(page, '/routes/2022-cycling-esports-world-championships-route')
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('2022 Cycling Esports World Championships Route')
    await expect(finishTime(page)).toHaveText(/^\d+:\d\d(:\d\d)?$/)
    await expectNoHorizontalOverflow(page)
    await page.getByRole('list', { name: 'Ranked setups' }).scrollIntoViewIfNeeded()
    await expectNoHorizontalOverflow(page)
  })

  test('discloses missing course data beside the time and in the briefing', async ({ page }) => {
    await visit(page, '/routes/flat-route-rev')
    await expect(recommendation(page)).toContainText('Limited route data: elevation and surface locations unavailable.')
    await expect(briefing(page)).toContainText('Elevation profile unavailable')
    await expect(briefing(page)).toContainText('road assumed by model')
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
