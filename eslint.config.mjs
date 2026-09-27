// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  // A page gets its Ranking results from `useRankingPage` and renders them
  // with `RankingPageBody` (see **Ranking page** in CONTEXT.md). The route,
  // segment and race pages used to wire the composables it wraps by hand, so
  // every Ranking results change landed three times; a page calling one of
  // them directly is how that would start again. No exemptions: every
  // ranking page is on the module (#285-#287).
  {
    files: ['app/pages/**/*.vue'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: 'CallExpression[callee.name=/^(useRecommendRequest|useTttPlan|useComparison|useRecommendationAnswer)$/]',
        message: 'A page gets its Ranking results from useRankingPage, never from useRecommendRequest, useTttPlan, useComparison or useRecommendationAnswer directly - give the module an input instead (see **Ranking page** in CONTEXT.md).'
      }]
    }
  }
)
