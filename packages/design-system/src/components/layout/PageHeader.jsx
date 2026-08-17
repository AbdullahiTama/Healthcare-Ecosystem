import { forwardRef } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import { theme } from '../../theme'
import { Button } from '../ui/Button'

/**
 * Unified PageHeader for both CareHub and CareFind.
 *
 * Two modes (docs/product/INFORMATION-ARCHITECTURE.md standard page structure):
 *  - `compact` (default off): slim top app-bar — title on the left, `rightSlot`
 *    (BranchSwitcher, role badge, avatar, actions) on the right. Matches the
 *    legacy CareHub TopBar geometry so migrating routes is behavior-preserving.
 *  - full: content header — breadcrumb, h1 title + description, then a row of
 *    context actions / search / secondary + primary actions.
 *
 * The shared component only owns tokens; app-specific concerns (e.g. CareHub's
 * mobile menu clearance padding) are passed in via `style`.
 */
export const PageHeader = forwardRef(function PageHeader(
  {
    title,
    description,
    breadcrumb,
    compact = false,
    rightSlot,
    primaryAction,
    secondaryActions,
    contextActions,
    search,
    onSearch,
    searchPlaceholder,
    className = '',
    style = {},
  },
  ref
) {
  if (compact) {
    return (
      <header
        ref={ref}
        role="banner"
        className={className}
        style={{
          background: theme.cardBg,
          borderBottom: `1px solid ${theme.border}`,
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexShrink: 0,
          ...style,
        }}
      >
        <h1 style={{ fontWeight: 800, fontSize: 16, color: theme.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, margin: 0 }}>
          {title}
        </h1>
        {rightSlot && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>{rightSlot}</div>
        )}
      </header>
    )
  }

  const breadcrumbStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    flexWrap: 'wrap',
    fontSize: theme.type.bodySm.size,
    color: theme.textLight,
  }

  const actionsStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space[3],
    flexWrap: 'wrap',
    marginTop: 12,
  }

  return (
    <header
      ref={ref}
      role="banner"
      className={className}
      style={{
        padding: '16px 24px',
        marginBottom: theme.space[6],
        background: theme.cardBg,
        borderBottom: `1px solid ${theme.border}`,
        ...style,
      }}
    >
      {breadcrumb && (
        <nav aria-label="Breadcrumb" style={breadcrumbStyle}>
          {breadcrumb.map((item, i) => (
            <span key={item.href || i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {i > 0 && <ChevronRight size={14} color={theme.textLight} aria-hidden="true" />}
              {item.href ? (
                <a href={item.href} style={{ color: theme.tealDeep, fontWeight: 600, textDecoration: 'none' }}>
                  {item.label}
                </a>
              ) : (
                <span style={{ color: theme.textDark, fontWeight: 600 }}>{item.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <h1 style={{ fontSize: theme.type.h1.size, fontWeight: theme.type.h1.weight, color: theme.textDark, margin: 0, lineHeight: theme.type.h1.lineHeight }}>
          {title}
        </h1>
        {description && <p style={{ fontSize: theme.type.body.size, color: theme.textLight, margin: 0, lineHeight: theme.type.body.lineHeight }}>{description}</p>}
      </div>

      {(contextActions || search || primaryAction || secondaryActions) && (
        <div style={actionsStyle}>
          {contextActions}
          {search && (
            <div style={{ flex: 1, maxWidth: 400, position: 'relative' }}>
              <label htmlFor="page-header-search" style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>
                Search
              </label>
              <Search size={18} aria-hidden="true" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: theme.gray400, pointerEvents: 'none' }} />
              <input
                id="page-header-search"
                type="search"
                placeholder={searchPlaceholder || (typeof search === 'string' ? search : 'Search…')}
                onChange={onSearch}
                style={{
                  width: '100%',
                  minHeight: 40,
                  padding: '8px 14px 8px 40px',
                  borderRadius: theme.radius.md,
                  border: `1px solid ${theme.gray200}`,
                  background: theme.gray50,
                  color: theme.textDark,
                  fontSize: theme.type.body.size,
                  fontFamily: theme.fontFamily,
                  boxSizing: 'border-box',
                  outline: 'none',
                  transition: `border-color ${theme.motion.fast} ${theme.motion.easeOut}, box-shadow ${theme.motion.fast} ${theme.motion.easeOut}`,
                }}
                onFocus={e => { e.target.style.borderColor = theme.tealDeep; e.target.style.boxShadow = `0 0 0 3px ${theme.tealMist}` }}
                onBlur={e => { e.target.style.borderColor = theme.gray200; e.target.style.boxShadow = 'none' }}
              />
            </div>
          )}
          {secondaryActions && (
            <div style={{ display: 'flex', gap: theme.space[2] }}>
              {secondaryActions.map((action, i) => (
                <Button key={i} variant={action.variant || 'ghost'} size={action.size || 'md'} onClick={action.onClick} disabled={action.disabled} leftIcon={action.leftIcon} rightIcon={action.rightIcon}>
                  {action.label}
                </Button>
              ))}
            </div>
          )}
          {primaryAction && (
            <Button variant={primaryAction.variant || 'primary'} size={primaryAction.size || 'md'} onClick={primaryAction.onClick} disabled={primaryAction.disabled} leftIcon={primaryAction.leftIcon} rightIcon={primaryAction.rightIcon}>
              {primaryAction.label}
            </Button>
          )}
        </div>
      )}
    </header>
  )
})

PageHeader.displayName = 'PageHeader'

export default PageHeader