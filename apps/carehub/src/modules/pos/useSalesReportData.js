import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { authClient } from '../../lib/authClient'
import { saleRepository, paymentRepository, shiftRepository } from './repositories'

// The signed-in user's auth id. The app's `auth` object carries the business
// and staff row but not the auth user, and the report needs it to show a
// cashier their own sales and to find their open shift. No token is sent, so
// there is nothing to renew here; but `null` makes the report tell the cashier
// to sign out and in again, so it is only given when the session is really
// over. A refresh that failed for lack of a connection (a laptop waking, Wi-Fi
// still rejoining) leaves no session in hand for a moment while the session
// itself is fine, so keep resolving (the report shows "Loading") and ask again.
export const AUTH_USER_RETRY_MS = 5000

export function useAuthUserId({ getSession = () => authClient.auth.getSession(), retryMs = AUTH_USER_RETRY_MS } = {}) {
  const [userId, setUserId] = useState(undefined) // undefined = still resolving
  useEffect(() => {
    let live = true
    let timer = null
    const again = () => { if (live) timer = setTimeout(resolve, retryMs) }
    async function resolve() {
      try {
        const { data, error } = await getSession()
        if (!live) return
        if (data?.session?.user?.id) { setUserId(data.session.user.id); return }
        if (error && isAuthRetryableFetchError(error)) { again(); return }
        setUserId(null)
      } catch (e) {
        again()
      }
    }
    resolve()
    return () => { live = false; clearTimeout(timer) }
  }, [])
  return userId
}

export const salesReportKey = (businessId, fromIso, toIso) => ['salesReport', businessId, fromIso, toIso]

// Everything the report needs for one period, in one query:
//   sales          rows created in the period (held/deleted included; the
//                  arithmetic decides what counts)
//   payments       ledger rows received in the period
//   salesById      the period's sales plus any older sale a payment belongs to
//   shifts         shifts overlapping the period
//   ledgerAvailable / shiftsAvailable  false until the accounting migration is applied
async function loadReport(businessId, fromIso, toIso) {
  const [sales, ledger, shifts] = await Promise.all([
    saleRepository.getRange(businessId, fromIso, toIso),
    paymentRepository.getRange(businessId, fromIso, toIso),
    shiftRepository.getRange(businessId, fromIso, toIso),
  ])
  const salesById = Object.fromEntries((sales || []).map((s) => [s.id, s]))
  const missing = [...new Set(ledger.rows.map((p) => p.sale_id))].filter((id) => !salesById[id])
  if (missing.length) {
    for (const s of await saleRepository.getByIds(businessId, missing)) salesById[s.id] = s
  }
  return {
    sales: sales || [],
    payments: ledger.rows,
    salesById,
    shifts: shifts.rows,
    ledgerAvailable: ledger.available,
    shiftsAvailable: shifts.available,
  }
}

export function useSalesReportData(businessId, range) {
  const fromIso = range ? range.start.toISOString() : null
  const toIso = range ? range.end.toISOString() : null
  return useQuery({
    queryKey: salesReportKey(businessId, fromIso, toIso),
    queryFn: () => loadReport(businessId, fromIso, toIso),
    enabled: !!businessId && !!range,
    staleTime: 30_000,
  })
}

export function useInvalidateSalesReport() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['salesReport'] })
    qc.invalidateQueries({ queryKey: ['sales'] })
    qc.invalidateQueries({ queryKey: ['reports'] })
  }
}
