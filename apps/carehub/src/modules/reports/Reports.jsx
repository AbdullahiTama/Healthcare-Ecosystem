import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, CheckCircle, AlertTriangle, Search, X, ChevronRight } from 'lucide-react'
// Reports owns no table of its own — it is a read-only projection over three
// aggregates that belong to other modules. So it gets no repository of its
// own; it composes theirs. Adding a `reportRepository` here would be an
// abstraction over nothing, and it would put a fourth copy of these queries in
// the codebase.
import { saleRepository } from '../pos/repositories'
import { expenseRepository } from '../expenses/repositories'
import { expenseDate, sumExpenses, sumByCategory } from '../expenses/expenseRules'
import { purchaseRepository } from '../purchases/repositories'
import { adrReportRepository } from '../adr/repositories'
import { inPeriod, periodRange } from './periodFilter'
import { businessDateOf } from '../../lib/businessDay'
import { searchSales } from './transactionSearch'
import { isCompletedSale, saleNet, saleRefunded, paymentStatus } from '../pos/salesReport'
import SaleDetailModal from '../pos/SaleDetailModal'
import { useInvalidateSalesReport } from '../pos/useSalesReportData'
import { useProductCatalog } from '../inventory/hooks/useProductCatalog'
import { useSettings, useClients } from '../../hooks/queries'
import { fmt, currentMonth } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { usePlanGate } from '../../hooks/usePlanGate'
import { Card, StatCard, Loading, TealBtn, Pill, useToast, Toast } from '../../components/ui'

const { tealDeep, navy, gray600, gray500, gray400, gray100, gray50, border, danger, success, warning, bg } = theme

const PAGE = 50
const STATUS_PILL = { Paid: 'green', 'Part-paid': 'amber', Unpaid: 'red' }
// Same periods and words as Sales & Accounts; weeks run Monday to Sunday.
const REPORT_PERIODS = [['today', 'Today'], ['week', 'This week'], ['month', 'Month'], ['year', 'This year'], ['all', 'All time']]

export default function Reports({ brand, role, perms, embedded = false }) {
  const [period, setPeriod] = useState('month')
  const [customMonth, setCustomMonth] = useState(currentMonth())
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [openSaleId, setOpenSaleId] = useState(null)
  const { msg, type: toastType, show: showToast } = useToast()
  const plan = usePlanGate(showToast)
  // Editing, refunding and deleting a completed sale is the Owner's alone, and
  // only from here. This only decides what is offered; the database enforces it.
  const canCorrect = role === 'Owner'
  const { data: settings } = useSettings(brand?.id)
  const clientsQuery = useClients(brand?.id)
  const catalog = useProductCatalog(canCorrect ? brand?.id : undefined)
  const invalidate = useInvalidateSalesReport()
  // Only the selected period is read from the server (sales and purchases are
  // filtered by date there, and every read pages past the 1000-row cap), so a
  // business with years of history does not download all of it to show one
  // month. Outstanding credit is all-time by definition, so it comes from the
  // open-sales read. React Query caches each period, and an answer for a
  // period the user has already left is never shown.
  const reportQuery = useQuery({
    queryKey: ['reports', brand?.id, period, period === 'month' ? customMonth : null],
    enabled: !!brand?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { from, to } = periodRange({ period, month: customMonth })
      const [sales, expenses, purchases, adrReports, openSales] = await Promise.all([
        saleRepository.getSince(brand.id, from, { to }),
        expenseRepository.getAll(brand.id),
        purchaseRepository.getAll(brand.id, { from, to }),
        adrReportRepository.getReports(brand.id),
        saleRepository.getOpen(brand.id),
      ]).catch((e) => { console.error('[Reports] load failed:', e?.message); throw e })
      return { sales: sales || [], expenses: expenses || [], purchases: purchases || [], adrReports: adrReports || [], openSales: openSales || [] }
    },
  })
  const loading = reportQuery.isLoading
  // Do not present a failed read as a month with no spending.
  const loadError = reportQuery.isError ? (reportQuery.error?.message || 'Could not load reports.') : null
  const load = () => reportQuery.refetch()
  const { sales = [], expenses = [], purchases = [], adrReports = [], openSales = [] } = reportQuery.data || {}

  const inRange = (item, dateOf) => inPeriod(item, { period, month: customMonth, dateOf })

  // Held, resumed and deleted rows are not sales.
  const fSales = sales.filter(s => inRange(s)).filter(isCompletedSale)
  // Expenses belong to the date the user recorded (same rule as the Expenses page and the database).
  const fExpenses = expenses.filter(x => inRange(x, expenseDate))
  const fPurchases = purchases.filter(p => inRange(p))
  const fAdrReports = adrReports.filter(r => inRange(r))
  // The search narrows the transaction list (and its CSV rows) within the chosen
  // period; the summary cards above always describe the whole period.
  const searched = searchSales(fSales, query)
  const openSale = openSaleId ? fSales.find(s => s.id === openSaleId) : null

  // Revenue is net of refunds, so a refund or an Owner edit shows here at once.
  const totalRevenue = fSales.reduce((s, x) => s + saleNet(x), 0)
  const totalRefunded = fSales.reduce((s, x) => s + saleRefunded(x), 0)
  const totalExpenses = sumExpenses(fExpenses)
  const totalPurchases = fPurchases.reduce((s, x) => s + (x.total_cost || 0), 0)
  const netProfit = totalRevenue - totalExpenses - totalPurchases
  const creditBalance = openSales.filter(s => s.is_credit && (s.balance || 0) > 0).reduce((s, x) => s + (x.balance || 0), 0)

  const byMethod = {}
  fSales.forEach(s => { byMethod[s.payment_method] = (byMethod[s.payment_method] || 0) + saleNet(s) })

  const byExpCat = sumByCategory(fExpenses)

  const dailySales = {}
  fSales.forEach(s => { const d = businessDateOf(s.created_at); dailySales[d] = (dailySales[d] || 0) + saleNet(s) })
  const dailyDates = Object.keys(dailySales).sort().slice(-14)
  const maxDaily = Math.max(...Object.values(dailySales), 1)

  function exportCSV() {
    if (!plan.allow('exporting reports')) return
    const rows = [
      ['CareHub Financial Report'],
      ['Business', brand?.name || '', 'Period', period === 'month' ? customMonth : period],
      ['Generated', new Date().toLocaleDateString('en-NG')],
      [],
      ['SUMMARY'],
      ['Total Revenue', totalRevenue],
      ['Total Expenses', totalExpenses],
      ['Total Purchases', totalPurchases],
      ['Net Profit', netProfit],
      ['Credit Outstanding', creditBalance],
      [],
      ['SALES DETAIL'],
      ['Date', 'Transaction No', 'Client', 'Total', 'Refunded', 'Net', 'Payment Method', 'Credit?'],
      ...searched.map(s => [businessDateOf(s.created_at), s.txn_no || '', s.client_name || 'Walk-in', s.total || 0, saleRefunded(s), saleNet(s), s.payment_method || '', s.is_credit ? 'Yes' : 'No']),
      [],
      ['EXPENSES DETAIL'],
      ['Date', 'Category', 'Description', 'Amount', 'Staff'],
      ...fExpenses.map(e => [businessDateOf(e.date || e.created_at), e.category || '', e.description || '', e.amount || 0, e.staff_name || '']),
      [],
      ['PURCHASES DETAIL'],
      ['Date', 'Supplier', 'Product', 'Total Cost', 'Paid', 'Balance', 'Status'],
      ...fPurchases.map(p => [p.supply_date || '', p.supplier_name || '', p.product_name || '', p.total_cost || 0, p.amount_paid || 0, p.balance || 0, p.status || '']),
      [],
      ['ADR REPORTS DETAIL'],
      ['Report No', 'Module', 'Status', 'Created', 'Reporter'],
      ...fAdrReports.map(r => [
        r.report_number || 'Not set',
        r.module_type || 'Not set',
        r.status || 'Not set',
        r.created_at ? new Date(r.created_at).toLocaleDateString('en-NG') : 'Not set',
        r.reporter_name || 'Not set',
      ]),
    ]
    const csv = rows.map(r => (Array.isArray(r) ? r : [r]).map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'CareHub_Report_' + (period === 'month' ? customMonth : period) + '.csv'; a.click()
    URL.revokeObjectURL(url)
    showToast('Report exported!')
  }

  return (
    <div>
      {(!embedded || perms?.canExportReports) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: embedded ? 'flex-end' : 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
          {!embedded && <div><div style={{ fontSize: '20px', fontWeight: '900', color: navy }}>Financial Reports</div><div style={{ fontSize: '13px', color: gray500, marginTop: '3px' }}>Full breakdown of revenue, expenses and profit</div></div>}
          {perms?.canExportReports && (
            <button onClick={exportCSV} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 18px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
              <Download size={15} /> Export to Excel / CSV
            </button>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
        {REPORT_PERIODS.map(([p, label]) => { const on = period === p; return (
          <button key={p} onClick={() => setPeriod(p)} aria-pressed={on}
            style={{ padding: '8px 14px', borderRadius: theme.radius.full, border: `1px solid ${on ? tealDeep : border}`, cursor: 'pointer', fontSize: '12px', fontWeight: '700', background: on ? tealDeep : 'white', color: on ? 'white' : gray600 }}>
            {label}
          </button>
        )})}
        {period === 'month' && (
          <input type='month' value={customMonth} onChange={e => setCustomMonth(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', color: navy, background: 'white' }} />
        )}
      </div>

      <div role='search' style={{ position: 'relative', marginBottom: '20px', maxWidth: 520 }}>
        <Search size={15} color={gray400} aria-hidden='true' style={{ position: 'absolute', left: 12, top: 12 }} />
        <input type='search' value={query} onChange={e => { setQuery(e.target.value); setLimit(PAGE) }}
          aria-label='Search transactions' placeholder='Search customer, receipt no., amount, product, cashier…'
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 36px 10px 34px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', color: navy, background: 'white' }} />
        {query && (
          <button onClick={() => { setQuery(''); setLimit(PAGE) }} aria-label='Clear search'
            style={{ position: 'absolute', right: 6, top: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 6, display: 'flex', color: gray400 }}><X size={15} /></button>
        )}
      </div>

      {loading ? <Loading /> : loadError ? (
        <Card style={{ padding: '24px', textAlign: 'center' }} role='alert'>
          <div style={{ fontWeight: '800', color: navy, marginBottom: '4px' }}>Reports could not be loaded</div>
          <div style={{ fontSize: '13px', color: gray500, marginBottom: '14px' }}>Figures are not shown because they could not be read, so they are not shown as zero.</div>
          <TealBtn onClick={load}>Try again</TealBtn>
        </Card>
      ) : (
        <>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '14px', marginBottom: '20px' }}>
            <Card style={{ padding: '20px', borderLeft: `4px solid ${success}` }}>
              <div style={{ fontSize: '12px', color: gray500, fontWeight: '600', marginBottom: '4px' }}>Total revenue</div>
              <div style={{ fontSize: '28px', fontWeight: '900', color: success }}>{fmt(totalRevenue)}</div>
              <div style={{ fontSize: '12px', color: gray400, marginTop: '4px' }}>{fSales.length} transactions{totalRefunded > 0 ? ` · after ${fmt(totalRefunded)} refunded` : ''}</div>
            </Card>
            <Card style={{ padding: '20px', borderLeft: `4px solid ${danger}` }}>
              <div style={{ fontSize: '12px', color: gray500, fontWeight: '600', marginBottom: '4px' }}>Total expenditure</div>
              <div style={{ fontSize: '28px', fontWeight: '900', color: danger }}>{fmt(totalExpenses + totalPurchases)}</div>
              <div style={{ fontSize: '12px', color: gray400, marginTop: '4px' }}>Expenses + purchases</div>
            </Card>
            <Card style={{ padding: '20px', borderLeft: `4px solid ${netProfit >= 0 ? tealDeep : danger}` }}>
              <div style={{ fontSize: '12px', color: gray500, fontWeight: '600', marginBottom: '4px' }}>Net profit</div>
              <div style={{ fontSize: '28px', fontWeight: '900', color: netProfit >= 0 ? tealDeep : danger }}>{fmt(netProfit)}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: gray400, marginTop: '4px' }}>{netProfit >= 0 ? <><CheckCircle size={12} /> Profitable</> : <><AlertTriangle size={12} /> Loss</>}</div>
            </Card>
            <Card style={{ padding: '20px', borderLeft: `4px solid ${warning}` }}>
              <div style={{ fontSize: '12px', color: gray500, fontWeight: '600', marginBottom: '4px' }}>Credit outstanding</div>
              <div style={{ fontSize: '28px', fontWeight: '900', color: warning }}>{fmt(creditBalance)}</div>
              <div style={{ fontSize: '12px', color: gray400, marginTop: '4px' }}>All open credit sales, any date</div>
            </Card>
            <Card style={{ padding: '20px', borderLeft: `4px solid ${warning}` }}>
              <div style={{ fontSize: '12px', color: gray500, fontWeight: '600', marginBottom: '4px' }}>Total ADR Reports</div>
              <div style={{ fontSize: '28px', fontWeight: '900', color: warning }}>{fAdrReports.length} reports</div>
              <div style={{ fontSize: '12px', color: gray400, marginTop: '4px' }}>ADR reports</div>
            </Card>
          </div>

          {/* Revenue by method */}
          {Object.keys(byMethod).length > 0 && (
            <Card style={{ padding: '20px', marginBottom: '20px' }}>
              <div style={{ fontWeight: '800', fontSize: '15px', marginBottom: '14px', color: navy }}>Revenue by payment method</div>
              {Object.entries(byMethod).sort((a, b) => b[1] - a[1]).map(([method, amt]) => (
                <div key={method} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                  <span style={{ fontSize: '12px', color: gray600, width: '80px', fontWeight: '600', flexShrink: 0 }}>{method}</span>
                  <div style={{ flex: 1, height: '10px', background: gray100, borderRadius: '5px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: (totalRevenue > 0 ? (amt / totalRevenue) * 100 : 0) + '%', background: tealDeep, borderRadius: '5px' }} />
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: '700', width: '100px', textAlign: 'right', flexShrink: 0, color: navy }}>{fmt(amt)}</span>
                </div>
              ))}
            </Card>
          )}

          {/* Expense breakdown */}
          {Object.keys(byExpCat).length > 0 && (
            <Card style={{ padding: '20px', marginBottom: '20px' }}>
              <div style={{ fontWeight: '800', fontSize: '15px', marginBottom: '14px', color: navy }}>Expense breakdown</div>
              {Object.entries(byExpCat).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                  <span style={{ fontSize: '12px', color: gray600, width: '110px', fontWeight: '600', flexShrink: 0 }}>{cat}</span>
                  <div style={{ flex: 1, height: '10px', background: gray100, borderRadius: '5px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: (totalExpenses > 0 ? (amt / totalExpenses) * 100 : 0) + '%', background: danger, borderRadius: '5px' }} />
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: '700', width: '100px', textAlign: 'right', flexShrink: 0, color: navy }}>{fmt(amt)}</span>
                </div>
              ))}
            </Card>
          )}

          {/* Daily chart */}
          {dailyDates.length > 0 && (
            <Card style={{ padding: '20px', marginBottom: '20px' }}>
              <div style={{ fontWeight: '800', fontSize: '15px', marginBottom: '14px', color: navy }}>Daily sales (last 14 days)</div>
              {dailyDates.map(date => (
                <div key={date} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', color: gray400, width: '60px', flexShrink: 0 }}>{date.slice(5)}</span>
                  <div style={{ flex: 1, height: '8px', background: gray100, borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: ((dailySales[date] || 0) / maxDaily * 100) + '%', background: tealDeep, borderRadius: '4px' }} />
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: '700', width: '90px', textAlign: 'right', flexShrink: 0, color: navy }}>{fmt(dailySales[date] || 0)}</span>
                </div>
              ))}
            </Card>
          )}

          {/* Transactions: every completed sale in the period, searchable. Opening one
              shows it in full; the Owner can edit, refund or delete it there. */}
          <Card style={{ marginBottom: '20px' }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${border}`, fontWeight: '800', fontSize: '15px', color: navy, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span>Transactions</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: gray500 }} aria-live='polite'>
                {query.trim() ? `${searched.length} of ${fSales.length} match` : `${fSales.length} in this period`}
              </span>
            </div>
            {fSales.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: gray400, fontSize: '13px' }}>No transactions in this period</div>
            ) : searched.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: gray400, fontSize: '13px' }}>
                No transactions match &ldquo;{query.trim()}&rdquo;. <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>Clear search</button>
              </div>
            ) : searched.slice(0, limit).map(s => {
              const refunded = saleRefunded(s)
              return (
                <button key={s.id} onClick={() => setOpenSaleId(s.id)} aria-label={`Open ${s.txn_no}, ${s.client_name || 'Walk-in'}, ${fmt(s.total || 0)}`}
                  style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 20px', border: 'none', borderBottom: `1px solid ${gray100}`, background: 'white', cursor: 'pointer', textAlign: 'left' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: navy }}>{s.client_name || 'Walk-in'}</div>
                    <div style={{ fontSize: '11px', color: gray400 }}>{s.txn_no} · {businessDateOf(s.created_at)} · {s.payment_method}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '14px', fontWeight: '900', color: tealDeep }}>{fmt(s.total || 0)}</div>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {s.is_credit && <Pill label={paymentStatus(s)} type={STATUS_PILL[paymentStatus(s)]} />}
                        {refunded > 0 && <Pill label={`Refunded ${fmt(refunded)}`} type='gray' />}
                        {s.edited_at && <Pill label='Edited' type='blue' />}
                      </div>
                    </div>
                    <ChevronRight size={14} color={gray400} aria-hidden='true' />
                  </div>
                </button>
              )
            })}
            {searched.length > limit && (
              <div style={{ padding: 12, textAlign: 'center' }}>
                <button onClick={() => setLimit(l => l + PAGE)} style={{ padding: '8px 16px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Show more ({searched.length - limit} left)</button>
              </div>
            )}
          </Card>
        </>
      )}

      <SaleDetailModal show={!!openSale} sale={openSale} onClose={() => setOpenSaleId(null)} brand={brand} settings={settings}
        canCorrect={canCorrect} ledgerAvailable products={catalog.products} clients={clientsQuery.data || []} showToast={showToast} onChanged={invalidate} />
      <Toast msg={msg} type={toastType} />
    </div>
  )
}