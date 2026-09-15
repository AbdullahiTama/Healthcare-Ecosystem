import {
  Bell, Shield, Building2, AlertTriangle, DollarSign, ClipboardList, Newspaper, CalendarClock, ChevronRight,
} from 'lucide-react'
import { theme } from '../../../styles/theme'
import { Card, Empty } from '@care-ecosystem/design-system/components/ui'
import { AdminPageHeader } from '../ui'

const SEVERITY_STYLES = {
  urgent: { bg: theme.dangerBg, color: theme.danger, border: theme.danger },
  warning: { bg: theme.amberBg, color: theme.amberText, border: '#f59e0b' },
  info: { bg: theme.tealMist, color: theme.tealDeep, border: theme.tealDeep },
}

const ICON_MAP = {
  verification: Shield,
  claim: Building2,
  report: AlertTriangle,
  withdrawal: DollarSign,
  task: ClipboardList,
  consultation: CalendarClock,
  news: Newspaper,
}

function timeAgo(d) {
  if (!d) return 'Never'
  const diff = Math.floor((Date.now() - new Date(d)) / 1000)
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function NotificationsTab({ notifications, setTab }) {
  return (
    <div>
      <AdminPageHeader
        title="Notifications"
        subtitle="All pending items requiring your attention"
      />

      {notifications.length === 0 ? (
        <Empty
          icon={<Bell size={40} strokeWidth={1.5} color={theme.gray300} />}
          message="All clear — no pending issues"
          cause="positive"
        />
      ) : (
        notifications.map((n, i) => {
          const severityStyle = SEVERITY_STYLES[n.severity] || SEVERITY_STYLES.info
          const IconComponent = ICON_MAP[n.type] || Bell

          return (
            <Card
              key={i}
              onClick={() => setTab(n.tab)}
              style={{
                padding: theme.space[5],
                marginBottom: theme.space[4],
                borderLeft: `4px solid ${severityStyle.border}`,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', gap: theme.space[4], alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: theme.radius.sm,
                    background: severityStyle.bg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <IconComponent size={18} color={severityStyle.color} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: theme.type.body.size, color: theme.textDark, marginBottom: theme.space[1] }}>
                    {n.title}
                  </div>
                  {n.subtitle && (
                    <div style={{ fontSize: theme.type.bodySm.size, color: theme.textMid, marginBottom: theme.space[2] }}>
                      {n.subtitle}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: theme.space[3], alignItems: 'center' }}>
                    <span style={{ fontSize: theme.type.caption.size, color: theme.textLight }}>
                      {timeAgo(n.time)}
                    </span>
                    <span
                      style={{
                        fontSize: theme.type.micro.size,
                        fontWeight: 800,
                        padding: `${theme.space[1]} ${theme.space[3]}`,
                        borderRadius: theme.radius.full,
                        background: severityStyle.bg,
                        color: severityStyle.color,
                        textTransform: 'uppercase',
                      }}
                    >
                      {n.severity}
                    </span>
                  </div>
                </div>
                <ChevronRight size={16} color={theme.textLight} style={{ flexShrink: 0, marginTop: theme.space[2] }} />
              </div>
            </Card>
          )
        })
      )}
    </div>
  )
}
