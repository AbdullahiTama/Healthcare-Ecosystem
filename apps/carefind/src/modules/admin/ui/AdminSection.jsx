import { theme } from '../../../styles/theme'

export default function AdminSection({ title, subtitle, children, action, style = {} }) {
  return (
    <div style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: theme.radius.lg, padding: theme.space[6], marginBottom: theme.space[6], ...style }}>
      {(title || action) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: title ? theme.space[5] : 0 }}>
          {title && (
            <div>
              <div style={{ fontSize: theme.type.h3.size, fontWeight: theme.type.h3.weight, color: theme.textDark }}>{title}</div>
              {subtitle && <div style={{ fontSize: theme.type.bodySm.size, color: theme.textLight, marginTop: 2 }}>{subtitle}</div>}
            </div>
          )}
          {action}
        </div>
      )}
      {children}
    </div>
  )
}
