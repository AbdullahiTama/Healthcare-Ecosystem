// Shared presentational primitives for consultation forms (skincare + pharmacy).
// Chips = multi-select; Pills = single-select; YesNo = yes/no pair; SectionCard
// = the standard form card with title/hint. All accessible (aria-pressed).

import { theme } from '../../styles/theme'
import { Card } from '../../components/ui'

const { tealDeep, navy, gray600, gray400, border, bg } = theme

export function Chips({ options, selected = [], onToggle, customLabel }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map(o => {
        const on = selected.includes(o)
        return (
          <button key={o} type="button" onClick={() => onToggle(o)} aria-pressed={on}
            style={{ padding: '7px 12px', borderRadius: theme.radius.full, border: '1px solid', borderColor: on ? tealDeep : border, cursor: 'pointer', fontSize: 12, fontWeight: 700, background: on ? tealDeep : '#fff', color: on ? '#fff' : gray600 }}>
            {customLabel ? customLabel(o) : o}
          </button>
        )
      })}
    </div>
  )
}

export function Pills({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map(o => {
        const on = value === o
        return (
          <button key={o} type="button" onClick={() => onChange(on ? '' : o)} aria-pressed={on}
            style={{ padding: '7px 12px', borderRadius: theme.radius.full, border: '1px solid', borderColor: on ? tealDeep : border, cursor: 'pointer', fontSize: 12, fontWeight: 700, background: on ? tealDeep : '#fff', color: on ? '#fff' : gray600 }}>
            {o}
          </button>
        )
      })}
    </div>
  )
}

export function YesNo({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {['Yes', 'No'].map(o => {
        const on = value === (o === 'Yes' ? 'yes' : 'no')
        return (
          <button key={o} type="button" onClick={() => onChange(on ? '' : (o === 'Yes' ? 'yes' : 'no'))} aria-pressed={on}
            style={{ padding: '7px 16px', borderRadius: theme.radius.full, border: '1px solid', borderColor: on ? tealDeep : border, cursor: 'pointer', fontSize: 12, fontWeight: 700, background: on ? tealDeep : '#fff', color: on ? '#fff' : gray600 }}>
            {o}
          </button>
        )
      })}
    </div>
  )
}

export function SectionCard({ title, hint, children }) {
  return (
    <Card style={{ padding: 18, marginBottom: 14 }}>
      <div style={{ fontWeight: 800, fontSize: 14, color: navy, marginBottom: hint ? 2 : 14 }}>{title}</div>
      {hint && <div style={{ fontSize: 12, color: gray400, marginBottom: 12 }}>{hint}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </Card>
  )
}
