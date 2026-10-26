import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const store = new Map()
vi.mock('../../../services/supabase', () => ({
  sbFetch: vi.fn(),
  sbFetchWithCount: vi.fn(),
  cacheData: vi.fn((key, data) => store.set(key, data)),
  getCached: vi.fn((key) => (store.has(key) ? store.get(key) : null)),
}))

import { useProductCatalog } from './useProductCatalog'
import { cacheData } from '../../../services/supabase'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

let host, root, queryClient, latest

function Probe({ businessId, fetchAll }) {
  latest = useProductCatalog(businessId, { fetchAll })
  return null
}

async function mount(businessId, fetchAll) {
  await act(async () => {
    root.render(<QueryClientProvider client={queryClient}><Probe businessId={businessId} fetchAll={fetchAll} /></QueryClientProvider>)
  })
}

beforeEach(() => {
  store.clear()
  vi.mocked(cacheData).mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  queryClient.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const rows = [{ id: '1', name: 'Amoxil', stock: 4 }, { id: '2', name: 'Panadol', stock: 9 }]

describe('useProductCatalog', () => {
  it('is loading with progress until the first answer, then ready', async () => {
    const d = deferred()
    let report
    const fetchAll = vi.fn((_id, { onProgress }) => { report = onProgress; return d.promise })
    await mount('biz-A', fetchAll)
    expect(latest.status).toBe('loading')
    expect(latest.products).toEqual([])

    await act(async () => report(1000))
    expect(latest.loadedCount).toBe(1000)

    await act(async () => d.resolve(rows))
    await flush()
    expect(latest).toMatchObject({ status: 'ready', refreshing: false, stale: false, products: rows })
  })

  it('shows the saved copy at once while the server load runs, then replaces it', async () => {
    store.set('products_biz-A', [{ id: 'old', name: 'Saved' }])
    const d = deferred()
    await mount('biz-A', () => d.promise)
    expect(latest).toMatchObject({ status: 'ready', refreshing: true })
    expect(latest.products.map((p) => p.id)).toEqual(['old'])

    await act(async () => d.resolve(rows))
    await flush()
    expect(latest).toMatchObject({ status: 'ready', refreshing: false, stale: false })
    expect(latest.products).toEqual(rows)
  })

  it('a failed first load with no saved copy is an error; Retry recovers', async () => {
    let fail = true
    const fetchAll = vi.fn(async () => { if (fail) throw new Error('network down'); return rows })
    await mount('biz-A', fetchAll)
    await flush()
    expect(latest.status).toBe('error')
    expect(latest.error).toMatch(/couldn't load your products/i)

    fail = false
    await act(async () => { await latest.reload() })
    await flush()
    expect(latest).toMatchObject({ status: 'ready', products: rows })
  })

  it('a failed load with a saved copy keeps showing the copy, flagged as failed', async () => {
    store.set('products_biz-A', rows)
    await mount('biz-A', async () => { throw new Error('500') })
    await flush()
    expect(latest).toMatchObject({ status: 'ready', stale: true, staleReason: 'failed', products: rows })
  })

  it('offline with a saved copy: shows it as offline without calling the server', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    store.set('products_biz-A', rows)
    const fetchAll = vi.fn()
    await mount('biz-A', fetchAll)
    await flush()
    expect(fetchAll).not.toHaveBeenCalled()
    expect(latest).toMatchObject({ status: 'ready', stale: true, staleReason: 'offline', refreshing: false, products: rows })
  })

  it('offline with no saved copy: an offline error, not an endless skeleton', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await mount('biz-A', vi.fn())
    await flush()
    expect(latest.status).toBe('error')
    expect(latest.error).toMatch(/offline/)
  })

  it('setProducts applies a saved row locally without another server load', async () => {
    const fetchAll = vi.fn(async () => rows)
    await mount('biz-A', fetchAll)
    await flush()
    await act(async () => latest.setProducts((prev) => prev.map((p) => (p.id === '1' ? { ...p, stock: 10 } : p))))
    await flush() // React Query notifies subscribers on the next tick
    expect(latest.products.find((p) => p.id === '1').stock).toBe(10)
    expect(fetchAll).toHaveBeenCalledTimes(1)
  })

  it('an edit made while a load is running is kept: the load is cancelled and run again', async () => {
    const first = deferred()
    const fetchAll = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(async () => [{ id: '1', name: 'Amoxil', stock: 10 }, { id: '2', name: 'Panadol', stock: 9 }])
    store.set('products_biz-A', rows)
    await mount('biz-A', fetchAll)
    expect(latest.refreshing).toBe(true)

    await act(async () => latest.setProducts((prev) => prev.map((p) => (p.id === '1' ? { ...p, stock: 10 } : p))))
    await flush()
    // The first load (read before the edit) answers late with the old stock: it must not win.
    await act(async () => first.resolve(rows))
    await flush()
    expect(fetchAll).toHaveBeenCalledTimes(2)
    expect(latest.products.find((p) => p.id === '1').stock).toBe(10)
  })

  it('switching business never shows the previous business products', async () => {
    const a = deferred()
    const fetchAll = vi.fn((id) => (id === 'biz-A' ? a.promise : Promise.resolve([{ id: 'b1', name: 'B product' }])))
    await mount('biz-A', fetchAll)
    await mount('biz-B', fetchAll)
    await flush()
    expect(latest.products.map((p) => p.id)).toEqual(['b1'])
    // A's answer arrives late; B's list is unchanged.
    await act(async () => a.resolve(rows))
    await flush()
    expect(latest.products.map((p) => p.id)).toEqual(['b1'])
  })

  it('writes the offline copy after the list settles, and not for an unchanged saved copy', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    store.set('products_biz-A', rows)
    const same = deferred()
    await mount('biz-A', () => same.promise)
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(cacheData).not.toHaveBeenCalled()

    await act(async () => same.resolve([...rows, { id: '3', name: 'Zinc' }]))
    // React Query delivers the update on a zero-delay timer, then the write waits 1.5 s.
    await act(async () => { vi.advanceTimersByTime(10) })
    expect(cacheData).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(cacheData).toHaveBeenCalledTimes(1)
    expect(store.get('products_biz-A')).toHaveLength(3)
  })
})
