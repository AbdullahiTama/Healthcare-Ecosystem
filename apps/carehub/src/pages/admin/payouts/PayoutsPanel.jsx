import { useState, useEffect, useCallback, useMemo } from 'react'
import { RefreshCw, Wallet, Download, ChevronRight } from 'lucide-react'
import { Card, GhostBtn, TealBtn, Pill, Loading, Empty, ErrorState, ConfirmDialog, useToast, Toast } from '../../../components/ui'
import Sheet from '../../../components/ui/Sheet'
import { theme } from '../../../styles/theme'
import { fmt, fmtDate } from '../../../lib/utils'
import * as api from '../../../services/supabase'
import { toCsv, recordToCsv, downloadCsv, exportStamp } from '../../../lib/carefindhubExports'
import RecordFields, { flattenSections } from '../shared/RecordFields'
import { useAuditedExport } from '../shared/AuditedExport'
import { maskAccount } from '../applications/applicationRecords'

// Admin > Payouts: agent and business payout requests. Each opens in full; the list and each request can be
// exported. The status actions are unchanged: pending → processing → paid (atomic, with confirmation) or rejected.
// Account numbers are shown in full only inside the open request, where the admin needs them to pay; lists and
// exports carry the last four digits.

const FILTERS = ['all', 'pending', 'processing', 'paid', 'rejected']
const TONE = { paid: 'green', rejected: 'red', processing: 'blue', pending: 'amber' }
const bankOf = (r) => ({
  bank: r.bank_name || r.bank_details?.bank_name || null,
  number: r.account_number || r.bank_details?.account_number || null,
  name: r.account_name || r.bank_details?.account_name || null,
  method: r.payout_method || r.bank_details?.method || 'bank_transfer',
})

export function payoutSections(r, { fullAccount = false } = {}) {
  if (!r) return []
  const bank = bankOf(r)
  return [
    { title: 'Request', fields: [['Amount', fmt(r.amount)], ['Status', r.status], ['Requester type', r.requester_type], ['Requester ID', r.requester_id], ['Request ID', r.id]] },
    { title: 'Pay to', fields: [['Method', bank.method], ['Bank', bank.bank], ['Account number', fullAccount ? bank.number : maskAccount(bank.number)], ['Account name', bank.name]] },
    { title: 'Timeline', fields: [['Requested', r.requested_at || r.created_at], ['Reviewed', r.reviewed_at], ['Processed', r.processed_at], ['Last updated', r.updated_at]] },
    { title: 'Notes', fields: [['Notes', r.notes]] },
  ]
}

export const PAYOUT_EXPORT_COLUMNS = [
  { label: 'Request ID', key: 'id' },
  { label: 'Requester type', key: 'requester_type' },
  { label: 'Requester ID', key: 'requester_id' },
  { label: 'Amount (NGN)', key: 'amount' },
  { label: 'Status', key: 'status' },
  { label: 'Method', get: r => bankOf(r).method },
  { label: 'Bank', get: r => bankOf(r).bank },
  { label: 'Account (last 4)', get: r => maskAccount(bankOf(r).number) },
  { label: 'Account name', get: r => bankOf(r).name },
  { label: 'Requested', get: r => r.requested_at || r.created_at || '' },
  { label: 'Reviewed', get: r => r.reviewed_at || '' },
  { label: 'Processed', get: r => r.processed_at || '' },
  { label: 'Notes', key: 'notes' },
]

export default function PayoutsPanel({ service = api }) {
  const { msg, type, show: showToast } = useToast()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const [confirmPaid, setConfirmPaid] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const { requestExport, exportDialog } = useAuditedExport({ onExported: () => showToast('Export recorded and downloaded.', { type: 'info' }) })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setRows((await service.getPayoutRequests()) || []) } catch (e) { console.error('[admin-payouts] load failed', e); setError(e?.message || 'Payout requests could not be loaded.') }
    setLoading(false)
  }, [service])
  useEffect(() => { load() }, [load])

  const list = useMemo(() => (Array.isArray(rows) ? rows : []), [rows])
  const filtered = filter === 'all' ? list : list.filter(r => r.status === filter)
  const selected = list.find(r => r.id === selectedId) || null

  const updateStatus = async (row, next) => {
    if (busy) return
    setBusy(true)
    try {
      await service.updatePayoutRequest(row.id, { status: next, reviewed_at: new Date().toISOString() })
      showToast(`Payout ${next}`, { type: 'success' }); load()
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }
  const doMarkPaid = async () => {
    if (!confirmPaid) return
    setBusy(true)
    try {
      await service.markPayoutPaidAtomic(confirmPaid.id, {})
      await service.updatePayoutRequest(confirmPaid.id, { status: 'paid', processed_at: new Date().toISOString() })
      showToast('Marked paid. The financial source was updated.', { type: 'success' })
      setConfirmPaid(null); load()
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }

  const exportList = () => requestExport({
    exportType: 'admin.payouts.csv', label: 'payout requests', rowCount: filtered.length,
    run: () => downloadCsv(`payouts_${filter}_${exportStamp()}.csv`, toCsv(PAYOUT_EXPORT_COLUMNS, filtered)),
  })
  const exportOne = (r) => requestExport({
    exportType: 'admin.payout.csv', label: `payout request ${String(r.id).slice(0, 8)}`, rowCount: 1,
    run: () => downloadCsv(`payout_${String(r.id).slice(0, 8)}_${exportStamp()}.csv`, recordToCsv(flattenSections(payoutSections(r)))),
  })

  const actions = (r, full = false) => (
    <>
      {r.status === 'pending' && <><TealBtn disabled={busy} onClick={() => updateStatus(r, 'processing')} style={{ padding: '6px 12px', fontSize: 12, ...(full ? { flex: '1 1 140px' } : {}) }}>Approve → processing</TealBtn><button type="button" disabled={busy} onClick={() => updateStatus(r, 'rejected')} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: 'var(--red-bg)', color: 'var(--red)', fontWeight: 700, fontSize: 12, cursor: busy ? 'not-allowed' : 'pointer', ...(full ? { flex: '1 1 100px' } : {}) }}>Reject</button></>}
      {r.status === 'processing' && <TealBtn disabled={busy} onClick={() => setConfirmPaid(r)} style={{ padding: '6px 12px', fontSize: 12, background: 'var(--green)', ...(full ? { flex: '1 1 140px' } : {}) }}>Mark as Paid</TealBtn>}
    </>
  )

  if (loading && rows == null) return <Loading text="Loading payout requests…" />
  if (error && rows == null) return <ErrorState message={error} onRetry={load} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div role="tablist" aria-label="Payout status" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {FILTERS.map(s => (
            <button key={s} type="button" role="tab" aria-selected={filter === s} onClick={() => setFilter(s)} style={{ padding: '8px 14px', borderRadius: theme.radius.md, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12, background: filter === s ? 'var(--teal)' : 'var(--hairline)', color: filter === s ? 'white' : 'var(--muted)', textTransform: 'capitalize' }}>{s}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostBtn onClick={load} disabled={loading}><RefreshCw size={13} style={{ marginRight: 6 }} aria-hidden="true" />Refresh</GhostBtn>
          <GhostBtn onClick={exportList} disabled={filtered.length === 0}><Download size={13} style={{ marginRight: 6 }} aria-hidden="true" />Export</GhostBtn>
        </div>
      </div>
      {error && <div role="alert" style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>}
      {filtered.length === 0 ? <Empty icon={<Wallet size={28} />} message={filter === 'all' ? 'No payout requests yet.' : `No ${filter} payout requests.`} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(r => {
            const bank = bankOf(r)
            return (
              <Card key={r.id} style={{ padding: 14, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center', background: 'var(--panel)', border: '1px solid var(--border)' }}>
                <button type="button" onClick={() => setSelectedId(r.id)} aria-label={`Open payout request of ${fmt(r.amount)} for ${r.requester_type}`} style={{ flex: '1 1 260px', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--fg)' }}>{r.requester_type} · {fmt(r.amount)}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[bank.bank || 'Bank not set', maskAccount(bank.number), bank.name, fmtDate(r.requested_at)].filter(Boolean).join(' · ')}</div>
                  </div>
                  <ChevronRight size={14} aria-hidden="true" style={{ color: 'var(--muted)', flexShrink: 0 }} />
                </button>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Pill label={r.status} type={TONE[r.status] || 'amber'} />
                  {actions(r)}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {selected && (
        <Sheet show onClose={() => setSelectedId(null)} title={`Payout · ${fmt(selected.amount)}`} footer={
          <div style={{ display: 'flex', gap: 8, width: '100%', flexWrap: 'wrap' }}>
            {actions(selected, true)}
            <GhostBtn onClick={() => exportOne(selected)} style={{ flex: '1 1 100px' }}><Download size={13} style={{ marginRight: 6 }} aria-hidden="true" />Export</GhostBtn>
          </div>
        }>
          <RecordFields sections={payoutSections(selected, { fullAccount: true })} />
        </Sheet>
      )}

      <ConfirmDialog show={!!confirmPaid} title="Confirm Mark as Paid?" onClose={() => setConfirmPaid(null)} onConfirm={doMarkPaid} confirmLabel={busy ? 'Processing...' : 'Confirm Paid'} consequence={
        <div style={{ fontSize: 13 }}>
          <div>This updates the payout status and its financial source together.</div>
          <div style={{ marginTop: 8, color: 'var(--red)', fontWeight: 600 }}>Only confirm once the money has been sent. This cannot be undone.</div>
        </div>
      } />
      {exportDialog}
      <Toast msg={msg} type={type} />
    </div>
  )
}
