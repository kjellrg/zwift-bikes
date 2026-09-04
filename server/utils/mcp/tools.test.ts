import { afterEach, describe, expect, it, vi } from 'vitest'
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
