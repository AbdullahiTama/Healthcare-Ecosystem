import { useState, useEffect, useCallback } from 'react'
import { Search, RefreshCw, Shield, Clock, AlertTriangle, CheckCircle, Eye, ExternalLink } from 'lucide-react'
import { Card, GhostBtn, Loading, Empty, ErrorState, useToast, Toast } from '../../../components/ui'
import { createTrustRepository, slaLabel, slaTone } from '../../../modules/trust/repositories'

function timeAgo(s) {
  if (!s) return '—'
  const diff = Math.floor((Date.now() - new Date(s)) / 1000)
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function TrustQueue({ repository = createTrustRepository() }) {
  const [items, setItems] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showOverdueOnly, setShowOverdueOnly] = useState(false)
  const { msg, type, show: showToast } = useToast()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const q = await repository.getTrustQueue({ limit: 100 })
      setItems(Array.isArray(q) ? q : [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [repository])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  const filtered = (() => {
    let list = Array.isArray(items) ? items : []
    if (filter !== 'all') list = list.filter(i => i.type === filter)
    if (showOverdueOnly) list = list.filter(i => i.overdue)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(i => `${i.label} ${i.subtitle} ${i.type}`.toLowerCase().includes(q))
    }
    return list
  })()

  const counts = (() => {
    const c = { all: items?.length || 0, verification: 0, claim: 0, report: 0, appeal: 0, overdue: 0 }
    for (const i of (items || [])) {
      c[i.type] = (c[i.type] || 0) + 1
      if (i.overdue) c.overdue++
    }
    return c
  })()

  if (loading && items == null) return <Loading />
  if (error) return <ErrorState message={error} onRetry={load} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { id: 'all', label: `All (${counts.all})` },
            { id: 'verification', label: `Verify (${counts.verification})` },
            { id: 'claim', label: `Claims (${counts.claim})` },
            { id: 'report', label: `Reports (${counts.report})` },
            { id: 'appeal', label: `Appeals (${counts.appeal})` },
          ].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{ padding: '7px 12px', borderRadius: 8, border: filter === f.id ? '1px solid var(--teal)' : '1px solid var(--border)', background: filter === f.id ? 'var(--teal-mist)' : 'var(--panel)', color: filter === f.id ? 'var(--teal)' : 'var(--muted)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>{f.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}><input type="checkbox" checked={showOverdueOnly} onChange={e => setShowOverdueOnly(e.target.checked)} /> Overdue only ({counts.overdue})</label>
          <GhostBtn onClick={load}><RefreshCw size={12} style={{ marginRight: 6 }} />Refresh</GhostBtn>
        </div>
      </Card>

      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name / reason / type" aria-label="Search trust queue" style={{ width: '100%', padding: '9px 12px 9px 30px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }} />
        </div>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{filtered.length} • SLA red overdue / amber &lt;4h</span>
      </Card>

      {filtered.length === 0 ? (
        <Card style={{ padding: 32, background: 'var(--panel)', border: '1px solid var(--border)', textAlign: 'center' }}><Empty icon={<CheckCircle size={28} />} message={showOverdueOnly ? 'No overdue — all within SLA.' : filter !== 'all' ? `No ${filter} items.` : 'All caught up — no trust queue.'} /></Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(item => {
            const tone = slaTone(item)
            const label = slaLabel(item)
            return (
              <Card key={item.id} style={{ padding: 12, background: item.overdue ? 'var(--red-bg)' : item.urgent ? 'var(--amber-bg)' : 'var(--panel)', border: `1px solid ${tone === 'red' ? 'var(--red)' : tone === 'amber' ? 'var(--amber)' : 'var(--border)'}`, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ padding: '2px 7px', borderRadius: 6, background: 'var(--hairline)', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>{item.type}</span>
                    {item.label}
                    <span style={{ fontSize: 11, color: tone === 'red' ? 'var(--red)' : tone === 'amber' ? 'var(--amber)' : 'var(--muted)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={11} /> {label} • {timeAgo(item.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{item.subtitle || '—'}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ padding: '3px 7px', borderRadius: 6, background: tone === 'red' ? 'var(--red)' : tone === 'amber' ? 'var(--amber)' : 'var(--teal)', color: 'white', fontWeight: 700, fontSize: 11 }}>{item.overdue ? 'OVERDUE' : item.urgent ? 'DUE SOON' : 'ON TRACK'}</span>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>Unified from verification_requests + business_claims + reports + moderation_appeals • polls 30s • SLA 24h verify / 48h others</div>
      <Toast msg={msg} type={type} />
    </div>
  )
}
