// AdminPanel card: view + tune the personalized-feed ranking (Phase 6).
//
// Reads feed_ranking_config (weights + diversity) and candidate_generation_pools
// — both are public-read, so the card renders for anyone with admin access.
// Editing goes through set_feed_ranking_config, a SECURITY DEFINER RPC whose
// ONLY authorization is profiles.is_admin for the signed-in Supabase user; a
// normal user (or an admin whose profile isn't flagged) sees the read-only
// view with a hint. We intentionally do NOT extend the admin-auth.js gateway —
// its handler is deployed outside this repo, and adding a write path through
// it here would shadow the deployed function.

import { useEffect, useState } from 'react'
import { supabase } from '../../config/supabaseClient'
import { theme } from '../../styles/theme'
import { Toast, useToast } from '../../components/ui'

const WEIGHT_LABELS = {
  engagement: 'Engagement',
  recency: 'Recency',
  affinity: 'Affinity',
  authority: 'Provider authority',
  location: 'Location',
  medical: 'Medical relevance',
  interests: 'Your interests',
}
const DIVERSITY_LABELS = {
  maxPerAuthor: 'Max posts per author',
  maxPerType: 'Max posts per content type',
}
const FALLBACK = {
  weights: { engagement: 40, recency: 20, affinity: 20, authority: 15, location: 10, medical: 10, interests: 10 },
  diversity: { maxPerAuthor: 3, maxPerType: 5 },
}

export default function FeedRankingConfig() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [weights, setWeights] = useState(FALLBACK.weights)
  const [diversity, setDiversity] = useState(FALLBACK.diversity)
  const [pools, setPools] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let mounted = true
    async function load() {
      const [{ data: rows }, { data: poolRows }, { data: me }] = await Promise.all([
        supabase.from('feed_ranking_config').select('key, value'),
        supabase.from('candidate_generation_pools').select('pool, label, enabled, priority, limit_count').order('priority', { ascending: true }),
        supabase.auth.getUser().then(({ data }) =>
          data.user ? supabase.from('profiles').select('is_admin').eq('id', data.user.id).maybeSingle() : null,
        ),
      ])
      if (!mounted) return
      if (rows && rows.length) {
        const byKey = {}
        rows.forEach((r) => { byKey[r.key] = r.value })
        if (byKey.weights) setWeights({ ...FALLBACK.weights, ...byKey.weights })
        if (byKey.diversity) setDiversity({ ...FALLBACK.diversity, ...byKey.diversity })
      }
      setPools(poolRows || [])
      setIsAdmin(me?.data?.is_admin === true)
      setLoading(false)
    }
    load().catch(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [])

  async function save() {
    setSaving(true)
    try {
      await Promise.all([
        supabase.rpc('set_feed_ranking_config', { p_key: 'weights', p_value: weights }),
        supabase.rpc('set_feed_ranking_config', { p_key: 'diversity', p_value: diversity }),
      ])
      toast.show('Feed ranking saved', { type: 'success' })
    } catch (err) {
      toast.show(`Could not save: ${err.message || 'unknown error'}`, { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const numberInput = (value, onChange, max = 100) => ({
    type: 'number', min: 0, max, value,
    onChange: (e) => onChange(Math.max(0, Number(e.target.value) || 0)),
    style: { width: 70, padding: '7px 8px', fontSize: 12, border: `1px solid ${theme.border}`, borderRadius: 8, boxSizing: 'border-box' },
  })

  if (loading) {
    return <p style={{ fontSize: 12, color: theme.textLight }}>Loading feed ranking…</p>
  }

  return (
    <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 14, background: theme.cardBg, marginTop: 4 }}>
      <p style={{ margin: '0 0 4px 0', fontWeight: 800, fontSize: 13, color: theme.navy }}>⚙️ Feed ranking (Phase 6)</p>
      <p style={{ margin: '0 0 12px 0', fontSize: 11, color: theme.textLight }}>
        For You = weighted sum of signals (each normalized 0..1). Relative weights; tune with data.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px 12px', alignItems: 'center' }}>
        {Object.entries(WEIGHT_LABELS).map(([key, label]) => (
          <div key={key} style={{ display: 'contents' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: theme.textMid }}>{label}</span>
            {isAdmin
              ? <input {...numberInput(weights[key] ?? 0, (v) => setWeights({ ...weights, [key]: v }))} aria-label={`${label} weight`} />
              : <span style={{ fontSize: 12, color: theme.navy, fontWeight: 800, textAlign: 'right' }}>{weights[key] ?? 0}</span>}
          </div>
        ))}
        <div style={{ borderTop: `1px solid ${theme.border}`, gridColumn: '1 / -1', margin: '6px 0 2px' }} />
        {Object.entries(DIVERSITY_LABELS).map(([key, label]) => (
          <div key={key} style={{ display: 'contents' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: theme.textMid }}>{label}</span>
            {isAdmin
              ? <input {...numberInput(diversity[key] ?? 0, (v) => setDiversity({ ...diversity, [key]: v }), 20)} aria-label={label} />
              : <span style={{ fontSize: 12, color: theme.navy, fontWeight: 800, textAlign: 'right' }}>{diversity[key] ?? 0}</span>}
          </div>
        ))}
      </div>

      {pools.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {pools.map((p) => (
            <span key={p.pool} style={{ fontSize: 10.5, fontWeight: 700, background: theme.tealMist, color: theme.tealDeep, borderRadius: 999, padding: '4px 9px' }}>
              {p.label || p.pool} · {p.enabled ? `${p.limit_count}` : 'off'}
            </span>
          ))}
        </div>
      )}

      {isAdmin ? (
        <button onClick={save} disabled={saving} style={{ marginTop: 14, width: '100%', padding: 11, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13 }}>
          {saving ? 'Saving…' : 'Save weights & diversity'}
        </button>
      ) : (
        <p style={{ margin: '14px 0 0 0', fontSize: 11, color: theme.textLight }}>
          Read-only for your account. To edit: flag your profile <code>is_admin = true</code> (then the Save button appears), or tune directly in SQL with the service key ({`update feed_ranking_config set value = '{"engagement":40,…}'::jsonb where key='weights';`}).
        </p>
      )}

      <Toast msg={toast.msg} type={toast.type} actionLabel={toast.actionLabel} onAction={toast.onAction} />
    </div>
  )
}
