import { useState, useEffect, useCallback } from 'react'
import { TrendingUp, Wallet, AlertTriangle, RefreshCw } from 'lucide-react'
import { Card, GhostBtn, Loading, ErrorState } from '../../../components/ui'
import { createMoneyRepository, koboToNaira } from '../../../modules/money/repositories'

function Sparkline({ values = [], color = 'var(--teal)', width = 64, height = 20 }) {
  if (!values.length) return <div style={{ width, height }} />
  const max = Math.max(...values, 1), min = Math.min(...values, 0), range = max - min || 1
  const pts = values.map((v, i) => `${(i / Math.max(values.length - 1, 1)) * width},${height - ((v - min) / range) * height}`).join(' ')
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: 'block' }}><polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={pts} opacity={0.9} /></svg>
}

export default function RevenueOverview({ repository = createMoneyRepository() }) {
  const [plans, setPlans] = useState(null)
  const [subs, setSubs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [trend, setTrend] = useState([2,3,5,4,6,8,7])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [pl, su] = await Promise.all([
        repository.getPlans({ includeInactive: false }).catch(() => []),
        repository.getSubscriptions({ limit: 100 }).catch(() => []),
      ])
      setPlans(pl); setSubs(su)
      // mock trend from subs length
      const base = (Array.isArray(su) ? su.length : 0) || 0
      setTrend([base, base+1, base+2, base+1, base+3, base+4, base+2].map(v=>Math.max(0,v)))
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [repository])
  useEffect(() => { load() }, [load])

  if (loading && plans == null) return <Loading />
  if (error) return <ErrorState message={error} onRetry={load} />

  const priceMap = {}
  for (const p of (plans || [])) priceMap[p.key] = p.price_kobo
  const active = (Array.isArray(subs) ? subs : []).filter(s => s.status === 'active')
  const pastDue = (subs || []).filter(s => s.status === 'past_due')
  const trialing = (subs || []).filter(s => s.status === 'trialing')
  const mrrKobo = active.reduce((sum, s) => sum + (priceMap[s.plan_key] || 0), 0)
  const arpuKobo = active.length ? Math.round(mrrKobo / active.length) : 0
  const churnRisk = pastDue.length

  const kpis = [
    { label: 'MRR', value: koboToNaira(mrrKobo), delta: `${active.length} active`, spark: trend, tone: undefined },
    { label: 'ARPU', value: koboToNaira(arpuKobo), delta: `per active`, spark: trend.map(v=>Math.max(1,v-1)), tone: undefined },
    { label: 'Past due', value: pastDue.length, delta: `${pastDue.length ? 'needs dunning' : 'all clear'}`, spark: pastDue.map(()=>1), tone: pastDue.length ? 'warning' : undefined },
    { label: 'Trialing', value: trialing.length, delta: `${trialing.length} trials`, spark: trialing.map(()=>1), tone: undefined },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6 }}><TrendingUp size={14} style={{ color: 'var(--teal)' }} /> Revenue <span style={{ fontSize: 11, background: 'var(--hairline)', color: 'var(--muted)', padding: '2px 6px', borderRadius: 6 }}>MRR from plan_catalog × active subs</span></div>
        <GhostBtn onClick={load}><RefreshCw size={12} style={{ marginRight: 6 }} />Refresh</GhostBtn>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
        {kpis.map(k => (
          <Card key={k.label} style={{ padding: 14, background: k.tone === 'warning' ? 'var(--amber-bg)' : 'var(--panel)', border: k.tone === 'warning' ? '1px solid var(--amber)' : '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: k.tone === 'warning' ? 'var(--amber)' : 'var(--fg)', marginTop: 6 }}>{k.value}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>{k.delta}</div>
            <div style={{ marginTop: 8 }}><Sparkline values={k.spark} color={k.tone === 'warning' ? 'var(--amber)' : 'var(--teal)'} /></div>
          </Card>
        ))}
      </div>

      <Card style={{ padding: 16, background: 'var(--panel)', border: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}><Wallet size={14} /> Active by plan</div>
        {plans && plans.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {plans.map(p => {
              const count = active.filter(s => s.plan_key === p.key).length
              return <div key={p.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--panel)' }}>
                <span style={{ fontWeight: 700, color: 'var(--fg)' }}>{p.key} • {p.name} <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 12 }}>• {koboToNaira(p.price_kobo)} / {p.billing_cycle}</span></span>
                <span style={{ fontWeight: 800, color: count ? 'var(--teal)' : 'var(--muted)' }}>{count} active</span>
              </div>
            })}
          </div>
        ) : <div style={{ fontSize: 12, color: 'var(--muted)' }}>No plans — seed in Plan Catalog.</div>}
      </Card>

      {churnRisk > 0 && (
        <Card style={{ padding: 12, background: 'var(--amber-bg)', border: '1px solid var(--amber)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <AlertTriangle size={14} style={{ color: 'var(--amber)' }} />
          <div style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 700 }}>{churnRisk} past-due • dunning D1/D3/D7 → suspended after 3 fails. Wire cron to `dunning_jobs`.</div>
        </Card>
      )}
    </div>
  )
}
