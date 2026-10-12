import { useCallback, useState } from 'react'
import { callAdminAuth } from '../adminApi'
import { useAdmin } from '../provider/AdminProvider.jsx'

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

  const rejectWithdrawal = useCallback(async (id) => {
    setBusy(id)
    try {
      await callAdminAuth('reject_withdrawal', { id })
      invalidateAdmin()
      showToast('Withdrawal rejected', { type: 'success' })
      return { ok: true }
    } catch (err) {
      invalidateAdmin()
      return { ok: false, error: err.message }
    } finally {
      setBusy(null)
    }
  }, [showToast, invalidateAdmin])

  return { busy, rejectWithdrawal }
}
