import { useState, useEffect, useCallback } from 'react'
import { ShieldAlert, RefreshCw, AlertTriangle, CheckCircle, Clock, X } from 'lucide-react'
import { Card, GhostBtn, TealBtn, Inp, Sel, Loading, Empty, ErrorState, useToast, Toast, ConfirmDialog } from '../../../components/ui'
import { createHealthRepository } from '../../../modules/health/repositories'

function StatusDot({ status }) {
  const map = { up: 'var(--green)', degraded: 'var(--amber)', down: 'var(--red)' }
  const c = map[status] || 'var(--gray)'
  return <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 9999, background: c, display: 'inline-block', flexShrink: 0 }} />
}

export default function HealthLights({ repository = createHealthRepository() }) {
  const [checks, setChecks] = useState(null)
  const [incidents, setIncidents] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ title: '', message: '', severity: 'amber', is_maintenance: false, pause_signups: false })
  const [busy, setBusy] = useState(false)
  const [confirmDismiss, setConfirmDismiss] = useState(null)
  const { msg, type, show: showToast } = useToast()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [c, inc] = await Promise.all([
        repository.getHealthChecks({ limit: 20 }).catch(() => []),
        repository.getIncidents({ limit: 10 }).catch(() => []),
      ])
      setChecks(Array.isArray(c) ? c : [])
      setIncidents(Array.isArray(inc) ? inc : [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [repository])

  useEffect(() => { load() }, [load])

  // 30s poll + lastSynced ticker already handled in AdminDashboard pulse, but keep local refresh
  useEffect(() => {
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  const handleCreate = async () => {
    if (!form.title.trim() || !form.message.trim()) { showToast('Title and message required', { type: 'error' }); return }
    setBusy(true)
    try {
      await repository.createIncident({ title: form.title.trim(), message: form.message.trim(), severity: form.severity, is_maintenance: !!form.is_maintenance, pause_signups: !!form.pause_signups })
      await repository.logAudit({ action: 'create_incident', target_table: 'admin_incidents', target_id: form.title.trim(), after: form }).catch(() => {})
      showToast('Incident posted — banner live', { type: 'success' })
      setForm({ title: '', message: '', severity: 'amber', is_maintenance: false, pause_signups: false })
      setShowNew(false)
      load()
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }

  const handleDismiss = async () => {
    if (!confirmDismiss) return
    setBusy(true)
    try {
      await repository.deleteIncident(confirmDismiss.id)
      await repository.logAudit({ action: 'dismiss_incident', target_table: 'admin_incidents', target_id: confirmDismiss.id, before: confirmDismiss }).catch(() => {})
      showToast('Incident dismissed', { type: 'success' })
      setConfirmDismiss(null)
      load()
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }

  // derived lights: latest check per target
  const latestByTarget = (() => {
    const m = {}
    for (const c of (checks || [])) {
      if (!m[c.target]) m[c.target] = c
    }
    return m
  })()
  const targets = ['api', 'db', 'storage', 'paystack']
  const hasActive = Array.isArray(incidents) && incidents.length > 0

  if (loading && checks == null) return <Loading />
  if (error) return <ErrorState message={error} onRetry={load} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Lights strip — 4 lights responsive */}
      <Card style={{ padding: 14, background: 'var(--panel)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6 }}><ShieldAlert size={14} style={{ color: 'var(--teal)' }} /> Health Lights <span style={{ fontSize: 10, background: 'var(--hairline)', color: 'var(--muted)', padding: '2px 6px', borderRadius: 6, fontWeight: 700 }}>30s poll</span></div>
          <GhostBtn onClick={load}><RefreshCw size={12} style={{ marginRight: 6 }} />Refresh</GhostBtn>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
          {targets.map(t => {
            const c = latestByTarget[t]
            const status = c?.status || 'up'
            const tone = status === 'up' ? 'var(--green)' : status === 'degraded' ? 'var(--amber)' : 'var(--red)'
            return (
              <div key={t} style={{ padding: 12, borderRadius: 10, border: `1px solid ${status === 'up' ? 'var(--border)' : tone}`, background: status === 'up' ? 'var(--panel)' : status === 'degraded' ? 'var(--amber-bg)' : 'var(--red-bg)', display: 'flex', gap: 10, alignItems: 'center' }}>
                <StatusDot status={status} />
                <div>
                  <div style={{ fontWeight: 800, fontSize: 12, textTransform: 'uppercase', color: 'var(--fg)' }}>{t}</div>
                  <div style={{ fontSize: 11, color: status === 'up' ? 'var(--muted)' : tone, fontWeight: 700 }} aria-live="polite">{c ? `${status} ${c.latency_ms ? `• ${c.latency_ms}ms` : ''}` : 'up • no data yet'}</div>
                  {c?.checked_at && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{new Date(c.checked_at).toLocaleTimeString()}</div>}
                </div>
                {status !== 'up' && <AlertTriangle size={14} style={{ marginLeft: 'auto', color: tone }} />}
                {status === 'up' && <CheckCircle size={14} style={{ marginLeft: 'auto', color: 'var(--green)' }} />}
              </div>
            )
          })}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}><Clock size={11} /> Last checked {checks?.[0]?.checked_at ? new Date(checks[0].checked_at).toLocaleTimeString() : 'just now'} • Polls every 30s, realtime on incident create</div>
      </Card>

      {/* Active banner preview + controls */}
      <Card style={{ padding: 14, background: hasActive && incidents[0].severity === 'red' ? 'var(--red-bg)' : hasActive ? 'var(--amber-bg)' : 'var(--panel)', border: hasActive ? `1px solid ${incidents[0].severity === 'red' ? 'var(--red)' : 'var(--amber)'}` : '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: hasActive ? (incidents[0].severity === 'red' ? 'var(--red)' : 'var(--amber)') : 'var(--fg)' }}>{hasActive ? `Active: ${incidents[0].title}` : 'No active incident — all clear'}</div>
          <TealBtn onClick={() => setShowNew(true)} style={{ padding: '7px 12px', fontSize: 12 }}>+ New incident / banner</TealBtn>
        </div>
        {hasActive ? (
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--fg)', lineHeight: 1.5 }}>
            <div>{incidents[0].message}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span>Severity: <b style={{ color: incidents[0].severity === 'red' ? 'var(--red)' : 'var(--amber)' }}>{incidents[0].severity}</b></span>
              {incidents[0].is_maintenance && <span>• Maintenance</span>}
              {incidents[0].pause_signups && <span>• Signups paused</span>}
              <span>• {new Date(incidents[0].created_at).toLocaleString()}</span>
            </div>
            <button onClick={() => setConfirmDismiss(incidents[0])} style={{ marginTop: 8, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--red)', background: 'var(--panel)', color: 'var(--red)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}><X size={12} style={{ marginRight: 4 }} />Dismiss banner</button>
          </div>
        ) : (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>Create a banner to notify all tenants. Example: “Payouts delayed — investigating” with amber dot. Toggle “Pause signups” blocks <code>registerBusiness</code> with banner.</div>
        )}
      </Card>

      {/* Recent incidents */}
      <Card style={{ padding: 14, background: 'var(--panel)', border: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', marginBottom: 10 }}>Recent incidents</div>
        {!incidents || incidents.length === 0 ? (
          <Empty icon={<CheckCircle size={24} />} message="No incidents yet — last 10 shown here when posted." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
            {incidents.map(inc => (
              <div key={inc.id} style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--panel)', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--fg)' }}><StatusDot status={inc.severity === 'red' ? 'down' : 'degraded'} /> {inc.title} <span style={{ fontWeight: 600, fontSize: 11, color: 'var(--muted)' }}>• {inc.severity}</span></div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{inc.message}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{new Date(inc.created_at).toLocaleString()} {inc.pause_signups ? '• signups paused' : ''}</div>
                </div>
                <button onClick={() => setConfirmDismiss(inc)} style={{ alignSelf: 'center', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--hairline)', color: 'var(--muted)', fontWeight: 700, fontSize: 11, cursor: 'pointer', flexShrink: 0 }}>Dismiss</button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* New incident Sheet-like modal inline */}
      {showNew && (
        <Card style={{ padding: 16, background: 'var(--panel)', border: '1px solid var(--teal)' }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', marginBottom: 10 }}>New incident / banner</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Inp label="Title *" value={form.title} onChange={v => setForm(s => ({ ...s, title: v }))} placeholder="e.g. Payouts delayed — investigating" />
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}><span style={{ fontWeight: 600, color: 'var(--fg)' }}>Message *</span><textarea value={form.message} onChange={e => setForm(s => ({ ...s, message: e.target.value }))} placeholder="What tenants see" rows={3} style={{ padding: 10, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }} /></label>
            <Sel label="Severity" value={form.severity} onChange={v => setForm(s => ({ ...s, severity: v }))} options={[{ value: 'amber', label: 'amber — degraded' }, { value: 'red', label: 'red — down' }]} />
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--fg)' }}><input type="checkbox" checked={form.is_maintenance} onChange={e => setForm(s => ({ ...s, is_maintenance: e.target.checked }))} /> Maintenance mode</label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--fg)' }}><input type="checkbox" checked={form.pause_signups} onChange={e => setForm(s => ({ ...s, pause_signups: e.target.checked }))} /> Pause new signups (blocks registerBusiness)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <GhostBtn onClick={() => setShowNew(false)} style={{ flex: 1 }}>Cancel</GhostBtn>
              <TealBtn disabled={busy} onClick={handleCreate} style={{ flex: 1 }}>{busy ? 'Posting...' : 'Post banner'}</TealBtn>
            </div>
          </div>
        </Card>
      )}

      <ConfirmDialog show={!!confirmDismiss} title="Dismiss incident?" onClose={() => setConfirmDismiss(null)} onConfirm={handleDismiss} confirmLabel={busy ? 'Dismissing...' : 'Dismiss'} variant="danger" message={<div style={{ fontSize: 13 }}>This removes the banner for all tenants. Audited.</div>} />
      <Toast msg={msg} type={type} />
    </div>
  )
}
