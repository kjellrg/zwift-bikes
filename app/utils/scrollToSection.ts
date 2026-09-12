/**
 * Brings a section of the current page into view and focuses it, so a control
 * that reaches for one - "View TTT plan", "Show comparison" - lands a keyboard
 * user there too and not only a scrollbar. The section takes `tabindex="-1"`
 * and its own `scroll-mt`; missing ones are a no-op rather than a throw, since
 * every caller's target is conditionally rendered.
 *
 * `nextTick` first: a caller may have just made the section exist, or just
 * changed what it shows.
 */
export async function scrollToSection(id: string) {
  await nextTick()
  const section = document.getElementById(id)
  section?.scrollIntoView({ block: 'start' })
  section?.focus({ preventScroll: true })
}
