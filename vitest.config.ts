import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests are colocated with the code they cover (`*.test.ts`, plus
// `*.test.mjs` next to the plain-ESM build scripts under `scripts/`), which
// the existing project tsconfigs already typecheck. No Nuxt environment on
// purpose: everything under test is framework-free shared/server logic, and
// keeping the suite plain-node keeps it fast enough for the pre-commit hook.
export default defineConfig({
  // The `app/` modules under test import shared VALUES through Nuxt's
  // `#shared` alias, which is what survives Nitro's prerender bundling - a
  // relative `../../shared/...` import from app code resolves in dev and then
  // fails the build. Nothing teaches a plain-node runner that alias, so it is
  // mapped here.
  resolve: {
    alias: { '#shared': fileURLToPath(new URL('./shared', import.meta.url)) }
  },
  test: {
    environment: 'node',
    include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'app/**/*.test.ts', 'scripts/**/*.test.mjs']
  }
})
