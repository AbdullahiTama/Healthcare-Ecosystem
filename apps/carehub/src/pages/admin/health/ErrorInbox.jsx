import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Bug, AlertTriangle, CheckCircle, Clock } from 'lucide-react'
import { Card, GhostBtn, Loading, Empty, ErrorState, useToast, Toast, ConfirmDialog } from '../../../components/ui'
import { createHealthRepository } from '../../../modules/health/repositories'

export default function ErrorInbox({ repository = createHealthRepository() }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterQueue, setFilterQueue] = useState('')
  const [confirm, setConfirm] = useState(null)
  const { msg, type, show: showToast } = useToast()
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await repository.getDeadLetters({ queue: filterQueue || undefined, status: 'open', limit: 50 }).catch(() => [])
      setRows(Array.isArray(data) ? data : [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [repository, filterQueue])
  useEffect(() => { load() }, [load])

  const handleRetry = async () => {
    if (!confirm) return
    setBusy(true)
    try {
      await repository.retryDeadLetter(confirm.id)
      await repository.logAudit({ action: 'retry_dead_letter', target_table: 'dead_letters', target_id: confirm.id }).catch(() => {})
      showToast('Retried — check audit for result', { type: 'success' })
      setConfirm(null); load()
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }
  const handleDismiss = async (row) => {
    setBusy(true)
    try {
      await repository.dismissDeadLetter(row.id)
      await repository.logAudit({ action: 'dismiss_dead_letter', target_table: 'dead_letters', target_id: row.id }).catch(() => {})
      showToast('Dismissed', { type: 'success' }); load()
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }

  if (loading && rows == null) return <Loading />
  if (error) return <ErrorState message={error} onRetry={load} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6 }}><Bug size={14} /> Error Inbox <span style={{ fontSize: 11, background: 'var(--hairline)', color: 'var(--muted)', padding: '2px 6px', borderRadius: 6 }}>dead_letters • open</span></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={filterQueue} onChange={e => setFilterQueue(e.target.value)} aria-label="Filter by queue" style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 12 }}>
            <option value="">All queues</option>
            <option value="webhooks">webhooks (Paystack)</option>
            <option value="notifications">notifications</option>
            <option value="payout_mismatch">payout_mismatch</option>
          </select>
          <GhostBtn onClick={load}><RefreshCw size={12} style={{ marginRight: 6 }} />Refresh</GhostBtn>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card style={{ padding: 32, background: 'var(--panel)', border: '1px solid var(--border)', textAlign: 'center' }}>
          <Empty icon={<CheckCircle size={24} />} message={filterQueue ? `No open ${filterQueue} errors — last checked just now.` : 'No errors — last checked just now. Dead letters appear here when webhooks/notifications fail.'} />
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(r => (
            <Card key={r.id} style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--amber)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={12} style={{ color: 'var(--amber)' }} /> {r.queue} • {r.error?.slice(0, 80)} <span style={{ fontWeight: 600, fontSize: 11, color: 'var(--muted)' }}>• retries {r.retries}</span></div>
                <span style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={11} /> {new Date(r.created_at).toLocaleString()}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)', background: 'var(--hairline)', padding: 8, borderRadius: 8, overflow: 'auto', maxHeight: 120 }}>{JSON.stringify(r.payload, null, 2)}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <GhostBtn onClick={() => setConfirm(r)} disabled={busy}>Retry</GhostBtn>
                <button onClick={() => handleDismiss(r)} disabled={busy} style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--hairline)', color: 'var(--muted)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Dismiss</button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <ConfirmDialog show={!!confirm} title="Retry this job?" onClose={() => setConfirm(null)} onConfirm={handleRetry} confirmLabel={busy ? 'Retrying...' : 'Retry'} message={<div style={{ fontSize: 13 }}>Retry is idempotent via reference-uniqueness. Audited to admin_audit_log.</div>} />
      <Toast msg={msg} type={type} />
    </div>
  )
}
