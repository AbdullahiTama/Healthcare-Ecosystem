import { theme } from '../../theme'
import { Card } from '../ui/Card'

// SectionCard — a card that carries information, not decoration.
//
// Replaces the two patterns duplicated across both apps: a hand-rolled
// `{ background:'white', border, radius, padding }` wrapper (~34 sites) and a
// hand-rolled header row `{ flex, space-between }` + `{ fontWeight:800 }`
// title (~9 sites). The heading is a real <h2>/<h3> so a dashboard's document
// outline is navigable by screen reader and by browser heading shortcuts.
export function SectionCard({
  title,
  sub,
  actions,
  headingLevel = 2,
  children,
  bodyStyle,
  className,
  style = {},
  id,
}) {
  const level = Math.min(6, Math.max(2, Number(headingLevel) || 2))
  const Heading = `h${level}`
  const hasHeader = Boolean(title || sub || actions)

  return (
    <Card className={className} style={{ padding: theme.space[10], ...style }}>
      {hasHeader && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: theme.space[6],
            flexWrap: 'wrap',
            marginBottom: theme.space[8],
          }}
        >
          <div style={{ minWidth: 0 }}>
            {title && (
              <Heading
                id={id ? `${id}-title` : undefined}
                style={{
                  margin: 0,
                  fontSize: theme.type.h2.size,
                  fontWeight: theme.type.h2.weight,
                  lineHeight: theme.type.h2.lineHeight,
                  letterSpacing: theme.type.h2.letterSpacing,
                  color: theme.textDark,
                }}
              >
                {title}
              </Heading>
            )}
            {sub && (
              <div style={{ fontSize: theme.type.body.size, color: theme.textLight, marginTop: 4, lineHeight: theme.type.body.lineHeight }}>
                {sub}
              </div>
            )}
          </div>
          {actions && (
            <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[6], flexShrink: 0 }}>
              {actions}
            </div>
          )}
        </div>
      )}
      <div style={bodyStyle}>{children}</div>
    </Card>
  )
}

export default SectionCard
