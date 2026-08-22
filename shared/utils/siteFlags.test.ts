import { describe, expect, it } from 'vitest'
import { DEFAULT_SITE_FLAGS, isMotdActive, parseSiteFlags, siteFlagsStrictSchema, toPublicSiteFlags } from './siteFlags'

const fullMotd = {
  id: '2026-08-rebalance',
  message: 'Zwift 1.84 rebalanced wheels - rankings are being re-verified.',
  tone: 'warning',
  dismissible: true,
  expiresAt: '2026-09-01T00:00:00Z'
}

describe('parseSiteFlags', () => {
  it('fills every default from an empty object', () => {
    const flags = parseSiteFlags('{}')
    expect(flags).toEqual({
      version: 1,
      motd: null,
      sections: { events: { mode: 'on' } },
      killSwitches: { recommend: false, mcp: false }
    })
    expect(flags).toEqual(DEFAULT_SITE_FLAGS)
  })

  it('parses a fully-populated config', () => {
    const flags = parseSiteFlags(JSON.stringify({
      motd: fullMotd,
      sections: { events: { mode: 'hidden', notice: 'Back next season.' } },
      killSwitches: { recommend: true },
      updatedAt: '2026-08-22T12:00:00Z'
    }))
    expect(flags?.motd).toEqual(fullMotd)
    expect(flags?.sections.events).toEqual({ mode: 'hidden', notice: 'Back next season.' })
    // A partial killSwitches object still defaults the unmentioned switch.
    expect(flags?.killSwitches).toEqual({ recommend: true, mcp: false })
  })

  // The runtime parse must tolerate keys a newer schema added, so an older
  // deploy keeps serving the config instead of failing open and dropping a
  // live MOTD.
  it('ignores unknown keys', () => {
    const flags = parseSiteFlags(JSON.stringify({ motd: null, futureKnob: true }))
    expect(flags).toEqual(DEFAULT_SITE_FLAGS)
  })

  // Unusable configs return null so callers fall back to defaults - a broken
  // push must degrade to normal service, never take the site down.
  it('returns null for malformed JSON', () => {
    expect(parseSiteFlags('{not json')).toBeNull()
  })

  it('returns null for wrong value types and out-of-range values', () => {
    expect(parseSiteFlags(JSON.stringify({ motd: { id: 'x', message: 'hi', tone: 'party' } }))).toBeNull()
    expect(parseSiteFlags(JSON.stringify({ sections: { events: { mode: 'off' } } }))).toBeNull()
    expect(parseSiteFlags(JSON.stringify({ killSwitches: { recommend: 'yes' } }))).toBeNull()
    expect(parseSiteFlags(JSON.stringify({ motd: { id: 'x', message: '' } }))).toBeNull()
  })
})

describe('siteFlagsStrictSchema', () => {
  // The push script parses with the strict schema: there a surplus key is a
  // typo, and push time is the only chance to catch it - the runtime's
  // lenient parse would just ignore the misspelled intent.
  it('rejects unknown keys at every level', () => {
    expect(siteFlagsStrictSchema.safeParse({ futureKnob: true }).success).toBe(false)
    expect(siteFlagsStrictSchema.safeParse({ motd: { ...fullMotd, tune: 'info' } }).success).toBe(false)
    expect(siteFlagsStrictSchema.safeParse({ sections: { event: {} } }).success).toBe(false)
    expect(siteFlagsStrictSchema.safeParse({ killSwitches: { recomend: true } }).success).toBe(false)
  })

  it('accepts what the loose schema accepts, minus the junk', () => {
    const result = siteFlagsStrictSchema.safeParse({
      motd: fullMotd,
      sections: { events: { mode: 'hidden' } },
      killSwitches: { mcp: true }
    })
    expect(result.success).toBe(true)
  })
})

describe('isMotdActive', () => {
  const motd = parseSiteFlags(JSON.stringify({ motd: fullMotd }))!.motd!

  it('shows before expiry, hides after', () => {
    expect(isMotdActive(motd, new Date('2026-08-31T23:59:59Z'))).toBe(true)
    expect(isMotdActive(motd, new Date('2026-09-01T00:00:00Z'))).toBe(false)
  })

  it('never expires without an expiresAt', () => {
    const { expiresAt: _dropped, ...rest } = motd
    expect(isMotdActive(rest, new Date('2999-01-01T00:00:00Z'))).toBe(true)
  })
})

describe('toPublicSiteFlags', () => {
  const flags = parseSiteFlags(JSON.stringify({
    motd: fullMotd,
    sections: { events: { mode: 'hidden' } },
    killSwitches: { recommend: true, mcp: true }
  }))!

  it('keeps only the client-facing slice', () => {
    const publicFlags = toPublicSiteFlags(flags, new Date('2026-08-22T00:00:00Z'))
    expect(publicFlags).toEqual({
      motd: fullMotd,
      sections: { events: { mode: 'hidden' } }
    })
    expect('killSwitches' in publicFlags).toBe(false)
  })

  it('drops an expired motd server-side', () => {
    expect(toPublicSiteFlags(flags, new Date('2026-09-02T00:00:00Z')).motd).toBeNull()
  })
})
