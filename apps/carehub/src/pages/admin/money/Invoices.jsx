import { useState, useEffect, useCallback } from 'react'
import { Search, RefreshCw, Receipt, Undo2 } from 'lucide-react'
import { Card, GhostBtn, TealBtn, Inp, Loading, Empty, ErrorState, useToast, Toast, ConfirmDialog } from '../../../components/ui'
import { createMoneyRepository } from '../../../modules/money/repositories'

function fmt(s) { if (!s) return '—'; try { return new Date(s).toLocaleString() } catch { return s } }

export default function Invoices({ repository = createMoneyRepository() }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [businessId, setBusinessId] = useState('')
  const [filterType, setFilterType] = useState('')
  const [showCredit, setShowCredit] = useState(false)
  const [creditForm, setCreditForm] = useState({ business_id: '', amount_kobo: '', reason: '' })
  const [busy, setBusy] = useState(false)
  const [confirmRefund, setConfirmRefund] = useState(null)
  const { msg, type, show: showToast } = useToast()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await repository.getAllInvoices({ business_id: businessId || undefined, type: filterType || undefined, limit: 50 }).catch(() => [])
      setRows(Array.isArray(data) ? data : [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [repository, businessId, filterType])
  useEffect(() => { load() }, [load])

  const handleCredit = async () => {
    if (!creditForm.business_id.trim() || !creditForm.amount_kobo || !creditForm.reason.trim()) { showToast('Business, amount, reason required', { type: 'error' }); return }
    setBusy(true)
    try {
      await repository.createCreditNote({ business_id: creditForm.business_id.trim(), amount_kobo: Number(creditForm.amount_kobo), reason: creditForm.reason.trim() })
      showToast('Credit note created (negative invoice)', { type: 'success' }); setShowCredit(false); setCreditForm({ business_id: '', amount_kobo: '', reason: '' }); load()
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }

  const handleRefund = async () => {
    if (!confirmRefund) return
    setBusy(true)
    try {
      await repository.createCreditNote({ business_id: confirmRefund.business_id, amount_kobo: Math.abs(Number(confirmRefund.amount_kobo)), reason: `refund ${confirmRefund.reference}` })
      showToast('Refund credit note issued', { type: 'success' }); setConfirmRefund(null); load()
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }

  if (loading && rows == null) return <Loading />
  if (error) return <ErrorState message={error} onRetry={load} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
          <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 300 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
            <input value={businessId} onChange={e => setBusinessId(e.target.value)} placeholder="Filter business_id" aria-label="Filter business" style={{ width: '100%', padding: '9px 12px 9px 30px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }} />
          </div>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} aria-label="Filter type" style={{ padding: '9px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }}>
            <option value="">All types</option>
            <option value="invoice">invoice</option>
            <option value="credit_note">credit_note</option>
          </select>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{rows.length} rows</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostBtn onClick={load}><RefreshCw size={12} style={{ marginRight: 6 }} />Refresh</GhostBtn>
          <TealBtn onClick={() => setShowCredit(true)}><Undo2 size={12} style={{ marginRight: 6 }} />New credit note</TealBtn>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card style={{ padding: 32, background: 'var(--panel)', border: '1px solid var(--border)', textAlign: 'center' }}><Empty icon={<Receipt size={24} />} message="No invoices — generate on subscription change or refund. Append-only, never mutate amount." /></Card>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden', background: 'var(--panel)', border: '1px solid var(--border)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ borderBottom: '1px solid var(--border)' }}><tr style={{ height: 36 }}>
                <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Reference</th>
                <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Business</th>
                <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Type</th>
                <th style={{ padding: '0 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Amount</th>
                <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Created</th>
                <th style={{ padding: '0 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Refund</th>
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ height: 36, borderBottom: '1px solid var(--hairline)' }}>
                    <td style={{ padding: '0 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg)' }}>{r.reference}</td>
                    <td style={{ padding: '0 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg)' }}>{r.business_id.slice(0, 8)}</td>
                    <td style={{ padding: '0 12px' }}><span style={{ padding: '3px 7px', borderRadius: 6, background: r.type === 'credit_note' ? 'var(--red-bg)' : 'var(--hairline)', color: r.type === 'credit_note' ? 'var(--red)' : 'var(--muted)', fontWeight: 700, fontSize: 11 }}>{r.type}</span></td>
                    <td style={{ padding: '0 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: r.amount_kobo < 0 ? 'var(--red)' : 'var(--fg)', fontWeight: 700 }}>{r.amount_kobo < 0 ? '-' : ''}₦{Math.abs(r.amount_kobo / 100).toLocaleString()}</td>
                    <td style={{ padding: '0 12px', fontSize: 11, color: 'var(--muted)' }}>{fmt(r.created_at)}</td>
                    <td style={{ padding: '0 12px', textAlign: 'right' }}>{r.type === 'invoice' ? <button onClick={() => setConfirmRefund(r)} style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--muted)', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>Refund</button> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showCredit && (
        <Card style={{ padding: 16, background: 'var(--panel)', border: '1px solid var(--teal)' }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', marginBottom: 10 }}>New credit note (refund)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
            <Inp label="Business ID *" value={creditForm.business_id} onChange={v => setCreditForm(s => ({ ...s, business_id: v }))} placeholder="business_id" />
            <Inp label="Amount kobo * (50000 = ₦500)" value={creditForm.amount_kobo} onChange={v => setCreditForm(s => ({ ...s, amount_kobo: v }))} />
            <Inp label="Reason *" value={creditForm.reason} onChange={v => setCreditForm(s => ({ ...s, reason: v }))} placeholder="refund INV-123" />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <GhostBtn onClick={() => setShowCredit(false)} style={{ flex: 1 }}>Cancel</GhostBtn>
            <TealBtn disabled={busy} onClick={handleCredit} style={{ flex: 1 }}>{busy ? 'Creating...' : 'Create credit note'}</TealBtn>
          </div>
        </Card>
      )}

      <ConfirmDialog show={!!confirmRefund} title={`Refund ${confirmRefund?.reference}?`} onClose={() => setConfirmRefund(null)} onConfirm={handleRefund} confirmLabel={busy ? 'Refunding...' : 'Refund (credit note)'} variant="danger" message={<div style={{ fontSize: 13 }}>Creates negative <code>credit_note</code> for {confirmRefund?.reference} — append-only, never mutates invoice.</div>} />
      <Toast msg={msg} type={type} />
    </div>
  )
}
