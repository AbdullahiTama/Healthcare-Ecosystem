import { businessDateOf } from '../../lib/businessDay'
import { useMemo, useState } from 'react'
import { Search, CreditCard, X, ChevronDown, ChevronUp, Download, UserX, Users } from 'lucide-react'
import { Card, Empty, ErrorState, Loading, Modal, Pill, GhostBtn } from '../../components/ui'
import RecordPaymentForm from '../../components/payments/RecordPaymentForm'
import PaymentHistory from '../../components/payments/PaymentHistory'
import ExportFormatModal from '../../components/ExportFormatModal'
import { useSalePayments, useRecordSalePayment, useRecordCustomerPayment, useCreditAccountTransactions } from '../../hooks/queries'
import { paymentErrorMessage, isMissingObject } from '../../lib/dbErrors'
import { auditedExport, exportColumns } from '../../lib/auditedExport'
import { fmt } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { Figure } from '../purchases/SupplierPayments'
import { groupCreditAccounts, searchCreditAccounts, accountTransactions, visitOwed, ACCOUNT_SORTS, CREDIT_EXPORT_COLUMNS, creditExportRows } from './creditAccounts'

const { navy, gray400, gray500, gray600, gray100, border, danger, success, tealDeep } = theme
// The methods record_sale_payment() accepts; they feed the Sales & Accounts report's cash / transfer / POS totals.
const CUSTOMER_METHODS = ['Cash', 'Transfer', 'POS']
const PAGE = 30

// POS → Credit: one account per customer. Repeated credit purchases by the same customer are shown together (total
// outstanding, visits, what each visit still owes, payment history), with View details, Record payment and View
// transactions. Each credit sale stays its own record: a payment on the account is applied to the oldest visits first
// through record_sale_payment (record_customer_payment), so every purchase and payment remains traceable in the POS
// ledger. Docs: docs/architecture/Debt-Accounts-and-POS-Stock-Limits.md §4.
export default function CreditCollections({ brand, creditSales, clients = [], loading, error, onRetry, showToast, role, perms }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('balance')
  const [shown, setShown] = useState(PAGE)
  const [open, setOpen] = useState(null) // { key, view: 'details' | 'pay' | 'transactions' }
  const [showExport, setShowExport] = useState(false)
  const accounts = useMemo(() => groupCreditAccounts(creditSales, clients), [creditSales, clients])
  const { results, outstanding, totalAccounts } = useMemo(() => searchCreditAccounts(accounts, { query, sort }), [accounts, query, sort])
  const visits = accounts.reduce((n, a) => n + a.visits, 0)
  const canExport = role === 'Owner' || !!perms?.canExportReports
  const current = open ? accounts.find((a) => a.key === open.key) : null

  async function exportShown(format) {
    return auditedExport({
      format, rows: creditExportRows(results), columns: exportColumns(CREDIT_EXPORT_COLUMNS, ['total', 'paid', 'balance']),
      sheetName: 'Credit accounts', fileBase: 'CareHub_Credit_Accounts', businessId: brand.id, exportType: 'credit_accounts',
      noun: 'customer account', showToast, logTag: '[credit]', filters: { search_applied: !!query.trim(), sort, accounts: results.length },
    })
  }

  if (loading) return <Loading text='Loading credit accounts…' />
  if (error) return <ErrorState message="We couldn't load credit sales." onRetry={onRetry} />
  if (totalAccounts === 0) return <Empty icon={<CreditCard size={40} strokeWidth={1.5} />} message='No outstanding credit sales' cause='positive' />

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ flex: '1 1 240px', display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 12px' }}>
          <Search size={15} color={gray400} aria-hidden='true' />
          <input type='search' value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE) }}
            placeholder='Search customer, phone or transaction number' aria-label='Search credit accounts by customer, phone or transaction number'
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
            {Object.entries(ACCOUNT_SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        {canExport && <GhostBtn onClick={() => setShowExport(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Download size={14} aria-hidden='true' /> Export</GhostBtn>}
      </div>

      <div role='status' aria-live='polite' style={{ fontSize: 13, color: gray600, marginBottom: 12 }}>
        {query
          ? <><strong>{results.length}</strong> of {totalAccounts} customer account{totalAccounts === 1 ? '' : 's'} match · <strong style={{ color: danger }}>{fmt(outstanding)}</strong> outstanding</>
          : <><strong>{totalAccounts}</strong> customer account{totalAccounts === 1 ? '' : 's'} · {visits} credit sale{visits === 1 ? '' : 's'} · <strong style={{ color: danger }}>{fmt(outstanding)}</strong> outstanding</>}
      </div>

      {results.length === 0 ? (
        <Empty icon={<Search size={40} strokeWidth={1.5} />} cause='filtered' title='No credit accounts match' description='Check the spelling, or search by phone or transaction number.' action='Clear search' onAction={() => setQuery('')} />
      ) : (
        <>
          {results.slice(0, shown).map((a) => (
            <AccountCard key={a.key} account={a} onOpen={(view) => setOpen({ key: a.key, view })} />
          ))}
          {results.length > shown && (
            <button type='button' onClick={() => setShown((n) => n + PAGE)}
              style={{ display: 'block', margin: '4px auto 0', padding: '10px 18px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: tealDeep, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              Show {Math.min(PAGE, results.length - shown)} more of {results.length - shown}
            </button>
          )}
        </>
      )}

      {current && open.view === 'details' && <AccountDetailsModal brand={brand} account={current} showToast={showToast} onClose={() => setOpen(null)} onPayAll={() => setOpen({ key: current.key, view: 'pay' })} />}
      {current && open.view === 'pay' && <AccountPaymentModal brand={brand} account={current} showToast={showToast} onClose={() => setOpen(null)} />}
      {current && open.view === 'transactions' && <AccountTransactionsModal brand={brand} account={current} onClose={() => setOpen(null)} />}
      {showExport && (
        <ExportFormatModal show onClose={() => setShowExport(false)} onExport={exportShown} title='Export credit accounts' name='credit-export-format'
          description={`Exports the ${results.length} customer account${results.length === 1 ? '' : 's'} on screen: visits owing, purchased, paid and outstanding, with each transaction number. The export is recorded in the audit log.`} />
      )}
    </div>
  )
}

function AccountCard({ account: a, onOpen }) {
  const btn = (label, view, primary) => (
    <button type='button' onClick={() => onOpen(view)} aria-label={`${label}: ${a.name}`}
      style={{ padding: '8px 14px', borderRadius: theme.radius.md, border: primary ? 'none' : `1px solid ${border}`, background: primary ? tealDeep : 'white', color: primary ? 'white' : gray600, fontWeight: 700, fontSize: 12, cursor: 'pointer', minHeight: 36 }}>
      {label}
    </button>
  )
  return (
    <Card style={{ padding: 16, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: navy }}>{a.name}</div>
          <div style={{ fontSize: 12, color: gray500, marginTop: 2 }}>
            {a.phone ? a.phone + ' · ' : ''}{a.visits} visit{a.visits === 1 ? '' : 's'} owing · since {businessDateOf(a.oldest)}{a.visits > 1 ? ` · latest ${businessDateOf(a.latest)}` : ''}
          </div>
          <div style={{ fontSize: 12, color: success, marginTop: 2 }}>Purchased {fmt(a.total)} · paid {fmt(a.paid)}</div>
          {(a.unlinked > 0 || a.ambiguous) && (
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {a.ambiguous && <Pill label={<><Users size={10} aria-hidden='true' /> Several customers share this name</>} type='amber' />}
              {a.unlinked > 0 && !a.walkIn && <Pill label={<><UserX size={10} aria-hidden='true' /> {a.unlinked} sale{a.unlinked === 1 ? '' : 's'} matched by name</>} type='gray' />}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: gray500, fontWeight: 700 }}>Total outstanding</div>
          <div style={{ fontSize: 17, fontWeight: 900, color: danger }}>{fmt(a.balance)}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {btn('Record payment', 'pay', true)}
        {btn('View details', 'details')}
        {btn('View transactions', 'transactions')}
      </div>
    </Card>
  )
}

// The items of a sale, shortened: "Amoxil ×2, ORS ×1 and 3 more".
function itemsSummary(sale) {
  let items = []
  try { items = Array.isArray(sale.items) ? sale.items : JSON.parse(sale.items || '[]') } catch (e) { items = [] }
  const names = items.map((i) => `${i.name} ×${i.qty}`)
  return names.length > 3 ? names.slice(0, 3).join(', ') + ` and ${names.length - 3} more` : names.join(', ')
}

function useVisitPayment(brand, showToast) {
  const record = useRecordSalePayment(brand?.id)
  return async (sale, { amount, method }) => {
    try {
      const r = await record.mutateAsync({ saleId: sale.id, amount, method })
      const who = sale.client_name || 'Walk-in'
      showToast(r.balance > 0
        ? `${fmt(r.applied ?? amount)} received from ${who}. Balance now ${fmt(r.balance)}.`
        : `${who} has paid in full (${sale.txn_no}).`, { type: 'success' })
      console.info('[credit] payment recorded', { sale: sale.txn_no, amount: r.applied ?? amount, balance: r.balance })
    } catch (e) {
      console.error('[credit] payment failed:', e)
      throw new Error(paymentErrorMessage(e))
    }
  }
}

// View details: each visit with what it still owes, its items and payments, payable on its own.
function AccountDetailsModal({ brand, account, showToast, onClose, onPayAll }) {
  const payVisit = useVisitPayment(brand, showToast)
  return (
    <Modal show onClose={onClose} title={account.name} wide>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <Figure label='Purchased' value={fmt(account.total)} />
          <Figure label='Paid' value={fmt(account.paid)} color={success} />
          <Figure label='Outstanding' value={fmt(account.balance)} color={danger} />
        </div>
        {account.visits > 1 && <div><GhostBtn onClick={onPayAll} style={{ padding: '8px 14px' }}>Pay towards the whole account</GhostBtn></div>}
        <section aria-label='Visits owing'>
          <div style={{ fontWeight: 800, fontSize: 13, color: navy, marginBottom: 8 }}>{account.visits} visit{account.visits === 1 ? '' : 's'} owing, oldest first</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {account.sales.map((s) => <VisitRow key={s.id} sale={s} brandId={brand?.id} onRecord={(p) => payVisit(s, p)} />)}
          </ul>
        </section>
      </div>
    </Modal>
  )
}

function VisitRow({ sale, brandId, onRecord }) {
  const [paying, setPaying] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const history = useSalePayments(sale.id, brandId, showHistory)
  const id = `credit-${sale.id}`
  const owed = visitOwed(sale)
  const items = itemsSummary(sale)
  return (
    <li style={{ padding: '10px 12px', border: `1px solid ${border}`, borderRadius: theme.radius.md }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: navy }}>{sale.txn_no} · {businessDateOf(sale.created_at)}</div>
          {items && <div style={{ fontSize: 12, color: gray600, marginTop: 2, overflowWrap: 'anywhere' }}>{items}</div>}
          <div style={{ fontSize: 12, color: gray500, marginTop: 2 }}>Total {fmt(sale.total)} · paid {fmt(Math.min(Number(sale.amount_paid) || 0, Number(sale.total) || 0))}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: gray500, fontWeight: 700 }}>Owed on this visit</div>
          <div style={{ fontSize: 15, fontWeight: 900, color: danger }}>{fmt(owed)}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button type='button' onClick={() => setPaying((v) => !v)} aria-expanded={paying} aria-controls={`${id}-pay`}
          style={{ padding: '6px 12px', borderRadius: theme.radius.md, border: `1px solid ${tealDeep}`, background: 'white', color: tealDeep, fontWeight: 700, fontSize: 12, cursor: 'pointer', minHeight: 32 }}>
          {paying ? 'Close' : 'Pay this visit'}
        </button>
        <button type='button' onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory} aria-controls={`${id}-history`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: gray600, fontWeight: 700, fontSize: 12, cursor: 'pointer', minHeight: 32 }}>
          Payment history {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {paying && (
        <div id={`${id}-pay`} style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${gray100}` }}>
          <RecordPaymentForm idPrefix={id} compact balance={owed} methods={CUSTOMER_METHODS} defaultMethod='Cash'
            submitLabel='Record payment' onSubmit={async (p) => { await onRecord(p); setPaying(false) }} />
        </div>
      )}
      {showHistory && (
        <div id={`${id}-history`} style={{ marginTop: 10 }}>
          <PaymentHistory payments={history.data} loading={history.isLoading} error={history.isError} onRetry={() => history.refetch()} />
        </div>
      )}
    </li>
  )
}

// Record payment on the whole account: applied to the oldest visits first, all or nothing.
function AccountPaymentModal({ brand, account, showToast, onClose }) {
  const recordAccount = useRecordCustomerPayment(brand?.id)
  const payVisit = useVisitPayment(brand, showToast)
  const oldest = account.sales.find((s) => visitOwed(s) > 0)

  async function submit({ amount, method }) {
    try {
      const r = await recordAccount.mutateAsync({ saleIds: account.sales.map((s) => s.id), amount, method })
      const n = (r?.allocations || []).length
      console.info('[credit] account payment recorded', { account: account.key, amount, visits: n, balance: r?.balance })
      showToast(Number(r?.balance) > 0
        ? `${fmt(amount)} received from ${account.name}, applied to ${n} visit${n === 1 ? '' : 's'}. Balance now ${fmt(r.balance)}.`
        : `${account.name} has paid the account in full.`, { type: 'success' })
      onClose()
    } catch (e) {
      if (isMissingObject(e)) {
        // Before carehub_20270117: a payment that fits the oldest visit is recorded on it, as a visit payment.
        if (oldest && amount <= visitOwed(oldest) + 0.005) { await payVisit(oldest, { amount, method }); onClose(); return }
        throw new Error('Paying several visits at once becomes available once the latest database update is applied. Pay each visit from View details.')
      }
      console.error('[credit] account payment failed:', e)
      throw new Error(paymentErrorMessage(e))
    }
  }

  return (
    <Modal show onClose={onClose} title={`Payment from ${account.name}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          <Figure label='Visits owing' value={String(account.visits)} />
          <Figure label='Total outstanding' value={fmt(account.balance)} color={danger} />
        </div>
        <div style={{ fontSize: 12.5, color: gray600, lineHeight: 1.5 }}>
          Applied to the oldest visits first{oldest ? ` (starting with ${oldest.txn_no}, ${fmt(visitOwed(oldest))} owed)` : ''}. Each visit records its own part, so every payment stays traceable to a sale.
        </div>
        <RecordPaymentForm idPrefix={`account-${account.sales[0]?.id || 'x'}`} balance={account.balance} methods={CUSTOMER_METHODS} defaultMethod='Cash'
          submitLabel='Record payment' onSubmit={submit} />
      </div>
    </Modal>
  )
}

// View transactions: every credit purchase and payment on the account, oldest first, with the balance after each.
function AccountTransactionsModal({ brand, account, onClose }) {
  const tx = useCreditAccountTransactions(brand?.id, account)
  const rows = useMemo(() => (tx.data ? accountTransactions(tx.data.sales, tx.data.payments) : []), [tx.data])
  const label = (e) => (e.type === 'purchase' ? 'Purchase on credit' : e.type === 'refund' ? 'Refund (money returned)' : e.payment?.kind === 'sale' ? 'Paid at the sale' : 'Payment')
  return (
    <Modal show onClose={onClose} title={`${account.name}: transactions`} wide>
      {tx.isLoading ? <Loading text='Loading transactions…' /> : tx.isError ? (
        <ErrorState message="We couldn't load this account's transactions." onRetry={() => tx.refetch()} />
      ) : rows.length === 0 ? (
        <Empty message='No transactions found.' />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: gray500 }}>
            {tx.data.complete ? 'Every credit sale on this customer\'s record (paid ones too) and every payment.' : 'The open credit sales of this account and their payments (not linked to a customer record).'}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${border}` }}>
                  {['Date', 'Transaction', 'What', 'Amount', 'Balance after'].map((h, i) => (
                    <th key={h} scope='col' style={{ padding: '8px 10px', textAlign: i >= 3 ? 'right' : 'left', fontSize: 10, fontWeight: 700, color: gray400, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((e, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${gray100}` }}>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: gray600 }}>{businessDateOf(e.at)}</td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: navy, fontWeight: 700 }}>{e.sale?.txn_no}</td>
                    <td style={{ padding: '8px 10px', color: gray600 }}>{label(e)}{e.payment ? ` · ${e.payment.method}${e.payment.staff_name ? ' · by ' + e.payment.staff_name : ''}` : ''}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 800, color: e.type === 'purchase' ? navy : e.type === 'refund' ? danger : success }}>{e.type === 'payment' ? '−' : ''}{fmt(e.amount)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: e.balance > 0 ? danger : success }}>{e.type === 'refund' ? '' : fmt(e.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  )
}
