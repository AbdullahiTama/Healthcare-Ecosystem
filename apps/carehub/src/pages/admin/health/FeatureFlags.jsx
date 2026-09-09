import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Shield, ToggleLeft, ToggleRight, AlertTriangle } from 'lucide-react'
import { Card, GhostBtn, Loading, Empty, ErrorState, useToast, Toast } from '../../../components/ui'
import { createHealthRepository } from '../../../modules/health/repositories'

export default function FeatureFlags({ repository = createHealthRepository() }) {
  const [flags, setFlags] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyKey, setBusyKey] = useState(null)
  const { msg, type, show: showToast } = useToast()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const rows = await repository.getFeatureFlags()
      setFlags(Array.isArray(rows) ? rows : [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [repository])
  useEffect(() => { load() }, [load])

  const toggle = async (flag) => {
    setBusyKey(flag.key)
    try {
      const before = { enabled: flag.enabled, rollout_pct: flag.rollout_pct }
      const after = { enabled: !flag.enabled }
      await repository.updateFeatureFlag(flag.key, after)
      await repository.logAudit({ action: 'update_feature_flag', target_table: 'feature_flags', target_id: flag.key, before, after }).catch(() => {})
      showToast(`${flag.key} ${!flag.enabled ? 'enabled' : 'disabled'}`, { type: 'success' })
      setFlags(prev => prev.map(f => f.key === flag.key ? { ...f, enabled: !f.enabled } : f))
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusyKey(null)
  }

  const setRollout = async (flag, pct) => {
    setBusyKey(flag.key + ':rollout')
    try {
      const before = { rollout_pct: flag.rollout_pct }
      await repository.updateFeatureFlag(flag.key, { rollout_pct: pct })
      await repository.logAudit({ action: 'update_feature_flag_rollout', target_table: 'feature_flags', target_id: flag.key, before, after: { rollout_pct: pct } }).catch(() => {})
      showToast(`${flag.key} rollout ${pct}%`, { type: 'success' })
      setFlags(prev => prev.map(f => f.key === flag.key ? { ...f, rollout_pct: pct } : f))
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusyKey(null)
  }

  if (loading && flags == null) return <Loading />
  if (error) return <ErrorState message={error} onRetry={load} />
  if (!flags || flags.length === 0) return <Empty icon={<Shield size={28} />} message="No feature flags seeded. Run 20260908_admin_platform_health.sql seed." />

  const isPlaceholder = (() => {
    try { return String(import.meta.env.VITE_PAYSTACK_SECRET_KEY || import.meta.env.PAYSTACK_SECRET_KEY || '').includes('REPLACE') } catch { return false }
  })()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6 }}><Shield size={14} /> Feature switches <span style={{ fontSize: 11, background: 'var(--hairline)', color: 'var(--muted)', padding: '2px 6px', borderRadius: 6 }}>owner only • audited</span></div>
        <GhostBtn onClick={load}><RefreshCw size={12} style={{ marginRight: 6 }} />Refresh</GhostBtn>
      </Card>

      {isPlaceholder && (
        <Card style={{ padding: 12, background: 'var(--amber-bg)', border: '1px solid var(--amber)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <AlertTriangle size={16} style={{ color: 'var(--amber)' }} />
          <div style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 700 }}>PAYSTACK_SECRET_KEY is placeholder `sk_live_REPLACE...` — live payments will fail. Set real key in env.</div>
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}>
        {flags.map(f => (
          <Card key={f.key} style={{ padding: 14, background: 'var(--panel)', border: f.enabled ? '1px solid var(--teal)' : '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', fontFamily: 'var(--font-mono)' }}>{f.key}</div>
              <button onClick={() => toggle(f)} disabled={!!busyKey} aria-label={`Toggle ${f.key}`} aria-pressed={f.enabled} style={{ border: 'none', background: 'none', cursor: busyKey ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', color: f.enabled ? 'var(--teal)' : 'var(--muted)' }}>
                {f.enabled ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
              </button>
            </div>
            <div style={{ fontSize: 12, color: f.enabled ? 'var(--green)' : 'var(--muted)', fontWeight: 700 }}>{f.enabled ? 'Enabled' : 'Disabled'} • rollout {f.rollout_pct}%</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[10, 50, 100].map(pct => (
                <button key={pct} disabled={!!busyKey} onClick={() => setRollout(f, pct)} style={{ padding: '6px 10px', borderRadius: 8, border: f.rollout_pct === pct ? '1px solid var(--teal)' : '1px solid var(--border)', background: f.rollout_pct === pct ? 'var(--teal-mist)' : 'var(--panel)', color: f.rollout_pct === pct ? 'var(--teal)' : 'var(--muted)', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>{pct}%</button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Updated {f.updated_at ? new Date(f.updated_at).toLocaleString() : '—'} {f.allowlist?.length ? `• allowlist: ${f.allowlist.slice(0, 2).join(', ')}` : ''}</div>
          </Card>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>Toggles gate `visible_on_carefind` / `ecommerce_enabled` / `booking_enabled` / `maintenance_mode` — every change audited to admin_audit_log.</div>
      <Toast msg={msg} type={type} />
    </div>
  )
}
