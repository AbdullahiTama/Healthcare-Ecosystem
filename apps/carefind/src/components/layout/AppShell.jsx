import { useBreakpoint } from '../../hooks/useBreakpoint'
import { theme } from '../../styles/theme'
import DesktopHeader from './DesktopHeader.jsx'
import LeftSidebar from './LeftSidebar.jsx'

// Responsive three-column desktop shell (docs/design/LAYOUTS.md-style
// composition, applied to CareFind for the first time).
//
// Breakpoint contract:
//  - Mobile (<768px): pure passthrough — renders `children` and nothing
//    else. The calling page is expected to render its own existing mobile
//    header/BottomNav itself in that branch; AppShell never touches mobile.
//  - Tablet (768–1023px): header + collapsed icon-only left rail + full-width
//    main column; the right sidebar (if any) moves below the main content
//    instead of beside it.
//  - Desktop (≥1024px): header + full left sidebar + main column (capped for
//    readability, not stretched edge-to-edge) + right sidebar, the whole
//    three-column block capped at a max width and centered — large monitors
//    get a genuinely wider, denser layout, not a 480px column adrift in grey
//    space, but text still reads comfortably on an ultrawide.
// `onCompose` is optional. Only the feed can open the create selector in
// place, so every other page omits it and LeftSidebar navigates to the feed
// carrying the create flag instead — the create button must never resolve to
// "go to the feed and do nothing".
export default function AppShell({ children, rightSidebar, user, myUsername, myAvatar, unreadNotifs, onCompose }) {
  const { isMobile, isTablet } = useBreakpoint()

  return (
    <div style={{ minHeight: '100vh', background: theme.bg }}>
      <DesktopHeader user={user} myUsername={myUsername} myAvatar={myAvatar} unreadNotifs={unreadNotifs} />
      <div style={{ maxWidth: 1320, margin: '0 auto', display: 'flex', gap: 24, padding: '0 24px', alignItems: 'flex-start' }}>
        <LeftSidebar
          user={user}
          myUsername={myUsername}
          myAvatar={myAvatar}
          unreadNotifs={unreadNotifs}
          onCompose={onCompose}
          collapsed={isTablet}
        />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 24, alignItems: 'flex-start', flexDirection: isTablet ? 'column' : 'row' }}>
          <main style={{ flex: 1, minWidth: 0, maxWidth: isTablet ? '100%' : (rightSidebar ? 640 : 900), padding: '24px 0', width: '100%' }}>
            {children}
          </main>
          {rightSidebar && (
            <div style={{ width: isTablet ? '100%' : undefined, paddingTop: isTablet ? 0 : 24, alignSelf: isTablet ? 'auto' : 'stretch' }}>
              {rightSidebar}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
