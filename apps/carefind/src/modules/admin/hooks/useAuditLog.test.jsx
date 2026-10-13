import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const callAdminAuth = vi.hoisted(() => vi.fn())
vi.mock('../adminApi', () => ({ callAdminAuth }))

import { useAuditLog } from './useAuditLog'

// One client per test, so tests never share a cache.
const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({ id: `a${i}` }))
const run = (args) => renderHook(() => useAuditLog(args), { wrapper: makeWrapper() })

beforeEach(() => {
  callAdminAuth.mockReset()
})

describe('useAuditLog', () => {
  it('page 0 with defaults asks for 26 rows with exact params and returns 25', async () => {
    callAdminAuth.mockResolvedValue({ data: rowsOf(26) })
    const { result } = run()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(callAdminAuth).toHaveBeenCalledTimes(1)
    expect(callAdminAuth).toHaveBeenCalledWith('list_audit_logs', { limit: 26, action: 'all', target_type: 'all', dateFrom: '', dateTo: '' })
    expect(result.current.data.rows).toHaveLength(25)
    expect(result.current.data.hasNext).toBe(true)
    expect(result.current.data.capped).toBe(false)
  })

  it('page 2 requests 76 rows and returns rows 50-74', async () => {
    callAdminAuth.mockResolvedValue({ data: rowsOf(76) })
    const { result } = run({ page: 2 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(callAdminAuth.mock.calls[0][1].limit).toBe(76)
    expect(result.current.data.rows[0].id).toBe('a50')
    expect(result.current.data.rows).toHaveLength(25)
    expect(result.current.data.rows[24].id).toBe('a74')
  })

  it('page 7 requests 200 and is capped with no next page', async () => {
    callAdminAuth.mockResolvedValue({ data: rowsOf(200) })
    const { result } = run({ page: 7 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(callAdminAuth.mock.calls[0][1].limit).toBe(200)
    expect(result.current.data.hasNext).toBe(false)
    expect(result.current.data.capped).toBe(true)
  })

  it('a short list has no next page and is not capped', async () => {
    callAdminAuth.mockResolvedValue({ data: rowsOf(10) })
    const { result } = run()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toMatchObject({ hasNext: false, capped: false })
    expect(result.current.data.rows).toHaveLength(10)
  })

  it('a response without a data array is an error, never an empty trail', async () => {
    callAdminAuth.mockResolvedValue({})
    const { result } = run()
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  it('a rejected call is an error', async () => {
    callAdminAuth.mockRejectedValue(new Error('boom'))
    const { result } = run()
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('passes enriched fields through untouched', async () => {
    const row = { id: 'a1', actor_name: 'Ada', target_type: 'user', metadata: { x: 1 } }
    callAdminAuth.mockResolvedValue({ data: [row] })
    const { result } = run()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.rows[0]).toEqual(row)
  })
})
