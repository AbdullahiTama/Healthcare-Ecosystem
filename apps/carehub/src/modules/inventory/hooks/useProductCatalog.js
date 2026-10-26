import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { productRepository } from '../repositories'
import { cacheData, getCached } from '../../../services/supabase'
import { keys } from '../../../hooks/queries'
import { loadProductCatalog, catalogCacheKey } from '../productCatalog'

// The product catalog for the signed-in business, shared by every dashboard
// page through BusinessDashboard. Built on React Query like the app's other
// server data (hooks/queries.js), so de-duplication, retries, refetch on
// reconnect and ignoring answers for a previous business come from the library.
// The rules for when the saved offline copy is shown live in productCatalog.js.
//
// Returned shape (what pages read from `catalog`):
//   products     the list to show
//   status       'loading' (nothing to show yet) | 'ready' | 'error' (nothing to show, load failed)
//   refreshing   a server load is running while products are already on screen
//   stale        the products shown are the saved offline copy, not a fresh server answer
//   staleReason  'offline' | 'failed' | 'unconfirmed' | null (see productCatalog.js)
//   loadedCount  rows received so far by the running load (progress for large catalogs)
//   error        a message for the user when status is 'error'
//   reload()     load again now
//   setProducts  apply rows the server returned after a save (React setState signature)
//
// Behaviour:
//   * The saved copy is shown at once while the server load runs, so a large
//     catalog on a slow connection is never a blank page.
//   * The catalog is large (megabytes for a big pharmacy) and pages keep it
//     current after their own saves, so it is refreshed at most every 5 minutes
//     on window focus, and on reconnect, rather than the app's 30 s default.
//   * An edit made while a load is running cancels that load (its rows were
//     read before the edit) and starts a fresh one, so the edit is not lost.
//   * The offline copy follows the list, debounced, and is not rewritten when
//     the list has not changed.
const CATALOG_STALE_TIME_MS = 5 * 60_000
const CACHE_WRITE_DELAY_MS = 1500

function readCache(key) {
  try { return getCached(key) } catch { return null }
}

function savedCopy(businessId) {
  const cached = businessId ? readCache(catalogCacheKey(businessId)) : null
  return Array.isArray(cached) && cached.length > 0 ? cached : null
}

export function useProductCatalog(businessId, { fetchAll = productRepository.getAll } = {}) {
  const queryClient = useQueryClient()
  const queryKey = keys.products(businessId)
  const [loadedCount, setLoadedCount] = useState(0)

  const query = useQuery({
    queryKey,
    enabled: !!businessId,
    // Run even when the browser reports offline: loadProductCatalog decides what
    // to show (the saved copy, or an offline message). React Query's default
    // would pause the query and leave a blank page on the skeleton.
    networkMode: 'always',
    // A saved copy (not a server answer) is out of date at once, so reconnecting
    // or returning to the tab refreshes it.
    staleTime: (q) => (q.state.data?.stale ? 0 : CATALOG_STALE_TIME_MS),
    // Show the saved copy immediately; updatedAt 0 marks it stale so the server
    // load still runs at once.
    initialData: () => {
      const copy = savedCopy(businessId)
      return copy ? { products: copy, source: 'cache', stale: true, reason: null } : undefined
    },
    initialDataUpdatedAt: 0,
    queryFn: async () => {
      setLoadedCount(0)
      const result = await loadProductCatalog({
        businessId,
        fetchAll,
        readCache,
        online: typeof navigator === 'undefined' || navigator.onLine !== false,
        onProgress: setLoadedCount,
      })
      // Nothing to fall back on: let React Query record the failure (and retry once).
      if (result.source === 'none' && result.error) throw result.error
      if (result.error) console.error('[catalog] refresh failed, showing the saved copy:', result.error)
      if (result.stale) console.warn('[catalog] showing the saved copy:', result.reason, `(${result.products.length} products)`)
      else console.info('[catalog] loaded', result.products.length, 'products')
      return { products: result.products, source: result.source, stale: result.stale, reason: result.reason }
    },
  })

  const data = query.data
  const products = data?.products || EMPTY
  const hasData = !!data
  const status = hasData ? 'ready' : query.isError ? 'error' : 'loading'
  // A failed refresh while products are on screen keeps them and says so.
  const refreshFailed = hasData && query.isError && !query.isFetching

  // Keep the offline copy in step with the list.
  const savedRef = useRef(null)
  useEffect(() => {
    if (!businessId || !data) return undefined
    if (savedRef.current === null && data.source === 'cache') { savedRef.current = data.products; return undefined }
    if (data.products === savedRef.current) return undefined
    const t = setTimeout(() => {
      cacheData(catalogCacheKey(businessId), data.products)
      savedRef.current = data.products
    }, CACHE_WRITE_DELAY_MS)
    return () => clearTimeout(t)
  }, [data, businessId])
  useEffect(() => { savedRef.current = null }, [businessId])

  const setProducts = useCallback((update) => {
    const key = keys.products(businessId)
    const apply = () => queryClient.setQueryData(key, (prev) => {
      const base = prev?.products || []
      const next = typeof update === 'function' ? update(base) : update
      return { ...(prev || { source: 'server', stale: false, reason: null }), products: next }
    })
    if (queryClient.isFetching({ queryKey: key }) === 0) { apply(); return }
    // A load is running and read the list before this edit. Cancel it first
    // (cancelling restores the previous data, which would otherwise overwrite
    // the edit), apply the edit, then load again.
    queryClient.cancelQueries({ queryKey: key }).then(() => {
      apply()
      queryClient.invalidateQueries({ queryKey: key })
    })
  }, [queryClient, businessId])

  const reload = useCallback(() => query.refetch(), [query.refetch])

  return {
    products,
    setProducts,
    status,
    refreshing: hasData && query.isFetching,
    stale: !!data?.stale || refreshFailed,
    staleReason: refreshFailed ? 'failed' : data?.reason || null,
    loadedCount,
    error: status === 'error' ? friendlyError(query.error) : null,
    reload,
  }
}

const EMPTY = []

function friendlyError(error) {
  const msg = String(error?.message || '')
  if (msg.startsWith('Session expired') || msg.includes('offline')) return msg
  return "We couldn't load your products. Check your connection and try again."
}
