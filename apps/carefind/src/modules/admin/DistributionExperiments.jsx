// AdminPanel card: staged content distribution (Phase 7).
//
// Shows every experiment in content_distribution_experiments with its kill
// switch + rollout %, and (for admins) per-variant metric counts from
// distribution_experiment_stats. Edits go through set_distribution_experiment
// — a SECURITY DEFINER RPC whose ONLY authorization is profiles.is_admin for
// the signed-in Supabase user, the same gate as set_feed_ranking_config.
// Non-admins get a read-only view; the admin-auth.js gateway is deliberately
// NOT extended (its handler is deployed outside this repo).

import { useEffect, useState } from 'react'
import { supabase } from '../../config/supabaseClient'
import { theme } from '../../styles/theme'
import { Toast, useToast } from '../../components/ui'

export default function DistributionExperiments() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [experiments, setExperiments] = useState([])
  const [stats, setStats] = useState({})
  const [drafts, setDrafts] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let mounted = true
    async function load() {
      const { data: rows } = await supabase
        .from('content_distribution_experiments')
        .select('key, label, description, enabled, rollout_pct, variant, config, start_at, end_at')
        .order('key', { ascending: true })

      let admin = false
      const { data: me } = await supabase.auth.getUser().then(({ data }) =>
        data.user ? supabase.from('profiles').select('is_admin').eq('id', data.user.id).maybeSingle() : null,
      )
      admin = me?.data?.is_admin === true

      const draftsFor = {}
      ;(rows || []).forEach((e) => { draftsFor[e.key] = { enabled: e.enabled, rollout_pct: Number(e.rollout_pct) } })

      // Stats are an admin-only RPC; a non-admin gets not_authorized, which we
      // swallow — the card just renders without counts.
      const statMap = {}
      if (admin && rows) {
        await Promise.all(rows.map(async (e) => {
          const { data, error } = await supabase.rpc('distribution_experiment_stats', { p_experiment_key: e.key })
          if (!error) statMap[e.key] = data || []
        }))
      }

      if (!mounted) return
      setIsAdmin(admin)
      setExperiments(rows || [])
      setDrafts(draftsFor)
      setStats(statMap)
      setLoading(false)
    }
    load().catch(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [])

  async function save(key) {
    setSaving(true)
    try {
      const { error } = await supabase.rpc('set_distribution_experiment', {
        p_key: key,
        p_updates: drafts[key],
      })
      if (error) throw error
      toast.show('Experiment updated', { type: 'success' })
      setExperiments((prev) => prev.map((e) => (e.key === key ? { ...e, ...drafts[key] } : e)))
    } catch (err) {
      toast.show(`Could not save: ${err.message || 'unknown error'}`, { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p style={{ fontSize: 12, color: theme.textLight }}>Loading experiments…</p>
  }

  return (
    <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 14, background: theme.cardBg, marginTop: 4 }}>
      <p style={{ margin: '0 0 4px 0', fontWeight: 800, fontSize: 13, color: theme.navy }}>🚦 Content rollout (Phase 7)</p>
      <p style={{ margin: '0 0 12px 0', fontSize: 11, color: theme.textLight }}>
        Staged A/B experiments for the For You ranking. Kill switch + rollout %; readers are bucketed deterministically by id.
      </p>

      {experiments.length === 0 && (
        <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>No experiments staged yet.</p>
      )}

      {experiments.map((e) => {
        const draft = drafts[e.key] || { enabled: e.enabled, rollout_pct: Number(e.rollout_pct) }
        const expStats = stats[e.key]
        const live = e.enabled && Number(e.rollout_pct) > 0
        return (
          <div key={e.key} style={{ border: `1px solid ${theme.border}`, borderRadius: 12, padding: 12, marginBottom: 10, background: theme.cardBg }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: theme.navy }}>{e.label || e.key}</span>
              <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '3px 9px', background: live ? '#dcfce7' : theme.gray100, color: live ? '#15803d' : theme.textLight }}>
                {live ? `LIVE · ${e.rollout_pct}%` : 'OFF'}
              </span>
            </div>
            <p style={{ margin: '0 0 10px 0', fontSize: 11, color: theme.textLight }}>{e.description}</p>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              {isAdmin ? (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: theme.textMid, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(ev) => setDrafts((prev) => ({ ...prev, [e.key]: { ...prev[e.key], enabled: ev.target.checked } }))}
                      style={{ width: 16, height: 16, accentColor: theme.tealDeep }}
                    />
                    Kill switch
                  </label>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: theme.textMid }}>
                    <input
                      type="range" min="0" max="100" step="5"
                      value={draft.rollout_pct}
                      onChange={(ev) => setDrafts((prev) => ({ ...prev, [e.key]: { ...prev[e.key], rollout_pct: Number(ev.target.value) } }))}
                      style={{ width: 120, accentColor: theme.tealDeep }}
                      aria-label={`${e.key} rollout percent`}
                    />
                    {draft.rollout_pct}%
                  </span>
                </>
              ) : (
                <span style={{ fontSize: 12, fontWeight: 700, color: theme.textMid }}>
                  Rollout {e.rollout_pct}% · variant “{e.variant}”
                </span>
              )}
            </div>

            {expStats && expStats.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {expStats.map((s) => (
                  <span key={`${s.variant}-${s.event_type}`} style={{ fontSize: 10.5, fontWeight: 700, background: s.variant === 'control' ? theme.gray100 : theme.tealMist, color: s.variant === 'control' ? theme.textLight : theme.tealDeep, borderRadius: 999, padding: '4px 9px' }}>
                    {s.variant} · {s.event_type} · {s.event_count} ({s.distinct_users} users)
                  </span>
                ))}
              </div>
            )}

            {isAdmin && (
              <button onClick={() => save(e.key)} disabled={saving} style={{ marginTop: 10, width: '100%', padding: 10, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 12 }}>
                {saving ? 'Saving…' : 'Save kill switch & rollout'}
              </button>
            )}
          </div>
        )
      })}

      {!isAdmin && (
        <p style={{ margin: '8px 0 0 0', fontSize: 11, color: theme.textLight }}>
          Read-only for your account. Flag your profile <code>is_admin = true</code> to edit rollout and see metric counts.
        </p>
      )}

      <Toast msg={toast.msg} type={toast.type} actionLabel={toast.actionLabel} onAction={toast.onAction} />
    </div>
  )
}
