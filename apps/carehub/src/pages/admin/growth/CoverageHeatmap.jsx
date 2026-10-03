import { useState, useEffect, useCallback } from 'react'
import { Search, RefreshCw, MapPin, AlertTriangle, CheckCircle, TrendingUp } from 'lucide-react'
import { Card, GhostBtn, Loading, Empty, ErrorState } from '../../../components/ui'
import { createGrowthRepository } from '../../../modules/growth/repositories'

export default function CoverageHeatmap({ repository = createGrowthRepository() }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await repository.getCoverageGaps({ limit: 200 })
      setRows(Array.isArray(data) ? data : [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [repository])
  useEffect(() => { load() }, [load])

  const filtered = (() => {
    let list = Array.isArray(rows) ? rows : []
    if (filter === 'thin') list = list.filter(r => r.gapLabel === 'thin')
    if (filter === 'watch') list = list.filter(r => r.gapLabel === 'watch')
    if (filter === 'covered') list = list.filter(r => r.gapLabel === 'covered')
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(r => r.state.toLowerCase().includes(q))
    }
    return list
  })()

  if (loading && rows == null) return <Loading />
  if (error) return <ErrorState message={error} onRetry={load} />

  const maxAgents = Math.max(...(rows || []).map(r => r.agents), 1)
  const maxBiz = Math.max(...(rows || []).map(r => r.businesses), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6 }}><MapPin size={14} /> Coverage Gaps <span style={{ fontSize: 11, background: 'var(--hairline)', padding: '2px 6px', borderRadius: 6, color: 'var(--muted)' }}>agents vs businesses per state • 1:10 heuristic</span></div>
        <GhostBtn onClick={load}><RefreshCw size={12} style={{ marginRight: 6 }} />Refresh</GhostBtn>
      </Card>

      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 300 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter state" aria-label="Filter coverage" style={{ width: '100%', padding: '9px 12px 9px 30px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }} />
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter gap" style={{ padding: '9px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }}>
          <option value="all">All gaps</option>
          <option value="thin">thin (gap &gt;20)</option>
          <option value="watch">watch (gap &gt;0)</option>
          <option value="covered">covered</option>
        </select>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{filtered.length} states</span>
      </Card>

      {filtered.length === 0 ? (
        <Card style={{ padding: 32, background: 'var(--panel)', border: '1px solid var(--border)', textAlign: 'center' }}><Empty icon={<MapPin size={28} />} message="No states match — seed businesses.agents." /></Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(r => {
            const tone = r.gapLabel === 'thin' ? 'var(--red)' : r.gapLabel === 'watch' ? 'var(--amber)' : 'var(--green)'
            const bg = r.gapLabel === 'thin' ? 'var(--red-bg)' : r.gapLabel === 'watch' ? 'var(--amber-bg)' : 'var(--teal-mist)'
            return (
              <Card key={r.state} style={{ padding: 12, background: bg, border: `1px solid ${tone}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6 }}><MapPin size={12} /> {r.state} <span style={{ fontSize: 11, background: 'var(--panel)', padding: '2px 7px', borderRadius: 6, color: tone, border: `1px solid ${tone}`, fontWeight: 700 }}>{r.gapLabel.toUpperCase()} • gap {r.gap}</span></div>
                  <span style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>{r.gapLabel === 'thin' ? <AlertTriangle size={11} style={{ color: 'var(--red)' }} /> : r.gapLabel === 'covered' ? <CheckCircle size={11} style={{ color: 'var(--green)' }} /> : <TrendingUp size={11} />} {r.agents} agents • {r.businesses} businesses</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ flex: 1, height: 8, background: 'var(--hairline)', borderRadius: 6, overflow: 'hidden', display: 'flex' }}>
                    <div style={{ width: `${(r.agents / maxAgents) * 100}%`, background: 'var(--teal)', transition: 'width 300ms' }} />
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--muted)', minWidth: 60 }}>{r.agents}/{maxAgents} agents</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ flex: 1, height: 8, background: 'var(--hairline)', borderRadius: 6, overflow: 'hidden', display: 'flex' }}>
                    <div style={{ width: `${(r.businesses / maxBiz) * 100}%`, background: tone, transition: 'width 300ms' }} />
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--muted)', minWidth: 60 }}>{r.businesses}/{maxBiz} biz</span>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
