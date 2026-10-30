import { describe, it, expect, vi, afterEach } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'

vi.mock('../../lib/sessionFetch', () => ({ renewSession: vi.fn() }))

import { refetchActiveQueries } from '../RefreshProvider.jsx'

// A real QueryClient: what the resume refresh asks of React Query is exactly
// "refetch what is on screen", so it is checked against the library itself.
let client
let stops = []
function onScreen(queryKey, queryFn) {
  const observer = new QueryObserver(client, { queryKey, queryFn })
  stops.push(observer.subscribe(() => {}))
  return observer
}
afterEach(() => { stops.forEach((stop) => stop()); stops = []; client?.clear() })

describe('refetchActiveQueries', () => {
  it('refetches the queries on screen, keeping their data meanwhile, and leaves the rest alone', async () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    let sales = 1000
    const salesFn = vi.fn(async () => sales)
    const observer = onScreen(['sales'], salesFn)
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe(1000))
    const offScreenFn = vi.fn(async () => 'x')
    await client.prefetchQuery({ queryKey: ['reports'], queryFn: offScreenFn })

    sales = 2500
    const pending = refetchActiveQueries(client)
    expect(observer.getCurrentResult().data).toBe(1000) // still shown while it refetches
    await pending
    expect(observer.getCurrentResult().data).toBe(2500)
    expect(salesFn).toHaveBeenCalledTimes(2)
    expect(offScreenFn).toHaveBeenCalledTimes(1)
  })

  it('joins a refetch React Query already started instead of asking twice', async () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    const fn = vi.fn(() => new Promise((r) => setTimeout(() => r('ok'), 10)))
    const observer = onScreen(['sales'], fn)
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe('ok'))
    observer.refetch() // e.g. React Query's own refetch on window focus
    await refetchActiveQueries(client)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('rejects when a query on screen cannot refresh, so the indicator can say so', async () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    let fail = false
    const observer = onScreen(['sales'], async () => { if (fail) throw new Error('Failed to fetch'); return 1 })
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe(1))
    fail = true
    await expect(refetchActiveQueries(client)).rejects.toThrow('Failed to fetch')
    expect(observer.getCurrentResult().data).toBe(1) // the earlier data stays on screen
  })
})
