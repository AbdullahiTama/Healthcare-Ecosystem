// Order list page - displays orders for customers with search, status tabs, and load more

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { orderRepository } from './orderRepository'
import { useAuth } from '../../providers/AuthContext'
import { theme } from '../../styles/theme'
import { Card, Empty, Loading, Button, Input } from '../../components/ui'
import { Package, Search, Filter, ChevronRight, RotateCcw, ArrowLeft } from 'lucide-react'
import AppShell from '../../components/layout/AppShell.jsx'
import BottomNav from '../../components/BottomNav.jsx'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { STATUS_CONFIG, CUSTOMER_STATUSES, getEstimatedDelivery } from './orderConstants'
import { useCart } from './CartProvider'

const PAGE_SIZE = 20
// A shared empty list for "no data yet": a fresh [] on every render made the effect below store a new array on every render,
// so the page re-rendered without pause while the orders were loading.
const NO_ORDERS = []

// My Orders sits in the site shell like the other signed-in pages (on a phone: the content and the bottom navigation), so the
// shopper always has a way out; it rendered bare before, with no back link and no navigation.
export default function OrderList() {
  const { user } = useAuth()
  const { isMobile } = useBreakpoint()
  if (isMobile) {
    return (
      <>
        <OrderListContent isMobile />
        <BottomNav />
      </>
    )
  }
  return (
    <AppShell user={user}>
      <OrderListContent />
    </AppShell>
  )
}

function OrderListContent({ isMobile = false }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { addItem } = useCart()

  // Back to wherever the shopper came from; opened directly (a link, a refresh), there is no in-app history, so go to the shop
  function goBack() {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1)
    else navigate('/search?tab=shop')
  }

  const [orders, setOrders] = useState([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [hasMore, setHasMore] = useState(true)

  const { data: initialOrders = NO_ORDERS, isLoading: loading, refetch } = useQuery({
    queryKey: ['customer-orders', user?.id, statusFilter],
    queryFn: () => orderRepository.getByCustomer(user.id, { status: statusFilter || undefined, limit: PAGE_SIZE, offset: 0 }),
    enabled: !!user?.id,
    staleTime: 30 * 1000,
  })

  useEffect(() => {
    setOrders(initialOrders)
    setHasMore(initialOrders.length === PAGE_SIZE)
  }, [initialOrders])

  async function loadOrders(reset = false) {
    const offset = reset ? 0 : orders.length
    if (!reset) setLoadingMore(true)
    setError('')
    try {
      const data = await orderRepository.getByCustomer(user.id, {
        status: statusFilter || undefined,
        limit: PAGE_SIZE,
        offset
      })
      if (reset) {
        setOrders(data || [])
        refetch()
      } else {
        setOrders(prev => [...prev, ...(data || [])])
      }
      setHasMore((data || []).length === PAGE_SIZE)
    } catch (err) {
      console.error('Failed to load orders:', err)
      setError(err.message || 'Failed to load orders')
    } finally {
      setLoadingMore(false)
    }
  }

  const filteredOrders = useMemo(() => {
    if (!search.trim()) return orders
    const q = search.toLowerCase().trim()
    return orders.filter(o =>
      (o.order_ref || '').toLowerCase().includes(q) ||
      (o.order_items || []).some(i => (i.product_name || '').toLowerCase().includes(q)) ||
      new Date(o.created_at).toLocaleDateString().toLowerCase().includes(q)
    )
  }, [orders, search])

  const statusCounts = useMemo(() => {
    const counts = { '': orders.length }
    orders.forEach(o => { counts[o.status] = (counts[o.status] || 0) + 1 })
    return counts
  }, [orders])

  function handleReorder(order, e) {
    e.stopPropagation()
    let added = 0
    ;(order.order_items || []).forEach(item => {
      if (item.ecommerce_product_id) {
        addItem({
          ecommerce_product_id: item.ecommerce_product_id,
          product_name: item.product_name,
          unit_price_kobo: item.unit_price_kobo,
          quantity: item.quantity
        })
        added++
      }
    })
    if (added > 0) {
      navigate('/cart')
    }
  }

  if (loading) {
    return <Loading />
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: isMobile ? '12px 16px calc(90px + env(safe-area-inset-bottom))' : '24px 16px' }}>
      <button
        type="button"
        onClick={goBack}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, padding: 0, marginBottom: isMobile ? 4 : 12, background: 'none', border: 'none', color: theme.tealDeep, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Back
      </button>
      <h1 style={{ fontSize: isMobile ? 22 : 24, fontWeight: 700, marginBottom: isMobile ? 16 : 24, color: theme.navy }}>
        My Orders
      </h1>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: theme.textMid }} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by order ref, product, or date..."
          style={{
            width: '100%',
            padding: '12px 12px 12px 36px',
            borderRadius: 10,
            border: `1px solid ${theme.border}`,
            fontSize: 14,
            boxSizing: 'border-box'
          }}
        />
      </div>

      {/* Status Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, overflowX: 'auto', paddingBottom: 4 }}>
        {CUSTOMER_STATUSES.map(s => {
          const count = statusCounts[s.key] || 0
          const isActive = statusFilter === s.key
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => setStatusFilter(s.key)}
              style={{
                minHeight: isMobile ? 44 : undefined,
                padding: '8px 16px',
                borderRadius: 20,
                border: `1px solid ${isActive ? theme.tealDeep : theme.border}`,
                background: isActive ? theme.tealDeep : '#fff',
                color: isActive ? '#fff' : theme.textMid,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              {s.label}
              {count > 0 && (
                <span style={{
                  background: isActive ? 'rgba(255,255,255,0.2)' : theme.gray200,
                  padding: '2px 6px',
                  borderRadius: 10,
                  fontSize: 11,
                  fontWeight: 700
                }}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {error && (
        <div style={{
          padding: 16,
          borderRadius: 8,
          background: theme.dangerBg,
          border: `1px solid ${theme.danger}`,
          color: theme.danger,
          fontSize: 14,
          marginBottom: 16
        }}>
          {error}
        </div>
      )}

      {filteredOrders.length === 0 ? (
        <Empty
          icon={<Package size={48} />}
          title={search ? 'No orders match your search' : statusFilter ? `No ${CUSTOMER_STATUSES.find(s => s.key === statusFilter)?.label || ''} orders` : 'No orders yet'}
          description={search ? 'Try a different search term' : statusFilter ? 'Try a different status filter' : 'Your order history will appear here'}
          action={search || statusFilter ? 'Clear Filters' : 'Browse Shop'}
          onAction={() => {
            if (search || statusFilter) {
              setSearch('')
              setStatusFilter('')
            } else {
              navigate('/search?tab=shop')
            }
          }}
        />
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filteredOrders.map(order => {
              const statusConfig = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending_payment
              const StatusIcon = statusConfig.icon
              const estimatedDelivery = getEstimatedDelivery(order)
              const canReorder = order.status === 'delivered'

              return (
                <Card
                  key={order.id}
                  style={{ padding: 16, cursor: 'pointer', transition: 'box-shadow 0.2s', position: 'relative' }}
                  onClick={() => navigate(`/orders/${order.id}`)}
                  hoverable
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: theme.navy }}>
                          #{order.order_ref || order.id.slice(0, 8).toUpperCase()}
                        </span>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '3px 8px',
                          borderRadius: 12,
                          background: statusConfig.color + '15',
                          color: statusConfig.color,
                          fontSize: 11,
                          fontWeight: 600
                        }}>
                          <StatusIcon size={12} />
                          {statusConfig.label}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: theme.textMid }}>
                        {new Date(order.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {estimatedDelivery && (
                          <span style={{ marginLeft: 8, color: theme.tealDeep, fontWeight: 600 }}>
                            {estimatedDelivery}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: theme.tealDeep }}>
                        ₦{(order.total_kobo / 100).toLocaleString()}
                      </div>
                      <div style={{ fontSize: 11, color: theme.textMid }}>
                        {order.order_items.length} {order.order_items.length === 1 ? 'item' : 'items'}
                      </div>
                    </div>
                  </div>

                  {/* Items preview */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ display: 'flex', gap: 4, flex: 1, overflow: 'hidden' }}>
                      {order.order_items.slice(0, 3).map((item, idx) => (
                        <div key={item.id || idx} style={{
                          padding: '4px 8px',
                          borderRadius: 6,
                          background: theme.gray100,
                          fontSize: 11,
                          color: theme.textMid,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: 120
                        }}>
                          {item.product_name}
                        </div>
                      ))}
                      {order.order_items.length > 3 && (
                        <span style={{ fontSize: 11, color: theme.textMid, whiteSpace: 'nowrap' }}>
                          +{order.order_items.length - 3} more
                        </span>
                      )}
                    </div>
                    {canReorder && (
                      <button
                        type="button"
                        onClick={(e) => handleReorder(order, e)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          minHeight: isMobile ? 44 : undefined,
                          padding: '6px 10px',
                          borderRadius: 6,
                          border: `1px solid ${theme.tealDeep}`,
                          background: 'transparent',
                          color: theme.tealDeep,
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        <RotateCcw size={12} />
                        Reorder
                      </button>
                    )}
                  </div>

                  {/* Delivery method */}
                  <div style={{ fontSize: 11, color: theme.textLight, borderTop: `1px solid ${theme.border}`, paddingTop: 8 }}>
                    {order.delivery_preference === 'pickup' ? 'Pickup' : 'Home Delivery'}
                    {order.delivery_city && ` • ${order.delivery_city}`}
                  </div>
                </Card>
              )
            })}
          </div>

          {/* Load More */}
          {hasMore && !search && (
            <div style={{ textAlign: 'center', marginTop: 24 }}>
              <Button
                variant="secondary"
                onClick={() => loadOrders(false)}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading...' : 'Load More Orders'}
              </Button>
            </div>
          )}

          {/* Summary */}
          {!search && (
            <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: theme.textLight }}>
              Showing {filteredOrders.length} of {orders.length} orders
              {!hasMore && orders.length > PAGE_SIZE && ' (all loaded)'}
            </div>
          )}
        </>
      )}
    </div>
  )
}
