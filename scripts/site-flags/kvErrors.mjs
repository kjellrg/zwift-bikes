// How `site-flags.mjs` reads wrangler's failures. Kept apart from the CLI so
// the classification can be unit-tested against the exact strings wrangler
// prints (`scripts/site-flags/kvErrors.test.mjs`).
//
// wrangler 4.128 `kv key get --remote` does not distinguish a missing KEY
// from a missing NAMESPACE: both come back from the Cloudflare API as a
// 404 and wrangler prints the same
//   Failed to fetch https://api.cloudflare.com/.../namespaces/<id>/values/<key> - 404: Not Found
// line for either. A missing BINDING is different text ("No KV namespace
// with binding ... was found in the "kv_namespaces" section") and no 404.
// So a 404 on `get` is only "the key was never seeded" once `kv key list`
// has proven the namespace itself answers - the caller runs that second
// command; these helpers only read the two outputs. Issue #157.

/** True for the one wrangler failure that can mean "no such key": a 404 on this key's value URL. */
export function isKvValueMissing(stderr, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`/values/${escaped} - 404: Not Found`).test(stderr ?? '')
}

/**
 * Whether `wrangler kv key list` output (a JSON array of `{ name, ... }`)
 * names the key. A list that does not parse is treated as not containing
 * it - the caller has already confirmed the command exited 0.
 */
export function listContainsKey(listStdout, key) {
  const raw = listStdout ?? ''
  const start = raw.indexOf('[')
  if (start === -1) return false
  try {
    const entries = JSON.parse(raw.slice(start))
    return Array.isArray(entries) && entries.some(entry => entry && entry.name === key)
  } catch {
    return false
  }
}

/**
 * Whether a local flags file holds anything an operator wrote: any
 * difference from the defaults other than the `updatedAt` stamp `push`
 * writes. Used by `pull` to refuse to overwrite such a file with defaults
 * unless `--force` is passed.
 */
export function differsFromDefaults(localFlags, defaults) {
  const strip = (flags) => {
    const { updatedAt, ...rest } = flags
    void updatedAt
    return rest
  }
  return JSON.stringify(strip(localFlags)) !== JSON.stringify(strip(defaults))
}
