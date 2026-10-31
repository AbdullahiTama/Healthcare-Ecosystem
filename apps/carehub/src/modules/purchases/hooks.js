import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { purchaseRepository } from './repositories'
import { useSupplierBalances, usePurchaseProductStats } from '../../hooks/queries'
import { isMissingObject } from '../../lib/dbErrors'
import { toSupplier } from './suppliers'

// Every supplier the business has bought from, all time, with what was spent,
// paid and is owed, and the last purchase. From the analytics function when the
// database has it (it adds the last purchase's amount), else the older supplier
// totals, so the supplier picker works on either.
export function useSupplierDirectory(brandId) {
  const stats = useQuery({
    queryKey: ['purchases', 'supplierStats', brandId, {}],
    queryFn: () => purchaseRepository.getSupplierStats(brandId, {}),
    enabled: !!brandId,
    staleTime: 60_000,
  })
  const fallback = useSupplierBalances(brandId, stats.isError && isMissingObject(stats.error))
  const source = stats.isSuccess ? stats : fallback
  const suppliers = useMemo(() => (source.data || []).map(toSupplier).filter((s) => s.name), [source.data])
  return { suppliers, isLoading: stats.isLoading || (stats.isError && fallback.isLoading), isError: stats.isError && (!isMissingObject(stats.error) || fallback.isError) }
}

const PRODUCT_INSIGHT_LIMIT = 500

// Earlier purchases of the products on the form, from one request: the most
// recently bought products (up to 500), looked up by product id or name. For a
// business that has bought more products than that, a product not in the
// window is asked for on its own (useProductInsight below).
export function useProductInsights(brandId, enabled = true) {
  const q = usePurchaseProductStats(brandId, {}, { sort: 'recent', limit: PRODUCT_INSIGHT_LIMIT }, enabled)
  return useMemo(() => {
    const rows = q.data || []
    const byId = new Map()
    const byKey = new Map()
    for (const r of rows) {
      if (r.product_id) byId.set(r.product_id, r)
      byKey.set(r.product_key, r)
    }
    const complete = q.isSuccess && (rows.length === 0 || Number(rows[0].total_count) <= rows.length)
    return {
      status: q.isLoading ? 'loading' : q.isError ? (isMissingObject(q.error) ? 'unavailable' : 'error') : 'ready',
      complete,
      lookup: (product, name) => (product?.id && byId.get(product.id)) || byKey.get(String(product?.name || name || '').trim().toLowerCase().replace(/\s+/g, ' ')) || null,
    }
  }, [q.data, q.isLoading, q.isError, q.isSuccess, q.error])
}

// One product's purchase statistics, all time (by id and name).
export function useProductInsight(brandId, product, enabled = true) {
  return useQuery({
    queryKey: ['purchases', 'productStats', brandId, { productId: product?.id, productKey: product?.name }, 'one'],
    queryFn: async () => (await purchaseRepository.getProductStats(brandId, { productId: product.id, productKey: product.name }, { limit: 1 }))?.[0] || null,
    enabled: !!brandId && !!product?.id && enabled,
    staleTime: 60_000,
  })
}
