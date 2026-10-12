import { useCallback, useState } from 'react'
import { callAdminAuth } from '../adminApi'
import { useAdmin } from '../provider/AdminProvider.jsx'

// The user actions that used to live in LegacyTabHost, calling the same server
// actions with the same payloads. Each resolves { ok } or { ok: false, error }
// so the drawer can show a failure where the admin is looking; success toasts
// and refreshes the lists.

async function audit(auditAction, targetType, targetId, metadata = {}) {
  try {
    await callAdminAuth('log_audit_action', { auditAction, targetType, targetId, metadata })
  } catch { /* an audit failure must not block the action */ }
}

export function useUserActions() {
  const { showToast, invalidateAdmin } = useAdmin()
  const [busy, setBusy] = useState(null)

  const run = useCallback(async ({ id, action, payload, auditAs, metadata, success }) => {
    setBusy(id)
    try {
      await callAdminAuth(action, payload)
      if (auditAs) audit(auditAs[0], auditAs[1], id, metadata)
      invalidateAdmin()
      showToast(success, { type: 'success' })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    } finally {
      setBusy(null)
    }
  }, [showToast, invalidateAdmin])

  // Manual verification writes no audit entry, exactly as the legacy handler
  // did; that gap is a recorded finding, not something to change here.
  const verifyUser = ({ id, specialty }) => {
    if (!specialty || !specialty.trim()) return Promise.resolve({ ok: false, error: 'Enter a specialty' })
    return run({ id, action: 'manual_verify', payload: { userId: id, specialty }, success: 'User verified' })
  }
  const suspendUser = ({ id, days }) => run({
    id, action: 'suspend_user', payload: { userId: id, days },
    auditAs: ['suspend', 'user'], metadata: { days }, // suspend_user only sets suspended_until; nothing in this repo enforces it,
    // so the toast says what was recorded, as the confirmation does.
    success: `User marked as suspended for ${days} days`,
  })
  const deleteUser = ({ id, name }) => run({
    id, action: 'delete_user', payload: { userId: id },
    auditAs: ['delete', 'user'], metadata: { name }, success: 'User deleted',
  })

  return { busy, verifyUser, suspendUser, deleteUser }
}
