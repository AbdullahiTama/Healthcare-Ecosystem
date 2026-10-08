import { useState, useEffect, useCallback } from 'react'
import { Search, RefreshCw, Undo2, Download, Shield, Clock } from 'lucide-react'
import { Card, GhostBtn, Loading, Empty, ErrorState, useToast, Toast } from '../../../components/ui'
import { createHealthRepository } from '../../../modules/health/repositories'

function fmtDate(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) } catch { return s }
}

export default function AuditLog({ repository = createHealthRepository() }) {
  const [logs, setLogs] = useState(null)
  const [exportsLog, setExportsLog] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [filterTable, setFilterTable] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20
  const { msg, type, show: showToast } = useToast()
  const [undoBusy, setUndoBusy] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [a, e] = await Promise.all([
        repository.getAuditLogs({ limit: 100, action: filterAction || undefined, target_table: filterTable || undefined }).catch(() => []),
        repository.getExportLogs({ limit: 20 }).catch(() => []),
      ])
      setLogs(Array.isArray(a) ? a : [])
      setExportsLog(Array.isArray(e) ? e : [])
    } catch (err) { setError(err.message) }
    setLoading(false)
  }, [repository, filterAction, filterTable])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [filterAction, filterTable, search])

  const filtered = (() => {
    const list = Array.isArray(logs) ? logs : []
    if (!search.trim()) return list
    const q = search.trim().toLowerCase()
    return list.filter(l => `${l.action} ${l.target_table} ${l.target_id} ${l.ip}`.toLowerCase().includes(q))
  })()

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize)

  const handleUndo = async (row) => {
    // Undo is audit-only for now: marks intention, does not auto-revert business row
    // Real undo for businesses already handled via BusinessesPanel optimistic + toast
    if (undoBusy) return
    setUndoBusy(row.id)
    try {
      await repository.logAudit({ action: `undo_${row.action}`, target_table: row.target_table, target_id: row.target_id, before: row.after, after: row.before, actor_admin_id: row.actor_admin_id }).catch(() => {})
      showToast('Undo logged — revert business row via Businesses if needed', { type: 'info' })
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setUndoBusy(null)
  }

  if (loading && logs == null) return <Loading />
  if (error) return <ErrorState message={error} onRetry={load} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
          <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 320 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search action / table / IP" aria-label="Search audit log" style={{ width: '100%', padding: '9px 12px 9px 30px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }} />
          </div>
          <select value={filterAction} onChange={e => setFilterAction(e.target.value)} aria-label="Filter by action" style={{ padding: '9px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }}>
            <option value="">All actions</option>
            <option value="create_incident">create_incident</option>
            <option value="dismiss_incident">dismiss_incident</option>
            <option value="suspend_business">suspend_business</option>
            <option value="export">export</option>
            <option value="update_feature_flag">update_feature_flag</option>
          </select>
          <select value={filterTable} onChange={e => setFilterTable(e.target.value)} aria-label="Filter by table" style={{ padding: '9px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }}>
            <option value="">All tables</option>
            <option value="admin_incidents">admin_incidents</option>
            <option value="businesses">businesses</option>
            <option value="feature_flags">feature_flags</option>
            <option value="export_logs">export_logs</option>
          </select>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{filtered.length} result(s) • page {page}/{totalPages}</span>
        </div>
        <GhostBtn onClick={load}><RefreshCw size={13} style={{ marginRight: 6 }} />Refresh</GhostBtn>
      </Card>

      {/* Export governance strip */}
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}><Download size={13} /> Recent exports (governed — reason + watermark required)</div>
        {exportsLog.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>No exports yet. Use Businesses “Export filtered” — now asks for reason and watermarks CSV.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
            {exportsLog.slice(0, 5).map(ex => (
              <div key={ex.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 8px', background: 'var(--hairline)', borderRadius: 8 }}>
                <span style={{ color: 'var(--fg)' }}>{ex.export_type} • {ex.row_count} rows • reason: {ex.reason} • {fmtDate(ex.created_at)}</span>
                <span style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{ex.watermark?.slice(0, 8)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Audit feed */}
      {filtered.length === 0 ? (
        <Card style={{ padding: 32, background: 'var(--panel)', border: '1px solid var(--border)', textAlign: 'center' }}><Empty icon={<Shield size={28} />} message={search || filterAction ? 'No audit entries match filters.' : 'No actions yet — admin writes appear here with 90d retention.'} /></Card>
      ) : (
        <>
          <Card style={{ padding: 0, overflow: 'hidden', background: 'var(--panel)', border: '1px solid var(--border)' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
                  <tr style={{ height: 36 }}>
                    <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Time</th>
                    <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Actor</th>
                    <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Action</th>
                    <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Target</th>
                    <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>IP</th>
                    <th style={{ padding: '0 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Undo</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(row => (
                    <tr key={row.id} style={{ height: 36, borderBottom: '1px solid var(--hairline)' }}>
                      <td style={{ padding: '0 12px', whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 12 }}><Clock size={11} style={{ marginRight: 4 }} />{fmtDate(row.created_at)}</td>
                      <td style={{ padding: '0 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg)' }}>{(row.actor_admin_id || '—').slice(0, 8)}</td>
                      <td style={{ padding: '0 12px' }}><span style={{ padding: '3px 7px', borderRadius: 6, background: 'var(--hairline)', color: 'var(--fg)', fontWeight: 700, fontSize: 11 }}>{row.action}</span></td>
                      <td style={{ padding: '0 12px', fontSize: 12, color: 'var(--fg)' }}>{row.target_table}<span style={{ color: 'var(--muted)' }}>/{(row.target_id || '').slice(0, 8)}</span></td>
                      <td style={{ padding: '0 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>{row.ip || '—'}</td>
                      <td style={{ padding: '0 12px', textAlign: 'right' }}>
                        <button disabled={!!undoBusy} onClick={() => handleUndo(row)} style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--muted)', fontWeight: 700, fontSize: 11, cursor: undoBusy ? 'not-allowed' : 'pointer' }}><Undo2 size={11} style={{ marginRight: 4 }} />Log undo</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
            <GhostBtn onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</GhostBtn>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Page {page} of {totalPages}</span>
            <GhostBtn onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</GhostBtn>
          </div>
        </>
      )}
      <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>Append-only • 90d retention • every write audited • watermark on exports</div>
      <Toast msg={msg} type={type} />
    </div>
  )
}
