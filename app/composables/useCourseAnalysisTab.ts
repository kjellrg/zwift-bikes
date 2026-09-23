export type CourseAnalysisTab = 'segments' | 'scoring' | 'speed' | 'surface' | 'plan'

/** The `id` of the course section, for the Fact row's "View TTT plan" action and for scrolling to it. */
export const COURSE_ANALYSIS_ID = 'course-analysis'

/**
 * Which course-analysis tab is showing. Page memory, not a Shared view: a
 * tab is not part of what a link carries, so it never touches the URL, and
 * it never persists. It survives a lap refresh, the bike drawer opening and
 * closing, and a navigation from one ride to another (a page-local ref would
 * not survive a route -> segment -> route trip), and `RideCourseAnalysis`
 * shows its first tab whenever the selected one leaves the tab set - the TTT
 * plan when draft mode leaves ttt, the climbs on a segment page - without
 * writing that fallback back here, so the trip keeps the rider's own tab.
 */
export function useCourseAnalysisTab() {
  const selected = useState<CourseAnalysisTab>('course-analysis-tab', () => 'segments')

  /** Selects a tab and goes to the section showing it. */
  async function show(tab: CourseAnalysisTab) {
    selected.value = tab
    await scrollToSection(COURSE_ANALYSIS_ID)
  }

  return { selected, show }
}
