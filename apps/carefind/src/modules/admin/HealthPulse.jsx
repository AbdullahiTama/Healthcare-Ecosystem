import { useCallback, useEffect, useState } from 'react'
import { DollarSign, Clock, Radio, AlertTriangle, RefreshCw } from 'lucide-react'
import { theme } from '../../styles/theme'
import { dashboardRepository } from './repositories'
import { useRealtimeChannel } from './hooks/useRealtimeChannel'

const PULSE_INTERVAL = 30000

export default function HealthPulse({ onNavigate }) {
  const [pulse, setPulse] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)

  const fetchPulse = useCallback(async () => {
    try {
      const data = await dashboardRepository.getHealthPulse()
      setPulse(data)
      setLastUpdated(new Date())
    } catch {
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPulse()
  }, [fetchPulse])

  useRealtimeChannel({
    channelName: 'health-pulse-realtime',
    subscription: { schema: 'public', table: 'transactions' },
    onUpdate: fetchPulse,
    onInsert: fetchPulse,
    pollInterval: PULSE_INTERVAL,
    pollFn: fetchPulse,
    pollAlways: true,
  })

  if (loading && !pulse) return null

  const items = [
    {
      icon: DollarSign,
      label: 'Revenue Today',
      value: `₦${(pulse?.revenueToday || 0).toLocaleString()}`,
      color: theme.success || 'var(--color-success)',
      tab: 'revenue',
    },
    {
      icon: Clock,
      label: 'Pending Items',
      value: pulse?.pendingItems || 0,
      color: (pulse?.pendingItems || 0) > 5 ? 'var(--color-warning)' : theme.textMid,
      tab: 'notifications',
      alert: (pulse?.pendingItems || 0) > 10,
    },
    {
      icon: Radio,
      label: 'Active Lives',
      value: pulse?.activeLives || 0,
      color: (pulse?.activeLives || 0) > 0 ? 'var(--color-purple)' : theme.textMid,
      tab: 'golive',
    },
    {
      icon: AlertTriangle,
      label: 'Open Disputes',
      value: pulse?.openDisputes || 0,
      color: (pulse?.openDisputes || 0) > 0 ? 'var(--color-danger)' : theme.textMid,
      tab: 'reports',
      alert: (pulse?.openDisputes || 0) > 3,
    },
  ]

  return (
    <div style={{
      background: theme.cardBg,
      border: `1px solid ${theme.border}`,
      borderRadius: theme.radius.lg,
      padding: '12px 16px',
      marginBottom: theme.space[4],
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          color: theme.textLight,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          Platform Pulse
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastUpdated && (
            <span style={{ fontSize: 10, color: theme.textLight }}>
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchPulse}
            style={{
              background: 'none',
              border: 'none',
              padding: 2,
              cursor: 'pointer',
              color: theme.textLight,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 12,
      }}>
        {items.map(item => {
          const Icon = item.icon
          return (
            <button
              key={item.label}
              onClick={() => onNavigate(item.tab)}
              style={{
                background: 'none',
                border: `1px solid ${item.alert ? item.color + '40' : theme.border}`,
                borderRadius: theme.radius.md,
                padding: '10px 12px',
                cursor: 'pointer',
                textAlign: 'left',
                position: 'relative',
                transition: 'border-color 0.15s',
                fontFamily: theme.fontFamily,
              }}
            >
              {item.alert && (
                <div style={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: item.color,
                }} />
              )}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 4,
              }}>
                <Icon size={13} color={item.color} />
                <span style={{
                  fontSize: 10,
                  color: theme.textLight,
                  fontWeight: 500,
                }}>
                  {item.label}
                </span>
              </div>
              <div style={{
                fontSize: 18,
                fontWeight: 700,
                color: theme.textDark,
              }}>
                {item.value}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
