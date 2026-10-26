// The recorded tracks the scripts read: every route's and segment's stream,
// the package's plus the supplement's (shared/data/supplement/streams.generated.json).
// A slug the package has no track for takes the supplement's; one it has a
// track for keeps it unless the supplement's entry corrects that record (a
// fixed Strava id comes with its own track). A script never reaches into `zwift-data/streams` itself (a lint
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
    // The file holds only tracks that are meant to be used: for a record the package lacks, or one the
    // supplement corrects (`supplement:prune` drops the rest), so it takes precedence.
    merged = {
      routes: { ...packageStreams.routes, ...supplement.routes },
      segments: { ...packageStreams.segments, ...supplement.segments }
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
