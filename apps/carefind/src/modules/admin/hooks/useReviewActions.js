import { useCallback, useState } from 'react'
import { callAdminAuth } from '../adminApi'
import { useAdmin } from '../provider/AdminProvider.jsx'

// The review actions that used to live in LegacyTabHost, unchanged in what they
// call. Each resolves { ok } or { ok: false, error } so the drawer can show the
// failure where the admin is looking; success toasts and refreshes the lists.

async function audit(auditAction, targetType, targetId, metadata = {}) {
  try {
    await callAdminAuth('log_audit_action', { auditAction, targetType, targetId, metadata })
  } catch { /* an audit failure must not block moderation */ }
}

export function useReviewActions() {
  const { showToast, invalidateAdmin, recordAction } = useAdmin()
  const [busyId, setBusyId] = useState(null)

  const run = useCallback(async ({ id, action, payload, auditAs, record, success, metadata }) => {
    setBusyId(id)
    try {
      await callAdminAuth(action, payload)
      audit(auditAs[0], auditAs[1], id, metadata)
      recordAction({ action: record[0], target: record[1], id, timestamp: new Date().toISOString() })
      invalidateAdmin()
      showToast(success, { type: 'success' })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    } finally {
      setBusyId(null)
    }
  }, [showToast, invalidateAdmin, recordAction])

  const approveVerification = ({ id, userId, profession }) => run({
    id, action: 'approve_verification', payload: { id, userId, profession },
    auditAs: ['approve', 'verification'], record: ['approve', 'verification'], metadata: { userId, profession },
    success: 'Verification approved',
  })
  const rejectVerification = (id) => run({
    id, action: 'reject_verification', payload: { id },
    auditAs: ['reject', 'verification'], record: ['reject', 'verification'], success: 'Verification rejected',
  })
  const approveClaim = ({ id, businessId }) => run({
    id, action: 'approve_claim', payload: { claimId: id, businessId },
    auditAs: ['approve', 'claim'], record: ['approve', 'claim'], metadata: { businessId }, success: 'Claim approved',
  })
  const rejectClaim = (id) => run({
    id, action: 'reject_claim', payload: { claimId: id },
    auditAs: ['reject', 'claim'], record: ['reject', 'claim'], success: 'Claim rejected',
  })
  const resolveReport = (id) => run({
    id, action: 'resolve_report', payload: { id },
    auditAs: ['resolve', 'report'], record: ['approve', 'report'], success: 'Report resolved',
  })
  const deletePost = (id) => run({
    id, action: 'delete_post', payload: { id },
    auditAs: ['delete', 'post'], record: ['reject', 'post'], success: 'Post deleted',
  })

  // Resolve a private credential document to a short-lived signed URL. The tab
  // is opened SYNCHRONOUSLY inside the click's user-activation window and then
  // pointed at the URL; window.open after an await is blocked by Chrome/Safari.
  // `noopener` is deliberately NOT passed: it makes window.open return null, so
  // the tab could never be pointed at the URL. Instead the opener is severed by
  // hand before navigating, so the signed-URL page cannot reach back to us.
  const openCredential = useCallback(async (requestId) => {
    setBusyId(requestId)
    const tab = window.open('', '_blank')
    if (tab) { try { tab.opener = null } catch { /* best effort */ } }
    try {
      const { url } = await callAdminAuth('credential_url', { requestId })
      if (!tab) return { ok: false, error: 'Your browser blocked the document window. Allow popups for this site and try again.' }
      tab.location = url
      return { ok: true }
    } catch (err) {
      if (tab) tab.close()
      return { ok: false, error: `Could not open the document: ${err.message}` }
    } finally {
      setBusyId(null)
    }
  }, [])

  return { busyId, approveVerification, rejectVerification, approveClaim, rejectClaim, resolveReport, deletePost, openCredential }
}
