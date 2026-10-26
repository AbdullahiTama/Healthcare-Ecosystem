import { useMemo, useState } from 'react'
import { Search, CreditCard, X, ChevronDown, ChevronUp } from 'lucide-react'
import { Card, Empty, ErrorState, Loading } from '../../components/ui'
import RecordPaymentForm from '../../components/payments/RecordPaymentForm'
import PaymentHistory from '../../components/payments/PaymentHistory'
import { useSalePayments, useRecordSalePayment } from '../../hooks/queries'
import { paymentErrorMessage } from '../../lib/dbErrors'
import { fmt } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { searchCreditSales, CREDIT_SORTS } from './creditSearch'

const { navy, gray400, gray500, gray600, border, danger, success, tealDeep } = theme
const CUSTOMER_METHODS = ['Cash', 'Transfer', 'POS', 'Other']
const PAGE = 30

// POS → Credit: find a customer's credit sale by name or transaction number and
// record a full or partial payment. The open credit sales come from
// useOpenSales (every outstanding sale, paged); searching them is in memory.
// Each payment goes through record_sale_payment, which updates the balance,
// the linked debt and the payment history in one transaction.
export default function CreditCollections({ brand, creditSales, loading, error, onRetry, staffName, showToast }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('newest')
  const [shown, setShown] = useState(PAGE)
  const { results, outstanding, totalOpen } = useMemo(
    () => searchCreditSales(creditSales, { query, sort }),
    [creditSales, query, sort],
  )
  const recordPayment = useRecordSalePayment(brand?.id)

  async function record(sale, { amount, method }) {
    try {
      const r = await recordPayment.mutateAsync({ saleId: sale.id, amount, method, staffName: staffName || null })
      const who = sale.client_name || 'Walk-in'
      showToast(r.balance > 0
        ? `${fmt(amount)} received from ${who}. Balance now ${fmt(r.balance)}.`
        : `${who} has paid in full (${sale.txn_no}).`, { type: 'success' })
      console.info('[credit] payment recorded', { sale: sale.txn_no, amount, balance: r.balance })
    } catch (e) {
      console.error('[credit] payment failed:', e)
      throw new Error(paymentErrorMessage(e))
    }
  }

  if (loading) return <Loading text='Loading credit sales…' />
  if (error) return <ErrorState message="We couldn't load credit sales." onRetry={onRetry} />
  if (totalOpen === 0) return <Empty icon={<CreditCard size={40} strokeWidth={1.5} />} message='No outstanding credit sales' cause='positive' />

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ flex: '1 1 240px', display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 12px' }}>
          <Search size={15} color={gray400} aria-hidden='true' />
          <input type='search' value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE) }}
            placeholder='Search customer name or transaction number' aria-label='Search credit sales by customer name or transaction number'
            style={{ flex: 1, border: 'none', outline: 'none', padding: '11px 0', fontSize: 13, background: 'transparent', color: navy, minWidth: 0 }} />
          {query && (
            <button type='button' onClick={() => setQuery('')} aria-label='Clear search' style={{ background: 'none', border: 'none', cursor: 'pointer', color: gray500, display: 'flex', minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' }}>
              <X size={15} />
            </button>
          )}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: gray600, fontWeight: 700 }}>
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ padding: '9px 10px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 13, background: 'white', color: navy }}>
            {Object.entries(CREDIT_SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
      </div>

      <div role='status' aria-live='polite' style={{ fontSize: 13, color: gray600, marginBottom: 12 }}>
        {query
          ? <><strong>{results.length}</strong> of {totalOpen} credit sale{totalOpen === 1 ? '' : 's'} match · <strong style={{ color: danger }}>{fmt(outstanding)}</strong> outstanding</>
          : <><strong>{totalOpen}</strong> credit sale{totalOpen === 1 ? '' : 's'} · <strong style={{ color: danger }}>{fmt(outstanding)}</strong> outstanding</>}
      </div>

      {results.length === 0 ? (
        <Empty icon={<Search size={40} strokeWidth={1.5} />} cause='filtered' title='No credit sales match' description='Check the spelling, or search by transaction number.' action='Clear search' onAction={() => setQuery('')} />
      ) : (
        <>
          {results.slice(0, shown).map((s) => (
            <CreditSaleCard key={s.id} sale={s} brandId={brand?.id} onRecord={(p) => record(s, p)} />
          ))}
          {results.length > shown && (
            <button type='button' onClick={() => setShown((n) => n + PAGE)}
              style={{ display: 'block', margin: '4px auto 0', padding: '10px 18px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: tealDeep, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              Show {Math.min(PAGE, results.length - shown)} more of {results.length - shown}
            </button>
          )}
        </>
      )}
    </div>
  )
}

function CreditSaleCard({ sale, brandId, onRecord }) {
  const [open, setOpen] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const history = useSalePayments(sale.id, brandId, showHistory)
  const name = sale.client_name || 'Walk-in'
  const id = `credit-${sale.id}`
  return (
    <Card style={{ padding: 16, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: navy }}>{name}</div>
          <div style={{ fontSize: 12, color: gray500, marginTop: 2 }}>{sale.txn_no} · {(sale.created_at || '').slice(0, 10)} · Total {fmt(sale.total)}</div>
          <div style={{ fontSize: 12, color: success, marginTop: 2 }}>Paid {fmt(sale.amount_paid || 0)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: gray500, fontWeight: 700 }}>Balance</div>
          <div style={{ fontSize: 17, fontWeight: 900, color: danger }}>{fmt(sale.balance || 0)}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button type='button' onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={`${id}-pay`}
          style={{ padding: '8px 14px', borderRadius: theme.radius.md, border: 'none', background: tealDeep, color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer', minHeight: 36 }}>
          {open ? 'Close' : 'Record payment'}
        </button>
        <button type='button' onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory} aria-controls={`${id}-history`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '8px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: gray600, fontWeight: 700, fontSize: 12, cursor: 'pointer', minHeight: 36 }}>
          Payment history {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {open && (
        <div id={`${id}-pay`} style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${border}` }}>
          <RecordPaymentForm idPrefix={id} compact balance={sale.balance} methods={CUSTOMER_METHODS} defaultMethod='Cash'
            submitLabel='Record payment' onSubmit={async (p) => { await onRecord(p); setOpen(false) }} />
        </div>
      )}
      {showHistory && (
        <div id={`${id}-history`} style={{ marginTop: 12 }}>
          <PaymentHistory payments={history.data} loading={history.isLoading} error={history.isError} onRetry={() => history.refetch()} />
        </div>
      )}
    </Card>
  )
}
