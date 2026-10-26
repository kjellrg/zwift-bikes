// The recorded tracks the scripts read: every route's and segment's stream,
// the package's first and then the supplement's
// (shared/data/supplement/streams.generated.json) for a slug the package has
// none for. A script never reaches into `zwift-data/streams` itself (a lint
// rule holds that, eslint.config.mjs). Scripts only - the streams are far too
// large for the app bundle, and nothing under app/, server/ or shared/
// imports this file.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as packageStreams from 'zwift-data/streams'

export const SUPPLEMENT_STREAMS_PATH = fileURLToPath(new URL('../../shared/data/supplement/streams.generated.json', import.meta.url))

let merged

/** @returns {{ routes: Readonly<Record<string, import('zwift-data/streams').StreamData | undefined>>, segments: Readonly<Record<string, import('zwift-data/streams').StreamData | undefined>> }} */
export function getStreams() {
  if (!merged) {
    const supplement = JSON.parse(readFileSync(SUPPLEMENT_STREAMS_PATH, 'utf-8'))
    // The package's track last, so a slug it has a track for never takes the supplement's.
    merged = {
      routes: { ...supplement.routes, ...packageStreams.routes },
      segments: { ...supplement.segments, ...packageStreams.segments }
    }
  }
  return merged
}

/** @param {string} slug */
export function getRouteStream(slug) {
  return getStreams().routes[slug]
}

/** @param {string} slug */
export function getSegmentStream(slug) {
  return getStreams().segments[slug]
}
