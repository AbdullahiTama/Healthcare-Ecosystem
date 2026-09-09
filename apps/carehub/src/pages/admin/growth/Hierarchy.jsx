import { useState, useEffect, useCallback } from 'react'
import { Search, RefreshCw, Users, Layers, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { Card, GhostBtn, Loading, Empty, ErrorState } from '../../../components/ui'
import { createGrowthRepository } from '../../../modules/growth/repositories'

export default function Hierarchy({ repository = createGrowthRepository() }) {
  const [agents, setAgents] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(() => new Set(['Lagos', 'Abuja']))
  const [stateFilter, setStateFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const rows = await repository.getAgents({ limit: 200 })
      setAgents(Array.isArray(rows) ? rows : [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [repository])
  useEffect(() => { load() }, [load])

  const tree = (() => {
    const list = Array.isArray(agents) ? agents : []
    let filtered = list
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      filtered = filtered.filter(a => `${a.full_name} ${a.email} ${a.referral_code}`.toLowerCase().includes(q))
    }
    if (stateFilter) filtered = filtered.filter(a => (a.state || '').toLowerCase() === stateFilter.toLowerCase())
    return repository.buildTree(filtered)
  })()

  const toggle = (state) => {
    setExpanded(prev => {
      const n = new Set(prev)
      if (n.has(state)) n.delete(state); else n.add(state)
      return n
    })
  }

  if (loading && agents == null) return <Loading />
  if (error) return <ErrorState message={error} onRetry={load} />

  const states = [...new Set((agents || []).map(a => a.state).filter(Boolean))].sort()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name / email / CF-code" aria-label="Search agents" style={{ width: '100%', padding: '9px 12px 9px 30px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }} />
        </div>
        <select value={stateFilter} onChange={e => setStateFilter(e.target.value)} aria-label="Filter state" style={{ padding: '9px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }}>
          <option value="">All states</option>
          {states.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <GhostBtn onClick={load}><RefreshCw size={12} style={{ marginRight: 6 }} />Refresh</GhostBtn>
      </Card>

      {tree.length === 0 ? <Card style={{ padding: 32, background: 'var(--panel)', border: '1px solid var(--border)', textAlign: 'center' }}><Empty icon={<Users size={28} />} message="No agents for filter." /></Card> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tree.map(node => {
            const isOpen = expanded.has(node.state)
            const coordinators = node.coordinators
            return (
              <Card key={node.state} style={{ padding: 0, overflow: 'hidden', background: 'var(--panel)', border: '1px solid var(--border)' }}>
                <button onClick={() => toggle(node.state)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'var(--hairline)', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 8 }}><Layers size={13} /> {node.state} <span style={{ fontSize: 11, background: 'var(--panel)', padding: '2px 7px', borderRadius: 6, color: 'var(--muted)', border: '1px solid var(--border)' }}>{node.total} agents</span></span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)' }}>{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                </button>
                {isOpen && (
                  <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {coordinators.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>No coordinators — agents are unparented.</div>}
                    {coordinators.map(c => {
                      const children = (node.byParent[c.id] || [])
                      const cap = 20
                      const isFull = children.length >= cap
                      return (
                        <div key={c.id} style={{ padding: 10, border: `1px solid ${isFull ? 'var(--amber)' : 'var(--border)'}`, borderRadius: 10, background: isFull ? 'var(--amber-bg)' : 'var(--panel)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--fg)' }}>{c.full_name || c.name} <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--muted)' }}>• {c.tier} • {c.referral_code || '—'} {isFull ? '• 20/20 FULL' : `• ${children.length}/${cap}`}</span></div>
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{c.email}</span>
                          </div>
                          {children.length ? (
                            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {children.map(ch => (
                                <div key={ch.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: 'var(--hairline)', borderRadius: 8, fontSize: 12 }}>
                                  <span style={{ fontWeight: 600, color: 'var(--fg)' }}>{ch.full_name || ch.name} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>• {ch.tier} • {ch.referral_code || '—'}</span></span>
                                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>{ch.email}</span>
                                </div>
                              ))}
                            </div>
                          ) : <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>No agents under this coordinator.</div>}
                        </div>
                      )
                    })}
                    {/* Unparented */}
                    {(node.byParent['__root'] || []).length > 0 && (
                      <div style={{ padding: 10, border: '1px dashed var(--border)', borderRadius: 10 }}>
                        <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Unparented</div>
                        {(node.byParent['__root'] || []).map(ch => (
                          <div key={ch.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, marginBottom: 6 }}>
                            <span style={{ fontWeight: 600, color: 'var(--fg)' }}>{ch.full_name || ch.name} • {ch.tier}</span>
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{ch.referral_code || '—'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
