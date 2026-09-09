import { useState, useEffect, useCallback } from 'react'
import { Search, RefreshCw, TrendingUp, Wallet } from 'lucide-react'
import { Card, GhostBtn, Loading, Empty, ErrorState } from '../../../components/ui'
import { createGrowthRepository } from '../../../modules/growth/repositories'
import { koboToNaira } from '../../../modules/money/repositories'

export default function Performance({ repository = createGrowthRepository() }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('referrals')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await repository.getPerformance({ limit: 100 })
      setRows(Array.isArray(data) ? data : [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [repository])
  useEffect(() => { load() }, [load])

  const filtered = (() => {
    let list = Array.isArray(rows) ? rows : []
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(r => `${r.full_name} ${r.state} ${r.tier}`.toLowerCase().includes(q))
    }
    const dir = -1
    if (sort === 'referrals') list = [...list].sort((a, b) => dir * (a.referrals - b.referrals))
    if (sort === 'owed') list = [...list].sort((a, b) => dir * (a.owed - b.owed))
    if (sort === 'converted') list = [...list].sort((a, b) => dir * (a.converted - b.converted))
    return list
  })()

  if (loading && rows == null) return <Loading />
  if (error) return <ErrorState message={error} onRetry={load} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
          <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 320 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search agent / state / tier" aria-label="Search performance" style={{ width: '100%', padding: '9px 12px 9px 30px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }} />
          </div>
          <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort" style={{ padding: '9px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }}>
            <option value="referrals">Sort: referrals</option>
            <option value="owed">Sort: owed</option>
            <option value="converted">Sort: converted</option>
          </select>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{filtered.length} agents</span>
        </div>
        <GhostBtn onClick={load}><RefreshCw size={12} style={{ marginRight: 6 }} />Refresh</GhostBtn>
      </Card>

      {filtered.length === 0 ? (
        <Card style={{ padding: 32, background: 'var(--panel)', border: '1px solid var(--border)', textAlign: 'center' }}><Empty icon={<TrendingUp size={28} />} message="No performance data — agents exist but no referrals/earnings yet." /></Card>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden', background: 'var(--panel)', border: '1px solid var(--border)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ borderBottom: '1px solid var(--border)', background: 'var(--panel)' }}>
                <tr style={{ height: 36 }}>
                  <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Agent</th>
                  <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>State</th>
                  <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Tier</th>
                  <th style={{ padding: '0 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Referrals</th>
                  <th style={{ padding: '0 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Owed</th>
                  <th style={{ padding: '0 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Paid</th>
                  <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Last earning</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 50).map(r => (
                  <tr key={r.id} style={{ height: 36, borderBottom: '1px solid var(--hairline)' }}>
                    <td style={{ padding: '0 12px', fontWeight: 700, color: 'var(--fg)' }}>{r.full_name}</td>
                    <td style={{ padding: '0 12px', color: 'var(--muted)' }}>{r.state || '—'}</td>
                    <td style={{ padding: '0 12px', color: 'var(--muted)' }}>{r.tier}</td>
                    <td style={{ padding: '0 12px', textAlign: 'right', fontWeight: 700, color: 'var(--fg)' }}>{r.referrals}</td>
                    <td style={{ padding: '0 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: r.owed > r.paid ? 'var(--amber)' : 'var(--fg)' }}>{koboToNaira(r.owed)}</td>
                    <td style={{ padding: '0 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{koboToNaira(r.paid)}</td>
                    <td style={{ padding: '0 12px', fontSize: 11, color: 'var(--muted)' }}>{r.last_earning_at ? new Date(r.last_earning_at).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>Referrals = `agent_referrals`; Owed/Paid = `agent_earnings`; Converted = `plan_payments.is_first_payment` where available. Export via Health → Export logs.</div>
    </div>
  )
}
