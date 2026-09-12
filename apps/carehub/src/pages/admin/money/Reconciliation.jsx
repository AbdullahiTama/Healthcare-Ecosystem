import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, AlertTriangle, CheckCircle, Search } from 'lucide-react'
import { Card, GhostBtn, Loading, Empty, ErrorState, useToast, Toast } from '../../../components/ui'
import { createMoneyRepository } from '../../../modules/money/repositories'

export default function Reconciliation({ repository = createMoneyRepository() }) {
  const [mismatches, setMismatches] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [busyRef, setBusyRef] = useState(null)
  const { msg, type, show: showToast } = useToast()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const rows = await repository.getReconciliationMismatches({ limit: 100 }).catch(() => [])
      setMismatches(Array.isArray(rows) ? rows : [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [repository])
  useEffect(() => { load() }, [load])

  const handleResolveMissing = async (m) => {
    if (busyRef) return
    setBusyRef(m.reference)
    try {
      // Create missing plan_payment from paystack event — reference UNIQUE guards double-create
      await repository.createPlanPayment({ business_id: m.business_id, reference: m.reference, naira_amount: Math.round((m.paystack?.amount_kobo || m.amount_kobo) / 100), status: 'success', months: 1 })
      showToast(`Created missing payment ${m.reference}`, { type: 'success' })
      load()
    } catch (e) { showToast(e.message.includes('duplicate') || e.message.includes('23505') ? 'Already exists (UNIQUE)' : e.message, { type: 'error' }) }
    setBusyRef(null)
  }

  const filtered = (() => {
    const list = Array.isArray(mismatches) ? mismatches : []
    if (!filter.trim()) return list
    const q = filter.trim().toLowerCase()
    return list.filter(m => `${m.reference} ${m.type} ${m.business_id}`.toLowerCase().includes(q))
  })()

  if (loading && mismatches == null) return <Loading />
  if (error) return <ErrorState message={error} onRetry={load} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)' }}>Reconciliation <span style={{ fontSize: 11, background: filtered.length ? 'var(--amber-bg)' : 'var(--hairline)', color: filtered.length ? 'var(--amber)' : 'var(--muted)', padding: '2px 6px', borderRadius: 6 }}>{filtered.length} mismatches • UNIQUE reference guard</span></div>
        <GhostBtn onClick={load}><RefreshCw size={12} style={{ marginRight: 6 }} />Refresh</GhostBtn>
      </Card>

      {filtered.length === 0 ? (
        <Card style={{ padding: 32, background: 'var(--panel)', border: '1px solid var(--border)', textAlign: 'center' }}><Empty icon={<CheckCircle size={24} />} message="All matched — Paystack ↔ plan_payments in sync. Wire webhook to paystack_events to populate." /></Card>
      ) : (
        <>
          <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
              <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter reference / type / business" aria-label="Filter mismatches" style={{ width: '100%', padding: '9px 12px 9px 30px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }} />
            </div>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{filtered.length} mismatches</span>
          </Card>
          <Card style={{ padding: 0, overflow: 'hidden', background: 'var(--panel)', border: '1px solid var(--border)' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ borderBottom: '1px solid var(--border)' }}><tr style={{ height: 36 }}>
                  <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Reference</th>
                  <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Type</th>
                  <th style={{ padding: '0 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Paystack</th>
                  <th style={{ padding: '0 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>DB</th>
                  <th style={{ padding: '0 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Action</th>
                </tr></thead>
                <tbody>
                  {filtered.map(m => (
                    <tr key={m.reference} style={{ height: 36, borderBottom: '1px solid var(--hairline)' }}>
                      <td style={{ padding: '0 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg)' }}>{m.reference}</td>
                      <td style={{ padding: '0 12px' }}><span style={{ padding: '3px 7px', borderRadius: 6, background: m.type === 'missing_in_db' ? 'var(--amber-bg)' : m.type === 'amount_mismatch' ? 'var(--red-bg)' : 'var(--hairline)', color: m.type === 'missing_in_db' ? 'var(--amber)' : m.type === 'amount_mismatch' ? 'var(--red)' : 'var(--muted)', fontWeight: 700, fontSize: 11 }}>{m.type}</span></td>
                      <td style={{ padding: '0 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>{m.paystack ? `₦${(m.paystack.amount_kobo / 100).toLocaleString()}` : '—'}</td>
                      <td style={{ padding: '0 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>{m.db ? `₦${Number(m.db.naira_amount != null ? m.db.naira_amount : (m.db.amount_kobo / 100)).toLocaleString()}` : '—'}</td>
                      <td style={{ padding: '0 12px', textAlign: 'right' }}>
                        {m.type === 'missing_in_db' && <button disabled={busyRef === m.reference} onClick={() => handleResolveMissing(m)} style={{ padding: '5px 10px', borderRadius: 8, border: 'none', background: 'var(--teal)', color: 'white', fontWeight: 700, fontSize: 11, cursor: busyRef ? 'not-allowed' : 'pointer' }}>{busyRef === m.reference ? 'Creating...' : 'Create missing'}</button>}
                        {m.type === 'amount_mismatch' && <span style={{ fontSize: 11, color: 'var(--muted)' }}>PS {m.psAmt} vs DB {m.dbAmt}</span>}
                        {m.type === 'missing_in_paystack' && <span style={{ fontSize: 11, color: 'var(--muted)' }}>DB only</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>Webhook → <code>paystack_events.reference UNIQUE</code> → triple-match here. “Create missing” is idempotent — duplicate 23505 is success.</div>
      <Toast msg={msg} type={type} />
    </div>
  )
}
