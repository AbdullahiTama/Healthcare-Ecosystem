// Order list page - displays orders for customers and vendors with status filtering

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { orderRepository } from './orderRepository'
import { useAuth } from '../../providers/AuthContext'
import { theme } from '../../styles/theme'
import { Card, Empty, Loading, Button } from '../../components/ui'
import { Package, Clock, CheckCircle, Truck, MapPin, Filter } from 'lucide-react'

const STATUS_CONFIG = {
  pending_payment: { label: 'Pending Payment', icon: Clock, color: theme.warning },
  paid: { label: 'Paid', icon: CheckCircle, color: theme.success },
  accepted: { label: 'Accepted', icon: CheckCircle, color: theme.success },
  processing: { label: 'Processing', icon: Package, color: theme.tealDeep },
  ready_for_pickup: { label: 'Ready for Pickup', icon: MapPin, color: theme.tealDeep },
  delivered: { label: 'Delivered', icon: CheckCircle, color: theme.success },
  cancelled: { label: 'Cancelled', icon: Clock, color: theme.danger }
}

export default function OrderList() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [viewMode, setViewMode] = useState('customer') // 'customer' or 'vendor'

  useEffect(() => {
    loadOrders()
  }, [viewMode, statusFilter])

  async function loadOrders() {
    setLoading(true)
    setError('')
    try {
      let data
      if (viewMode === 'customer') {
        data = await orderRepository.getByCustomer(user.id, { status: statusFilter || undefined })
      } else {
        // TODO: Get vendor ID from user's business
        // For now, this is a placeholder
        data = []
      }
      setOrders(data || [])
    } catch (err) {
      console.error('Failed to load orders:', err)
      setError(err.message || 'Failed to load orders')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <Loading />
  }

  const statuses = Object.keys(STATUS_CONFIG)

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24, color: theme.navy }}>
        My Orders
      </h1>

      {/* View Mode Toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Button
          onClick={() => setViewMode('customer')}
          variant={viewMode === 'customer' ? 'primary' : 'secondary'}
          size="sm"
        >
          Customer Orders
        </Button>
        <Button
          onClick={() => setViewMode('vendor')}
          variant={viewMode === 'vendor' ? 'primary' : 'secondary'}
          size="sm"
        >
          Vendor Orders
        </Button>
      </div>

      {/* Status Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        <Filter size={16} style={{ color: theme.textMid }} />
        <Button
          onClick={() => setStatusFilter('')}
          variant={!statusFilter ? 'primary' : 'secondary'}
          size="sm"
        >
          All
        </Button>
        {statuses.map(status => {
          const config = STATUS_CONFIG[status]
          return (
            <Button
              key={status}
              onClick={() => setStatusFilter(status)}
              variant={statusFilter === status ? 'primary' : 'secondary'}
              size="sm"
              style={statusFilter === status ? { background: config.color, borderColor: config.color } : {}}
            >
              {config.label}
            </Button>
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

      {orders.length === 0 ? (
        <Empty
          icon={<Package size={48} />}
          title="No orders found"
          description={statusFilter ? 'No orders match this filter' : 'You have not placed any orders yet'}
          action="Browse Shop"
          onAction={() => navigate('/search?tab=shop')}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {orders.map(order => {
            const statusConfig = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending_payment
            const StatusIcon = statusConfig.icon

            return (
              <Card
                key={order.id}
                style={{ padding: 16, cursor: 'pointer', transition: 'box-shadow 0.2s' }}
                onClick={() => navigate(`/orders/${order.id}`)}
                hoverable
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: theme.navy, marginBottom: 4 }}>
                      Order #{order.id.slice(0, 8).toUpperCase()}
                    </div>
                    <div style={{ fontSize: 12, color: theme.textMid }}>
                      {new Date(order.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
                    borderRadius: 16,
                    background: statusConfig.color + '20',
                    color: statusConfig.color,
                    fontSize: 12,
                    fontWeight: 600
                  }}>
                    <StatusIcon size={14} />
                    {statusConfig.label}
                  </div>
                </div>

                {/* Order Items Preview */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, overflowX: 'auto', paddingBottom: 8 }}>
                  {order.order_items.slice(0, 3).map(item => (
                    <div key={item.id} style={{
                      minWidth: 60,
                      height: 60,
                      borderRadius: 8,
                      background: theme.gray200,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      color: theme.textMid,
                      padding: 4,
                      textAlign: 'center'
                    }}>
                      {item.product_name.slice(0, 20)}
                    </div>
                  ))}
                  {order.order_items.length > 3 && (
                    <div style={{
                      minWidth: 60,
                      height: 60,
                      borderRadius: 8,
                      background: theme.tealDeep + '10',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 600,
                      color: theme.tealDeep
                    }}>
                      +{order.order_items.length - 3}
                    </div>
                  )}
                </div>

                {/* Order Summary */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTop: `1px solid ${theme.border}` }}>
                  <div style={{ fontSize: 12, color: theme.textMid }}>
                    {order.order_items.length} {order.order_items.length === 1 ? 'item' : 'items'} • {order.delivery_preference === 'pickup' ? 'Pickup' : 'Delivery'}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: theme.tealDeep }}>
                    ₦{(order.total_kobo / 100).toLocaleString()}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
