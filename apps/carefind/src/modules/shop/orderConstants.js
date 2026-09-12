// Shared order status configuration for consistent display across OrderList and OrderDetail

import { Clock, CheckCircle, Package, Truck, MapPin, XCircle, AlertTriangle, RotateCcw } from 'lucide-react'
import { theme } from '../../styles/theme'

export const STATUS_CONFIG = {
  pending_payment: { label: 'Pending Payment', icon: Clock, color: theme.warning, step: 0 },
  delivery_quote_pending: { label: 'Quote Pending', icon: Truck, color: theme.warning, step: 1 },
  paid: { label: 'Paid', icon: CheckCircle, color: theme.success, step: 2 },
  accepted: { label: 'Accepted', icon: CheckCircle, color: theme.success, step: 3 },
  processing: { label: 'Processing', icon: Package, color: theme.tealDeep, step: 4 },
  packed: { label: 'Packed', icon: Package, color: theme.tealDeep, step: 5 },
  at_pickup_station: { label: 'At Pickup Station', icon: MapPin, color: '#8b5cf6', step: 6 },
  ready_for_pickup: { label: 'Ready for Pickup', icon: MapPin, color: theme.tealDeep, step: 7 },
  in_transit: { label: 'In Transit', icon: Truck, color: theme.tealDeep, step: 8 },
  delivered: { label: 'Delivered', icon: CheckCircle, color: theme.success, step: 9 },
  cancelled: { label: 'Cancelled', icon: XCircle, color: theme.danger, step: -1 },
  refund_requested: { label: 'Refund Requested', icon: RotateCcw, color: theme.warning, step: -2 },
  refunded: { label: 'Refunded', icon: RotateCcw, color: theme.textMid, step: -3 },
  disputed: { label: 'Disputed', icon: AlertTriangle, color: theme.danger, step: -4 }
}

export const CUSTOMER_STATUSES = [
  { key: '', label: 'All' },
  { key: 'pending_payment', label: 'Pending Payment' },
  { key: 'paid', label: 'Paid' },
  { key: 'processing', label: 'Processing' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' }
]

export const TRACKING_STEPS = [
  { key: 'paid', label: 'Order Placed' },
  { key: 'accepted', label: 'Confirmed' },
  { key: 'processing', label: 'Preparing' },
  { key: 'packed', label: 'Packed' },
  { key: 'at_pickup_station', label: 'At Station' },
  { key: 'ready_for_pickup', label: 'Ready' },
  { key: 'in_transit', label: 'On the Way' },
  { key: 'delivered', label: 'Delivered' }
]

export function getEstimatedDelivery(order) {
  if (!order || order.status === 'delivered' || order.status === 'cancelled') return null
  if (order.delivery_preference === 'pickup') {
    if (order.status === 'ready_for_pickup') return 'Ready for pickup now'
    if (order.status === 'at_pickup_station') return 'At pickup station'
    if (['paid', 'accepted', 'processing', 'packed'].includes(order.status)) {
      const created = new Date(order.created_at)
      const ready = new Date(created.getTime() + 24 * 60 * 60 * 1000)
      return `Ready by ${ready.toLocaleDateString('en-NG', { weekday: 'short', month: 'short', day: 'numeric' })}`
    }
  } else {
    if (order.status === 'in_transit') return 'Arriving today'
    if (['paid', 'accepted', 'processing', 'packed'].includes(order.status)) {
      const created = new Date(order.created_at)
      const delivery = new Date(created.getTime() + 3 * 24 * 60 * 60 * 1000)
      return `Est. ${delivery.toLocaleDateString('en-NG', { weekday: 'short', month: 'short', day: 'numeric' })}`
    }
  }
  return null
}
