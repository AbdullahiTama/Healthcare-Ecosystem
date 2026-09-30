import { theme } from '../../theme'

// QuickAction — "Add product", "Add expense", "Export report": a labelled
// tile that starts a common task from the dashboard.
//
// Used with MetricGrid as the container (its auto-fit grid gives the same
// 3-up → 2-up → 1-up behaviour), so no second grid primitive is introduced.
// It is a real <button>: keyboard operable, disabled state included.
const TONES = {
  brand: { bg: theme.tealMist, fg: theme.tealDeep },
  success: { bg: theme.successBg, fg: theme.success },
  warning: { bg: theme.warningBg, fg: theme.warning },
  danger: { bg: theme.dangerBg, fg: theme.danger },
  info: { bg: theme.infoBg, fg: theme.info },
}

export function QuickAction({ icon, label, sub, onClick, tone = 'brand', disabled, className, style = {} }) {
  const c = TONES[tone] || TONES.brand

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={className}
      onMouseEnter={(e) => {
        if (disabled) return
        e.currentTarget.style.borderColor = theme.tealDeep
        e.currentTarget.style.boxShadow = theme.elevation[2]
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = theme.border
        e.currentTarget.style.boxShadow = theme.elevation[1]
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: theme.space[6],
        width: '100%',
        padding: theme.space[8],
        borderRadius: theme.radius.lg,
        background: theme.cardBg,
        border: `1px solid ${theme.border}`,
        boxShadow: theme.elevation[1],
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        textAlign: 'left',
        fontFamily: theme.fontFamily,
        boxSizing: 'border-box',
        transition: `border-color ${theme.motion.fast} ${theme.motion.easeOut}, box-shadow ${theme.motion.fast} ${theme.motion.easeOut}`,
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 36,
          height: 36,
          borderRadius: theme.radius.md,
          background: c.bg,
          color: c.fg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span>
        <span style={{ display: 'block', fontSize: theme.type.bodyLg.size, fontWeight: 700, color: theme.textDark }}>
          {label}
        </span>
        {sub && (
          <span style={{ display: 'block', fontSize: theme.type.caption.size, fontWeight: theme.type.caption.weight, color: theme.textLight, marginTop: 4, lineHeight: theme.type.caption.lineHeight }}>
            {sub}
          </span>
        )}
      </span>
    </button>
  )
}

export default QuickAction
