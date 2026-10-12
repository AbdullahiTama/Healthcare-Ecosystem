import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { callAdminAuth } from '../adminApi'
import { useAdmin } from '../provider/AdminProvider.jsx'

// What the money checks found (reconciliation_findings), and the decisions a
// person can record about them. Nothing here changes any money. The payloads,
// toasts and run summary are those of the legacy ReconciliationTab.

// "open" means open AND acknowledged (both still unresolved); the server lists
// both when no status is sent. A response without a list rejects, so a failed
// load is never shown as "nothing needs attention".
export function useReconciliationFindings(status) {
  return useQuery({
    queryKey: ['admin', 'reconciliation', status],
    queryFn: async () => {
      const r = await callAdminAuth('admin_list_reconciliation', status === 'open' ? {} : { status })
      if (!Array.isArray(r?.data)) throw new Error('admin_list_reconciliation returned no list')
      return r.data
    },
  })
}

const TOAST = { dismiss: 'Finding dismissed', acknowledge: 'Finding acknowledged', reopen: 'Finding reopened' }

export function useReconciliationActions() {
  const { showToast, invalidateAdmin } = useAdmin()
  const [busyId, setBusyId] = useState(null)
  const [running, setRunning] = useState(false)

  // Resolves { ok } or { ok: false, error }; the failure is shown by the drawer.
  const updateFinding = useCallback(async ({ id, op, note }) => {
    setBusyId(id)
    try {
      await callAdminAuth('admin_update_reconciliation_finding', { id, op, note: op === 'dismiss' ? note : undefined })
      invalidateAdmin()
      showToast(TOAST[op] || TOAST.reopen, { type: 'success' })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    } finally {
      setBusyId(null)
    }
  }, [showToast, invalidateAdmin])

  const runNow = useCallback(async () => {
    setRunning(true)
    try {
      const { report } = await callAdminAuth('admin_run_reconciliation')
      const t = report?.db?.totals
      const failed = report?.failed?.length ? ` Steps that failed: ${report.failed.join(', ')}.` : ''
      invalidateAdmin()
      return { ok: true, summary: t ? `Checked. ${t.open_critical} critical, ${t.open_warning} warning, ${t.open_info} info open.${failed}` : `Run finished.${failed}` }
    } catch (err) {
      showToast(`The check could not run: ${err.message}`, { type: 'error' })
      return { ok: false, error: err.message }
    } finally {
      setRunning(false)
    }
  }, [showToast, invalidateAdmin])

  return { busyId, running, updateFinding, runNow }
}
