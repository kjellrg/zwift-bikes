// Fails the build when a client chunk carries data that belongs on the server.
//
// Runs after `nuxt build` (see the `build` script in package.json). Two
// payloads have leaked into the browser bundle before, through nothing more
// than a page auto-importing a `shared/utils` helper whose import chain
// reached them (issue #151: 1.77 MB, 344 KB gzipped, on every route page):
//
//   - shared/data/routeSurfaces.generated.json (~2 MB of measured surface
//     segments and elevation profiles), reachable from `shared/data/routeSurfaces.ts`,
//     `shared/utils/routeTerrain.ts`, `shared/utils/routeClimbs.ts` and
//     `shared/utils/catalog.ts`;
//   - zwift-data's full route catalog, reachable from `shared/utils/catalog.ts`
//     and `shared/utils/routeSegments.ts`.
//
// Nuxt auto-imports every export of `shared/utils/*.ts` into every `.vue`
// file, so a single bare call to e.g. `getRoutesWithMeta()` in a component
// re-creates the leak with no import statement to review. The markers below
// are property names that only occur inside those payloads; each was
// verified present (13 and 313 hits) in the leaked chunk before the fix and
// absent from every chunk after it. The size ceiling is the coarse backstop
// for anything the markers don't name: the largest legitimate chunk is
// ~360 KB (Nuxt UI + the elevation chart), so 512 KB leaves headroom for
// ordinary growth while still catching a whole catalog.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chunkDir = path.join(repoRoot, '.output/public/_nuxt')

const MARKERS = [
  { text: 'traceCoveredLeadIn', payload: 'shared/data/routeSurfaces.generated.json' },
  { text: 'stravaSegmentId', payload: 'the zwift-data route catalog' }
]
const MAX_CHUNK_BYTES = 512 * 1024

let chunks
try {
  chunks = readdirSync(chunkDir).filter(name => name.endsWith('.js'))
} catch {
  console.error(`${path.relative(repoRoot, chunkDir)} does not exist - run \`nuxt build\` first.`)
  process.exit(1)
}

const failures = []
const sizes = []
for (const name of chunks) {
  const file = path.join(chunkDir, name)
  const bytes = statSync(file).size
  sizes.push({ name, bytes })
  if (bytes > MAX_CHUNK_BYTES) {
    failures.push(`${name} is ${(bytes / 1024).toFixed(0)} KB, over the ${MAX_CHUNK_BYTES / 1024} KB ceiling`)
  }
  const source = readFileSync(file, 'utf8')
  for (const marker of MARKERS) {
    if (source.includes(marker.text)) {
      failures.push(`${name} contains "${marker.text}" - ${marker.payload} is in the client bundle`)
    }
  }
}

sizes.sort((a, b) => b.bytes - a.bytes)
console.log(`Client chunks: ${chunks.length}, largest five:`)
for (const { name, bytes } of sizes.slice(0, 5)) console.log(`  ${(bytes / 1024).toFixed(0).padStart(5)} KB  ${name}`)

if (failures.length) {
  console.error('\nClient bundle check failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  console.error('\nA shared/utils import chain is reaching server-only data - see the header of scripts/check-client-bundle.mjs and shared/utils/routeOccurrences.ts.')
  process.exit(1)
}
console.log('Client bundle check passed.')
