import { useEffect, useMemo, useState } from 'react'
import { Search, RefreshCw } from 'lucide-react'
import { Card, Empty, Loading, ErrorState } from '@care-ecosystem/design-system/components/ui'
import { StatusDot } from '../components/StatusDot'
import { AdminPageHeader } from '../ui'
import { useAdminOrders } from '../../../hooks/queries'

// The statuses `shop_orders` actually allows. The old dropdown offered completed/pending/failed — values the table
// never holds — so choosing any of them returned zero rows for every order, ever.
const ORDER_STATUSES = [
  'pending_payment', 'delivery_quote_pending', 'paid', 'accepted', 'processing', 'packed',
  'at_pickup_station', 'ready_for_pickup', 'in_transit', 'delivered', 'cancelled',
  'refund_requested', 'refunded', 'disputed',
]
const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded']

const statusColor = (s) => {
  if (s === 'delivered') return 'var(--green)'
  if (s === 'paid' || s === 'accepted' || s === 'processing' || s === 'packed' || s === 'at_pickup_station' || s === 'ready_for_pickup' || s === 'in_transit') return 'var(--amber)'
  if (s === 'cancelled' || s === 'refunded' || s === 'disputed' || s === 'failed' || s === 'refund_requested') return 'var(--red)'
  return 'var(--gray)'
}

const kobo = (v) => `₦${(Number(v || 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
const label = (s) => String(s || '').replace(/_/g, ' ')

export default function OrdersTab({ businesses = [], showToast }) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [status, setStatus] = useState('')
  const [paymentStatus, setPaymentStatus] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 25

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const { data, isLoading, isFetching, error, refetch } = useAdminOrders({
    search: debouncedSearch, status, paymentStatus, vendorId, dateFrom, dateTo, page, pageSize,
  })

  const orders = data?.orders || []
  const count = data?.count || 0
  const totalPages = Math.max(1, Math.ceil(count / pageSize))

  // Any filter change must return to page 1, or an operator lands on page 4 of a 1-page result and sees nothing.
  useEffect(() => { setPage(1) }, [status, paymentStatus, vendorId, dateFrom, dateTo])

  const vendorName = useMemo(
    () => (id) => businesses.find((b) => b.id === id)?.name || 'Not set',
    [businesses],
  )

  const reset = () => {
    setSearch(''); setDebouncedSearch(''); setStatus(''); setPaymentStatus('')
    setVendorId(''); setDateFrom(''); setDateTo(''); setPage(1)
  }

  const activeFilters = debouncedSearch || status || paymentStatus || vendorId || dateFrom || dateTo

  return (
    <div>
      <AdminPageHeader title="Orders" subtitle={count ? `${count} order${count === 1 ? '' : 's'}` : 'No orders match'}>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--muted)', cursor: isFetching ? 'progress' : 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700 }}
        >
          <RefreshCw size={12} /> {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </AdminPageHeader>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 380 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Order no, receipt / payment ref, customer or vendor…"
            aria-label="Search orders"
            style={{ width: '100%', padding: '10px 12px 10px 30px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, background: 'var(--panel)', color: 'var(--fg)', boxSizing: 'border-box' }}
          />
        </div>

        <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by order status"
          style={selectStyle}>
          <option value="">All order states</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>

        <select value={paymentStatus} onChange={e => setPaymentStatus(e.target.value)} aria-label="Filter by payment state"
          style={selectStyle}>
          <option value="">All payment states</option>
          {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>

        {businesses.length > 0 && (
          <select value={vendorId} onChange={e => setVendorId(e.target.value)} aria-label="Filter by vendor"
            style={{ ...selectStyle, maxWidth: 200 }}>
            <option value="">All vendors</option>
            {businesses.map((b) => <option key={b.id} value={b.id}>{b.name || 'Unnamed vendor'}</option>)}
          </select>
        )}

        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} aria-label="From date" style={{ ...selectStyle, padding: '9px 10px' }} />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} aria-label="To date" style={{ ...selectStyle, padding: '9px 10px' }} />

        {activeFilters && (
          <button onClick={reset} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent, #0f766e)', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
            Clear
          </button>
        )}
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{count} result{count === 1 ? '' : 's'}{totalPages > 1 ? ` · page ${page}/${totalPages}` : ''}</span>
      </div>

      {error ? (
        <ErrorState message={`Could not load orders. ${error.message || 'The server rejected the query'}`} onRetry={() => refetch()} />
      ) : isLoading ? (
        <Loading text="Loading orders…" />
      ) : orders.length === 0 ? (
        <div style={{ minHeight: 108, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12 }}>
          <Empty message={activeFilters ? 'No orders match these filters' : 'No orders yet'} />
        </div>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden', background: 'var(--panel)', border: '1px solid var(--border)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
                <tr style={{ height: 36 }}>
                  {['Order', 'Customer', 'Vendor', 'Items', 'Total', 'Payment', 'State', 'Placed'].map((h, i) => (
                    <th key={h} style={{ padding: '0 12px', textAlign: i >= 3 && i <= 5 ? 'right' : 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="ds-data-row" style={{ height: 36, borderBottom: '1px solid var(--hairline)' }}>
                    <td style={{ padding: '0 12px', color: 'var(--fg)', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {o.order_ref || 'Not set'}
                      {o.payment_reference && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }} title="Receipt / payment reference">{o.payment_reference}</div>
                      )}
                    </td>
                    <td style={{ padding: '0 12px', color: 'var(--fg)', fontSize: 13, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.customer_name || o.profiles?.full_name || o.profiles?.display_name || 'Not set'}
                    </td>
                    <td style={{ padding: '0 12px', color: 'var(--muted)', fontSize: 12, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.businesses?.name || vendorName(o.vendor_business_id)}
                    </td>
                    <td style={{ padding: '0 12px', textAlign: 'right', color: 'var(--muted)', fontSize: 12 }}>
                      {(o.shop_order_items || []).reduce((n, i) => n + Number(i.quantity || 0), 0)}
                    </td>
                    <td style={{ padding: '0 12px', textAlign: 'right', fontWeight: 700, color: 'var(--fg)', whiteSpace: 'nowrap' }}>
                      {kobo(o.total_kobo)}
                    </td>
                    <td style={{ padding: '0 12px', textAlign: 'right', color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {label(o.payment_status) || 'Not set'}
                    </td>
                    <td style={{ padding: '0 12px', textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: statusColor(o.status), whiteSpace: 'nowrap' }}>
                        <StatusDot status={o.status} /> {label(o.status) || 'Not set'}
                      </span>
                    </td>
                    <td style={{ padding: '0 12px', textAlign: 'right', color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {o.created_at ? new Date(o.created_at).toLocaleDateString() : 'Not set'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', marginTop: 12 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || isFetching} style={pageBtn(page <= 1)}>Prev</button>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages || isFetching} style={pageBtn(page >= totalPages)}>Next</button>
        </div>
      )}
    </div>
  )
}

const selectStyle = { padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, background: 'var(--panel)', color: 'var(--fg)' }
const pageBtn = (disabled) => ({ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: disabled ? 'var(--hairline)' : 'var(--panel)', color: disabled ? 'var(--muted-2)' : 'var(--fg)', fontWeight: 700, fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer' })