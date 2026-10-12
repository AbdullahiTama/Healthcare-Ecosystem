import { useCallback, useState } from 'react'
import { callAdminAuth } from '../adminApi'
import { useAdmin } from '../provider/AdminProvider.jsx'
import { bestEffort } from '../lib/bestEffort'

// The withdrawal reject that used to be an inline handler in LegacyTabHost,
// calling the same server action with the same { id } payload. Resolves { ok }
// or { ok: false, error } so the drawer can show a failure where the admin is
// looking.
//
// Like the legacy handler it writes no audit entry and no action history; that
// gap is a recorded finding, not something to change here.
//
// One deliberate difference: on a server error the lists are STILL refreshed,
// because a refusal such as "already confirmed paid" means the request changed
// underneath the admin and the screen must show its current state.

export function useWithdrawalActions() {
  const { showToast, invalidateAdmin } = useAdmin()
  const [busy, setBusy] = useState(null)

  // Only the server call decides the result. The refresh and toast run after it
  // and cannot throw out of here: once the server has refunded or settled the
  // request, the admin must never be told the reject failed.
  const rejectWithdrawal = useCallback(async (id) => {
    setBusy(id)
    let result
    try {
      await callAdminAuth('reject_withdrawal', { id })
      result = { ok: true }
    } catch (err) {
      result = { ok: false, error: err.message }
    } finally {
      setBusy(null)
    }
    bestEffort('refreshing after reject_withdrawal', invalidateAdmin)
    if (result.ok) bestEffort('toasting reject_withdrawal', () => showToast('Withdrawal rejected', { type: 'success' }))
    return result
  }, [showToast, invalidateAdmin])

  return { busy, rejectWithdrawal }
}
