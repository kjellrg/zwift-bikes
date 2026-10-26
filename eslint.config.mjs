// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

// Routes, segments and their streams come from `getRoutes()`, `getSegments()`
// (shared/data/catalogSources.ts) and `getStreams()` (scripts/supplement/streams.mjs),
// which add the supplement's entries to the package's. An import straight from
// `zwift-data` would quietly miss them. Frames and wheels have their own merge
// points, `getFrames()` and `getWheelsets()`.
const CATALOG_SOURCE_PATHS = [
  {
    name: 'zwift-data',
    importNames: ['routes', 'segments'],
    allowTypeImports: true,
    message: 'Read routes and segments through getRoutes() / getSegments() in shared/data/catalogSources.ts, so supplemented entries are included.'
  },
  {
    name: 'zwift-data/streams',
    message: 'Read streams through getStreams() in scripts/supplement/streams.mjs, so supplemented tracks are included.'
  }
]
const EQUIPMENT_SOURCE_PATH = {
  name: 'zwift-data',
  importNames: ['bikeFrames', 'bikeFrontWheels', 'bikeRearWheels'],
  allowTypeImports: true,
  message: 'Read frames and wheels through getFrames() / getWheelsets(), so supplemented equipment is included. A script that compares the raw package on purpose says why in an eslint-disable comment.'
}

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
  },
  {
    files: ['**/*.{ts,mjs,vue}'],
    ignores: [
      '**/*.test.*',
      'shared/data/catalogSources.ts',
      'scripts/supplement/**',
      'shared/utils/catalog.ts',
      'shared/utils/wheelsets.ts'
    ],
    rules: { 'no-restricted-imports': ['error', { paths: [...CATALOG_SOURCE_PATHS, EQUIPMENT_SOURCE_PATH] }] }
  },
  {
    files: ['shared/utils/catalog.ts', 'shared/utils/wheelsets.ts'],
    rules: { 'no-restricted-imports': ['error', { paths: CATALOG_SOURCE_PATHS }] }
  }
)
