import { useState, useEffect, useCallback } from 'react'
import { ShieldCheck, RefreshCw, Play } from 'lucide-react'
import { Card, Empty, Loading, ErrorState } from '@care-ecosystem/design-system/components/ui'
import { AdminPageHeader } from '../ui'
import { callAdminAuth } from '../adminApi'

// What the money checks found (reconciliation_findings). The server runs the checks and keeps the findings; a person can
// acknowledge a finding (silences reminders), dismiss one with a note explaining why (it is never reopened), or reopen one.
// Nothing here changes any money: it only records decisions about what the checks reported.

const FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' },
]
const SEVERITY = {
  critical: { label: 'Critical', color: 'var(--red)', bg: 'var(--red-bg)' },
  warning: { label: 'Warning', color: 'var(--amber, #b45309)', bg: 'var(--hairline)' },
  info: { label: 'Info', color: 'var(--muted)', bg: 'var(--hairline)' },
}
const MIN_NOTE = 5

const when = (iso) => (iso ? new Date(iso).toLocaleString() : '')

export default function ReconciliationTab({ showToast }) {
  const [status, setStatus] = useState('open')
  const [findings, setFindings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [runSummary, setRunSummary] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [dismissing, setDismissing] = useState(null) // finding id whose dismissal note is being written
  const [note, setNote] = useState('')

  const load = useCallback(async (s = status) => {
    setLoading(true)
    setError('')
    try {
      // "open" in the UI means open AND acknowledged are both still unresolved; the server lists both for the default view.
      const { data } = await callAdminAuth('admin_list_reconciliation', s === 'open' ? {} : { status: s })
      setFindings(data || [])
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }, [status])

  useEffect(() => { load(status) }, [status, load])

  async function update(id, op, text) {
    setBusyId(id)
    try {
      await callAdminAuth('admin_update_reconciliation_finding', { id, op, note: text })
      showToast(op === 'dismiss' ? 'Finding dismissed' : op === 'acknowledge' ? 'Finding acknowledged' : 'Finding reopened', { type: 'success' })
      setDismissing(null)
      setNote('')
      await load(status)
    } catch (e) {
      showToast(`Couldn't update the finding: ${e.message}`, { type: 'error' })
    }
    setBusyId(null)
  }

  async function runNow() {
    setRunning(true)
    setRunSummary('')
    try {
      const { report } = await callAdminAuth('admin_run_reconciliation')
      const t = report?.db?.totals
      const failed = report?.failed?.length ? ` Steps that failed: ${report.failed.join(', ')}.` : ''
      setRunSummary(t ? `Checked. ${t.open_critical} critical, ${t.open_warning} warning, ${t.open_info} info open.${failed}` : `Run finished.${failed}`)
      await load(status)
    } catch (e) {
      showToast(`The check could not run: ${e.message}`, { type: 'error' })
    }
    setRunning(false)
  }

  const critical = findings.filter((f) => f.severity === 'critical' && ['open', 'acknowledged'].includes(f.status)).length

  return (
    <div>
      <AdminPageHeader title="Money Checks" subtitle="Differences found between our books, the payment engines and Paystack">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => load(status)} disabled={loading} aria-label="Refresh findings" style={btn()}>
            <RefreshCw size={12} /> Refresh
          </button>
          <button type="button" onClick={runNow} disabled={running} style={btn(true)}>
            <Play size={12} /> {running ? 'Running…' : 'Run checks now'}
          </button>
        </div>
      </AdminPageHeader>

      <div role="status" aria-live="polite" style={{ minHeight: runSummary ? 20 : 0, fontSize: 12, color: 'var(--muted)', marginBottom: runSummary ? 10 : 0 }}>{runSummary}</div>

      <div role="tablist" aria-label="Finding status" style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {FILTERS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={status === opt.value}
            onClick={() => setStatus(opt.value)}
            style={{ padding: '6px 14px', borderRadius: 9999, border: status === opt.value ? '1px solid var(--teal)' : '1px solid var(--border)', background: status === opt.value ? 'var(--teal-mist)' : 'var(--panel)', color: status === opt.value ? 'var(--teal)' : 'var(--muted)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={() => load(status)} /> : findings.length === 0 ? (
        <div style={{ minHeight: 108, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12 }}>
          <Empty icon={<ShieldCheck size={28} />} message={status === 'open' ? 'Nothing needs attention. Every check agrees.' : `No ${status} findings`} />
        </div>
      ) : (
        <>
          {status === 'open' && critical > 0 && (
            <div role="alert" style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--red-bg)', color: 'var(--red)', fontWeight: 700, fontSize: 12 }}>
              {critical} critical finding{critical === 1 ? '' : 's'} need a decision.
            </div>
          )}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {findings.map((f) => {
              const sev = SEVERITY[f.severity] || SEVERITY.info
              const open = f.status === 'open'
              return (
                <li key={f.id}>
                  <Card style={{ padding: 14, border: `1px solid ${f.severity === 'critical' && ['open', 'acknowledged'].includes(f.status) ? 'var(--red)' : 'var(--border)'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--fg)', wordBreak: 'break-word' }}>{f.kind.replace(/_/g, ' ')}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{f.source} · {f.subject_type} · <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{f.subject_id}</span></div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: sev.color, background: sev.bg, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 9999 }}>{sev.label}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>{f.status}</span>
                      </div>
                    </div>
                    <p style={{ margin: '8px 0', fontSize: 12, color: 'var(--fg)', wordBreak: 'break-word' }}>{f.detail}</p>
                    {f.note && <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--muted)' }}>Note: {f.note}</p>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>First seen {when(f.first_seen_at)} · last seen {when(f.last_seen_at)} · seen {f.occurrences}×</span>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {open && <button type="button" disabled={busyId === f.id} onClick={() => update(f.id, 'acknowledge')} style={btn()}>Acknowledge</button>}
                        {['open', 'acknowledged'].includes(f.status) && <button type="button" disabled={busyId === f.id} onClick={() => { setDismissing(f.id); setNote('') }} style={btn()}>Dismiss…</button>}
                        {['resolved', 'dismissed', 'acknowledged'].includes(f.status) && <button type="button" disabled={busyId === f.id} onClick={() => update(f.id, 'reopen')} style={btn()}>Reopen</button>}
                      </div>
                    </div>
                    {dismissing === f.id && (
                      <form
                        onSubmit={(e) => { e.preventDefault(); if (note.trim().length >= MIN_NOTE) update(f.id, 'dismiss', note.trim()) }}
                        style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}
                      >
                        <label htmlFor={`note-${f.id}`} style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg)' }}>Why is this explained? (kept on the record)</label>
                        <textarea
                          id={`note-${f.id}`}
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          rows={2}
                          maxLength={500}
                          style={{ padding: 8, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13, resize: 'vertical' }}
                        />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button type="submit" disabled={busyId === f.id || note.trim().length < MIN_NOTE} style={btn(true)}>Dismiss finding</button>
                          <button type="button" onClick={() => { setDismissing(null); setNote('') }} style={btn()}>Cancel</button>
                        </div>
                      </form>
                    )}
                  </Card>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

function btn(primary = false) {
  return {
    padding: '6px 12px', borderRadius: 8, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700,
    border: primary ? 'none' : '1px solid var(--border)', background: primary ? 'var(--teal)' : 'var(--panel)', color: primary ? 'white' : 'var(--muted)',
  }
}
