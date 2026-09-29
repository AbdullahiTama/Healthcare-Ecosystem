import { theme } from '../../../styles/theme'

// The micro-caps label that opens every section. Two contexts: light sections
// use the tealMist chip, dark sections use a translucent white one.
//
// tealDeep on var(--bg) measures 5.60:1, so the label passes WCAG AA at 10.5px
// — which gray500 (2.78:1) and gray400 (2.31:1) do not, and which the current
// page used for body copy throughout.
export function Eyebrow({ children, onDark = false }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 13px',
        borderRadius: theme.radius.full,
        background: onDark ? 'rgba(255,255,255,0.10)' : theme.tealMist,
        border: onDark ? '1px solid rgba(255,255,255,0.18)' : `1px solid ${theme.border}`,
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: onDark ? 'rgba(255,255,255,0.92)' : theme.tealDeep,
        lineHeight: 1.3,
      }}
    >
      {children}
    </span>
  )
}
