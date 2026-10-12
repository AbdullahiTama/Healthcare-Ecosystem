import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const query = vi.hoisted(() => vi.fn())
vi.mock('../repositories/transport', async () => {
  const actual = await vi.importActual('../repositories/transport')
  return { ...actual, adminTransport: { query } }
})

import { useBusinessesDirectory, BUSINESSES_PAGE_SIZE } from './useBusinessesDirectory'

// A fresh client per wrapper, so tests never share a cache.
const createWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({ id: `b${i}` }))
const p = (o = {}) => ({ search: '', type: 'all', status: 'all', location: '', page: 0, ...o })
const run = async (params) => {
  const hook = renderHook(() => useBusinessesDirectory(params), { wrapper: createWrapper() })
  await waitFor(() => expect(hook.result.current.isSuccess || hook.result.current.isError).toBe(true))
  return hook.result.current
}

beforeEach(() => {
  query.mockReset().mockResolvedValue({ data: rowsOf(3), count: 312 })
})

describe('useBusinessesDirectory', () => {
  it('queries businesses with an exact count, limit+1 and the page offset', async () => {
    await run(p({ page: 1 }))
    expect(query).toHaveBeenCalledWith('businesses', expect.objectContaining({
      count: 'exact', limit: BUSINESSES_PAGE_SIZE + 1, offset: BUSINESSES_PAGE_SIZE,
      order: { column: 'created_at', ascending: false },
    }))
  })

  it('sends no filters when nothing is selected', async () => {
    await run(p())
    expect(query.mock.calls[0][1].filters).toEqual([])
  })

  it('builds the name, type, status and location filters', async () => {
    await run(p({ search: 'garki', type: 'pharmacy', status: 'unclaimed', location: 'abuja' }))
    expect(query.mock.calls[0][1].filters).toEqual([
      { op: 'ilike', col: 'name', val: '%garki%' },
      { op: 'eq', col: 'business_type', val: 'pharmacy' },
      { op: 'eq', col: 'visible_on_carefind', val: false },
      { op: 'or', terms: [{ col: 'state', contains: 'abuja' }, { col: 'city', contains: 'abuja' }] },
    ])
  })

  it('claimed means visible_on_carefind = true', async () => {
    await run(p({ status: 'claimed' }))
    expect(query.mock.calls[0][1].filters).toContainEqual({ op: 'eq', col: 'visible_on_carefind', val: true })
  })

  it('escapes the search term as a LIKE pattern', async () => {
    await run(p({ search: '50%' }))
    expect(query.mock.calls[0][1].filters[0].val).toBe('%50\\%%')
  })

  it('whitespace-only search and location produce no filter, and terms are trimmed', async () => {
    await run(p({ search: '   ', location: '  \t ' }))
    expect(query.mock.calls[0][1].filters).toEqual([])
    query.mockClear()
    await run(p({ search: ' garki ', location: ' abuja ' }))
    expect(query.mock.calls[0][1].filters).toEqual([
      { op: 'ilike', col: 'name', val: '%garki%' },
      { op: 'or', terms: [{ col: 'state', contains: 'abuja' }, { col: 'city', contains: 'abuja' }] },
    ])
  })

  it('trims the extra row, reports hasNext, and exposes the exact filtered total', async () => {
    query.mockResolvedValue({ data: rowsOf(BUSINESSES_PAGE_SIZE + 1), count: 312 })
    const r = await run(p())
    expect(r.data.hasNext).toBe(true)
    expect(r.data.rows).toHaveLength(BUSINESSES_PAGE_SIZE)
    expect(r.data.total).toBe(312)
  })

  it('a failed query is an error, not an empty list', async () => {
    query.mockRejectedValue(new Error('rls'))
    const r = await run(p())
    expect(r.isError).toBe(true)
    expect(r.data).toBeUndefined()
  })
})
