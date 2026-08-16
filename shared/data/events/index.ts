import zrl202627 from './zrl-2026-27.json'
import zracing2026 from './zracing-2026.json'

/**
 * Registry of every hand-curated season file. Explicit static imports, no
 * globbing - Nuxt/Vite (and jiti, for the `nuxt.config.ts` import) handle
 * JSON imports natively, and an explicit list keeps "which seasons exist" a
 * one-line diff.
 *
 * Deliberately untyped-as-data here: `shared/utils/events.ts` is the only
 * consumer, and it runs the whole array through the zod schema once at
 * module init - a season file that doesn't conform fails the build with a
 * path-precise message, which is the actual type guarantee. Nothing else
 * should import this module.
 */
export const seasonData: unknown[] = [zrl202627, zracing2026]
