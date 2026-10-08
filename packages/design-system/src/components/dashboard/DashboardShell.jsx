import { useBreakpoint } from '../ui/useBreakpoint'
import { theme } from '../../theme'

// DashboardShell — the canvas every dashboard composes on:
//   [ navigation rail ][ top utility bar ][ central content ] [ optional aside ]
//
// It owns ONLY the geometry: viewport lock, scroll containment, content max-width,
// gutters, the main landmark and the skip link. Navigation, the top bar and the
// context panel stay app-owned slots, because CareHub's rail and CareFind's
// control-center rail are deliberately different components (they must feel
// related, not identical). The nav slot is expected to render its own <nav>.
//
// Respects prefers-reduced-motion implicitly: the shell animates nothing.
export const MAIN_CONTENT_ID = 'ds-main-content'

const VISUALLY_HIDDEN_UNTIL_FOCUSED = {
  position: 'absolute',
  left: 8,
  top: 8,
  zIndex: 100,
  padding: '10px 16px',
  borderRadius: theme.radius.md,
  background: 'white',
  color: theme.tealDeep,
  border: `1px solid ${theme.tealDeep}`,
  boxShadow: theme.elevation[2],
  fontWeight: 700,
  fontSize: theme.type.bodySm.size,
  textDecoration: 'none',
  transform: 'translateY(-200%)',
  transition: `transform ${theme.motion.fast} ${theme.motion.easeOut}`,
}

export function DashboardShell({
  nav,
  topbar,
  aside,
  children,
  collapsed = false,
  navWidth,
  navCollapsedWidth,
  contentMaxWidth,
  asideWidth,
  gutter,
  className,
  style = {},
}) {
  const { isMobile, isMobileOrTablet } = useBreakpoint()

  const resolvedNavWidth = collapsed ? (navCollapsedWidth ?? theme.dashboard.navCollapsedWidth) : (navWidth ?? theme.dashboard.navWidth)
  const resolvedMaxWidth = contentMaxWidth ?? theme.dashboard.contentMaxWidth
  const resolvedGutter = gutter ?? (isMobile ? theme.space[8] : theme.space[11])

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        background: theme.bg,
        ...style,
      }}
    >
      <a
        href={`#${MAIN_CONTENT_ID}`}
        style={VISUALLY_HIDDEN_UNTIL_FOCUSED}
        onFocus={(e) => { e.currentTarget.style.transform = 'translateY(0)' }}
        onBlur={(e) => { e.currentTarget.style.transform = 'translateY(-200%)' }}
      >
        Skip to main content
      </a>

      {nav && (
        // Mobile navigation is app-owned (drawer / overlay, position:fixed) —
        // `display:contents` hands it straight to the viewport so the shell
        // reserves no rail width and never double-lays-out an overlay.
        <div
          style={isMobile
            ? { display: 'contents' }
            : { width: resolvedNavWidth, flexShrink: 0, minWidth: 0, height: '100%', overflowY: 'auto', overflowX: 'hidden' }}
        >
          {nav}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {topbar && <div style={{ flexShrink: 0 }}>{topbar}</div>}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
          <main
            id={MAIN_CONTENT_ID}
            tabIndex={-1}
            style={{
              maxWidth: resolvedMaxWidth,
              margin: '0 auto',
              padding: resolvedGutter,
              boxSizing: 'border-box',
            }}
          >
            {children}
          </main>
        </div>
      </div>

      {!isMobileOrTablet && aside && (
        <aside
          aria-label="Context panel"
          style={{
            width: asideWidth ?? theme.dashboard.asideWidth,
            flexShrink: 0,
            overflowY: 'auto',
            background: theme.cardBg,
            borderLeft: `1px solid ${theme.border}`,
          }}
        >
          {aside}
        </aside>
      )}
    </div>
  )
}

export default DashboardShell
