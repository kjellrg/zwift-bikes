import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouteSimulationStallError, simulateRoute } from '../../../shared/utils/physics/simulator'
import { DEFAULT_SITE_FLAGS } from '../../../shared/utils/siteFlags'
import type { RpcContext } from './protocol'
import { callTool } from './tools'

// The recommend tools rank through the Ride ranking module in process
// (`server/utils/rankRide.ts`), so these tests run the real ranking against
// the real catalog, with no `$fetch` anywhere: Nitro's `$fetch` does not
// exist in this environment, so a tool that still reached for it would throw.
//
// The simulator is wrapped, not replaced: every test runs the real physics
// except the one that needs a stall. A rider the MCP bounds accept cannot
// actually stall on any Ride in today's catalog (the steepest grade is ~20%,
// and 0.3 W/kg still holds it), so that test has the simulator report one.
vi.mock('../../../shared/utils/physics/simulator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/utils/physics/simulator')>()
  return { ...actual, simulateRoute: vi.fn(actual.simulateRoute) }
})

const RUNNING: RpcContext = { killSwitches: DEFAULT_SITE_FLAGS.killSwitches }
const PAUSED: RpcContext = { killSwitches: { ...DEFAULT_SITE_FLAGS.killSwitches, recommend: true } }

const RIDER = { weightKg: 75, heightCm: 180, wkg: 3 }

function textOf(result: { content: { text: string }[] }): string {
  return result.content[0]?.text ?? ''
}

describe('recommend tools under killSwitches.recommend', () => {
  beforeEach(() => {
    vi.mocked(simulateRoute).mockClear()
  })

  it.each([
    ['recommend_for_route', { route: 'road-to-sky', ...RIDER }],
    ['recommend_for_segment', { segment: 'alpe-du-zwift', ...RIDER }]
  ])('%s answers with the site\'s maintenance message, ranking nothing', async (tool, args) => {
    const result = await callTool(tool, args, PAUSED)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('Recommendations are temporarily paused for maintenance. Try again later.')
    expect(simulateRoute).not.toHaveBeenCalled()
  })

  it('does not gate the tools that never rank anything', async () => {
    const result = await callTool('set_rider_profile', RIDER, { ...PAUSED, sessionId: undefined })
    // No session: the tool's own error, not the maintenance message.
    expect(textOf(result)).not.toContain('temporarily paused')
  })
})

describe('a Ride the rider cannot finish', () => {
  afterEach(() => {
    // Back to the real physics the mock was created around.
    vi.mocked(simulateRoute).mockReset()
  })

  it.each([
    ['recommend_for_route', { route: 'tempus-fugit', ...RIDER }],
    ['recommend_for_segment', { segment: 'alpe-du-zwift', ...RIDER }]
  ])('%s answers a tool error with the site\'s message', async (tool, args) => {
    vi.mocked(simulateRoute).mockImplementation(() => {
      throw new RouteSimulationStallError({ weightKg: 75, heightCm: 180, powerW: 225 }, 0.25, 1234, 5000)
    })
    const result = await callTool(tool, args, RUNNING)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('Rider cannot finish this route at this power: Rider (75 kg, 225 W) stalled on a 25.0% grade at 1234 m of 5000 m.')
  })
})

describe('a bike sold under two names', () => {
  it('is one row of the ranking, with the other name beside it (#266)', async () => {
    const text = textOf(await callTool('recommend_for_route', { route: 'libby-hill-after-party', category: 'standard', ...RIDER }, RUNNING))
    expect(text).toContain('| Canyon Aeroad CFR - CANYON//SRAM (also sold as Canyon Aeroad CFR Alpecin Premier-Tech) |')
    expect(text).not.toContain('| Canyon Aeroad CFR Alpecin Premier-Tech |')
  })
})

describe('an unknown slug', () => {
  it('suggests routes named like it', async () => {
    const text = textOf(await callTool('recommend_for_route', { route: 'big-foot-hill', ...RIDER }, RUNNING))
    expect(text).toMatch(/^No route with slug "big-foot-hill"\. Did you mean: /)
    expect(text).toContain('`big-foot-hills` (Big Foot Hills)')
  })

  it('suggests segments named like it', async () => {
    const text = textOf(await callTool('recommend_for_segment', { segment: 'alpe-du-zwif', ...RIDER }, RUNNING))
    expect(text).toMatch(/^No segment with slug "alpe-du-zwif"\. Did you mean: /)
    expect(text).toContain('`alpe-du-zwift` (Alpe du Zwift)')
  })

  it('points at list_routes when nothing is named like it', async () => {
    const result = await callTool('recommend_for_route', { route: 'qqqqqq', ...RIDER }, RUNNING)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('No route with slug "qqqqqq". Call `list_routes` to find the right slug.')
  })
})

describe('arguments the recommend query refuses', () => {
  it('come back as a tool error naming the argument', async () => {
    const result = await callTool('recommend_for_route', { route: 'tempus-fugit', ...RIDER, search: 'x'.repeat(201) }, RUNNING)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/^Invalid arguments: /)
    expect(textOf(result)).toContain('search')
  })
})

describe('the upgrade stage a recommend call reports', () => {
  // A real ranking, one row long: the header is what is under test.
  async function headerFor(upgradeLevel: number): Promise<string> {
    const result = await callTool('recommend_for_route', {
      route: 'tempus-fugit',
      ...RIDER,
      limit: 1,
      upgradeLevel
    }, RUNNING)
    return textOf(result)
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
