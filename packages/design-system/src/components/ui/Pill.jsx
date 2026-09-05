import { theme } from '../../theme'

// Unified Badge / Pill (Stage 3 / 3.9). Always paired with text — never a
// bare color dot (ACCESSIBILITY.md).
const PILL_TYPES = {
  gray: { bg: theme.gray100, color: theme.gray600 },
  green: { bg: theme.successBg, color: theme.success },
  amber: { bg: theme.warningBg, color: theme.warning },
  red: { bg: theme.dangerBg, color: theme.danger },
  blue: { bg: theme.infoBg, color: theme.info },
  purple: { bg: theme.purpleBg, color: theme.purple },
  teal: { bg: theme.tealMist, color: theme.tealDeep },
}

export function Pill({ label, type = 'gray', style = {} }) {
  const s = PILL_TYPES[type] || PILL_TYPES.gray
  return (
    <span style={{ padding: '3px 10px', borderRadius: theme.radius.full, fontSize: 11, fontWeight: 700, letterSpacing: '0.02em', background: s.bg, color: s.color, whiteSpace: 'nowrap', ...style }}>
      {label}
    </span>
  )
}

export const Badge = Pill

export default Pill
