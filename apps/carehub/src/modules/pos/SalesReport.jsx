import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Printer, FileSpreadsheet, SlidersHorizontal, Receipt, Wallet, Banknote, Repeat, CreditCard,
  RotateCcw, Scale, Clock, AlertTriangle, Tag, Hash, HandCoins, Info,
} from 'lucide-react'
import { theme } from '../../styles/theme'
import { Card, Pill, Empty, ErrorState, Loading, Sel, Inp, StatCard, Toast, useToast } from '../../components/ui'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useSettings } from '../../hooks/queries'
import { fmt, todayDate } from '../../lib/utils'
import { auditRepository } from '../audit/repositories'
import {
  PERIODS, SALE_METHODS, STATUSES, EMPTY_FILTERS, periodRange, filterSales, filterPayments, summarise,
  toReportRows, filterOptions, parseDbTime, cashierKey, expectedCash,
} from './salesReport'
import { exportSalesReportXlsx, printSalesReport } from './salesReportExport'
import { usePlanGate } from '../../hooks/usePlanGate'
import { useAuthUserId, useSalesReportData, useInvalidateSalesReport } from './useSalesReportData'
import SaleDetailModal from './SaleDetailModal'
import ShiftControl from './ShiftControl'

const { navy, gray400, gray500, gray600, gray100, border, bg, tealDeep, tealMist, danger, success, warning, warningBg } = theme

const PAGE = 100
const STATUS_PILL = { Paid: 'green', 'Part-paid': 'amber', Unpaid: 'red' }
const KIND_LABEL = { sale: 'At the till', collection: 'Repayment', refund: 'Refund' }
const shortTime = (d) => (d ? d.toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

// The till's Sales & Accounts report (route /dashboard/pos/report). A cashier
// reconciles what was sold against the money that came in, by period, and an
// owner or manager can do the same per staff member and per shift.
//
// Refunds, edits and deletions of completed sales are NOT done here: they are
// the Owner's, from Financial Reports (Reports.jsx), where they are audited.
//
// Who sees what: roles with canViewReports (Owner, Manager, custom roles
// granted it) see every cashier and get the cashier filter; everyone else sees
// only the sales and payments they handled. That is a screen rule — the
// database lets any member read the business's sales — recorded as a
// follow-up in docs/architecture/POS-Sales-Report.md.
export default function SalesReport({ brand, role, perms, staffName }) {
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const { msg: toastMsg, type: toastType, show: showToast } = useToast()
  const plan = usePlanGate(showToast)
  const userId = useAuthUserId()
  const { data: settings } = useSettings(brand?.id)
  const invalidate = useInvalidateSalesReport()

  const seeAll = role === 'Owner' || !!perms?.canViewReports

  const [period, setPeriod] = useState('today')
  const [from, setFrom] = useState(todayDate())
  const [to, setTo] = useState(todayDate())
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [tab, setTab] = useState('sales')
  const [limit, setLimit] = useState(PAGE)
  const [openSaleId, setOpenSaleId] = useState(null)
  const [exporting, setExporting] = useState(false)

  const range = useMemo(() => periodRange(period, { from, to }), [period, from, to])
  const { data, isLoading, isError, error, refetch, isFetching } = useSalesReportData(brand?.id, range)

  // A cashier's view is pinned to their own transactions.
  const effective = useMemo(() => (seeAll ? filters : { ...filters, cashier: userId || 'none' }), [seeAll, filters, userId])

  const view = useMemo(() => {
    if (!data) return null
    const sales = filterSales(data.sales, effective)
    const payments = filterPayments(data.payments, data.salesById, effective)
    const shiftsById = Object.fromEntries(data.shifts.map((s) => [s.id, s]))
    const rows = toReportRows(sales, { shiftsById }).sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))
    const options = filterOptions(data.sales.filter((s) => !seeAll ? cashierKey(s) === userId : true), data.payments, data.shifts)
    return {
      sales, payments, shiftsById, rows, options,
      summary: summarise({ sales, payments, ledgerAvailable: data.ledgerAvailable }),
      paymentRows: [...payments].sort((a, b) => (parseDbTime(b.received_at)?.getTime() || 0) - (parseDbTime(a.received_at)?.getTime() || 0)),
    }
  }, [data, effective, seeAll, userId])

  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setLimit(PAGE) }
  const activeFilterCount = Object.entries(filters).filter(([k, v]) => v && (seeAll || k !== 'cashier')).length
  const periodLabel = period === 'custom'
    ? (range ? `${from} to ${to}` : 'Custom range')
    : PERIODS.find(([p]) => p === period)?.[1]

  const filtersLabel = () => {
    if (!view) return ''
    const o = view.options
    const name = (list, v) => list.find((x) => x.value === v)?.label || v
    const parts = []
    if (effective.customer) parts.push('Customer: ' + name(o.customers, effective.customer))
    if (effective.product) parts.push('Product: ' + name(o.products, effective.product))
    if (effective.method) parts.push('Method: ' + effective.method)
    if (effective.status) parts.push('Status: ' + effective.status)
    if (effective.cashier) parts.push('Cashier: ' + (seeAll ? name(o.cashiers, effective.cashier) : (staffName || 'me')))
    if (effective.shift) parts.push('Shift: ' + (effective.shift === 'none' ? 'No shift' : name(o.shifts, effective.shift)))
    return parts.join(' · ')
  }

  const exportInput = () => ({
    rows: view.rows,
    summary: view.summary,
    meta: { businessName: brand?.name || '', periodLabel, filtersLabel: filtersLabel(), generatedBy: staffName || (role === 'Owner' ? 'Owner' : role), generatedAt: new Date() },
  })

  function printReport() {
    try { printSalesReport(exportInput()) } catch (e) { showToast(e.message, { type: 'warning' }) }
  }

  // The export audit record is written before the file is saved; a refusal
  // from the database (the role may not export) cancels the download.
  async function exportExcel() {
    if (!view.rows.length) { showToast('There are no sales to export for this period and these filters.', { type: 'warning' }); return }
    if (!plan.allow('exporting reports')) return
    setExporting(true)
    try {
      let audit = { status: 'failed' }
      const saved = await exportSalesReportXlsx(exportInput(), {
        beforeDownload: async () => {
          audit = await auditRepository.recordExport(brand.id, {
            exportType: 'sales_report.xlsx',
            rowCount: view.rows.length,
            filters: { period, from: range?.start.toISOString(), to: range?.end.toISOString(), ...Object.fromEntries(Object.entries(effective).filter(([, v]) => v)) },
          })
          return audit.status !== 'refused'
        },
      })
      if (!saved) showToast('Your role is not allowed to export data.', { type: 'error' })
      else if (audit.status !== 'recorded') {
        console.warn('[sales report] export audit record not saved:', audit.status)
        showToast(`Exported ${view.rows.length} sales, but the audit record could not be saved.`, { type: 'warning' })
      } else showToast(`Exported ${view.rows.length} sales.`, { type: 'success' })
    } catch (e) {
      console.error('sales report export failed:', e)
      showToast('Could not export: ' + e.message, { type: 'error' })
    } finally { setExporting(false) }
  }

  const btn = { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }
  const gutter = isMobile ? 16 : 24
  const selectedShift = effective.shift && effective.shift !== 'none' ? view?.shiftsById[effective.shift] : null

  // ── Body states ─────────────────────────────────────────────────────────────
  let body
  if (userId === undefined || (isLoading && range)) body = <Loading text='Loading sales…' />
  else if (!range) body = <Empty icon={<Clock size={40} strokeWidth={1.5} />} message='Choose a start and end date (the start must not be after the end).' />
  else if (!seeAll && !userId) body = <ErrorState message='We could not confirm who is signed in, so your sales cannot be shown. Sign out and in again.' />
  else if (isError) body = <ErrorState message={'Could not load the report: ' + String(error?.message || error).replace(/^Supabase error \(\d{3}\):\s*/, '')} onRetry={refetch} />
  else if (view) body = null

  return (
    <div style={{ background: bg, minHeight: '100%' }}>
      {/* Header */}
      <div style={{ background: 'white', borderBottom: `1px solid ${border}`, padding: `12px ${gutter}px`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/dashboard/pos')} style={{ ...btn, padding: 8 }} aria-label='Back to the POS'><ArrowLeft size={16} /></button>
        <div style={{ flex: 1, minWidth: 160 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: navy }}>Sales &amp; Accounts</h1>
          <div style={{ fontSize: 12, color: gray500 }}>{periodLabel}{!seeAll ? ' · your transactions' : ''}{isFetching && !isLoading ? ' · updating…' : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <ShiftControl brand={brand} userId={userId} showToast={showToast} onChange={invalidate} />
          <button onClick={printReport} disabled={!view} style={btn}><Printer size={14} /> Print / PDF</button>
          {(role === 'Owner' || perms?.canExportReports) && (
            <button onClick={exportExcel} disabled={!view || exporting} aria-busy={exporting} style={{ ...btn, opacity: exporting ? 0.7 : 1, cursor: exporting ? 'wait' : 'pointer' }}>
              <FileSpreadsheet size={14} /> {exporting ? 'Exporting…' : 'Excel'}
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div style={{ padding: `14px ${gutter}px 0` }}>
        <div role='group' aria-label='Period' style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {PERIODS.map(([p, label]) => {
            const on = period === p
            return (
              <button key={p} onClick={() => { setPeriod(p); setLimit(PAGE) }} aria-pressed={on}
                style={{ padding: '7px 14px', borderRadius: theme.radius.full, border: `1px solid ${on ? tealDeep : border}`, background: on ? tealDeep : 'white', color: on ? 'white' : gray600, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                {label}
              </button>
            )
          })}
          <button onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters} style={{ ...btn, borderRadius: theme.radius.full, marginLeft: isMobile ? 0 : 'auto' }}>
            <SlidersHorizontal size={14} /> Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
          </button>
        </div>
        {period === 'custom' && (
          <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <Inp label='From' type='date' value={from} onChange={setFrom} style={{ minWidth: 150 }} />
            <Inp label='To' type='date' value={to} onChange={setTo} style={{ minWidth: 150 }} />
          </div>
        )}
        {showFilters && view && (
          <Card style={{ marginTop: 10, padding: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
              <Sel label='Customer' value={filters.customer} onChange={(v) => setFilter('customer', v)} options={view.options.customers} placeholder='All customers' />
              <Sel label='Product' value={filters.product} onChange={(v) => setFilter('product', v)} options={view.options.products} placeholder='All products' />
              <Sel label='Payment method' value={filters.method} onChange={(v) => setFilter('method', v)} options={SALE_METHODS} placeholder='All methods' />
              <Sel label='Payment status' value={filters.status} onChange={(v) => setFilter('status', v)} options={STATUSES.map((s) => ({ value: s, label: s === 'Refund' ? 'Has a refund' : s }))} placeholder='Any status' />
              {seeAll && <Sel label='Cashier' value={filters.cashier} onChange={(v) => setFilter('cashier', v)} options={[...view.options.cashiers, { value: 'none', label: 'Not recorded' }]} placeholder='All staff' />}
              {data?.shiftsAvailable && <Sel label='Shift' value={filters.shift} onChange={(v) => setFilter('shift', v)} options={[...view.options.shifts, { value: 'none', label: 'No shift' }]} placeholder='All shifts' />}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11.5, color: gray500, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Info size={12} aria-hidden='true' /> Cashier and shift: sales follow who made the sale, money follows who received it.
              </span>
              {activeFilterCount > 0 && <button onClick={() => { setFilters(EMPTY_FILTERS); setLimit(PAGE) }} style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Clear filters</button>}
            </div>
          </Card>
        )}
      </div>

      {body !== null && body !== undefined ? <div style={{ padding: gutter }}>{body}</div> : view && (
        <>
          {/* Key figures: stay in view while the list scrolls */}
          <div style={{ position: 'sticky', top: 0, zIndex: 5, background: bg, padding: `12px ${gutter}px`, borderBottom: `1px solid ${border}` }}>
            <div aria-label='Key figures' style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 8 }}>
              <KeyFigure label='Total sales' value={fmt(view.summary.totalSales)} />
              <KeyFigure label='Net received' value={fmt(view.summary.netReceived)} color={success} />
              <KeyFigure label='Outstanding' value={fmt(view.summary.outstanding)} color={view.summary.outstanding > 0 ? danger : navy} />
              <KeyFigure label='Transactions' value={String(view.summary.transactions)} />
            </div>
          </div>

          <div style={{ padding: `14px ${gutter}px ${gutter}px`, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {!data.ledgerAvailable && (
              <div role='status' style={{ display: 'flex', gap: 8, padding: 12, borderRadius: theme.radius.md, background: warningBg, color: warning, fontSize: 12.5, lineHeight: 1.5 }}>
                <AlertTriangle size={16} style={{ flexShrink: 0 }} aria-hidden='true' />
                <span>Money figures are estimated from the sales themselves: payment history, refunds and shifts become available once the accounting update is applied. Repayments made after a sale are counted on the sale&apos;s date until then.</span>
              </div>
            )}

            {/* Breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
              <StatCard icon={<Receipt />} label='Total sales' value={fmt(view.summary.totalSales)} sub={`${view.summary.transactions} transaction${view.summary.transactions === 1 ? '' : 's'}`} />
              <StatCard icon={<Wallet />} label='Payments received' value={fmt(view.summary.received.total)} sub={view.summary.collections ? `incl. ${fmt(view.summary.collections)} repayments` : 'at the till and repayments'} />
              <StatCard icon={<Banknote />} label='Cash' value={fmt(view.summary.received.Cash)} />
              <StatCard icon={<Repeat />} label='Transfer' value={fmt(view.summary.received.Transfer)} />
              <StatCard icon={<CreditCard />} label='POS' value={fmt(view.summary.received.POS)} />
              {view.summary.received.Unspecified > 0 && <StatCard icon={<Hash />} label='Method not recorded' value={fmt(view.summary.received.Unspecified)} sub='older credit deposits' />}
              <StatCard icon={<RotateCcw />} label='Refunds' value={fmt(view.summary.refunds.total)} tone={view.summary.refunds.total > 0 ? 'warning' : undefined} />
              <StatCard icon={<Scale />} label='Net received' value={fmt(view.summary.netReceived)} sub='received less refunds' />
              <StatCard icon={<HandCoins />} label='Cash in hand' value={fmt(view.summary.cashInHand)} sub='cash received less cash refunds' />
              <StatCard icon={<Clock />} label='Credit given' value={fmt(view.summary.credit.amount)} sub={`${view.summary.credit.count} credit sale${view.summary.credit.count === 1 ? '' : 's'}`} />
              <StatCard icon={<AlertTriangle />} label='Outstanding' value={fmt(view.summary.outstanding)} tone={view.summary.outstanding > 0 ? 'danger' : undefined} sub='still owed on these sales' />
              <StatCard icon={<Tag />} label='Discounts' value={fmt(view.summary.discounts)} />
            </div>

            {selectedShift && (
              <Card style={{ padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: navy, marginBottom: 8 }}>Shift · {selectedShift.staff_name}{selectedShift.closed_at ? '' : ' (open)'}</div>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 10, fontSize: 13 }}>
                  <ShiftFact label='Opening cash' value={fmt(selectedShift.opening_float)} />
                  <ShiftFact label='Expected cash' value={fmt(selectedShift.closed_at ? selectedShift.expected_cash : expectedCash(selectedShift, data.payments))} />
                  <ShiftFact label='Counted cash' value={selectedShift.closed_at ? fmt(selectedShift.counted_cash) : 'Not closed yet'} />
                  {selectedShift.closed_at && (() => {
                    const d = Number(selectedShift.counted_cash) - Number(selectedShift.expected_cash)
                    return <ShiftFact label={d === 0 ? 'Balanced' : d > 0 ? 'Over by' : 'Short by'} value={fmt(Math.abs(d))} color={d === 0 ? success : danger} />
                  })()}
                </div>
                {selectedShift.close_note && <div style={{ marginTop: 8, fontSize: 12.5, color: gray600, fontStyle: 'italic' }}>Note: {selectedShift.close_note}</div>}
              </Card>
            )}

            {/* Sales / Payments */}
            <div role='tablist' aria-label='Report lists' style={{ display: 'flex', gap: 24, borderBottom: `1px solid ${border}` }}>
              {[['sales', 'Sales', view.rows.length], ['payments', 'Payments', view.paymentRows.length]].map(([v, label, count]) => {
                const on = tab === v
                if (v === 'payments' && !data.ledgerAvailable) return null
                return (
                  <button key={v} role='tab' aria-selected={on} onClick={() => { setTab(v); setLimit(PAGE) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px 2px', marginBottom: -1, fontSize: 13, fontWeight: on ? 800 : 600, color: on ? tealDeep : gray600, borderBottom: on ? `2px solid ${tealDeep}` : '2px solid transparent', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {label}<span style={{ background: on ? tealMist : gray100, color: on ? tealDeep : gray500, borderRadius: theme.radius.full, padding: '1px 7px', fontSize: 11, fontWeight: 800 }}>{count}</span>
                  </button>
                )
              })}
            </div>

            {tab === 'sales' || !data.ledgerAvailable ? (
              view.rows.length === 0 ? (
                <Empty icon={<Receipt size={40} strokeWidth={1.5} />}
                  message={data.sales.length === 0 ? (period === 'custom' ? 'No sales in this date range.' : `No sales ${periodLabel.toLowerCase()}.`) : 'No sales match these filters.'}
                  cause={data.sales.length === 0 ? 'none' : 'filtered'} />
              ) : (
                <SalesList rows={view.rows.slice(0, limit)} isMobile={isMobile} onOpen={setOpenSaleId} />
              )
            ) : view.paymentRows.length === 0 ? (
              <Empty icon={<Wallet size={40} strokeWidth={1.5} />} message='No money was received or refunded in this period with these filters.' cause={data.payments.length ? 'filtered' : 'none'} />
            ) : (
              <PaymentsList rows={view.paymentRows.slice(0, limit)} salesById={data.salesById} isMobile={isMobile} onOpen={setOpenSaleId} />
            )}

            {(tab === 'sales' ? view.rows.length : view.paymentRows.length) > limit && (
              <button onClick={() => setLimit((l) => l + PAGE)} style={{ ...btn, alignSelf: 'center' }}>Show more</button>
            )}
          </div>
        </>
      )}

      <SaleDetailModal show={!!openSaleId} sale={openSaleId ? data?.salesById[openSaleId] : null} onClose={() => setOpenSaleId(null)}
        shiftsById={view?.shiftsById} brand={brand} settings={settings} ledgerAvailable={!!data?.ledgerAvailable}
        showToast={showToast} onChanged={invalidate} />
      <Toast msg={toastMsg} type={toastType} />
    </div>
  )
}

function KeyFigure({ label, value, color = navy }) {
  return (
    <div style={{ background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '8px 12px', minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: gray500 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 900, color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  )
}

function ShiftFact({ label, value, color = navy }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: gray400, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontWeight: 800, color, marginTop: 2 }}>{value}</div>
    </div>
  )
}

const th = { textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 800, color: gray500, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', borderBottom: `1px solid ${border}`, background: 'white' }
const td = { padding: '10px 12px', fontSize: 12.5, color: navy, borderBottom: `1px solid ${gray100}`, verticalAlign: 'top' }
const num = { ...td, textAlign: 'right', whiteSpace: 'nowrap' }
const linkBtn = { background: 'none', border: 'none', padding: 0, color: tealDeep, fontWeight: 800, fontSize: 12.5, cursor: 'pointer', textAlign: 'left' }

function SalesList({ rows, isMobile, onOpen }) {
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((r) => (
          <Card key={r.saleId} style={{ padding: 0 }}>
            <button onClick={() => onOpen(r.saleId)} aria-label={`Receipt ${r.receipt}, ${r.customer}, ${fmt(r.total)}`}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 14, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: navy }}>{r.customer}</div>
                  <div style={{ fontSize: 11.5, color: gray500, marginTop: 2 }}>{r.receipt} · {shortTime(r.date)}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: 15, color: navy }}>{fmt(r.total)}</div>
                  <Pill label={r.status} type={STATUS_PILL[r.status]} />
                </div>
              </div>
              <div style={{ fontSize: 12, color: gray600, marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.products || 'No items recorded'}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 11.5, color: gray500, marginTop: 6 }}>
                <span>Paid <strong style={{ color: success }}>{fmt(r.paid)}</strong></span>
                {r.outstanding > 0 && <span>Owed <strong style={{ color: danger }}>{fmt(r.outstanding)}</strong></span>}
                {r.refunded > 0 && <span>Refunded <strong style={{ color: warning }}>{fmt(r.refunded)}</strong></span>}
                <span>{r.method}</span>
                <span>{r.cashier}</span>
              </div>
            </button>
          </Card>
        ))}
      </div>
    )
  }
  return (
    <Card style={{ padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
        <thead>
          <tr>
            <th style={th}>Date</th><th style={th}>Receipt</th><th style={th}>Customer</th><th style={th}>Products</th>
            <th style={{ ...th, textAlign: 'right' }}>Qty</th><th style={{ ...th, textAlign: 'right' }}>Total</th>
            <th style={{ ...th, textAlign: 'right' }}>Paid</th><th style={{ ...th, textAlign: 'right' }}>Outstanding</th>
            <th style={th}>Method</th><th style={th}>Status</th><th style={th}>Cashier</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.saleId}>
              <td style={{ ...td, whiteSpace: 'nowrap', color: gray600 }}>{shortTime(r.date)}</td>
              <td style={td}><button onClick={() => onOpen(r.saleId)} style={linkBtn}>{r.receipt}</button></td>
              <td style={td}>{r.customer}</td>
              <td style={{ ...td, maxWidth: 260 }}>{r.products || <span style={{ color: gray400 }}>None recorded</span>}</td>
              <td style={num}>{r.quantity}</td>
              <td style={{ ...num, fontWeight: 800 }}>{fmt(r.total)}</td>
              <td style={{ ...num, color: success }}>{fmt(r.paid)}</td>
              <td style={{ ...num, color: r.outstanding > 0 ? danger : gray400, fontWeight: r.outstanding > 0 ? 800 : 400 }}>{fmt(r.outstanding)}</td>
              <td style={td}>{r.method}</td>
              <td style={td}><span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}><Pill label={r.status} type={STATUS_PILL[r.status]} />{r.refunded > 0 && <Pill label='Refund' type='gray' />}</span></td>
              <td style={td}>{r.cashier}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function PaymentsList({ rows, salesById, isMobile, onOpen }) {
  const amount = (p) => <span style={{ fontWeight: 800, color: p.kind === 'refund' ? danger : success, whiteSpace: 'nowrap' }}>{p.kind === 'refund' ? '−' : ''}{fmt(p.amount)}</span>
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((p) => (
          <Card key={p.id} style={{ padding: 0 }}>
            <button onClick={() => salesById[p.sale_id] && onOpen(p.sale_id)} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 12, cursor: 'pointer' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: navy }}>{KIND_LABEL[p.kind]} · {p.method === 'Unspecified' ? 'Not recorded' : p.method}</div>
                <div style={{ fontSize: 11.5, color: gray500, marginTop: 2 }}>{salesById[p.sale_id]?.txn_no || 'Sale'} · {shortTime(parseDbTime(p.received_at))} · {p.staff_name || 'Not recorded'}</div>
              </div>
              {amount(p)}
            </button>
          </Card>
        ))}
      </div>
    )
  }
  return (
    <Card style={{ padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
        <thead>
          <tr><th style={th}>Time</th><th style={th}>Receipt</th><th style={th}>Customer</th><th style={th}>Type</th><th style={th}>Method</th><th style={th}>Received by</th><th style={{ ...th, textAlign: 'right' }}>Amount</th></tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const s = salesById[p.sale_id]
            return (
              <tr key={p.id}>
                <td style={{ ...td, whiteSpace: 'nowrap', color: gray600 }}>{shortTime(parseDbTime(p.received_at))}</td>
                <td style={td}>{s ? <button onClick={() => onOpen(p.sale_id)} style={linkBtn}>{s.txn_no}</button> : <span style={{ color: gray400 }}>Not available</span>}</td>
                <td style={td}>{s?.client_name || 'Walk-in'}</td>
                <td style={td}>{KIND_LABEL[p.kind]}{p.kind === 'refund' && p.note ? <div style={{ fontSize: 11.5, color: gray500 }}>{p.note}</div> : null}</td>
                <td style={td}>{p.method === 'Unspecified' ? 'Not recorded' : p.method}</td>
                <td style={td}>{p.staff_name || 'Not recorded'}</td>
                <td style={num}>{amount(p)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Card>
  )
}
