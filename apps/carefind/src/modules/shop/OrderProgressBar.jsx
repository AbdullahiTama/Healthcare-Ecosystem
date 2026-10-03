import { theme } from '../../styles/theme'
import { CheckCircle, Package, Truck, MapPin, Check } from 'lucide-react'
import { STATUS_CONFIG, TRACKING_STEPS } from './orderConstants'

export default function OrderProgressBar({ order }) {
  if (!order || ['cancelled', 'pending_payment', 'disputed'].includes(order.status)) {
    return null
  }

  const currentStepIndex = TRACKING_STEPS.findIndex(s => s.key === order.status)
  const progress = currentStepIndex >= 0 
    ? ((currentStepIndex + 1) / TRACKING_STEPS.length) * 100 
    : order.status === 'delivered' ? 100 : 0

  const statusConfig = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending_payment

  return (
    <div style={{
      padding: 20,
      borderRadius: theme.radius.lg,
      background: theme.cardBg,
      border: `1px solid ${theme.border}`,
    }}>
      {/* Progress Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <div style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: statusConfig.color + '20',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <statusConfig.icon size={16} color={statusConfig.color} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: theme.navy }}>
              {statusConfig.emoji} {statusConfig.label}
            </div>
            <div style={{ fontSize: 12, color: theme.textMid }}>
              {statusConfig.message}
            </div>
          </div>
        </div>
        <div style={{
          fontSize: 20,
          fontWeight: 800,
          color: theme.tealDeep,
        }}>
          {Math.round(progress)}%
        </div>
      </div>

      {/* Progress Bar */}
      <div style={{
        height: 8,
        borderRadius: 4,
        background: theme.gray200,
        overflow: 'hidden',
        marginBottom: 16,
      }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          borderRadius: 4,
          background: `linear-gradient(90deg, ${theme.tealDeep}, ${theme.success})`,
          transition: 'width 0.5s ease-out',
        }} />
      </div>

      {/* Step Indicators */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        position: 'relative',
      }}>
        {/* Connecting line */}
        <div style={{
          position: 'absolute',
          top: 10,
          left: 16,
          right: 16,
          height: 2,
          background: theme.gray200,
          zIndex: 0,
        }} />
        <div style={{
          position: 'absolute',
          top: 10,
          left: 16,
          width: `${Math.max(0, (progress / 100) * (100 - 4))}%`,
          height: 2,
          background: theme.tealDeep,
          zIndex: 1,
          transition: 'width 0.5s ease-out',
        }} />

        {TRACKING_STEPS.map((step, idx) => {
          const isCompleted = currentStepIndex >= idx || order.status === 'delivered'
          const isCurrent = step.key === order.status
          const StepIcon = isCompleted ? Check : (STATUS_CONFIG[step.key]?.icon || Package)

          return (
            <div
              key={step.key}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                zIndex: 2,
                flex: 1,
              }}
            >
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
                transition: 'all 0.3s ease',
              }}>
                {isCompleted ? (
                  <Check size={12} color="#fff" strokeWidth={3} />
                ) : (
                  <StepIcon size={10} color={theme.gray400} />
                )}
              </div>
              <div style={{
                fontSize: 10,
                fontWeight: isCurrent ? 700 : 500,
                color: isCompleted ? theme.tealDeep : theme.textMid,
                textAlign: 'center',
                maxWidth: 60,
                lineHeight: 1.2,
              }}>
                {step.label}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
