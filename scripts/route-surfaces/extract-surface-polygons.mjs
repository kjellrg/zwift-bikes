#!/usr/bin/env node
// Regenerates shared/data/zwiftmapSurfacePolygons.json from a local clone of
// zwiftmap (https://github.com/andipaetzold/zwiftmap, MIT licensed - see
// /THIRD_PARTY_NOTICES.md). zwiftmap's `worldConfigs/*.ts` files contain
// hand-mapped surface polygons (which lat/lng regions of each Zwift world
// are gravel/cobbles/wood/etc, vs. the tarmac default) - this pulls out just
// that polygon data, with no other zwiftmap code copied.
//
// Usage:
//   git clone https://github.com/andipaetzold/zwiftmap.git /tmp/zwiftmap
//   node scripts/route-surfaces/extract-surface-polygons.mjs /tmp/zwiftmap
//
// Re-run this (and commit the diff) if zwiftmap updates their world surface
// mapping - e.g. after a new Zwift world/route/road layout ships. This only
// touches shared/data/zwiftmapSurfacePolygons.json; it does not affect
// per-route surface composition (see compute-route-surfaces.mjs for that).

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

const zwiftmapCheckout = process.argv[2]
if (!zwiftmapCheckout) {
  console.error('Usage: node extract-surface-polygons.mjs <path-to-zwiftmap-checkout>')
  process.exit(1)
}
const configDir = path.join(zwiftmapCheckout, 'frontend/src/constants/worldConfigs')

// Matches frontend/src/types/Surface.ts's `SurfaceType` const enum member
// order exactly - the enum is compiled away, so this is the only way to map
// its numeric values back to names from outside a full TS build.
const SURFACE_TYPE_NAMES = ['tarmac', 'brick', 'wood', 'cobbles', 'snow', 'dirt', 'grass', 'sand', 'gravel']

// File names per world, as laid out in zwiftmap's `worldConfigs/index.ts`.
const WORLD_FILES = {
  'bologna': 'bologna.ts',
  'crit-city': 'critCity.ts',
  'france': 'france.ts',
  'innsbruck': 'innsbruck.ts',
  'london': 'london.ts',
  'makuri-islands': 'makuri-islands.ts',
  'new-york': 'newYork.ts',
  'paris': 'paris.ts',
  'richmond': 'richmond.ts',
  'scotland': 'scotland.ts',
  'watopia': 'watopia.ts',
  'yorkshire': 'yorkshire.ts'
}

const result = {}

for (const [worldSlug, file] of Object.entries(WORLD_FILES)) {
  let source = readFileSync(path.join(configDir, file), 'utf-8')

  // Drop the type-only import and any PNG map image import - neither has
  // runtime meaning for the `surfaces` polygon data we're after.
  source = source.replace(/^import .* from ["']\.\.\/\.\.\/types["'];?\n/m, '')
  source = source.replace(/^import (\w+) from ["']\.\.\/\.\.\/maps\/.*["'];?\n/m, 'const $1 = null;\n')

  const surfaceTypeShim = `const SurfaceType = ${JSON.stringify(
    Object.fromEntries(SURFACE_TYPE_NAMES.map((name, i) => [name[0].toUpperCase() + name.slice(1), i]))
  )};\n`

  const { code } = transformSync(surfaceTypeShim + source, { loader: 'ts', format: 'cjs' })

  const mod = { exports: {} }
  new Function('module', 'exports', 'require', code)(mod, mod.exports, () => ({}))

  const config = Object.values(mod.exports)[0]
  result[worldSlug] = config.surfaces.map(s => ({
    type: SURFACE_TYPE_NAMES[s.type],
    polygon: s.polygon
  }))
  console.log(worldSlug, '->', result[worldSlug].length, 'polygons')
}

const outPath = path.join(repoRoot, 'shared/data/zwiftmapSurfacePolygons.json')
writeFileSync(outPath, JSON.stringify(result))
console.log(`\nWrote ${outPath}`)
