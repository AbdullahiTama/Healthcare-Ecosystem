// The order's fulfilment steps as a vertical list, for phones. Eight steps side by side do not fit a phone's width (their
// labels ran into each other and the row overflowed), so both order trackers switch to this below the mobile breakpoint.

import { Check } from 'lucide-react'
import { theme } from '../../styles/theme'
import { TRACKING_STEPS } from './orderConstants'

export default function OrderStepsVertical({ order, showDates = false }) {
  const currentStepIndex = TRACKING_STEPS.findIndex(s => s.key === order.status)
  const history = order.order_status_history || order.shop_order_status_history || []

  return (
    <ol aria-label="Order progress" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {TRACKING_STEPS.map((step, idx) => {
        const isCompleted = currentStepIndex >= idx || order.status === 'delivered'
        const isCurrent = step.key === order.status
        const isLast = idx === TRACKING_STEPS.length - 1
        const stepEvent = showDates ? history.find(h => h.to_status === step.key) : null
        return (
          <li key={step.key} aria-current={isCurrent ? 'step' : undefined} style={{ display: 'flex', gap: 12, minHeight: isLast ? 0 : 36 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
              <div style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: isCompleted ? theme.tealDeep : '#fff',
                border: `2px solid ${isCompleted ? theme.tealDeep : theme.gray300}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: isCurrent ? `0 0 0 4px ${theme.tealDeep}20` : 'none',
              }}>
                {isCompleted && <Check size={12} color="#fff" strokeWidth={3} aria-hidden="true" />}
              </div>
              {!isLast && (
                <div style={{ flex: 1, width: 2, minHeight: 12, background: currentStepIndex > idx || order.status === 'delivered' ? theme.tealDeep : theme.gray200 }} />
              )}
            </div>
            <div style={{ paddingTop: 2, paddingBottom: isLast ? 0 : 10, minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: isCurrent ? 700 : 500, color: isCompleted ? theme.tealDeep : theme.textMid }}>
                {step.label}
              </span>
              {isCompleted && stepEvent && (
                <span style={{ marginLeft: 8, fontSize: 12, color: theme.textLight }}>
                  {new Date(stepEvent.created_at).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                </span>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
