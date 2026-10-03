import { useState, useEffect, useCallback } from 'react'
import { Search, RefreshCw, Flag, Eye, Undo2, Trash2, Shield, AlertTriangle, CheckCircle } from 'lucide-react'
import { Card, GhostBtn, TealBtn, Loading, Empty, ErrorState, useToast, Toast, ConfirmDialog } from '../../../components/ui'
import { createTrustRepository } from '../../../modules/trust/repositories'

function ReportRow({ report, onQuarantine, onRestore, onDelete, busy }) {
  const isQuarantined = !!report.posts?.is_quarantined || !!report.is_quarantined
  return (
    <Card style={{ padding: 12, background: isQuarantined ? 'var(--amber-bg)' : 'var(--panel)', border: `1px solid ${isQuarantined ? 'var(--amber)' : 'var(--border)'}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6 }}><Flag size={12} style={{ color: isQuarantined ? 'var(--amber)' : 'var(--muted)' }} /> {report.reason || 'Report'} <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>• {new Date(report.created_at).toLocaleString()} • {isQuarantined ? 'quarantined (hidden from feed/search)' : 'visible'}</span></div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, background: 'var(--hairline)', padding: 8, borderRadius: 8, maxHeight: 80, overflow: 'auto' }}>{report.posts?.content?.slice(0, 300) || report.reason || '—'}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{report.posts?.id ? `Post ${report.posts.id.slice(0, 8)}` : `Report ${report.id.slice(0, 8)}`} {report.reporter_id ? `• reporter ${report.reporter_id.slice(0, 6)}` : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {!isQuarantined ? (
            <button disabled={busy} onClick={() => onQuarantine(report)} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: 'var(--amber)', color: 'white', fontWeight: 700, fontSize: 12, cursor: busy ? 'not-allowed' : 'pointer' }}><Eye size={11} style={{ marginRight: 4 }} />Quarantine</button>
          ) : (
            <button disabled={busy} onClick={() => onRestore(report)} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--teal)', background: 'var(--panel)', color: 'var(--teal)', fontWeight: 700, fontSize: 12, cursor: busy ? 'not-allowed' : 'pointer' }}><Undo2 size={11} style={{ marginRight: 4 }} />Restore</button>
          )}
          <button disabled={busy} onClick={() => onDelete(report)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--red)', background: 'var(--panel)', color: 'var(--red)', fontWeight: 700, fontSize: 12, cursor: busy ? 'not-allowed' : 'pointer' }}><Trash2 size={11} /></button>
        </div>
      </div>
    </Card>
  )
}

export default function Moderation({ repository = createTrustRepository() }) {
  const [reports, setReports] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filterQuarantined, setFilterQuarantined] = useState('all')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [busy, setBusy] = useState(false)
  const { msg, type, show: showToast } = useToast()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await repository.getReports({ status: 'pending', limit: 50 })
      // Try to enrich with post quarantine flag where available
      setReports(Array.isArray(data) ? data : [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [repository])
  useEffect(() => { load() }, [load])

  const filtered = (() => {
    let list = Array.isArray(reports) ? reports : []
    if (filterQuarantined === 'quarantined') list = list.filter(r => r.is_quarantined || r.posts?.is_quarantined)
    if (filterQuarantined === 'visible') list = list.filter(r => !(r.is_quarantined || r.posts?.is_quarantined))
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(r => `${r.reason} ${r.posts?.content}`.toLowerCase().includes(q))
    }
    return list
  })()

  const handleQuarantine = async (report) => {
    const postId = report.posts?.id || report.post_id
    if (!postId) { showToast('No post_id to quarantine', { type: 'error' }); return }
    setBusy(true)
    try {
      await repository.quarantinePost(postId, report.reason || 'moderation quarantine', null)
      showToast('Quarantined — hidden from feed/search', { type: 'success' })
      load()
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }

  const handleRestore = async (report) => {
    const postId = report.posts?.id || report.post_id
    if (!postId) return
    setBusy(true)
    try {
      const { sbFetch } = await import('../../../services/supabase.js')
      await sbFetch(`posts?id=eq.${postId}`, { method: 'PATCH', body: JSON.stringify({ is_quarantined: false }), prefer: 'return=minimal' })
      await repository.logModeration({ target_type: 'post', target_id: postId, action: 'restore', reason: 'moderation restore', actor_admin_id: null })
      showToast('Restored — visible again', { type: 'success' })
      load()
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    setBusy(true)
    try {
      const { sbFetch } = await import('../../../services/supabase.js')
      const postId = confirmDelete.posts?.id || confirmDelete.post_id
      if (postId) await sbFetch(`posts?id=eq.${postId}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {})
      await sbFetch(`reports?id=eq.${confirmDelete.id}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {})
      await repository.logModeration({ target_type: 'report', target_id: confirmDelete.id, action: 'delete', reason: confirmDelete.reason || 'delete report', actor_admin_id: null })
      showToast('Deleted', { type: 'success' })
      setConfirmDelete(null)
      load()
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }

  if (loading && reports == null) return <Loading />
  if (error) return <ErrorState message={error} onRetry={load} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
          <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search report reason / post" aria-label="Search moderation" style={{ width: '100%', padding: '9px 12px 9px 30px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }} />
          </div>
          <select value={filterQuarantined} onChange={e => setFilterQuarantined(e.target.value)} aria-label="Filter quarantined" style={{ padding: '9px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }}>
            <option value="all">All</option>
            <option value="visible">Visible</option>
            <option value="quarantined">Quarantined</option>
          </select>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{filtered.length} reports</span>
        </div>
        <GhostBtn onClick={load}><RefreshCw size={12} style={{ marginRight: 6 }} />Refresh</GhostBtn>
      </Card>

      <Card style={{ padding: 12, background: 'var(--amber-bg)', border: '1px solid var(--amber)', display: 'flex', gap: 8 }}>
        <AlertTriangle size={14} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: 12, color: 'var(--amber)' }}><b>Quarantine ≠ Delete:</b> Quarantine hides from feed/search/index, keeps row + audit, reversible. Delete is permanent + removes likes/comments (like `AdminPanel:756`). Use Quarantine first.</div>
      </Card>

      {filtered.length === 0 ? (
        <Card style={{ padding: 32, background: 'var(--panel)', border: '1px solid var(--border)', textAlign: 'center' }}><Empty icon={<Shield size={28} />} message="No reports — or no quarantined items for filter. Reports appear here when users flag content." /></Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(r => (
            <ReportRow key={r.id} report={r} onQuarantine={handleQuarantine} onRestore={handleRestore} onDelete={setConfirmDelete} busy={busy} />
          ))}
        </div>
      )}

      <ConfirmDialog show={!!confirmDelete} title="Permanently delete?" onClose={() => setConfirmDelete(null)} onConfirm={handleDelete} confirmLabel={busy ? 'Deleting...' : 'Delete'} variant="danger"
        message={<div style={{ fontSize: 13 }}><div>This permanently deletes the post + its likes/comments and the report. <b>Quarantine</b> is reversible — delete is not.</div><div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 12 }}>Audited to moderation_actions.</div></div>} />
      <Toast msg={msg} type={type} />
    </div>
  )
}
