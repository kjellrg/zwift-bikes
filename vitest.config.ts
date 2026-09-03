import { defineConfig } from 'vitest/config'

// Unit tests are colocated with the code they cover (`*.test.ts`, plus
// `*.test.mjs` next to the plain-ESM build scripts under `scripts/`), which
// the existing project tsconfigs already typecheck. No Nuxt environment on
// purpose: everything under test is framework-free shared/server logic, and
// keeping the suite plain-node keeps it fast enough for the pre-commit hook.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'app/**/*.test.ts', 'scripts/**/*.test.mjs']
  }
})
