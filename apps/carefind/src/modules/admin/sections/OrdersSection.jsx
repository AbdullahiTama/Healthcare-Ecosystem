import { useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react'
import { DataTable, Empty, StatusBadge } from '@care-ecosystem/design-system/components/ui'
import { useFinanceData, TRANSACTION_CAP } from '../hooks/useFinanceData'
import '../ui/admin.css'

const PAGE_SIZE = 15
const STATUS_OPTIONS = [['', 'All statuses'], ['completed', 'Completed'], ['pending', 'Pending'], ['failed', 'Failed']]

// Legacy filtering, unchanged: search over description or user id, plus a status filter.
const matches = (t, search, status) => {
  const q = search.toLowerCase()
  const matchSearch = !search || (t.description || '').toLowerCase().includes(q) || (t.user_id || '').toLowerCase().includes(q)
  return matchSearch && (!status || t.status === status)
}

const columns = [
  { key: 'type', label: 'Type', render: t => <span style={{ textTransform: 'capitalize' }}>{t.type || '—'}</span> },
  {
    key: 'description', label: 'Description',
    render: t => (
      <span title={t.description || undefined} style={{ display: 'inline-block', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>
        {t.description || '—'}
      </span>
    ),
  },
  // Not divided by 100: shown exactly as stored, as the legacy Orders tab did.
  { key: 'naira_amount', label: 'Amount', render: t => `₦${(t.naira_amount || 0).toLocaleString()}` },
  { key: 'status', label: 'Status', render: t => <StatusBadge status={t.status} /> },
  { key: 'created_at', label: 'Date', render: t => (t.created_at ? new Date(t.created_at).toLocaleDateString() : '—') },
]

const controlStyle = { padding: '10px 12px', borderRadius: 10, border: '1px solid var(--adm-line, #d6dbe0)', fontSize: 13, background: 'white', color: 'inherit', font: 'inherit' }
const pagerButton = { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--adm-line, #d6dbe0)', background: 'white', fontWeight: 700, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }

// The wallet transactions list. Search and filters run on the latest
// TRANSACTION_CAP transactions already loaded, and the screen says so.
export default function OrdersSection() {
  const { data, isLoading, refetch } = useFinanceData()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0) // zero-based; shown to the reader as page + 1

  const source = data?.transactions
  const failed = !isLoading && source?.status !== 'ok'
  const all = source?.status === 'ok' ? source.data : []
  const filtered = all.filter(t => matches(t, search, status))
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pageCount - 1)
  const visible = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)

  const onSearch = (e) => { setSearch(e.target.value); setPage(0) }
  const onStatus = (e) => { setStatus(e.target.value); setPage(0) }

  return (
    <div className="adm-page">
      <div className="adm-head">
        <div>
          <h1>Orders</h1>
          <p className="adm-note">{`Wallet transactions, latest ${TRANSACTION_CAP}`}</p>
        </div>
        <button type="button" className="adm-btn-reset" onClick={() => refetch()} style={{ ...pagerButton, cursor: 'pointer' }}>
          <RefreshCw size={12} aria-hidden="true" /> Refresh
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 360 }}>
          <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.6 }} />
          <input value={search} onChange={onSearch} placeholder={`Search within these ${TRANSACTION_CAP}…`} aria-label="Search transactions" style={{ ...controlStyle, width: '100%', paddingLeft: 30, boxSizing: 'border-box' }} />
        </div>
        <select value={status} onChange={onStatus} aria-label="Filter by status" style={controlStyle}>
          {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {!failed && !isLoading && <span className="adm-note">{`${filtered.length} results · page ${current + 1}/${pageCount}`}</span>}
      </div>

      <DataTable
        rows={visible}
        columns={columns}
        total={filtered.length}
        loading={isLoading}
        error={failed ? "Couldn't load transactions." : undefined}
        onRetry={() => refetch()}
        empty={<Empty message="No transactions found" />}
      />

      {pageCount > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
          <button type="button" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)} style={{ ...pagerButton, cursor: current === 0 ? 'not-allowed' : 'pointer' }}><ChevronLeft size={13} aria-hidden="true" /> Previous</button>
          <button type="button" aria-label="Next page" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)} style={{ ...pagerButton, cursor: current >= pageCount - 1 ? 'not-allowed' : 'pointer' }}>Next <ChevronRight size={13} aria-hidden="true" /></button>
        </div>
      )}

      <p className="adm-note">{`Amount as stored (naira_amount). Search and filters cover these ${TRANSACTION_CAP} transactions only.`}</p>
    </div>
  )
}
