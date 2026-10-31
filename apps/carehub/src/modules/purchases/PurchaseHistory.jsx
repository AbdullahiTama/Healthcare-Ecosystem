import { useEffect, useMemo, useState } from 'react'
import { Search, X, Wallet, Receipt, CreditCard, Hourglass, CalendarClock, Truck, Package, ChevronDown, TrendingUp, TrendingDown } from 'lucide-react'
import { Card, StatCard, Loading, Empty, ErrorState, Pill } from '../../components/ui'
import PeriodFilter from '../../components/PeriodFilter'
import { usePurchaseSummary, usePurchaseSupplierStats, usePurchaseProductStats, usePurchaseHistory } from '../../hooks/queries'
import { isMissingObject } from '../../lib/dbErrors'
import { periodBounds, presetPeriod } from '../../lib/datePeriods'
import { fmt, fmtDate, todayDate } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { purchaseFrequency, priceChange, share } from './analytics'
import { purchaseStatus } from './SupplierPayments'

const { navy, gray50, gray100, gray400, gray500, gray600, border, danger, success, warning, tealDeep, tealMist } = theme

const PRODUCT_PAGE = 50
const th = { padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: gray400, textTransform: 'uppercase', whiteSpace: 'nowrap' }
const td = { padding: '10px 12px', fontSize: 13, color: navy, verticalAlign: 'top' }
const srOnly = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }
const control = { minHeight: 40, padding: '8px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 13, outline: 'none', color: navy, background: 'white' }

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

// History & analytics: every purchase across products and suppliers for a
// period, with what was spent, how often, the prices paid, what each supplier
// was paid and is owed. Picking a supplier or a product narrows everything to
// it and shows its own summary. All figures are worked out by the database
// (get_purchase_summary / _supplier_stats / _product_stats / _history), dated
// by each purchase's supply date.
export default function PurchaseHistory({ brand, suppliers = [], onOpenPurchase }) {
  const [period, setPeriod] = useState(() => presetPeriod('this_month', todayDate()))
  const [searchText, setSearchText] = useState('')
  const [supplierKey, setSupplierKey] = useState('')
  const [product, setProduct] = useState(null)        // { key, id, name } of the product picked
  const [sort, setSort] = useState('spend')
  const [productLimit, setProductLimit] = useState(PRODUCT_PAGE)
  const search = useDebounced(searchText.trim())
  const { from, to, label } = periodBounds(period)

  const filters = useMemo(() => ({ from, to, search, supplierKey, productKey: product?.key || '', productId: product?.id || null }), [from, to, search, supplierKey, product])
  useEffect(() => { setProductLimit(PRODUCT_PAGE) }, [filters, sort])

  const summary = usePurchaseSummary(brand?.id, filters)
  const supplierStats = usePurchaseSupplierStats(brand?.id, filters)
  const productStats = usePurchaseProductStats(brand?.id, filters, { sort, limit: productLimit })
  const history = usePurchaseHistory(brand?.id, filters)

  const supplierName = supplierKey ? (suppliers.find(s => s.key === supplierKey)?.name || supplierKey) : ''
  const narrowed = !!(supplierKey || product || search)

  if (summary.isError && isMissingObject(summary.error)) {
    return <Empty icon={<Receipt size={40} />} cause='none' message='Purchase history and analytics become available once the latest database update is applied. Your purchases are listed under the Purchases tab.' />
  }

  const s = summary.data
  const lines = (history.data?.pages || []).flat()
  const productRows = productStats.data || []
  const productTotal = Number(productRows[0]?.total_count) || 0
  const supplierRows = supplierStats.data || []
  const spentAll = supplierRows.reduce((a, r) => a + (Number(r.total_spent) || 0), 0)
  const pickedProductRow = product ? productRows.find(r => r.product_key === product.key) || productRows[0] : null
  const frequency = s ? purchaseFrequency(s.purchase_count, { from, to }, { firstDate: s.first_date, lastDate: s.last_date }) : null

  function clearAll() { setSearchText(''); setSupplierKey(''); setProduct(null) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filters */}
      <Card style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 12px' }}>
              <Search size={15} color={gray400} aria-hidden='true' />
              <input type='search' value={searchText} onChange={e => setSearchText(e.target.value)} aria-label='Search purchase history'
                placeholder='Product, supplier, barcode or batch'
                style={{ flex: 1, border: 'none', outline: 'none', padding: '10px 0', fontSize: 13, background: 'transparent', color: navy, minWidth: 0 }} />
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 700, color: gray600 }}>
              Supplier
              <select value={supplierKey} onChange={e => setSupplierKey(e.target.value)} style={{ ...control, fontWeight: 400 }}>
                <option value=''>All suppliers</option>
                {suppliers.map(sp => <option key={sp.key} value={sp.key}>{sp.name}</option>)}
              </select>
            </label>
          </div>
          <div style={{ flex: '2 1 320px', minWidth: 0 }}>
            <PeriodFilter value={period} onChange={setPeriod} label='Supply date' />
          </div>
        </div>
        {narrowed && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
            <span style={{ fontSize: 12, color: gray500 }}>Showing only:</span>
            {supplierKey && <Chip label={'Supplier: ' + supplierName} onClear={() => setSupplierKey('')} />}
            {product && <Chip label={'Product: ' + product.name} onClear={() => setProduct(null)} />}
            {search && <Chip label={'Search: ' + search} onClear={() => setSearchText('')} />}
            <button type='button' onClick={clearAll} style={{ border: 'none', background: 'none', color: tealDeep, fontWeight: 700, fontSize: 12, cursor: 'pointer', padding: '4px 2px' }}>Clear all</button>
          </div>
        )}
      </Card>

      {/* Summary */}
      <section aria-label='Spending summary' aria-busy={summary.isFetching}>
        <h2 style={{ fontSize: 14, fontWeight: 800, color: navy, margin: '0 0 10px' }}>
          {product ? product.name : supplierKey ? supplierName : 'All purchases'} · <span style={{ fontWeight: 600, color: gray500 }}>{label}</span>
        </h2>
        {summary.isLoading ? <Loading text='Working out your spending…' /> : summary.isError ? (
          <ErrorState message="We couldn't work out your spending." onRetry={() => summary.refetch()} />
        ) : !s || Number(s.purchase_count) === 0 ? (
          <Empty icon={<Receipt size={40} />} cause={narrowed || period.mode !== 'all' ? 'filtered' : 'none'} title='No purchases in this selection'
            description={'Nothing was bought ' + (period.mode === 'all' ? '' : 'in ' + label.toLowerCase() + ' ') + (supplierKey ? 'from ' + supplierName + ' ' : '') + (product ? 'of ' + product.name : '') + '.'}
            action={narrowed ? 'Clear filters' : undefined} onAction={narrowed ? clearAll : undefined} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <StatCard icon={<Wallet />} label={product ? 'Spent on this product' : 'Total spent'} value={fmt(s.total_spent)}
              sub={Number(s.units) > 0 ? Number(s.units).toLocaleString() + ' units in ' + Number(s.line_count) + ' line' + (Number(s.line_count) === 1 ? '' : 's') : undefined} />
            <StatCard icon={<Receipt />} label='Purchases' value={Number(s.purchase_count)} sub={frequency || undefined} />
            <StatCard icon={<CreditCard />} label={product ? 'Paid on these purchases' : 'Paid'} value={fmt(s.amount_paid)} />
            <StatCard icon={<Hourglass />} label='Outstanding' value={fmt(s.balance)} tone={Number(s.balance) > 0 ? 'danger' : undefined} />
            <StatCard icon={<CalendarClock />} label='Last purchase' value={s.last_date ? fmtDate(s.last_date) : 'None'}
              sub={s.last_supplier ? s.last_supplier + (s.last_total != null ? ' · ' + fmt(s.last_total) : '') : undefined}
              onClick={s.last_purchase_id && onOpenPurchase ? () => onOpenPurchase(s.last_purchase_id) : undefined} />
            {!product && !search && (
              <StatCard icon={<CreditCard />} label='Payments made in period' value={fmt(s.payments_in_period)} sub='By the date each payment was made' />
            )}
            {!product && !supplierKey && (
              <StatCard icon={<Truck />} label='Suppliers · products' value={Number(s.supplier_count) + ' · ' + Number(s.product_count)} />
            )}
            {product && pickedProductRow && (
              <StatCard icon={<Package />} label='Unit cost: last · average' value={fmt(pickedProductRow.last_cost) + ' · ' + fmt(pickedProductRow.avg_cost)}
                sub={pickedProductRow.previous_cost != null ? 'Before that ' + fmt(pickedProductRow.previous_cost) + ' · lowest ' + fmt(pickedProductRow.min_cost) + ', highest ' + fmt(pickedProductRow.max_cost) : 'Lowest ' + fmt(pickedProductRow.min_cost) + ', highest ' + fmt(pickedProductRow.max_cost)} />
            )}
          </div>
        )}
      </section>

      {/* Spending per supplier */}
      {!supplierKey && (
        <section aria-label='Spending by supplier'>
          <h2 style={{ fontSize: 14, fontWeight: 800, color: navy, margin: '0 0 10px' }}>Spending by supplier</h2>
          {supplierStats.isLoading ? <Loading text='Loading suppliers…' /> : supplierStats.isError ? (
            <ErrorState message="We couldn't load spending by supplier." onRetry={() => supplierStats.refetch()} />
          ) : supplierRows.length === 0 ? (
            <div style={{ fontSize: 13, color: gray500 }}>No supplier spending in this selection.</div>
          ) : (
            <Card>
              <div style={{ overflowX: 'auto', position: 'relative' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <caption style={srOnly}>Spending by supplier for {label}</caption>
                  <thead><tr style={{ borderBottom: `1px solid ${border}`, background: gray50 }}>
                    {['Supplier', 'Purchases', 'Spent', 'Share', 'Paid', 'Outstanding', 'Last purchase'].map(h => <th key={h} scope='col' style={th}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {supplierRows.map(r => (
                      <tr key={r.supplier_key} style={{ borderBottom: `1px solid ${gray100}` }}>
                        <td style={{ ...td, fontWeight: 700 }}>
                          <button type='button' onClick={() => setSupplierKey(r.supplier_key)} aria-label={'Show only ' + r.supplier_name}
                            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, color: navy, cursor: 'pointer', textAlign: 'left', textDecoration: 'underline', textDecorationColor: gray100, textUnderlineOffset: 3 }}>
                            {r.supplier_name}
                          </button>
                        </td>
                        <td style={td}>{Number(r.purchase_count)}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{fmt(r.total_spent)}</td>
                        <td style={td}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span aria-hidden='true' style={{ display: 'inline-block', width: 48, height: 6, borderRadius: 3, background: gray100, overflow: 'hidden' }}>
                              <span style={{ display: 'block', height: '100%', width: share(r.total_spent, spentAll) + '%', background: tealDeep }} />
                            </span>
                            {share(r.total_spent, spentAll)}%
                          </span>
                        </td>
                        <td style={{ ...td, color: success }}>{fmt(r.amount_paid)}</td>
                        <td style={{ ...td, fontWeight: 800, color: Number(r.balance) > 0 ? danger : success }}>{fmt(r.balance)}</td>
                        <td style={{ ...td, fontSize: 12, color: gray500 }}>{fmtDate(r.last_date)}{r.last_total != null ? ' · ' + fmt(r.last_total) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </section>
      )}

      {/* Per product */}
      {!product && (
        <section aria-label='Products bought'>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, color: navy, margin: 0 }}>Products bought{productTotal ? ' (' + productTotal + ')' : ''}</h2>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: gray600 }}>
              Sort by
              <select value={sort} onChange={e => setSort(e.target.value)} style={control}>
                <option value='spend'>Most spent</option>
                <option value='units'>Most units</option>
                <option value='times'>Most often bought</option>
                <option value='recent'>Last bought</option>
                <option value='name'>Name</option>
              </select>
            </label>
          </div>
          {productStats.isLoading ? <Loading text='Loading products…' /> : productStats.isError ? (
            <ErrorState message="We couldn't load the products bought." onRetry={() => productStats.refetch()} />
          ) : productRows.length === 0 ? (
            <div style={{ fontSize: 13, color: gray500 }}>No itemised purchases in this selection.</div>
          ) : (
            <Card>
              <div style={{ overflowX: 'auto', position: 'relative' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <caption style={srOnly}>Products bought for {label}</caption>
                  <thead><tr style={{ borderBottom: `1px solid ${border}`, background: gray50 }}>
                    {['Product', 'Times bought', 'Units', 'Spent', 'Average cost', 'Last cost', 'Last bought'].map(h => <th key={h} scope='col' style={th}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {productRows.map(r => {
                      const change = priceChange(r.last_cost, r.previous_cost)
                      return (
                        <tr key={r.product_key} style={{ borderBottom: `1px solid ${gray100}` }}>
                          <td style={{ ...td, fontWeight: 700, maxWidth: 260 }}>
                            <button type='button' onClick={() => setProduct({ key: r.product_key, id: r.product_id, name: r.product_name })} aria-label={'Show only ' + r.product_name}
                              style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, color: navy, cursor: 'pointer', textAlign: 'left', textDecoration: 'underline', textDecorationColor: gray100, textUnderlineOffset: 3, overflowWrap: 'anywhere' }}>
                              {r.product_name}
                            </button>
                          </td>
                          <td style={td}>{Number(r.times_purchased)}</td>
                          <td style={td}>{Number(r.units).toLocaleString()}</td>
                          <td style={{ ...td, fontWeight: 700 }}>{fmt(r.total_spent)}</td>
                          <td style={td}>{fmt(r.avg_cost)}</td>
                          <td style={td}>
                            {fmt(r.last_cost)}
                            {change != null && change !== 0 && (
                              <span title={'Previous ' + fmt(r.previous_cost)} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginLeft: 6, fontSize: 11.5, fontWeight: 800, color: change > 0 ? warning : success }}>
                                {change > 0 ? <TrendingUp size={11} aria-hidden='true' /> : <TrendingDown size={11} aria-hidden='true' />}{change > 0 ? '+' : ''}{change}%
                                <span style={srOnly}> compared with {fmt(r.previous_cost)} before</span>
                              </span>
                            )}
                          </td>
                          <td style={{ ...td, fontSize: 12, color: gray500 }}>{fmtDate(r.last_date)}{r.last_supplier ? ' · ' + r.last_supplier : ''}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {productTotal > productRows.length && productLimit < 500 && (
                <div style={{ padding: 12, textAlign: 'center' }}>
                  <MoreButton busy={productStats.isFetching} onClick={() => setProductLimit(l => Math.min(l + PRODUCT_PAGE, 500))} label={'Show more products (' + (productTotal - productRows.length) + ' more)'} />
                </div>
              )}
            </Card>
          )}
        </section>
      )}

      {/* Every purchase line */}
      <section aria-label='Purchase history'>
        <h2 style={{ fontSize: 14, fontWeight: 800, color: navy, margin: '0 0 10px' }}>Purchase history</h2>
        {history.isLoading ? <Loading text='Loading purchase history…' /> : history.isError ? (
          <ErrorState message="We couldn't load the purchase history." onRetry={() => history.refetch()} />
        ) : lines.length === 0 ? (
          <div style={{ fontSize: 13, color: gray500 }}>No purchase lines in this selection.</div>
        ) : (
          <Card>
            <div style={{ overflowX: 'auto', position: 'relative' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <caption style={srOnly}>Every purchase line for {label}, newest first</caption>
                <thead><tr style={{ borderBottom: `1px solid ${border}`, background: gray50 }}>
                  {['Date', 'Supplier', 'Product', 'Qty', 'Unit cost', 'Line total', 'Barcode · batch', 'Purchase'].map(h => <th key={h} scope='col' style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {lines.map(l => {
                    const st = purchaseStatus({ balance: l.purchase_balance, amount_paid: l.purchase_paid, status: l.purchase_status })
                    return (
                      <tr key={l.purchase_id + ':' + l.line_no} style={{ borderBottom: `1px solid ${gray100}` }}>
                        <td style={{ ...td, fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDate(l.purchase_date)}</td>
                        <td style={{ ...td, fontSize: 12.5 }}>{l.supplier_name}</td>
                        <td style={{ ...td, fontWeight: 600, maxWidth: 240, overflowWrap: 'anywhere' }}>
                          {l.item_name}
                          {!l.itemised && <span style={{ display: 'block', fontSize: 11, color: gray400, fontWeight: 400 }}>Saved as a summary (average cost)</span>}
                        </td>
                        <td style={td}>{Number(l.qty).toLocaleString()}</td>
                        <td style={td}>{fmt(l.unit_cost)}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{fmt(l.line_total)}</td>
                        <td style={{ ...td, fontSize: 12, color: gray500 }}>{[l.barcode, l.batch && 'Batch ' + l.batch].filter(Boolean).join(' · ') || '—'}</td>
                        <td style={td}>
                          <button type='button' onClick={() => onOpenPurchase?.(l.purchase_id)} aria-label={'Open the purchase from ' + l.supplier_name + ' on ' + fmtDate(l.purchase_date)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                            <Pill label={st.label} type={st.type} />
                            <span style={{ fontSize: 12, color: tealDeep, fontWeight: 700 }}>{fmt(l.purchase_total)}</span>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {history.hasNextPage && (
              <div style={{ padding: 12, textAlign: 'center' }}>
                <MoreButton busy={history.isFetchingNextPage} onClick={() => history.fetchNextPage()} label='Load more' />
              </div>
            )}
          </Card>
        )}
      </section>
    </div>
  )
}

function Chip({ label, onClear }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 4px 4px 10px', borderRadius: theme.radius.full, background: tealMist, color: tealDeep, fontSize: 12, fontWeight: 700, maxWidth: '100%' }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <button type='button' onClick={onClear} aria-label={'Remove filter ' + label}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', border: 'none', background: 'transparent', color: tealDeep, cursor: 'pointer' }}>
        <X size={13} />
      </button>
    </span>
  )
}

function MoreButton({ busy, onClick, label }) {
  return (
    <button type='button' onClick={onClick} disabled={busy} aria-busy={busy}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 20px', minHeight: 40, borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: 700, fontSize: 13, cursor: busy ? 'wait' : 'pointer' }}>
      {busy ? 'Loading…' : <><ChevronDown size={14} aria-hidden='true' /> {label}</>}
    </button>
  )
}
