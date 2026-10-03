import { useEffect, useState } from 'react'
import { Radio, X } from 'lucide-react'
import { theme } from '../styles/theme'
import { Link } from 'react-router-dom'

export function LiveReminder({ show, onDismiss }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!show || show.status !== 'scheduled' || !show.scheduled_at) return

    const target = new Date(show.scheduled_at)
    const now = new Date()
    const diff = target - now

    // Show reminder 5 minutes before
    const reminderTime = 5 * 60 * 1000
    if (diff > 0 && diff <= reminderTime) {
      const dismissed = localStorage.getItem(`live_reminder_dismissed_${show.id}`)
      if (!dismissed) {
        setVisible(true)
      }
    }
  }, [show])

  function handleDismiss() {
    setVisible(false)
    localStorage.setItem(`live_reminder_dismissed_${show.id}`, 'true')
    onDismiss?.()
  }

  if (!visible) return null

  return (
    <div style={{
      position: 'fixed',
      top: 16,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 1000,
      maxWidth: 400,
      width: 'calc(100% - 32px)',
      background: theme.cardBg,
      borderRadius: theme.radius.lg,
      boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
      border: `1px solid ${theme.border}`,
      overflow: 'hidden',
    }}>
      <div style={{
        background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <Radio size={16} color="#fff" style={{ animation: 'pulse 1.5s infinite' }} />
        <span style={{
          color: '#fff',
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: '0.05em',
        }}>
          STARTING SOON
        </span>
        <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>
      </div>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h4 style={{
              margin: '0 0 4px 0',
              fontSize: 14,
              fontWeight: 800,
              color: theme.navy,
            }}>
              {show.title}
            </h4>
            <p style={{
              margin: 0,
              fontSize: 12,
              color: theme.textMid,
            }}>
              Starting in a few minutes
            </p>
          </div>
          <button
            onClick={handleDismiss}
            aria-label="Dismiss reminder"
            style={{
              background: 'none',
              border: 'none',
              padding: 4,
              cursor: 'pointer',
              color: theme.textLight,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>
        <Link
          to={`/live/${show.id}`}
          onClick={handleDismiss}
          style={{
            display: 'block',
            marginTop: 12,
            padding: '10px 16px',
            background: theme.tealDeep,
            color: '#fff',
            borderRadius: theme.radius.md,
            textAlign: 'center',
            fontSize: 13,
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          Join Now
        </Link>
      </div>
    </div>
  )
}

export default LiveReminder
