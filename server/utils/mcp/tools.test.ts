import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RouteWithMeta } from '../../../shared/types/catalog'
import { callTool } from './tools'

// The tools reach the API through Nitro's `$fetch`, which does not exist in
// this environment. The stub throws, so a test passes only if the tool
// answered before fetching anything.
const fetchStub = vi.fn(() => {
  throw new Error('$fetch must not be called')
})

describe('recommend tools under killSwitches.recommend', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, '$fetch')
    fetchStub.mockClear()
  })

  it.each(['recommend_for_route', 'recommend_for_segment'])('%s refuses without fetching', async (tool) => {
    Reflect.set(globalThis, '$fetch', fetchStub)
    const args = tool === 'recommend_for_route'
      ? { route: 'road-to-sky', weightKg: 75, heightCm: 180, wkg: 3 }
      : { segment: 'alpe-du-zwift', weightKg: 75, heightCm: 180, wkg: 3 }
    const result = await callTool(tool, args, { recommendPaused: true })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('temporarily paused')
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('does not gate the tools that never rank anything', async () => {
    const result = await callTool('set_rider_profile', { weightKg: 75, heightCm: 180, wkg: 3 }, { sessionId: undefined, recommendPaused: true })
    // No session: the tool's own error, not the maintenance message.
    expect(result.content[0]?.text).not.toContain('temporarily paused')
  })
})

describe('the upgrade stage a recommend call reports', () => {
  // The tools reach the API through Nitro's `$fetch`. Both calls
  // `recommend_for_route` makes are answered here: the route lookup that
  // feeds the header, and the ranking itself, which returns no combos
  // because this test is only about the header line.
  const route = {
    slug: 'tempus-fugit',
    name: 'Tempus Fugit',
    world: 'watopia',
    worldName: 'Watopia',
    distance: 17.3,
    elevation: 16,
    leadInDistance: 0.3,
    leadInElevation: 0,
    lap: true,
    surface: { road: 100, gravel: 0, cobble: 0, confidence: 'measured' }
  } as unknown as RouteWithMeta

  const recommendResponse = {
    combos: [],
    pagination: { offset: 0, returned: 0, hasMore: false }
  }

  function stubFetch() {
    Reflect.set(globalThis, '$fetch', vi.fn((path: string) => (
      path.startsWith('/api/routes/') ? route : recommendResponse
    )))
  }

  afterEach(() => {
    Reflect.deleteProperty(globalThis, '$fetch')
  })

  async function headerFor(upgradeLevel: number): Promise<string> {
    stubFetch()
    const result = await callTool('recommend_for_route', {
      route: 'tempus-fugit',
      weightKg: 75,
      heightCm: 180,
      wkg: 3,
      verifiedOnly: false,
      upgradeLevel
    }, {})
    return result.content[0]?.text ?? ''
  }

  // The header exists to report the stage the ranking actually used, and the
  // classifier rounds - so echoing `3.5` back announced a stage that does not
  // exist while every bike was ranked at 4.
  it('reports a whole stage for a fractional upgradeLevel', async () => {
    expect(await headerFor(3.5)).toContain('All bikes assumed at upgrade stage 4')
  })

  it('still labels the two ends of the ladder', async () => {
    expect(await headerFor(9)).toContain('upgrade stage 5 (fully upgraded)')
    expect(await headerFor(-1)).toContain('upgrade stage 0 (stock)')
  })
})
