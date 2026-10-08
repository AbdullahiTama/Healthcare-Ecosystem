import { theme } from '../../../styles/theme'

export default function AdminPageHeader({ title, subtitle, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: theme.space[10], flexWrap: 'wrap', gap: theme.space[6] }}>
      <div>
        <div style={{ fontSize: theme.type.h1.size, fontWeight: theme.type.h1.weight, color: theme.textDark, lineHeight: theme.type.h1.lineHeight }}>{title}</div>
        {subtitle && <div style={{ fontSize: theme.type.body.size, color: theme.textLight, marginTop: 3 }}>{subtitle}</div>}
      </div>
      {children && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{children}</div>}
    </div>
  )
}
