import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Inbox, CheckCircle } from 'lucide-react'
import { Card, GhostBtn, Loading, Empty, ErrorState, useToast, Toast, ConfirmDialog } from '../../../components/ui'
import { createHealthRepository } from '../../../modules/health/repositories'

export default function JobQueue({ repository = createHealthRepository() }) {
  const [tab, setTab] = useState('notifications')
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(null)
  const { msg, type, show: showToast } = useToast()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await repository.getDeadLetters({ queue: tab, status: 'open', limit: 50 }).catch(() => [])
      setRows(Array.isArray(data) ? data : [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [repository, tab])
  useEffect(() => { load() }, [load])

  const doRetry = async () => {
    if (!confirm) return
    try { await repository.retryDeadLetter(confirm.id); showToast('Retried', { type: 'success' }); setConfirm(null); load() } catch (e) { showToast(e.message, { type: 'error' }) }
  }

  if (loading && rows == null) return <Loading />
  if (error) return <ErrorState message={error} onRetry={load} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {['notifications', 'webhooks', 'payout_mismatch'].map(q => (
            <button key={q} onClick={() => setTab(q)} style={{ padding: '7px 12px', borderRadius: 8, border: tab === q ? '1px solid var(--teal)' : '1px solid var(--border)', background: tab === q ? 'var(--teal-mist)' : 'var(--panel)', color: tab === q ? 'var(--teal)' : 'var(--muted)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>{q}</button>
          ))}
        </div>
        <GhostBtn onClick={load}><RefreshCw size={12} style={{ marginRight: 6 }} />Refresh</GhostBtn>
      </Card>

      {rows.length === 0 ? (
        <Card style={{ padding: 32, background: 'var(--panel)', border: '1px solid var(--border)', textAlign: 'center' }}><Empty icon={<CheckCircle size={24} />} message={`All ${tab} queues clear`} /></Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(r => (
            <Card key={r.id} style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12 }}><div style={{ fontWeight: 700, color: 'var(--fg)' }}>{r.error?.slice(0, 80)}</div><div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', background: 'var(--hairline)', padding: 6, borderRadius: 6, marginTop: 6, maxHeight: 100, overflow: 'auto' }}>{JSON.stringify(r.payload, null, 2)}</div></div>
              <GhostBtn onClick={() => setConfirm(r)}>Retry</GhostBtn>
            </Card>
          ))}
        </div>
      )}
      <ConfirmDialog show={!!confirm} title="Retry job?" onClose={() => setConfirm(null)} onConfirm={doRetry} confirmLabel="Retry" message={<div style={{ fontSize: 13 }}>Idempotent via reference-uniqueness.</div>} />
      <Toast msg={msg} type={type} />
    </div>
  )
}
