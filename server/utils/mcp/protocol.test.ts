import { afterEach, describe, expect, it, vi } from 'vitest'
import { bodyTooLarge, handleMessage, MCP_MAX_BODY_BYTES } from './protocol'

// `handleMessage` is exercised with the tool layer replaced: what is under
// test is the transport's own behaviour around a tool that throws, not any
// tool. The real `tools.ts` reaches the API through Nitro's `$fetch`, which
// does not exist in this environment.
vi.mock('./tools', () => ({
  listTools: () => [],
  callTool: vi.fn(async (name: string) => {
    if (name === 'explode') throw new TypeError('Cannot read properties of undefined (reading combos)')
    return { content: [{ type: 'text', text: 'ok' }] }
  })
}))

describe('bodyTooLarge', () => {
  it('refuses a declared length over the cap before the body is read', () => {
    expect(bodyTooLarge(String(MCP_MAX_BODY_BYTES + 1), undefined)).toBe(true)
    expect(bodyTooLarge(String(MCP_MAX_BODY_BYTES), undefined)).toBe(false)
  })

  it('measures the raw body in bytes when there is no usable header', () => {
    expect(bodyTooLarge(undefined, 'x'.repeat(MCP_MAX_BODY_BYTES))).toBe(false)
    expect(bodyTooLarge(undefined, 'x'.repeat(MCP_MAX_BODY_BYTES + 1))).toBe(true)
    // Multi-byte characters count as their encoded size, not their length.
    expect(bodyTooLarge('not-a-number', 'é'.repeat(MCP_MAX_BODY_BYTES / 2 + 1))).toBe(true)
  })

  it('accepts a missing body', () => {
    expect(bodyTooLarge(undefined, undefined)).toBe(false)
  })
})

describe('tools/call with a tool that throws', () => {
  afterEach(() => vi.restoreAllMocks())

  it('answers a generic internal error and logs the detail instead of echoing it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await handleMessage(
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'explode', arguments: {} } },
      {}
    )
    expect(response?.error?.code).toBe(-32603)
    expect(response?.error?.message).toBe('Tool "explode" failed. The error has been logged.')
    expect(response?.error?.message).not.toContain('TypeError')
    expect(response?.error?.message).not.toContain('combos')

    expect(log).toHaveBeenCalledTimes(1)
    const line = JSON.parse(log.mock.calls[0]![0] as string)
    expect(line).toMatchObject({ evt: 'mcp-tool-error', tool: 'explode' })
    expect(line.message).toContain('combos')
  })

  it('leaves a successful call untouched', async () => {
    const response = await handleMessage(
      { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'fine', arguments: {} } },
      {}
    )
    expect(response?.result).toEqual({ content: [{ type: 'text', text: 'ok' }] })
  })
})
