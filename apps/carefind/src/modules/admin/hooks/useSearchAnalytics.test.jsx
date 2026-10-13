import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const callAdminAuth = vi.hoisted(() => vi.fn())
vi.mock('../adminApi', () => ({ callAdminAuth }))

import { useSearchAnalytics } from './useSearchAnalytics'

// One client per test, so tests never share a cache.
const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
const run = (enabled) => renderHook(() => useSearchAnalytics(enabled), { wrapper: makeWrapper() })

beforeEach(() => {
  callAdminAuth.mockReset()
})

describe('useSearchAnalytics', () => {
  it('calls list_search_logs with exactly {} and keeps only rows with a query', async () => {
    callAdminAuth.mockResolvedValue({ data: [{ query: 'a' }, { query: '' }, { query: '  ' }, { query: 3 }, {}, { query: 'b', found: true }] })
    const { result } = run()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(callAdminAuth).toHaveBeenCalledWith('list_search_logs', {})
    expect(result.current.data).toEqual([{ query: 'a' }, { query: 'b', found: true }])
  })

  it('a response without a data array is an error', async () => {
    callAdminAuth.mockResolvedValue({})
    const { result } = run()
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('a rejected call is an error, not []', async () => {
    callAdminAuth.mockRejectedValue(new Error('boom'))
    const { result } = run()
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  it('does not fetch when disabled', () => {
    run(false)
    expect(callAdminAuth).not.toHaveBeenCalled()
  })
})
