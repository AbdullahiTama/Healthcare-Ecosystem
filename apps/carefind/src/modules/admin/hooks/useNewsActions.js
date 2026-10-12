import { useCallback, useState } from 'react'
import { callAdminAuth } from '../adminApi'
import { useAdmin } from '../provider/AdminProvider.jsx'
import { bestEffort } from '../lib/bestEffort'

// The news approve, reject and delete handlers that used to live in
// LegacyTabHost, calling the same server actions with the same payloads and
// writing the same audit and action-history entries. Each resolves { ok } or
// { ok: false, error } so the caller can show a failure where the admin is
// looking.
//
// Differences from the legacy handlers: a failure is returned rather than
// toasted, the lists are refreshed once (legacy refreshed twice and edited the
// query cache by hand), and nothing runs after the server call that can turn a
// committed action into a reported failure.

async function audit(auditAction, targetType, targetId, metadata = {}) {
  try {
    await callAdminAuth('log_audit_action', { auditAction, targetType, targetId, metadata })
  } catch { /* an audit failure must not block moderation */ }
}

export function useNewsActions() {
  const { showToast, invalidateAdmin, recordAction } = useAdmin()
  const [busyId, setBusyId] = useState(null)

  const run = useCallback(async ({ id, action, payload, auditMetadata, record, success }) => {
    setBusyId(id)
    let result
    try {
      await callAdminAuth(action, payload)
      result = { ok: true }
    } catch (err) {
      result = { ok: false, error: err.message }
    } finally {
      setBusyId(null)
    }
    if (!result.ok) return result
    audit(record ?? action.split('_')[0], 'news', id, auditMetadata)
    if (record) {
      bestEffort(`recording ${action}`, () => recordAction({ action: record, target: 'news', id, timestamp: new Date().toISOString() }))
    }
    bestEffort(`refreshing after ${action}`, invalidateAdmin)
    bestEffort(`toasting ${action}`, () => showToast(success, { type: 'success' }))
    return result
  }, [showToast, invalidateAdmin, recordAction])

  // The audit records the item's original headline, as legacy did; it falls
  // back to the headline sent when the caller does not pass one.
  const approveNews = ({ id, headline, subtitle, body, edited, originalHeadline }) => run({
    id, action: 'approve_news',
    payload: { id, edits: edited ? { headline, subtitle, body } : {} },
    auditMetadata: { headline: originalHeadline ?? headline }, record: 'approve', success: 'News item approved',
  })
  const rejectNews = (id) => run({
    id, action: 'reject_news', payload: { id },
    auditMetadata: {}, record: 'reject', success: 'News item rejected',
  })
  // Legacy wrote an audit entry but no action-history entry for a delete.
  const deleteNews = (id) => run({
    id, action: 'delete_news', payload: { id },
    auditMetadata: {}, success: 'News item deleted',
  })

  return { busyId, approveNews, rejectNews, deleteNews }
}
