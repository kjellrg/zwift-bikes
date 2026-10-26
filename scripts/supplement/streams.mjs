// The recorded tracks the scripts read: one place for every route's and
// segment's stream, so a script never reaches into `zwift-data/streams`
// itself (a lint rule holds that, eslint.config.mjs). Scripts only - the
// streams are far too large for the app bundle, and nothing under app/,
// server/ or shared/ imports this file.
import * as packageStreams from 'zwift-data/streams'

/** @returns {{ routes: Readonly<Record<string, import('zwift-data/streams').StreamData | undefined>>, segments: Readonly<Record<string, import('zwift-data/streams').StreamData | undefined>> }} */
export function getStreams() {
  return { routes: packageStreams.routes, segments: packageStreams.segments }
}

/** @param {string} slug */
export function getRouteStream(slug) {
  return getStreams().routes[slug]
}

/** @param {string} slug */
export function getSegmentStream(slug) {
  return getStreams().segments[slug]
}
