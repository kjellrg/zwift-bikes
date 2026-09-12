import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { hydrated, visit, visitPage } from './support'

/**
 * The accessibility gate (issue #218): axe-core over one page of every kind
 * the site serves and over the five Overlays, in both Colour modes, on both
 * projects. It asks the WCAG 2.0 A/AA and 2.1 AA rules only - no
 * best-practice rules, which are opinions rather than the standard the
 * gate promised - and it holds the page to a smaller bar than "no
 * findings": a critical or serious violation fails the test outright, a
 * moderate or minor one is recorded (an annotation on the test, a line on
 * stderr) for the maintainer to weigh at the gate. That split is the plan's:
 * the serious ones are fixed without asking, the rest are listed as
 * unresolved on the ticket.
 *
 * Every target is scanned dark first, because dark is the Colour mode a
 * first visit gets, then light through the header's own toggle - the
 * contrast rules are the ones a palette change can break, and they answer
 * differently per mode. The not-found page has no header, so it takes its
 * light mode from storage instead. The journeys behind each opener live in
 * the other specs; this one only needs the Overlay open.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa']
/** axe's impact levels that fail the test; the other two (`moderate`, `minor`) are reported. */
const BLOCKING = new Set(['critical', 'serious'])

const ROUTE = '/routes/hilly-route'

/**
 * One page per kind. The shell has no page of its own: its header, footer
 * and skip link are in every document below, so every scan covers it, and
 * the mobile menu gets its own test. A `ranking` page is opened with the
 * wait for its results.
 */
const PAGES: { kind: string, path: string, ranking?: boolean }[] = [
  { kind: 'home', path: '/' },
  { kind: 'segments hub', path: '/segments' },
  { kind: 'route', path: ROUTE, ranking: true },
  { kind: 'climb segment', path: '/segments/alpe-du-zwift', ranking: true },
  { kind: 'sprint segment', path: '/segments/fuego-flats', ranking: true },
  { kind: 'events hub', path: '/events' },
  { kind: 'season', path: '/events/zrl-2026-27' },
  { kind: 'race', path: '/events/zrl-2026-27/round-1-week-1', ranking: true },
  { kind: 'profile page', path: '/profile' },
  { kind: 'garage page', path: '/garage' },
  { kind: 'about page', path: '/about' },
  { kind: 'report page', path: '/report' }
]

const header = (page: Page) => page.getByRole('banner')
const menuToggle = (page: Page) => header(page).getByRole('button', { name: 'Open menu' })
const menu = (page: Page) => page.getByRole('dialog').filter({ has: page.getByRole('link', { name: 'Routes', exact: true }) })

/** The Overlays, each opened from the route page where every opener exists, and the dialog that proves it is up. */
const OVERLAYS: { kind: string, dialog: (page: Page) => Locator, opener: (page: Page, isMobile: boolean) => Promise<void> }[] = [
  {
    kind: 'profile overlay',
    dialog: page => page.getByRole('dialog', { name: 'My Profile' }),
    // A fresh context has no stored profile, so the rider strip offers to set one.
    opener: page => page.getByRole('link', { name: 'Set your profile' }).click()
  },
  {
    kind: 'garage overlay',
    dialog: page => page.getByRole('dialog', { name: 'My Garage' }),
    opener: page => page.getByRole('link', { name: 'Edit garage' }).click()
  },
  {
    kind: 'about overlay',
    dialog: page => page.getByRole('dialog', { name: 'About ZwiftBikes' }),
    opener: async (page, isMobile) => {
      if (isMobile) {
        await menuToggle(page).click()
        await expect(menu(page)).toBeVisible()
        await menu(page).getByRole('link', { name: 'About', exact: true }).click()
        return
      }
      await header(page).getByRole('link', { name: 'About', exact: true }).click()
    }
  },
  {
    kind: 'report overlay',
    dialog: page => page.getByRole('dialog', { name: 'Report an issue' }),
    opener: page => page.getByRole('contentinfo').getByRole('link', { name: 'Report an issue' }).click()
  },
  {
    kind: 'equipment drawer',
    // The drawer is named after the bike, so it is the dialog with a finish
    // estimate in it - the term `equipment-drawer.spec.ts` reads too.
    dialog: page => page.getByRole('dialog').filter({ has: page.getByRole('term').filter({ hasText: 'Est. finish time' }) }),
    opener: page => page.getByRole('button', { name: /^Details for / }).first().click()
  }
]

interface Finding {
  rule: string
  impact: string
  help: string
  nodes: number
  example: string
}

const describeFinding = (finding: Finding) =>
  `${finding.rule} [${finding.impact}] ${finding.help} - ${finding.nodes} node${finding.nodes === 1 ? '' : 's'}, e.g. ${finding.example}`

/**
 * Runs axe over the current document and applies the gate's split: blocking
 * impacts fail here, the rest are annotated and printed. `label` names the
 * target and the Colour mode, so a finding can be placed without the trace.
 */
async function audit(page: Page, label: string) {
  // The dev server's devtools widget and its error overlay are not part of
  // the site: axe would otherwise report their contrast and nesting.
  const results = await new AxeBuilder({ page }).withTags(TAGS).exclude('nuxt-devtools-frame').exclude('nuxt-error-overlay').analyze()
  const findings: Finding[] = results.violations.map(violation => ({
    rule: violation.id,
    impact: violation.impact ?? 'unknown',
    help: violation.help,
    nodes: violation.nodes.length,
    example: violation.nodes[0]?.target.join(' ') ?? ''
  }))
  for (const finding of findings.filter(finding => !BLOCKING.has(finding.impact))) {
    const line = `${label}: ${describeFinding(finding)}`
    test.info().annotations.push({ type: `axe ${finding.impact}`, description: line })
    console.warn(`[axe] ${line}`)
  }
  const blocking = findings.filter(finding => BLOCKING.has(finding.impact))
  expect(blocking.map(describeFinding), `${label}: blocking accessibility violations`).toEqual([])
}

async function switchToLight(page: Page) {
  await header(page).getByRole('button', { name: 'Switch to light mode' }).click()
  await expect(page.locator('html')).toHaveClass(/\blight\b/)
}

test.describe('accessibility', () => {
  for (const { kind, path, ranking } of PAGES) {
    test(`${kind} has no blocking violations in either Colour mode`, async ({ page }) => {
      await (ranking ? visit : visitPage)(page, path)
      await expect(page.locator('html')).toHaveClass(/\bdark\b/)
      await audit(page, `${kind} (dark)`)
      await switchToLight(page)
      await audit(page, `${kind} (light)`)
    })
  }

  for (const { kind, dialog, opener } of OVERLAYS) {
    test(`${kind} has no blocking violations in either Colour mode`, async ({ page, isMobile }) => {
      const overlay = dialog(page)
      await visit(page, ROUTE)
      await opener(page, isMobile)
      await expect(overlay).toBeVisible()
      await audit(page, `${kind} (dark)`)

      // The header sits behind the Overlay, so the mode is switched between
      // the two openings rather than through it.
      await page.keyboard.press('Escape')
      await expect(overlay).toHaveCount(0)
      await switchToLight(page)
      await opener(page, isMobile)
      await expect(overlay).toBeVisible()
      await audit(page, `${kind} (light)`)
    })
  }

  test('the mobile menu has no blocking violations in either Colour mode', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the menu only exists on mobile')
    await visit(page, ROUTE)
    await menuToggle(page).click()
    await expect(menu(page)).toBeVisible()
    await audit(page, 'mobile menu (dark)')
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)
    await switchToLight(page)
    await menuToggle(page).click()
    await expect(menu(page)).toBeVisible()
    await audit(page, 'mobile menu (light)')
  })

  test('the not-found page has no blocking violations in either Colour mode', async ({ page }) => {
    const path = '/segments/not-a-segment'
    const response = await page.goto(path, { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBe(404)
    await hydrated(page)
    await audit(page, 'not found (dark)')

    // No header on the error page, so light mode comes from the stored
    // preference the toggle would have written.
    await page.evaluate(() => localStorage.setItem('nuxt-color-mode', 'light'))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await hydrated(page)
    await expect(page.locator('html')).toHaveClass(/\blight\b/)
    await audit(page, 'not found (light)')
  })
})
