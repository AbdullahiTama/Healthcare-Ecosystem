import { isValidElement, cloneElement } from 'react'
import { theme } from '../../theme'
import { Card } from './Card'

// StatCard (Stage 3 / Slice 7). KPI tile: a muted icon+label row, a large
// value, and an optional sub-figure. `tone` ('warning'|'danger') or the legacy
// `alert` bool colors the value so a figure the owner must not miss stands out.
// Promoted from CareHub (its dashboard/POS template); CareFind exported an
// unused, differently-laid-out StatCard which is now replaced by this one.
export function StatCard({ icon, label, value, sub, alert, tone, onClick }) {
  const valueColor = tone === 'danger' ? theme.danger : (tone === 'warning' || alert) ? theme.warning : theme.navy
  const iconNode = isValidElement(icon) ? cloneElement(icon, { size: 15, strokeWidth: 2 }) : icon
  return (
    <Card onClick={onClick} style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: theme.gray500, marginBottom: 10 }}>
        <span style={{ display: 'flex' }}>{iconNode}</span>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontSize: 25, fontWeight: 900, color: valueColor, lineHeight: 1.1, letterSpacing: '-0.01em' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: theme.gray400, marginTop: 5 }}>{sub}</div>}
    </Card>
  )
}

export default StatCard
