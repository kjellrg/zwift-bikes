export type CourseAnalysisTab = 'elevation' | 'segments' | 'speed' | 'surface' | 'plan'

/** The `id` of the course-analysis section, for the briefing's "View TTT plan" action and for scrolling to it. */
export const COURSE_ANALYSIS_ID = 'course-analysis'

/**
 * Which course-analysis tab is showing. Page memory, not a Shared view: a
 * tab is not part of what a link carries, so it never touches the URL, and
 * it never persists. It survives a lap refresh, the bike drawer opening and
 * closing, and a navigation from one ride to another (a page-local ref would
 * not survive a route -> segment -> route trip), and `RideCourseAnalysis`
 * falls back to Elevation whenever the selected tab leaves the tab set - the
 * TTT plan when draft mode leaves ttt, the speed chart on a sprint page.
 */
export function useCourseAnalysisTab() {
  const selected = useState<CourseAnalysisTab>('course-analysis-tab', () => 'elevation')

  /** Selects a tab and goes to the section showing it. */
  async function show(tab: CourseAnalysisTab) {
    selected.value = tab
    await scrollToSection(COURSE_ANALYSIS_ID)
  }

  return { selected, show }
}
