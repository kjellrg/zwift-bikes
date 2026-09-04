import { describe, expect, it } from 'vitest'
import { differsFromDefaults, isKvValueMissing, listContainsKey } from './kvErrors.mjs'

// The strings below are what wrangler 4.128 prints, taken from its bundled
// source (`fetchKVGetValueBase` and `getKVNamespaceId` in wrangler-dist/cli.js).
const MISSING_KEY = `✘ [ERROR] Failed to fetch https://api.cloudflare.com/client/v4/accounts/abc/storage/kv/namespaces/0123/values/site-flags - 404: Not Found\n`
const MISSING_BINDING = `✘ [ERROR] No KV namespace with binding "SITE_FLAGS" was found in the "kv_namespaces" section of your wrangler config. Check the binding name is correct, or use \`--namespace-id\` instead.\n`
const SERVER_ERROR = `✘ [ERROR] Failed to fetch https://api.cloudflare.com/client/v4/accounts/abc/storage/kv/namespaces/0123/values/site-flags - 500: Internal Server Error\n`

describe('isKvValueMissing', () => {
  it('matches only the 404 on this key\'s value URL', () => {
    expect(isKvValueMissing(MISSING_KEY, 'site-flags')).toBe(true)
    expect(isKvValueMissing(MISSING_KEY, 'other-key')).toBe(false)
    expect(isKvValueMissing(SERVER_ERROR, 'site-flags')).toBe(false)
    expect(isKvValueMissing(MISSING_BINDING, 'site-flags')).toBe(false)
    expect(isKvValueMissing(undefined, 'site-flags')).toBe(false)
  })

  it('is not fooled by a generic "not found" elsewhere in the output', () => {
    // The old check was /not found/i over the whole stderr - exactly what a
    // misconfigured namespace or an unrelated wrangler error also says.
    expect(isKvValueMissing('A namespace with that id was not found', 'site-flags')).toBe(false)
  })
})

describe('listContainsKey', () => {
  it('reads wrangler\'s JSON key list, with or without a banner line', () => {
    const list = JSON.stringify([{ name: 'site-flags', expiration: null }, { name: 'other' }], null, 2)
    expect(listContainsKey(list, 'site-flags')).toBe(true)
    expect(listContainsKey(`👋 Listing keys...\n${list}`, 'site-flags')).toBe(true)
    expect(listContainsKey(list, 'missing')).toBe(false)
    expect(listContainsKey('[]', 'site-flags')).toBe(false)
  })

  it('treats unparseable or empty output as not containing the key', () => {
    expect(listContainsKey('', 'site-flags')).toBe(false)
    expect(listContainsKey('not json [', 'site-flags')).toBe(false)
  })
})

describe('differsFromDefaults', () => {
  const defaults = { killSwitches: { recommend: false, mcp: false }, sections: { events: { mode: 'visible' } } }

  it('ignores the updatedAt stamp push writes', () => {
    expect(differsFromDefaults({ ...defaults, updatedAt: '2026-09-04T10:00:00Z' }, defaults)).toBe(false)
  })

  it('sees an operator\'s change', () => {
    expect(differsFromDefaults({ ...defaults, killSwitches: { recommend: true, mcp: false } }, defaults)).toBe(true)
  })
})
