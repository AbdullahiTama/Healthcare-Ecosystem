import { useQuery } from '@tanstack/react-query'
import { callAdminAuth } from '../adminApi'

// The two money lists. Each settles on its own to { status: 'ok', data } or
// { status: 'error' }, so a failed list is shown as failed and never as an
// empty one. The key starts with 'admin', so invalidateAdmin() and the
// realtime channels refresh it.

// The server returns at most this many transactions (api/_handlers/admin-auth.js).
export const TRANSACTION_CAP = 50

const settle = async (promise) => {
  try { return { status: 'ok', data: await promise } } catch { return { status: 'error' } }
}

const list = (action) => callAdminAuth(action).then(r => {
  if (!Array.isArray(r?.data)) throw new Error(`${action} returned no list`)
  return r.data
})

export async function loadFinance() {
  const [transactions, withdrawals] = await Promise.all([
    settle(list('list_transactions')),
    settle(list('list_withdrawal_requests')),
  ])
  return { transactions, withdrawals }
}

export function useFinanceData(enabled = true) {
  return useQuery({ queryKey: ['admin', 'finance'], queryFn: loadFinance, enabled })
}
