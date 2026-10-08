import { useState, useEffect, useCallback } from 'react'
import { Search, RefreshCw, Shield, FileText, Trash2, Download, Clock } from 'lucide-react'
import { Card, GhostBtn, TealBtn, Inp, Sel, Loading, Empty, ErrorState, useToast, Toast, ConfirmDialog } from '../../../components/ui'
import { createComplianceRepository } from '../../../modules/compliance/repositories'

export default function Compliance({ repository = createComplianceRepository() }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('open')
  const [typeFilter, setTypeFilter] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ subject_type: 'business', subject_id: '', request_type: 'export', reason: '' })
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const { msg, type, show: showToast } = useToast()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await repository.getRequests({ status: statusFilter || undefined, type: typeFilter || undefined, limit: 50 })
      setRows(Array.isArray(data) ? data : [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [repository, statusFilter, typeFilter])
  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!form.subject_id.trim() || !form.reason.trim()) { showToast('Subject and reason required', { type: 'error' }); return }
    setBusy(true)
    try {
      await repository.createRequest({ subject_type: form.subject_type, subject_id: form.subject_id.trim(), request_type: form.request_type, reason: form.reason.trim() })
      showToast('Request created', { type: 'success' }); setShowNew(false); setForm({ subject_type: 'business', subject_id: '', request_type: 'export', reason: '' }); load()
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }

  const handleUpdate = async () => {
    if (!confirm) return
    setBusy(true)
    try {
      await repository.updateRequest(confirm.id, { status: confirm.next, completed_at: new Date().toISOString() })
      showToast(`Request ${confirm.next}`, { type: 'success' }); setConfirm(null); load()
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }

  if (loading && rows == null) return <Loading />
  if (error) return <ErrorState message={error} onRetry={load} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label="Filter status" style={{ padding: '9px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }}>
            <option value="open">open</option>
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
            <option value="completed">completed</option>
            <option value="">all</option>
          </select>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} aria-label="Filter type" style={{ padding: '9px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }}>
            <option value="">All types</option>
            <option value="export">export</option>
            <option value="delete">delete</option>
          </select>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{rows.length} requests</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostBtn onClick={load}><RefreshCw size={12} style={{ marginRight: 6 }} />Refresh</GhostBtn>
          <TealBtn onClick={() => setShowNew(true)}>+ New request</TealBtn>
        </div>
      </Card>

      <Card style={{ padding: 12, background: 'var(--hairline)', border: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}><b>Retention:</b> `admin_audit_log` 90d → 1yr (view 1yr sample via `since`), `export_logs` watermark+reason required, `moderation_actions` append-only. Purge job keeps hash.</div>
        <span style={{ fontSize: 11, background: 'var(--panel)', padding: '4px 8px', borderRadius: 6, color: 'var(--muted)', border: '1px solid var(--border)' }}>NDPR / GDPR</span>
      </Card>

      {rows.length === 0 ? (
        <Card style={{ padding: 32, background: 'var(--panel)', border: '1px solid var(--border)', textAlign: 'center' }}><Empty icon={<Shield size={28} />} message="No compliance requests — export/delete on request." /></Card>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden', background: 'var(--panel)', border: '1px solid var(--border)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ borderBottom: '1px solid var(--border)' }}><tr style={{ height: 36 }}>
                <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Subject</th>
                <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Type</th>
                <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Reason</th>
                <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Status</th>
                <th style={{ padding: '0 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Actions</th>
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ height: 36, borderBottom: '1px solid var(--hairline)' }}>
                    <td style={{ padding: '0 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg)' }}>{r.subject_type}/{r.subject_id.slice(0, 8)}</td>
                    <td style={{ padding: '0 12px' }}><span style={{ padding: '3px 7px', borderRadius: 6, background: r.request_type === 'delete' ? 'var(--red-bg)' : 'var(--teal-mist)', color: r.request_type === 'delete' ? 'var(--red)' : 'var(--teal)', fontWeight: 700, fontSize: 11 }}>{r.request_type}</span></td>
                    <td style={{ padding: '0 12px', fontSize: 12, color: 'var(--muted)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reason}</td>
                    <td style={{ padding: '0 12px' }}><span style={{ padding: '3px 7px', borderRadius: 6, background: 'var(--hairline)', color: 'var(--fg)', fontWeight: 700, fontSize: 11 }}>{r.status}</span></td>
                    <td style={{ padding: '0 12px', textAlign: 'right' }}>
                      {r.status === 'open' && <>
                        <button onClick={() => setConfirm({ id: r.id, next: 'approved' })} style={{ padding: '5px 10px', borderRadius: 8, border: 'none', background: 'var(--green)', color: 'white', fontWeight: 700, fontSize: 11, cursor: 'pointer', marginRight: 6 }}>Approve</button>
                        <button onClick={() => setConfirm({ id: r.id, next: 'rejected' })} style={{ padding: '5px 10px', borderRadius: 8, border: 'none', background: 'var(--red)', color: 'white', fontWeight: 700, fontSize: 11, cursor: 'pointer', marginRight: 6 }}>Reject</button>
                      </>}
                      {r.status === 'approved' && <button onClick={() => setConfirm({ id: r.id, next: 'completed' })} style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid var(--teal)', background: 'var(--panel)', color: 'var(--teal)', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>Mark completed</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showNew && (
        <Card style={{ padding: 16, background: 'var(--panel)', border: '1px solid var(--teal)' }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', marginBottom: 10 }}>New compliance request</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
            <Sel label="Subject type" value={form.subject_type} onChange={v => setForm(s => ({ ...s, subject_type: v }))} options={[{ value: 'business', label: 'business' }, { value: 'profile', label: 'profile' }]} />
            <Inp label="Subject ID *" value={form.subject_id} onChange={v => setForm(s => ({ ...s, subject_id: v }))} placeholder="business_id / profile id" />
            <Sel label="Request type" value={form.request_type} onChange={v => setForm(s => ({ ...s, request_type: v }))} options={[{ value: 'export', label: 'export' }, { value: 'delete', label: 'delete' }]} />
            <Inp label="Reason *" value={form.reason} onChange={v => setForm(s => ({ ...s, reason: v }))} placeholder="GDPR Art.17 / NDPR" />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <GhostBtn onClick={() => setShowNew(false)} style={{ flex: 1 }}>Cancel</GhostBtn>
            <TealBtn disabled={busy} onClick={handleCreate} style={{ flex: 1 }}>{busy ? 'Creating...' : 'Create'}</TealBtn>
          </div>
        </Card>
      )}

      <ConfirmDialog show={!!confirm} title={`${confirm?.next} request?`} onClose={() => setConfirm(null)} onConfirm={handleUpdate} confirmLabel={busy ? 'Saving...' : confirm?.next} variant={confirm?.next === 'rejected' ? 'danger' : 'default'} message={<div style={{ fontSize: 13 }}>Updates <code>compliance_requests.status</code> + audit. Delete requires completed → 2-approver hard delete via Businesses.</div>} />
      <Toast msg={msg} type={type} />
    </div>
  )
}
