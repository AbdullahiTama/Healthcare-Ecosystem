import { Download } from 'lucide-react'
import { Button, DataTable, Empty, StatusBadge } from '@care-ecosystem/design-system/components/ui'
import { useFinanceData, TRANSACTION_CAP } from '../hooks/useFinanceData'
import { topupTotal, countByType } from '../lib/financeFormat'
import { timeAgo, exportCSV } from '../ui'
import MetricStrip from '../ui/MetricStrip.jsx'
import '../ui/admin.css'

const typeLabel = (t) => (t.type ? t.type.replace('_', ' ') : '—')

// Same format as the legacy Revenue tab: naira_amount / 100, a dash when absent.
const nairaOf = (t) => (t.naira_amount ? `₦${(t.naira_amount / 100).toLocaleString()}` : '—')

const columns = [
  { key: 'type', label: 'Type', render: t => <span style={{ textTransform: 'capitalize' }}>{typeLabel(t)}</span> },
  { key: 'description', label: 'Description', render: t => t.description || '—' },
  { key: 'amount', label: 'Coins', render: t => t.amount ?? '—' },
  { key: 'naira_amount', label: '₦', render: nairaOf },
  { key: 'status', label: 'Status', render: t => <StatusBadge status={t.status} /> },
  { key: 'created_at', label: 'When', render: t => timeAgo(t.created_at) },
]

// Figures come from the latest TRANSACTION_CAP transactions only, and every label
// says so. A failed source is shown as failed, never as ₦0 or as no transactions.
export default function RevenueSection() {
  const { data, isLoading, refetch } = useFinanceData()
  const source = data?.transactions
  const rows = source?.status === 'ok' ? source.data : []
  const status = isLoading ? 'loading' : source?.status === 'ok' ? 'ok' : 'error'
  const failed = !isLoading && status === 'error'
  const retry = () => refetch()

  const cap = `latest ${TRANSACTION_CAP}`
  const items = [
    { key: 'topups', label: `Top-ups (${cap})`, hint: 'Sum of top-ups of any status', value: `₦${topupTotal(rows).toLocaleString()}` },
    { key: 'topup-count', label: `Top-up count (${cap})`, value: countByType(rows, 'topup') },
    { key: 'withdrawals', label: `Withdrawal requests (${cap})`, value: countByType(rows, 'withdrawal') },
  ].map(i => ({ ...i, status, onRetry: retry }))

  return (
    <div className="adm-page">
      <div className="adm-head">
        <div>
          <h1>Revenue</h1>
          <p className="adm-note">{`Wallet transactions, ${cap}`}</p>
        </div>
        <Button variant="primary" size="sm" leftIcon={<Download size={14} />} disabled={rows.length === 0} onClick={() => exportCSV(rows, 'transactions.csv')}>
          {`Export CSV (${cap})`}
        </Button>
      </div>

      <MetricStrip items={items} label="Revenue figures" />

      <section className="adm-panel" aria-labelledby="adm-revenue-title">
        <div className="adm-phead"><h2 id="adm-revenue-title">{`Latest ${TRANSACTION_CAP} transactions`}</h2></div>
        <DataTable
          rows={rows}
          columns={columns}
          loading={isLoading}
          error={failed ? "Couldn't load transactions." : undefined}
          onRetry={retry}
          empty={<Empty message={`No transactions in the latest ${TRANSACTION_CAP}`} />}
        />
      </section>
    </div>
  )
}
