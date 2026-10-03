import { useState, useEffect, useCallback } from 'react'
import { Search, RefreshCw, Calendar, AlertTriangle, CheckCircle } from 'lucide-react'
import { Card, GhostBtn, TealBtn, Sel, Loading, Empty, ErrorState, useToast, Toast } from '../../../components/ui'
import { createMoneyRepository } from '../../../modules/money/repositories'

function StatusDot({ status }) {
  const map = { active: 'var(--green)', trialing: 'var(--teal)', past_due: 'var(--amber)', suspended: 'var(--red)', canceled: 'var(--gray)' }
  return <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 9999, background: map[status] || 'var(--gray)', display: 'inline-block' }} />
}

export default function Subscriptions({ repository = createMoneyRepository() }) {
  const [rows, setRows] = useState(null)
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [planFilter, setPlanFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20
  const { msg, type, show: showToast } = useToast()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [subs, pl] = await Promise.all([
        repository.getSubscriptions({ status: statusFilter || undefined, plan_key: planFilter || undefined, limit: 100 }).catch(() => []),
        repository.getPlans({ includeInactive: true }).catch(() => []),
      ])
      setRows(Array.isArray(subs) ? subs : [])
      setPlans(Array.isArray(pl) ? pl : [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [repository, statusFilter, planFilter])
  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [statusFilter, planFilter, search])

  const filtered = (() => {
    const list = Array.isArray(rows) ? rows : []
    if (!search.trim()) return list
    const q = search.trim().toLowerCase()
    return list.filter(r => `${r.business_id} ${r.plan_key} ${r.status}`.toLowerCase().includes(q))
  })()
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize)

  if (loading && rows == null) return <Loading />
  if (error) return <ErrorState message={error} onRetry={load} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
          <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 320 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search business_id / plan / status" aria-label="Search subscriptions" style={{ width: '100%', padding: '9px 12px 9px 30px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }} />
          </div>
          <Sel label="" value={statusFilter} onChange={setStatusFilter} options={[{ value: '', label: 'All statuses' }, { value: 'trialing', label: 'trialing' }, { value: 'active', label: 'active' }, { value: 'past_due', label: 'past_due' }, { value: 'suspended', label: 'suspended' }, { value: 'canceled', label: 'canceled' }]} />
          <Sel label="" value={planFilter} onChange={setPlanFilter} options={[{ value: '', label: 'All plans' }, ...plans.map(p => ({ value: p.key, label: p.key }))]} />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{filtered.length} • page {page}/{totalPages}</span>
        </div>
        <GhostBtn onClick={load}><RefreshCw size={12} style={{ marginRight: 6 }} />Refresh</GhostBtn>
      </Card>

      {filtered.length === 0 ? (
        <Card style={{ padding: 32, background: 'var(--panel)', border: '1px solid var(--border)', textAlign: 'center' }}><Empty icon={<Calendar size={24} />} message={statusFilter || planFilter ? 'No subscriptions match filters.' : 'No subscriptions yet — upsert via plan. Next: wire businesses.plan sync on payment.'} /></Card>
      ) : (
        <>
          <Card style={{ padding: 0, overflow: 'hidden', background: 'var(--panel)', border: '1px solid var(--border)' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
                  <tr style={{ height: 36 }}>
                    <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Business</th>
                    <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Plan</th>
                    <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Status</th>
                    <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Period</th>
                    <th style={{ padding: '0 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Grace</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(r => (
                    <tr key={r.business_id} style={{ height: 36, borderBottom: '1px solid var(--hairline)' }}>
                      <td style={{ padding: '0 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg)' }}>{r.business_id.slice(0, 8)}</td>
                      <td style={{ padding: '0 12px', fontWeight: 700, color: 'var(--fg)' }}>{r.plan_key}</td>
                      <td style={{ padding: '0 12px' }}><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontWeight: 700, fontSize: 12, color: r.status === 'past_due' ? 'var(--amber)' : r.status === 'suspended' ? 'var(--red)' : r.status === 'active' ? 'var(--green)' : 'var(--muted)' }}><StatusDot status={r.status} /> {r.status}</span></td>
                      <td style={{ padding: '0 12px', fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{r.current_period_start} → {r.current_period_end}</td>
                      <td style={{ padding: '0 12px', textAlign: 'right', fontSize: 12, color: 'var(--muted)' }}>{r.grace_until || '—'}{r.renew_attempts ? ` • ${r.renew_attempts} attempts` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
            <GhostBtn onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</GhostBtn>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Page {page} of {totalPages}</span>
            <GhostBtn onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</GhostBtn>
          </div>
        </>
      )}
      <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>Dunning next: auto `past_due → suspended` after 3 fails at D1/D3/D7. Wire to Paystack webhook `paystack_events` + `dunning_jobs` cron.</div>
      <Toast msg={msg} type={type} />
    </div>
  )
}
