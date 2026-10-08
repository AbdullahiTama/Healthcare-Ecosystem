import { theme } from '../../theme'
import { Empty } from '../ui/State'

// ActivityList — "recent sales", "audit log", "needs your attention".
//
// The same row shape was hand-rolled in four-plus places across the two apps
// (DashboardHome worklist, DashboardHome recent sales, CareFind AuditLog,
// CareFind ModerationQueue). One semantic <ul> keeps the rhythm, the hairline
// and the trailing-value alignment identical everywhere.
//
// Rows are plain text unless the caller supplies `onClick` — then the row
// becomes a real <button> with a hover/focus surface, so keyboard users get
// the interaction they can see.
const TONES = {
  brand: theme.tealDeep,
  success: theme.success,
  warning: theme.warning,
  danger: theme.danger,
  info: theme.info,
  muted: theme.textLight,
}

// Icon-tile skins keyed off the same tone, so danger/warning rows read at a
// glance instead of only coloring the trailing value (mirrors QuickAction's
// tone map; brand/info keep the historical tealMist/tealDeep tile).
const TONE_TILES = {
  brand: { bg: theme.tealMist, fg: theme.tealDeep },
  success: { bg: theme.successBg, fg: theme.success },
  warning: { bg: theme.warningBg, fg: theme.warning },
  danger: { bg: theme.dangerBg, fg: theme.danger },
  info: { bg: theme.infoBg, fg: theme.info },
  muted: { bg: theme.gray200 || theme.tealMist, fg: theme.textLight },
}

export function ActivityList({
  items = [],
  label,
  empty,
  emptyMessage = 'Nothing here yet.',
  emptyAction,
  onEmptyAction,
  emptyCause = 'none',
  dense = false,
  className,
  style = {},
}) {
  if (!items.length) {
    // `empty` is a caller-supplied node; `empty === false` means "show nothing"
    // (a list whose absence is already explained elsewhere on the screen).
    if (empty === false) return null
    if (empty) return empty
    return <Empty message={emptyMessage} cause={emptyCause} action={emptyAction} onAction={onEmptyAction} />
  }

  const last = items.length - 1

  return (
    <ul
      className={className}
      role="list"
      aria-label={label}
      style={{ listStyle: 'none', margin: 0, padding: 0, ...style }}
    >
      {items.map((item, i) => {
        const Row = item.onClick ? 'button' : 'div'
        const toneColor = TONES[item.tone] || theme.textDark
        const toneTile = TONE_TILES[item.tone] || { bg: theme.tealMist, fg: theme.tealDeep }
        const hasValue = item.value !== undefined && item.value !== null
        return (
          <li key={item.id ?? i} style={{ borderBottom: i === last ? 'none' : `1px solid ${theme.hairline}` }}>
            <Row
              {...(item.onClick
                ? {
                    type: 'button',
                    onClick: item.onClick,
                    onMouseEnter: (e) => { e.currentTarget.style.background = theme.tealMist },
                    onMouseLeave: (e) => { e.currentTarget.style.background = 'transparent' },
                  }
                : {})}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: theme.space[6],
                width: '100%',
                padding: dense ? theme.space[4] : theme.space[5],
                background: 'transparent',
                border: 'none',
                borderBottom: 'none',
                borderRadius: theme.radius.sm,
                textAlign: 'left',
                fontFamily: theme.fontFamily,
                cursor: item.onClick ? 'pointer' : 'default',
                transition: `background ${theme.motion.fast} ${theme.motion.easeOut}`,
              }}
            >
              {item.icon && (
                <span
                  aria-hidden="true"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: theme.radius.full,
                    background: toneTile.bg,
                    color: toneTile.fg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {item.icon}
                </span>
              )}
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontSize: theme.type.body.size, fontWeight: 600, color: theme.textDark, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.title}
                </span>
                {item.meta && (
                  <span style={{ display: 'block', fontSize: theme.type.caption.size, fontWeight: theme.type.caption.weight, color: theme.textLight, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.meta}
                  </span>
                )}
              </span>
              {item.badge && <span style={{ flexShrink: 0 }}>{item.badge}</span>}
              {hasValue && (
                <span style={{ fontSize: theme.type.bodySm.size, fontWeight: 800, color: toneColor, flexShrink: 0 }}>
                  {item.value}
                </span>
              )}
            </Row>
          </li>
        )
      })}
    </ul>
  )
}

export default ActivityList
