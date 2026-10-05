import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { ConfirmDialog, Toast, useToast } from '../../components/ui'
import { callAdminAuth } from './adminApi'

const FeedbackContext = createContext(null)

// One toast, one confirm dialog and one activity trail for the whole console,
// so screens do not each carry their own.
export function AdminFeedbackProvider({ children }) {
  const { msg, type, actionLabel, onAction, show } = useToast()
  const [confirmState, setConfirmState] = useState(null)
  const [recentActions, setRecentActions] = useState([])

  // Never a bare "Are you sure?": callers state the consequence.
  const askConfirm = useCallback(({ title, consequence, confirmLabel = 'Delete', action }) => {
    setConfirmState({ title, consequence, confirmLabel, action })
  }, [])

  const recordAction = useCallback((entry) => {
    setRecentActions(prev => [...prev.slice(-49), { timestamp: new Date().toISOString(), ...entry }])
  }, [])

  const value = useMemo(
    () => ({ showToast: show, askConfirm, recordAction, recentActions }),
    [show, askConfirm, recordAction, recentActions],
  )

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <ConfirmDialog
        show={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={() => { const action = confirmState?.action; setConfirmState(null); if (action) action() }}
        title={confirmState?.title}
        consequence={confirmState?.consequence}
        confirmLabel={confirmState?.confirmLabel || 'Delete'}
      />
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </FeedbackContext.Provider>
  )
}

function useFeedback() {
  const ctx = useContext(FeedbackContext)
  if (!ctx) throw new Error('Admin feedback hooks must be used inside AdminFeedbackProvider')
  return ctx
}

export function useAdminToast() { return useFeedback().showToast }
export function useAdminConfirm() { return useFeedback().askConfirm }
export function useAdminActivity() {
  const { recentActions, recordAction } = useFeedback()
  return { recentActions, recordAction }
}

export function useAuditLog() {
  return useCallback(async (auditAction, targetType, targetId, metadata = {}) => {
    try {
      await callAdminAuth('log_audit_action', { auditAction, targetType, targetId, metadata })
    } catch { /* non-blocking: an audit failure must not block moderation */ }
  }, [])
}
