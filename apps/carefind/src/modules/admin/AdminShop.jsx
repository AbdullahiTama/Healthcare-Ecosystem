import { useEffect, useState } from 'react'
import { theme } from '../../styles/theme'
import { callAdminAuth } from './adminApi'

const STATUS_LABELS = {
  pending_payment: 'Pending Payment',
  delivery_quote_pending: 'Quote Pending',
  paid: 'Paid',
  accepted: 'Accepted',
  processing: 'Processing',
  packed: 'Packed',
  at_pickup_station: 'At Pickup Station',
  ready_for_pickup: 'Ready for Pickup',
  in_transit: 'In Transit',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  disputed: 'Disputed',
  refund_requested: 'Refund Requested',
  refunded: 'Refunded',
}

const STATUS_COLORS = {
  pending_payment: '#f59e0b',
  delivery_quote_pending: '#f59e0b',
  paid: '#059669',
  accepted: '#059669',
  delivered: '#059669',
  processing: '#0d9488',
  packed: '#0d9488',
  at_pickup_station: '#8b5cf6',
  ready_for_pickup: '#0d9488',
  in_transit: '#2563eb',
  cancelled: '#ef4444',
  disputed: '#ef4444',
  refund_requested: '#f59e0b',
  refunded: '#6b7280',
}

const TRANSITIONS = {
  paid: ['accepted', 'cancelled'],
  accepted: ['processing', 'cancelled'],
  processing: ['packed', 'cancelled'],
  packed: ['at_pickup_station', 'ready_for_pickup', 'cancelled'],
  at_pickup_station: ['ready_for_pickup', 'cancelled'],
  ready_for_pickup: ['in_transit', 'delivered', 'cancelled'],
  in_transit: ['delivered'],
  delivery_quote_pending: ['pending_payment', 'cancelled'],
  refund_requested: ['refunded', 'disputed'],
}

function fmtMoney(kobo) {
  if (kobo == null || isNaN(kobo)) return '₦0'
  return `₦${(Number(kobo) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDateTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function exportCustomerPDF(customer, orders, summary) {
  const win = window.open('', '_blank', 'noopener,noreferrer')
  if (!win) return
  const rows = (orders || []).map(o => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${o.id?.slice(0, 8) || '—'}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${fmtDate(o.created_at)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${o.items_count || 0}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${fmtMoney(o.total_kobo)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">
        <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:${STATUS_COLORS[o.status] || '#6b7280'}22;color:${STATUS_COLORS[o.status] || '#6b7280'}">${STATUS_LABELS[o.status] || o.status}</span>
      </td>
    </tr>
  `).join('')

  win.document.write(`<!DOCTYPE html><html><head><title>Customer Report — ${customer?.full_name || 'Unknown'}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a; }
    h1 { margin: 0 0 4px; font-size: 22px; }
    .sub { color: #6b7280; font-size: 13px; margin-bottom: 24px; }
    .metrics { display: flex; gap: 16px; margin-bottom: 24px; }
    .metric { flex: 1; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; text-align: center; }
    .metric .val { font-size: 22px; font-weight: 900; color: #0E6F5A; }
    .metric .lbl { font-size: 11px; color: #6b7280; font-weight: 700; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 8px; font-size: 11px; color: #6b7280; font-weight: 700; border-bottom: 2px solid #e5e7eb; text-transform: uppercase; }
    .footer { margin-top: 32px; font-size: 10px; color: #9ca3af; text-align: center; }
    @media print { body { padding: 20px; } }
  </style></head><body>
  <h1>CareFind — Customer Report</h1>
  <p class="sub">Generated ${fmtDateTime(new Date().toISOString())}</p>
  <div style="margin-bottom:20px;padding:14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;">
    <p style="margin:0 0 4px;font-weight:800;font-size:15px;">${customer?.full_name || 'Unknown Customer'}</p>
    <p style="margin:0;font-size:12px;color:#6b7280;">${customer?.email || '—'} · ${customer?.phone || '—'}</p>
    ${customer?.location ? `<p style="margin:4px 0 0;font-size:12px;color:#6b7280;">${customer.location}</p>` : ''}
  </div>
  <div class="metrics">
    <div class="metric"><div class="val">${summary?.total_orders || 0}</div><div class="lbl">Total Orders</div></div>
    <div class="metric"><div class="val">${fmtMoney(summary?.total_spent_kobo)}</div><div class="lbl">Total Spent</div></div>
    <div class="metric"><div class="val">${summary?.completed_orders || 0}</div><div class="lbl">Completed</div></div>
    <div class="metric"><div class="val">${summary?.unique_vendors || 0}</div><div class="lbl">Vendors</div></div>
  </div>
  <h2 style="font-size:15px;margin:0 0 10px;">Order History</h2>
  <table>
    <thead><tr><th>Order ID</th><th>Date</th><th>Items</th><th>Amount</th><th>Status</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" style="padding:16px;text-align:center;color:#9ca3af;">No orders</td></tr>'}</tbody>
  </table>
  <div class="footer">CareFind Admin Dashboard · Confidential</div>
  <script>window.onload=function(){window.print()}</script>
  </body></html>`)
  win.document.close()
}

function StatusBadge({ status }) {
  const color = STATUS_COLORS[status] || '#6b7280'
  return (
    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: theme.radius.full, fontSize: 10, fontWeight: 700, background: `${color}18`, color }}>{STATUS_LABELS[status] || status}</span>
  )
}

function ShopOverview({ overview, loading }) {
  const card = { border: `1px solid ${theme.border}`, borderRadius: theme.radius.lg, padding: 14, background: theme.cardBg, marginBottom: 10 }

  if (loading) return <p style={{ color: theme.textLight, fontSize: 13 }}>Loading shop metrics...</p>

  const metrics = [
    { label: 'Total Orders', value: overview?.total_orders || 0 },
    { label: 'Pending', value: overview?.pending || 0 },
    { label: 'Processing', value: overview?.processing || 0 },
    { label: 'Packed', value: overview?.packed || 0 },
    { label: 'At Station', value: overview?.at_pickup_station || 0 },
    { label: 'Ready', value: overview?.ready_for_pickup || 0 },
    { label: 'In Transit', value: overview?.in_transit || 0 },
    { label: 'Delivered', value: overview?.delivered || 0 },
    { label: 'Disputed', value: overview?.disputed || 0 },
    { label: 'Revenue', value: fmtMoney(overview?.revenue_kobo) },
    { label: 'Commission', value: fmtMoney(overview?.commission_kobo) },
    { label: 'Active Vendors', value: overview?.active_vendors || 0 },
    { label: 'Active Customers', value: overview?.active_customers || 0 },
  ]

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
        {metrics.map(m => (
          <div key={m.label} style={{ ...card, textAlign: 'center', padding: 12 }}>
            <p style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 900, color: theme.navy }}>{m.value}</p>
            <p style={{ margin: 0, fontSize: 10, color: theme.textMid, fontWeight: 600 }}>{m.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function OrdersList({ orders, loading, onOpenOrder, onLoadMore, hasMore }) {
  const card = { border: `1px solid ${theme.border}`, borderRadius: theme.radius.lg, padding: 14, background: theme.cardBg, marginBottom: 10 }
  const input = { width: '100%', padding: 10, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, boxSizing: 'border-box' }
  const btnPrimary = { padding: '8px 14px', background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: theme.radius.md, fontWeight: 700, fontSize: 12, cursor: 'pointer' }
  const btnSecondary = { padding: '8px 14px', background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, fontWeight: 700, fontSize: 12, cursor: 'pointer' }

  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [appliedFilters, setAppliedFilters] = useState({})

  function applyFilters() {
    setAppliedFilters({ status: statusFilter || undefined, search: search || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined })
  }

  function clearFilters() {
    setStatusFilter(''); setSearch(''); setDateFrom(''); setDateTo('')
    setAppliedFilters({})
  }

  return (
    <div>
      <div style={card}>
        <p style={{ margin: '0 0 10px', fontWeight: 800, fontSize: 13, color: theme.navy }}>Filters</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <div>
            <label style={{ fontSize: 10, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 3 }}>Status</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={input}>
              <option value="">All</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 3 }}>Search</label>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Order ID, customer..." style={input} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 3 }}>From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...input, fontSize: 12, padding: 8 }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 3 }}>To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...input, fontSize: 12, padding: 8 }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={applyFilters} style={btnPrimary}>Apply</button>
          <button onClick={clearFilters} style={btnSecondary}>Clear</button>
        </div>
      </div>

      {loading && <p style={{ color: theme.textLight, fontSize: 13 }}>Loading orders...</p>}

      {!loading && orders.length === 0 && (
        <p style={{ color: theme.textLight, fontSize: 13, textAlign: 'center', padding: 20 }}>No orders found.</p>
      )}

      {orders.map(o => (
        <div key={o.id} onClick={() => onOpenOrder(o.id)} style={{ ...card, cursor: 'pointer' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
            <div>
              <p style={{ margin: '0 0 2px', fontWeight: 800, fontSize: 13, color: theme.navy }}>#{o.id?.slice(0, 12) || '—'}</p>
              <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>{o.customer_name || o.profiles?.full_name || 'Unknown'} · {fmtDate(o.created_at)}</p>
            </div>
            <StatusBadge status={o.status} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: theme.tealDeep }}>{fmtMoney(o.total_kobo)}</p>
            <p style={{ margin: 0, fontSize: 10, color: theme.textLight }}>{o.vendor_name || o.businesses?.name || ''}</p>
          </div>
        </div>
      ))}

      {hasMore && (
        <div style={{ textAlign: 'center', padding: 10 }}>
          <button onClick={onLoadMore} style={btnSecondary}>Load More</button>
        </div>
      )}
    </div>
  )
}

function OrderDetail({ orderId, onBack, showToast }) {
  const card = { border: `1px solid ${theme.border}`, borderRadius: theme.radius.lg, padding: 14, background: theme.cardBg, marginBottom: 10 }
  const btnPrimary = { padding: '8px 14px', background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: theme.radius.md, fontWeight: 700, fontSize: 12, cursor: 'pointer' }
  const btnSecondary = { padding: '8px 14px', background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, fontWeight: 700, fontSize: 12, cursor: 'pointer' }
  const btnDanger = { padding: '8px 14px', background: theme.dangerBg, color: theme.alert, border: 'none', borderRadius: theme.radius.md, fontWeight: 700, fontSize: 12, cursor: 'pointer' }

  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [statusNote, setStatusNote] = useState('')
  const [activeSection, setActiveSection] = useState('details')

  useEffect(() => { loadOrder() }, [orderId])

  async function loadOrder() {
    setLoading(true)
    try {
      const token = localStorage.getItem('admin_token')
      const { data } = await callAdminAuth('get_shop_order_detail', { token, orderId })
      setOrder(data)
    } catch (e) {
      showToast(e.message, { type: 'error' })
    }
    setLoading(false)
  }

  async function updateStatus(newStatus) {
    setUpdating(true)
    try {
      const token = localStorage.getItem('admin_token')
      await callAdminAuth('admin_update_shop_order_status', { token, orderId, status: newStatus, note: statusNote || undefined })
      showToast(`Order updated to ${STATUS_LABELS[newStatus] || newStatus}`, { type: 'success' })
      setStatusNote('')
      loadOrder()
    } catch (e) {
      showToast(e.message, { type: 'error' })
    }
    setUpdating(false)
  }

  if (loading) return <p style={{ color: theme.textLight, fontSize: 13 }}>Loading order...</p>
  if (!order) return <p style={{ color: theme.textLight, fontSize: 13 }}>Order not found.</p>

  const o = order
  const vendor = o.businesses || {}
  const customer = o.profiles || {}
  const items = o.items || []
  const statusHistory = o.status_history || []
  const notifications = o.notifications || []
  const messages = o.messages || []
  const transitions = TRANSITIONS[o.status] || []

  const sections = [
    { key: 'details', label: 'Details' },
    { key: 'timeline', label: 'Timeline' },
    { key: 'notifications', label: `Notifications (${notifications.length})` },
    { key: 'messages', label: `Messages (${messages.length})` },
  ]

  return (
    <div>
      <button onClick={onBack} style={btnSecondary}>← Back to Orders</button>

      <div style={{ ...card, marginTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div>
            <p style={{ margin: '0 0 2px', fontWeight: 900, fontSize: 16, color: theme.navy }}>Order #{o.id?.slice(0, 12)}</p>
            <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>Placed {fmtDateTime(o.created_at)}</p>
          </div>
          <StatusBadge status={o.status} />
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {sections.map(s => (
            <button key={s.key} onClick={() => setActiveSection(s.key)} style={{
              padding: '5px 12px', borderRadius: theme.radius.full, fontSize: 11, fontWeight: 700,
              border: activeSection === s.key ? 'none' : `1px solid ${theme.border}`,
              background: activeSection === s.key ? theme.tealGradient : theme.bg,
              color: activeSection === s.key ? '#fff' : theme.textMid,
              cursor: 'pointer',
            }}>{s.label}</button>
          ))}
        </div>

        {activeSection === 'details' && (
          <div>
            <div style={{ border: `1px solid ${theme.border}`, borderRadius: 12, padding: 12, marginBottom: 10, background: '#f9fafb' }}>
              <p style={{ margin: '0 0 6px', fontWeight: 800, fontSize: 12, color: theme.tealDeep }}>🏪 Vendor</p>
              <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 13, color: theme.navy }}>{vendor.name || '—'}</p>
              {vendor.location && <p style={{ margin: '0 0 2px', fontSize: 11, color: theme.textLight }}>📍 {vendor.location}</p>}
              {vendor.whatsapp && <p style={{ margin: '0 0 2px', fontSize: 11, color: theme.textLight }}>📱 {vendor.whatsapp}</p>}
              {vendor.address && <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>🏠 {vendor.address}</p>}
            </div>

            <div style={{ border: `1px solid ${theme.border}`, borderRadius: 12, padding: 12, marginBottom: 10, background: '#f9fafb' }}>
              <p style={{ margin: '0 0 6px', fontWeight: 800, fontSize: 12, color: theme.tealDeep }}>👤 Customer</p>
              <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 13, color: theme.navy }}>{customer.full_name || customer.display_name || '—'}</p>
              {customer.email && <p style={{ margin: '0 0 2px', fontSize: 11, color: theme.textLight }}>✉️ {customer.email}</p>}
              {customer.phone && <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>📱 {customer.phone}</p>}
            </div>

            <p style={{ margin: '0 0 8px', fontWeight: 800, fontSize: 12, color: theme.navy }}>Items ({items.length})</p>
            {items.length === 0 && <p style={{ fontSize: 12, color: theme.textLight }}>No items.</p>}
            {items.map((item, i) => (
              <div key={item.id || i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < items.length - 1 ? `1px solid ${theme.border}` : 'none' }}>
                <div>
                  <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 12, color: theme.navy }}>{item.product_name || item.name || 'Item'}</p>
                  <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>Qty: {item.quantity || 1}</p>
                </div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 12, color: theme.tealDeep }}>{fmtMoney(item.price_kobo || item.unit_price_kobo)}</p>
              </div>
            ))}

            <div style={{ marginTop: 10, padding: 10, background: '#f9fafb', borderRadius: theme.radius.md, border: `1px solid ${theme.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: theme.textLight }}>Subtotal</span>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{fmtMoney(o.subtotal_kobo)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: theme.textLight }}>Delivery</span>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{fmtMoney(o.delivery_fee_kobo)}</span>
              </div>
              {o.platform_fee_kobo > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: theme.textLight }}>Platform Fee</span>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{fmtMoney(o.platform_fee_kobo)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6, borderTop: `1px solid ${theme.border}` }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: theme.navy }}>Total</span>
                <span style={{ fontSize: 13, fontWeight: 900, color: theme.tealDeep }}>{fmtMoney(o.total_kobo)}</span>
              </div>
            </div>

            {o.pickup_stations && o.pickup_stations.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <p style={{ margin: '0 0 6px', fontWeight: 800, fontSize: 12, color: theme.navy }}>📍 Pickup Station</p>
                {o.pickup_stations.map(ps => (
                  <div key={ps.id} style={{ padding: 10, background: '#f9fafb', borderRadius: theme.radius.md, border: `1px solid ${theme.border}` }}>
                    <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 12 }}>{ps.name}</p>
                    <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>{ps.address}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeSection === 'timeline' && (
          <div>
            {statusHistory.length === 0 && <p style={{ fontSize: 12, color: theme.textLight }}>No status history.</p>}
            {statusHistory.map((sh, i) => (
              <div key={sh.id || i} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLORS[sh.status] || '#6b7280', marginTop: 4, flexShrink: 0 }} />
                <div>
                  <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 12, color: theme.navy }}>{STATUS_LABELS[sh.status] || sh.status}</p>
                  <p style={{ margin: '0 0 2px', fontSize: 11, color: theme.textLight }}>{fmtDateTime(sh.created_at)}</p>
                  {sh.note && <p style={{ margin: 0, fontSize: 11, color: theme.textMid, fontStyle: 'italic' }}>{sh.note}</p>}
                </div>
              </div>
            ))}

            {o.tracking_events && o.tracking_events.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <p style={{ margin: '0 0 8px', fontWeight: 800, fontSize: 12, color: theme.navy }}>Tracking Events</p>
                {o.tracking_events.map((te, i) => (
                  <div key={te.id || i} style={{ padding: '6px 0', borderBottom: `1px solid ${theme.border}` }}>
                    <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 12 }}>{te.event_type || te.event}</p>
                    <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>{fmtDateTime(te.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeSection === 'notifications' && (
          <div>
            {notifications.length === 0 && <p style={{ fontSize: 12, color: theme.textLight }}>No notifications sent.</p>}
            {notifications.map((n, i) => (
              <div key={n.id || i} style={{ padding: '8px 0', borderBottom: i < notifications.length - 1 ? `1px solid ${theme.border}` : 'none' }}>
                <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 12, color: theme.navy }}>{n.title || n.type || 'Notification'}</p>
                {n.body && <p style={{ margin: '0 0 2px', fontSize: 11, color: theme.textMid }}>{n.body}</p>}
                <p style={{ margin: 0, fontSize: 10, color: theme.textLight }}>{fmtDateTime(n.created_at)} · {n.channel || 'push'}</p>
              </div>
            ))}
          </div>
        )}

        {activeSection === 'messages' && (
          <div>
            {messages.length === 0 && <p style={{ fontSize: 12, color: theme.textLight }}>No messages.</p>}
            {messages.map((m, i) => (
              <div key={m.id || i} style={{ padding: '8px 0', borderBottom: i < messages.length - 1 ? `1px solid ${theme.border}` : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 12, color: theme.navy }}>{m.sender_name || m.sender || '—'}</p>
                  <p style={{ margin: 0, fontSize: 10, color: theme.textLight }}>{fmtDateTime(m.created_at)}</p>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: theme.textMid }}>{m.body || m.content || m.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {transitions.length > 0 && (
        <div style={card}>
          <p style={{ margin: '0 0 8px', fontWeight: 800, fontSize: 12, color: theme.navy }}>Update Status</p>
          <input
            value={statusNote}
            onChange={e => setStatusNote(e.target.value)}
            placeholder="Optional note..."
            style={{ width: '100%', padding: 10, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, boxSizing: 'border-box', marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {transitions.map(s => (
              <button
                key={s}
                onClick={() => updateStatus(s)}
                disabled={updating}
                style={s === 'cancelled' ? btnDanger : btnPrimary}
              >
                {updating ? 'Updating...' : STATUS_LABELS[s] || s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function FulfilmentView({ showToast }) {
  const card = { border: `1px solid ${theme.border}`, borderRadius: theme.radius.lg, padding: 14, background: theme.cardBg, marginBottom: 10 }
  const btnPrimary = { padding: '8px 14px', background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: theme.radius.md, fontWeight: 700, fontSize: 12, cursor: 'pointer' }
  const btnSecondary = { padding: '8px 14px', background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, fontWeight: 700, fontSize: 12, cursor: 'pointer' }

  const [fulfilmentOrders, setFulfilmentOrders] = useState([])
  const [pickupStations, setPickupStations] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('processing')

  useEffect(() => { loadData() }, [statusFilter])

  async function loadData() {
    setLoading(true)
    try {
      const token = localStorage.getItem('admin_token')
      const [ordersRes, stationsRes] = await Promise.all([
        callAdminAuth('get_fulfilment_orders', { token, status: statusFilter || undefined }).catch(() => ({ data: [] })),
        callAdminAuth('list_pickup_stations_admin', { token }).catch(() => ({ data: [] })),
      ])
      setFulfilmentOrders(ordersRes.data || [])
      setPickupStations(stationsRes.data || [])
    } catch (e) {
      showToast(e.message, { type: 'error' })
    }
    setLoading(false)
  }

  async function quickUpdate(orderId, newStatus) {
    try {
      const token = localStorage.getItem('admin_token')
      await callAdminAuth('admin_update_shop_order_status', { token, orderId, status: newStatus })
      showToast(`Order ${STATUS_LABELS[newStatus] || newStatus}`, { type: 'success' })
      loadData()
    } catch (e) {
      showToast(e.message, { type: 'error' })
    }
  }

  const stationCounts = {}
  fulfilmentOrders.forEach(o => {
    const stationId = o.pickup_station_id || 'none'
    stationCounts[stationId] = (stationCounts[stationId] || 0) + 1
  })

  return (
    <div>
      <div style={card}>
        <p style={{ margin: '0 0 8px', fontWeight: 800, fontSize: 13, color: theme.navy }}>Fulfillment Status Filter</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['processing', 'packed', 'at_pickup_station', 'ready_for_pickup', 'in_transit', 'delivered'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} style={{
              padding: '5px 12px', borderRadius: theme.radius.full, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              border: statusFilter === s ? 'none' : `1px solid ${theme.border}`,
              background: statusFilter === s ? theme.tealGradient : theme.bg,
              color: statusFilter === s ? '#fff' : theme.textMid,
            }}>{STATUS_LABELS[s]}</button>
          ))}
        </div>
      </div>

      <div style={card}>
        <p style={{ margin: '0 0 8px', fontWeight: 800, fontSize: 13, color: theme.navy }}>📍 Pickup Stations</p>
        {pickupStations.length === 0 && <p style={{ fontSize: 12, color: theme.textLight }}>No pickup stations configured.</p>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {pickupStations.map(ps => (
            <div key={ps.id} style={{ padding: 10, background: '#f9fafb', borderRadius: theme.radius.md, border: `1px solid ${theme.border}` }}>
              <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 12, color: theme.navy }}>{ps.name}</p>
              <p style={{ margin: '0 0 2px', fontSize: 11, color: theme.textLight }}>{ps.address || ps.location || '—'}</p>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: theme.tealDeep }}>
                {stationCounts[ps.id] || 0} orders waiting
              </p>
            </div>
          ))}
        </div>
      </div>

      {loading && <p style={{ color: theme.textLight, fontSize: 13 }}>Loading fulfillment orders...</p>}

      {!loading && fulfilmentOrders.length === 0 && (
        <p style={{ color: theme.textLight, fontSize: 13, textAlign: 'center', padding: 20 }}>No orders in this status.</p>
      )}

      {fulfilmentOrders.map(o => {
        const nextTransitions = TRANSITIONS[o.status] || []
        return (
          <div key={o.id} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <div>
                <p style={{ margin: '0 0 2px', fontWeight: 800, fontSize: 13, color: theme.navy }}>#{o.id?.slice(0, 12)}</p>
                <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>{o.customer_name || o.profiles?.full_name || 'Unknown'} · {fmtDate(o.created_at)}</p>
              </div>
              <StatusBadge status={o.status} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: theme.tealDeep }}>{fmtMoney(o.total_kobo)}</p>
              <p style={{ margin: 0, fontSize: 10, color: theme.textLight }}>{o.vendor_name || o.businesses?.name || ''}</p>
            </div>
            {o.pickup_stations && o.pickup_stations.length > 0 && (
              <p style={{ margin: '0 0 6px', fontSize: 11, color: theme.textLight }}>📍 {o.pickup_stations[0]?.name || '—'}</p>
            )}
            {nextTransitions.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {nextTransitions.map(s => (
                  <button key={s} onClick={() => quickUpdate(o.id, s)} style={s === 'cancelled' ? { padding: '6px 10px', background: theme.dangerBg, color: theme.alert, border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 11, cursor: 'pointer' } : { padding: '6px 10px', background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
                    {STATUS_LABELS[s] || s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function CustomersList({ showToast }) {
  const card = { border: `1px solid ${theme.border}`, borderRadius: theme.radius.lg, padding: 14, background: theme.cardBg, marginBottom: 10 }
  const input = { width: '100%', padding: 10, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, boxSizing: 'border-box' }

  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState(null)

  async function loadCustomers(q) {
    setLoading(true)
    try {
      const token = localStorage.getItem('admin_token')
      const { data } = await callAdminAuth('list_shop_customers', { token, search: q || undefined })
      const sorted = (data || []).sort((a, b) => (b.total_spent_kobo || 0) - (a.total_spent_kobo || 0))
      setCustomers(sorted)
    } catch (e) {
      showToast(e.message, { type: 'error' })
    }
    setLoading(false)
  }

  useEffect(() => { loadCustomers() }, [])

  if (selectedCustomer) {
    return <CustomerDetail customerId={selectedCustomer} onBack={() => setSelectedCustomer(null)} showToast={showToast} />
  }

  return (
    <div>
      <div style={card}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') loadCustomers(search) }}
          placeholder="Search customers by name or email..."
          style={input}
        />
        <button onClick={() => loadCustomers(search)} style={{ marginTop: 8, padding: '8px 14px', background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: theme.radius.md, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Search</button>
      </div>

      {loading && <p style={{ color: theme.textLight, fontSize: 13 }}>Loading customers...</p>}

      {!loading && customers.length === 0 && (
        <p style={{ color: theme.textLight, fontSize: 13, textAlign: 'center', padding: 20 }}>No customers found.</p>
      )}

      {customers.map((c, i) => (
        <div key={c.id || i} onClick={() => setSelectedCustomer(c.id)} style={{ ...card, cursor: 'pointer' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ margin: '0 0 2px', fontWeight: 800, fontSize: 13, color: theme.navy }}>{c.full_name || c.display_name || 'Unknown'}</p>
              <p style={{ margin: '0 0 2px', fontSize: 11, color: theme.textLight }}>{c.email || '—'}</p>
              {c.phone && <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>{c.phone}</p>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: '0 0 2px', fontWeight: 900, fontSize: 14, color: theme.tealDeep }}>{fmtMoney(c.total_spent_kobo)}</p>
              <p style={{ margin: 0, fontSize: 10, color: theme.textLight }}>{c.total_orders || 0} orders</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function CustomerDetail({ customerId, onBack, showToast }) {
  const card = { border: `1px solid ${theme.border}`, borderRadius: theme.radius.lg, padding: 14, background: theme.cardBg, marginBottom: 10 }
  const btnPrimary = { padding: '8px 14px', background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: theme.radius.md, fontWeight: 700, fontSize: 12, cursor: 'pointer' }
  const btnSecondary = { padding: '8px 14px', background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, fontWeight: 700, fontSize: 12, cursor: 'pointer' }

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadCustomer() }, [customerId])

  async function loadCustomer() {
    setLoading(true)
    try {
      const token = localStorage.getItem('admin_token')
      const { data: result } = await callAdminAuth('get_customer_purchase_history', { token, customerId })
      setData(result)
    } catch (e) {
      showToast(e.message, { type: 'error' })
    }
    setLoading(false)
  }

  if (loading) return <p style={{ color: theme.textLight, fontSize: 13 }}>Loading customer...</p>
  if (!data) return <p style={{ color: theme.textLight, fontSize: 13 }}>Customer not found.</p>

  const profile = data.profile || {}
  const orders = data.orders || []
  const summary = data.summary || {}

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button onClick={onBack} style={btnSecondary}>← Back</button>
        <button onClick={() => exportCustomerPDF(profile, orders, summary)} style={btnPrimary}>📄 Export PDF</button>
      </div>

      <div style={card}>
        <p style={{ margin: '0 0 2px', fontWeight: 900, fontSize: 16, color: theme.navy }}>{profile.full_name || profile.display_name || 'Unknown Customer'}</p>
        {profile.email && <p style={{ margin: '0 0 2px', fontSize: 12, color: theme.textLight }}>✉️ {profile.email}</p>}
        {profile.phone && <p style={{ margin: '0 0 2px', fontSize: 12, color: theme.textLight }}>📱 {profile.phone}</p>}
        {profile.location && <p style={{ margin: '0 0 8px', fontSize: 12, color: theme.textLight }}>📍 {profile.location}</p>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginTop: 10 }}>
          <div style={{ background: '#f9fafb', borderRadius: 10, padding: 10, textAlign: 'center', border: `1px solid ${theme.border}` }}>
            <p style={{ margin: '0 0 2px', fontSize: 18, fontWeight: 900, color: theme.tealDeep }}>{summary.total_orders || 0}</p>
            <p style={{ margin: 0, fontSize: 10, color: theme.textLight, fontWeight: 700 }}>Total Orders</p>
          </div>
          <div style={{ background: '#f9fafb', borderRadius: 10, padding: 10, textAlign: 'center', border: `1px solid ${theme.border}` }}>
            <p style={{ margin: '0 0 2px', fontSize: 18, fontWeight: 900, color: theme.tealDeep }}>{fmtMoney(summary.total_spent_kobo)}</p>
            <p style={{ margin: 0, fontSize: 10, color: theme.textLight, fontWeight: 700 }}>Lifetime Value</p>
          </div>
          <div style={{ background: '#f9fafb', borderRadius: 10, padding: 10, textAlign: 'center', border: `1px solid ${theme.border}` }}>
            <p style={{ margin: '0 0 2px', fontSize: 18, fontWeight: 900, color: theme.tealDeep }}>{summary.completed_orders || 0}</p>
            <p style={{ margin: 0, fontSize: 10, color: theme.textLight, fontWeight: 700 }}>Completed</p>
          </div>
          <div style={{ background: '#f9fafb', borderRadius: 10, padding: 10, textAlign: 'center', border: `1px solid ${theme.border}` }}>
            <p style={{ margin: '0 0 2px', fontSize: 18, fontWeight: 900, color: theme.tealDeep }}>{summary.unique_vendors || 0}</p>
            <p style={{ margin: 0, fontSize: 10, color: theme.textLight, fontWeight: 700 }}>Vendors</p>
          </div>
        </div>
      </div>

      <p style={{ margin: '0 0 8px', fontWeight: 800, fontSize: 13, color: theme.navy }}>Order History</p>

      {orders.length === 0 && <p style={{ color: theme.textLight, fontSize: 13 }}>No orders yet.</p>}

      {orders.map(o => (
        <div key={o.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
            <div>
              <p style={{ margin: '0 0 2px', fontWeight: 800, fontSize: 13, color: theme.navy }}>#{o.id?.slice(0, 12)}</p>
              <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>{fmtDate(o.created_at)} · {o.vendor_name || o.businesses?.name || ''}</p>
            </div>
            <StatusBadge status={o.status} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>{o.items_count || 0} items</p>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: theme.tealDeep }}>{fmtMoney(o.total_kobo)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function VendorsView({ showToast }) {
  const card = { border: `1px solid ${theme.border}`, borderRadius: theme.radius.lg, padding: 14, background: theme.cardBg, marginBottom: 10 }
  const input = { width: '100%', padding: 10, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, boxSizing: 'border-box' }
  const btnPrimary = { padding: '8px 14px', background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: theme.radius.md, fontWeight: 700, fontSize: 12, cursor: 'pointer' }
  const btnSecondary = { padding: '8px 14px', background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, fontWeight: 700, fontSize: 12, cursor: 'pointer' }
  const btnDanger = { padding: '8px 14px', background: theme.dangerBg, color: theme.alert, border: 'none', borderRadius: theme.radius.md, fontWeight: 700, fontSize: 12, cursor: 'pointer' }

  const [vendorSearch, setVendorSearch] = useState('')
  const [vendorSummary, setVendorSummary] = useState(null)
  const [vendorLoading, setVendorLoading] = useState(false)
  const [applications, setApplications] = useState([])
  const [products, setProducts] = useState([])
  const [loadingApps, setLoadingApps] = useState(true)
  const [loadingProds, setLoadingProds] = useState(true)
  const [activeSubTab, setActiveSubTab] = useState('lookup')

  useEffect(() => { loadApplications(); loadProducts() }, [])

  async function loadApplications() {
    setLoadingApps(true)
    try {
      const token = localStorage.getItem('admin_token')
      const { data } = await callAdminAuth('list_ecommerce_applications', { token })
      setApplications(data || [])
    } catch (e) {
      showToast(e.message, { type: 'error' })
    }
    setLoadingApps(false)
  }

  async function loadProducts() {
    setLoadingProds(true)
    try {
      const token = localStorage.getItem('admin_token')
      const { data } = await callAdminAuth('list_ecommerce_products_admin', { token })
      setProducts(data || [])
    } catch (e) {
      showToast(e.message, { type: 'error' })
    }
    setLoadingProds(false)
  }

  async function lookupVendor() {
    if (!vendorSearch.trim()) return
    setVendorLoading(true)
    try {
      const token = localStorage.getItem('admin_token')
      const { data } = await callAdminAuth('get_vendor_order_summary', { token, vendorId: vendorSearch.trim() })
      setVendorSummary(data)
    } catch (e) {
      showToast(e.message, { type: 'error' })
      setVendorSummary(null)
    }
    setVendorLoading(false)
  }

  async function updateApplication(id, status) {
    try {
      const token = localStorage.getItem('admin_token')
      await callAdminAuth('update_ecommerce_application', { token, id, status })
      showToast(`Application ${status}`, { type: 'success' })
      loadApplications()
    } catch (e) {
      showToast(e.message, { type: 'error' })
    }
  }

  async function moderateProduct(id, patch) {
    try {
      const token = localStorage.getItem('admin_token')
      await callAdminAuth('moderate_ecommerce_product', { token, id, ...patch })
      showToast('Product updated', { type: 'success' })
      loadProducts()
    } catch (e) {
      showToast(e.message, { type: 'error' })
    }
  }

  const subTabs = [
    { key: 'lookup', label: '🔍 Vendor Lookup' },
    { key: 'applications', label: `📋 Applications (${applications.filter(a => a.status === 'Submitted' || a.status === 'Under Review').length})` },
    { key: 'products', label: `📦 Products (${products.length})` },
  ]

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {subTabs.map(t => (
          <button key={t.key} onClick={() => setActiveSubTab(t.key)} style={{
            padding: '5px 12px', borderRadius: 16, fontSize: 11, fontWeight: 700, cursor: 'pointer',
            border: activeSubTab === t.key ? 'none' : `1px solid ${theme.border}`,
            background: activeSubTab === t.key ? theme.tealGradient : theme.bg,
            color: activeSubTab === t.key ? '#fff' : theme.textMid,
          }}>{t.label}</button>
        ))}
      </div>

      {activeSubTab === 'lookup' && (
        <div>
          <div style={card}>
            <p style={{ margin: '0 0 8px', fontWeight: 800, fontSize: 13, color: theme.navy }}>Vendor Lookup</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={vendorSearch}
                onChange={e => setVendorSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') lookupVendor() }}
                placeholder="Enter vendor ID or business ID..."
                style={{ ...input, flex: 1 }}
              />
              <button onClick={lookupVendor} style={btnPrimary}>Search</button>
            </div>
          </div>

          {vendorLoading && <p style={{ color: theme.textLight, fontSize: 13 }}>Loading vendor data...</p>}

          {vendorSummary && (
            <div style={card}>
              <p style={{ margin: '0 0 8px', fontWeight: 900, fontSize: 14, color: theme.navy }}>{vendorSummary.business_name || vendorSummary.name || 'Vendor'}</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <div style={{ background: '#f9fafb', borderRadius: 10, padding: 10, textAlign: 'center', border: `1px solid ${theme.border}` }}>
                  <p style={{ margin: '0 0 2px', fontSize: 18, fontWeight: 900, color: theme.tealDeep }}>{vendorSummary.total_orders || 0}</p>
                  <p style={{ margin: 0, fontSize: 10, color: theme.textLight, fontWeight: 700 }}>Total Orders</p>
                </div>
                <div style={{ background: '#f9fafb', borderRadius: 10, padding: 10, textAlign: 'center', border: `1px solid ${theme.border}` }}>
                  <p style={{ margin: '0 0 2px', fontSize: 18, fontWeight: 900, color: theme.tealDeep }}>{fmtMoney(vendorSummary.revenue_kobo)}</p>
                  <p style={{ margin: 0, fontSize: 10, color: theme.textLight, fontWeight: 700 }}>Revenue</p>
                </div>
                <div style={{ background: '#f9fafb', borderRadius: 10, padding: 10, textAlign: 'center', border: `1px solid ${theme.border}` }}>
                  <p style={{ margin: '0 0 2px', fontSize: 18, fontWeight: 900, color: theme.tealDeep }}>{vendorSummary.active_products || 0}</p>
                  <p style={{ margin: 0, fontSize: 10, color: theme.textLight, fontWeight: 700 }}>Products</p>
                </div>
              </div>
              {vendorSummary.recent_orders && vendorSummary.recent_orders.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <p style={{ margin: '0 0 6px', fontWeight: 800, fontSize: 12, color: theme.navy }}>Recent Orders</p>
                  {vendorSummary.recent_orders.map(ro => (
                    <div key={ro.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${theme.border}` }}>
                      <div>
                        <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 12 }}>#{ro.id?.slice(0, 12)}</p>
                        <p style={{ margin: 0, fontSize: 10, color: theme.textLight }}>{fmtDate(ro.created_at)}</p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <StatusBadge status={ro.status} />
                        <p style={{ margin: '4px 0 0', fontSize: 11, fontWeight: 700, color: theme.tealDeep }}>{fmtMoney(ro.total_kobo)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeSubTab === 'applications' && (
        <div>
          {loadingApps && <p style={{ color: theme.textLight, fontSize: 13 }}>Loading applications...</p>}
          {!loadingApps && applications.length === 0 && <p style={{ color: theme.textLight, fontSize: 13 }}>No seller applications.</p>}
          {applications.map(app => (
            <div key={app.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div>
                  <p style={{ margin: '0 0 2px', fontWeight: 800, fontSize: 13, color: theme.navy }}>{app.business_name || app.applicant_name || 'Unknown'}</p>
                  <p style={{ margin: '0 0 2px', fontSize: 11, color: theme.textLight }}>{app.applicant_email || '—'}</p>
                  <p style={{ margin: 0, fontSize: 10, color: theme.textLight }}>{fmtDate(app.created_at)}</p>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 20,
                  background: app.status === 'Approved' ? theme.tealMist : app.status === 'Rejected' ? theme.dangerBg : theme.amberBg,
                  color: app.status === 'Approved' ? theme.success : app.status === 'Rejected' ? theme.alert : theme.amberText,
                }}>{app.status}</span>
              </div>
              {app.description && <p style={{ margin: '0 0 6px', fontSize: 11, color: theme.textMid }}>{app.description}</p>}
              {(app.status === 'Submitted' || app.status === 'Under Review') && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => updateApplication(app.id, 'Approved')} style={btnPrimary}>✓ Approve</button>
                  <button onClick={() => updateApplication(app.id, 'Rejected')} style={btnDanger}>✕ Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {activeSubTab === 'products' && (
        <div>
          {loadingProds && <p style={{ color: theme.textLight, fontSize: 13 }}>Loading products...</p>}
          {!loadingProds && products.length === 0 && <p style={{ color: theme.textLight, fontSize: 13 }}>No products to moderate.</p>}
          {products.map(p => (
            <div key={p.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: '0 0 2px', fontWeight: 800, fontSize: 13, color: theme.navy }}>{p.name || 'Unnamed Product'}</p>
                  <p style={{ margin: '0 0 2px', fontSize: 11, color: theme.textLight }}>{p.business_name || p.businesses?.name || 'Unknown vendor'}</p>
                  <p style={{ margin: 0, fontSize: 11, color: theme.tealDeep, fontWeight: 700 }}>{fmtMoney(p.price_kobo)}</p>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 20,
                  background: p.is_restricted ? theme.dangerBg : p.status === 'active' || p.status === 'approved' ? theme.tealMist : theme.amberBg,
                  color: p.is_restricted ? theme.alert : p.status === 'active' || p.status === 'approved' ? theme.success : theme.amberText,
                }}>{p.is_restricted ? 'Restricted' : p.status || 'pending'}</span>
              </div>
              {p.description && <p style={{ margin: '0 0 6px', fontSize: 11, color: theme.textMid }}>{p.description.slice(0, 120)}{p.description.length > 120 ? '...' : ''}</p>}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {!p.is_restricted && (
                  <button onClick={() => moderateProduct(p.id, { is_restricted: true })} style={btnDanger}>Restrict</button>
                )}
                {p.is_restricted && (
                  <button onClick={() => moderateProduct(p.id, { is_restricted: false })} style={btnSecondary}>Unrestrict</button>
                )}
                {p.status !== 'active' && p.status !== 'approved' && (
                  <button onClick={() => moderateProduct(p.id, { status: 'approved' })} style={btnPrimary}>Approve</button>
                )}
                {p.status !== 'rejected' && (
                  <button onClick={() => moderateProduct(p.id, { status: 'rejected' })} style={btnDanger}>Reject</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ShopReports({ showToast }) {
  const card = { border: `1px solid ${theme.border}`, borderRadius: theme.radius.lg, padding: 14, background: theme.cardBg, marginBottom: 10 }
  const btnPrimary = { padding: '8px 14px', background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: theme.radius.md, fontWeight: 700, fontSize: 12, cursor: 'pointer' }
  const btnSecondary = { padding: '8px 14px', background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, fontWeight: 700, fontSize: 12, cursor: 'pointer' }

  const [reports, setReports] = useState(null)
  const [loading, setLoading] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  async function loadReports() {
    setLoading(true)
    try {
      const token = localStorage.getItem('admin_token')
      const { data } = await callAdminAuth('get_shop_reports', { token, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined })
      setReports(data)
    } catch (e) {
      showToast(e.message || 'Failed to load reports', { type: 'error' })
    }
    setLoading(false)
  }

  function exportReport() {
    if (!reports) return
    const win = window.open('', '_blank', 'noopener,noreferrer')
    if (!win) return
    const rows = (reports.completed_orders || []).map(o => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${o.order_ref || o.id?.slice(0, 8) || '—'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${fmtDate(o.created_at)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${o.customer_name || '—'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${o.businesses?.name || '—'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${fmtMoney(o.total_kobo)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${fmtMoney(o.commission_kobo)}</td>
      </tr>
    `).join('')
    const productRows = (reports.top_products || []).map(p => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${p.product_name}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${p.total_qty}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${fmtMoney(p.total_revenue_kobo)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${p.order_count}</td>
      </tr>
    `).join('')
    const customerRows = (reports.top_customers || []).map(c => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${c.customer_name || c.customer_id?.slice(0, 8) || '—'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${c.total_orders}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;">${fmtMoney(c.total_spent_kobo)}</td>
      </tr>
    `).join('')
    win.document.write(`<!DOCTYPE html><html><head><title>Shop Reports</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a; }
      h1 { margin: 0 0 4px; font-size: 22px; color: #0a3d2e; }
      h2 { margin: 24px 0 10px; font-size: 16px; color: #0a3d2e; border-bottom: 2px solid #0d9488; padding-bottom: 4px; }
      .sub { color: #6b7280; font-size: 13px; margin-bottom: 24px; }
      .metrics { display: flex; gap: 16px; margin-bottom: 24px; }
      .metric { flex: 1; background: #f0fdf4; border: 1px solid #0d9488; border-radius: 12px; padding: 14px; text-align: center; }
      .val { font-size: 20px; font-weight: 800; color: #0a3d2e; }
      .lbl { font-size: 11px; color: #6b7280; margin-top: 2px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
      th { background: #0a3d2e; color: #fff; padding: 8px; text-align: left; font-size: 11px; }
      .footer { margin-top: 30px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; text-align: center; }
    </style></head><body>
    <h1>CareFind Shop Reports</h1>
    <p class="sub">Generated ${fmtDate(new Date().toISOString())}${dateFrom ? ` · From ${fmtDate(dateFrom)}` : ''}${dateTo ? ` · To ${fmtDate(dateTo)}` : ''}</p>
    <div class="metrics">
      <div class="metric"><div class="val">${reports.summary?.total_completed || 0}</div><div class="lbl">Completed Orders</div></div>
      <div class="metric"><div class="val">${fmtMoney(reports.summary?.total_revenue_kobo)}</div><div class="lbl">Total Revenue</div></div>
      <div class="metric"><div class="val">${fmtMoney(reports.summary?.total_commission_kobo)}</div><div class="lbl">Commission</div></div>
    </div>
    <h2>Completed Orders</h2>
    <table><thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Vendor</th><th>Amount</th><th>Commission</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" style="padding:16px;text-align:center;color:#9ca3af;">No completed orders</td></tr>'}</tbody></table>
    <h2>Top Products</h2>
    <table><thead><tr><th>Product</th><th>Qty Sold</th><th>Revenue</th><th>Orders</th></tr></thead>
    <tbody>${productRows || '<tr><td colspan="4" style="padding:16px;text-align:center;color:#9ca3af;">No product data</td></tr>'}</tbody></table>
    <h2>Top Customers</h2>
    <table><thead><tr><th>Customer</th><th>Orders</th><th>Total Spent</th></tr></thead>
    <tbody>${customerRows || '<tr><td colspan="3" style="padding:16px;text-align:center;color:#9ca3af;">No customer data</td></tr>'}</tbody></table>
    <div class="footer">CareFind Admin Dashboard · Confidential</div>
    <script>window.onload=function(){window.print()}</script>
    </body></html>`)
    win.document.close()
  }

  return (
    <div>
      <div style={card}>
        <p style={{ margin: '0 0 10px', fontWeight: 800, fontSize: 13, color: theme.navy }}>📈 Reports & History</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 3 }}>From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width: '100%', padding: 8, fontSize: 12, border: `1px solid ${theme.border}`, borderRadius: 8, boxSizing: 'border-box' }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 3 }}>To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ width: '100%', padding: 8, fontSize: 12, border: `1px solid ${theme.border}`, borderRadius: 8, boxSizing: 'border-box' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={loadReports} style={btnPrimary}>{loading ? 'Loading...' : 'Generate Report'}</button>
          {reports && <button onClick={exportReport} style={btnSecondary}>Export PDF</button>}
        </div>
      </div>

      {reports && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div style={{ ...card, textAlign: 'center', padding: 12 }}>
              <p style={{ margin: '0 0 2px', fontSize: 20, fontWeight: 900, color: theme.navy }}>{reports.summary?.total_completed || 0}</p>
              <p style={{ margin: 0, fontSize: 10, color: theme.textLight, fontWeight: 700 }}>Completed</p>
            </div>
            <div style={{ ...card, textAlign: 'center', padding: 12 }}>
              <p style={{ margin: '0 0 2px', fontSize: 20, fontWeight: 900, color: theme.tealDeep }}>{fmtMoney(reports.summary?.total_revenue_kobo)}</p>
              <p style={{ margin: 0, fontSize: 10, color: theme.textLight, fontWeight: 700 }}>Revenue</p>
            </div>
            <div style={{ ...card, textAlign: 'center', padding: 12 }}>
              <p style={{ margin: '0 0 2px', fontSize: 20, fontWeight: 900, color: theme.navy }}>{fmtMoney(reports.summary?.total_commission_kobo)}</p>
              <p style={{ margin: 0, fontSize: 10, color: theme.textLight, fontWeight: 700 }}>Commission</p>
            </div>
          </div>

          <div style={card}>
            <p style={{ margin: '0 0 8px', fontWeight: 800, fontSize: 13, color: theme.navy }}>Top Products</p>
            {(reports.top_products || []).length === 0 && <p style={{ fontSize: 12, color: theme.textLight }}>No product data.</p>}
            {(reports.top_products || []).slice(0, 10).map((p, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${theme.border}` }}>
                <div>
                  <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 12, color: theme.navy }}>{p.product_name}</p>
                  <p style={{ margin: 0, fontSize: 10, color: theme.textLight }}>{p.total_qty} sold · {p.order_count} orders</p>
                </div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 12, color: theme.tealDeep }}>{fmtMoney(p.total_revenue_kobo)}</p>
              </div>
            ))}
          </div>

          <div style={card}>
            <p style={{ margin: '0 0 8px', fontWeight: 800, fontSize: 13, color: theme.navy }}>Top Customers</p>
            {(reports.top_customers || []).length === 0 && <p style={{ fontSize: 12, color: theme.textLight }}>No customer data.</p>}
            {(reports.top_customers || []).slice(0, 10).map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${theme.border}` }}>
                <div>
                  <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 12, color: theme.navy }}>{c.customer_name || c.customer_id?.slice(0, 8) || '—'}</p>
                  <p style={{ margin: 0, fontSize: 10, color: theme.textLight }}>{c.total_orders} orders</p>
                </div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 12, color: theme.tealDeep }}>{fmtMoney(c.total_spent_kobo)}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ProductViews({ showToast }) {
  const card = { border: `1px solid ${theme.border}`, borderRadius: theme.radius.lg, padding: 14, background: theme.cardBg, marginBottom: 10 }

  const [views, setViews] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadViews() }, [])

  async function loadViews() {
    setLoading(true)
    try {
      const token = localStorage.getItem('admin_token')
      const { data } = await callAdminAuth('get_shop_product_views', { token })
      setViews(data || [])
    } catch (e) {
      showToast(e.message || 'Failed to load activity', { type: 'error' })
    }
    setLoading(false)
  }

  return (
    <div>
      <div style={card}>
        <p style={{ margin: '0 0 8px', fontWeight: 800, fontSize: 13, color: theme.navy }}>👁️ Product Activity</p>
        <p style={{ margin: '0 0 10px', fontSize: 11, color: theme.textMid }}>Most viewed products across CareFind Shop.</p>
      </div>

      {loading && <p style={{ color: theme.textLight, fontSize: 13 }}>Loading product views...</p>}

      {!loading && views.length === 0 && (
        <p style={{ color: theme.textLight, fontSize: 13, textAlign: 'center', padding: 20 }}>No product view data yet.</p>
      )}

      {views.map((p, i) => (
        <div key={p.product_id || i} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 13, color: theme.navy }}>{p.product_name}</p>
              <p style={{ margin: '0 0 2px', fontSize: 11, color: theme.textLight }}>Vendor: {p.vendor_name}</p>
              <p style={{ margin: 0, fontSize: 10, color: theme.textLight }}>Latest view: {fmtDate(p.latest_view)}</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: '0 0 2px', fontWeight: 800, fontSize: 16, color: theme.tealDeep }}>{p.view_count}</p>
              <p style={{ margin: 0, fontSize: 10, color: theme.textLight }}>views</p>
              <p style={{ margin: '2px 0 0', fontSize: 10, color: theme.textLight }}>{p.unique_users} users</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function AdminShop({ showToast }) {
  const [shopTab, setShopTab] = useState('overview')
  const [overview, setOverview] = useState(null)
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [orders, setOrders] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersHasMore, setOrdersHasMore] = useState(false)
  const [ordersOffset, setOrdersOffset] = useState(0)
  const [selectedOrderId, setSelectedOrderId] = useState(null)

  const LIMIT = 20

  const shopTabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'orders', label: 'Orders' },
    { key: 'fulfilment', label: 'Fulfilment' },
    { key: 'customers', label: 'Customers' },
    { key: 'vendors', label: 'Vendors' },
    { key: 'reports', label: 'Reports' },
    { key: 'activity', label: 'Activity' },
  ]

  useEffect(() => { loadOverview() }, [])

  async function loadOverview() {
    setOverviewLoading(true)
    try {
      const token = localStorage.getItem('admin_token')
      const { data } = await callAdminAuth('get_admin_shop_overview', { token })
      setOverview(data)
    } catch { /* silent */ }
    setOverviewLoading(false)
  }

  async function loadOrders(reset = false) {
    setOrdersLoading(true)
    const offset = reset ? 0 : ordersOffset
    try {
      const token = localStorage.getItem('admin_token')
      const { data } = await callAdminAuth('list_shop_orders_filtered', { token, limit: LIMIT })
      const list = data || []
      if (reset) {
        setOrders(list)
      } else {
        setOrders(prev => [...prev, ...list])
      }
      setOrdersHasMore(list.length >= LIMIT)
      setOrdersOffset(offset + list.length)
    } catch { /* silent */ }
    setOrdersLoading(false)
  }

  useEffect(() => {
    if (shopTab === 'orders' && orders.length === 0 && !ordersLoading) {
      loadOrders(true)
    }
  }, [shopTab])

  if (selectedOrderId && shopTab === 'orders') {
    return (
      <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 480, margin: '0 auto', paddingBottom: 40 }}>
        <OrderDetail orderId={selectedOrderId} onBack={() => setSelectedOrderId(null)} showToast={showToast} />
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }}>
        {shopTabs.map(t => (
          <button key={t.key} onClick={() => setShopTab(t.key)} style={{
            flexShrink: 0, padding: '7px 14px', borderRadius: theme.radius.full, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
            border: shopTab === t.key ? 'none' : `1px solid ${theme.border}`,
            background: shopTab === t.key ? theme.tealGradient : theme.cardBg,
            color: shopTab === t.key ? '#fff' : theme.textMid,
            cursor: 'pointer',
            transition: `all ${theme.motion.fast}`,
          }}>{t.label}</button>
        ))}
      </div>

      {shopTab === 'overview' && <ShopOverview overview={overview} loading={overviewLoading} />}
      {shopTab === 'orders' && (
        <OrdersList
          orders={orders}
          loading={ordersLoading}
          onOpenOrder={id => setSelectedOrderId(id)}
          onLoadMore={() => loadOrders(false)}
          hasMore={ordersHasMore}
        />
      )}
      {shopTab === 'fulfilment' && <FulfilmentView showToast={showToast} />}
      {shopTab === 'customers' && <CustomersList showToast={showToast} />}
      {shopTab === 'vendors' && <VendorsView showToast={showToast} />}
      {shopTab === 'reports' && <ShopReports showToast={showToast} />}
      {shopTab === 'activity' && <ProductViews showToast={showToast} />}
    </div>
  )
}
