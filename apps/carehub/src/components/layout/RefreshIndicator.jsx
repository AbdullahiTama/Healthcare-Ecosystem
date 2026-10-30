import { useEffect } from 'react'
import { RefreshCw, CheckCircle, AlertTriangle, X } from 'lucide-react'
import { useRefreshStatus } from '../../providers/RefreshProvider'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { MOBILE_MENU_LEFT, MOBILE_MENU_SIZE } from './shellConstants'
import { theme } from '../../styles/theme'

const { navy, tealDeep, warning, warningBg, border, gray500 } = theme

// How long "Updated just now" stays before the pill goes away.
const UPDATED_VISIBLE_MS = 3000

// A small pill at the top of the dashboard while it catches up after staff
// come back (lib/resume.js). Never covers the screen: what was on it stays
// usable the whole time. Offline needs no pill — the offline banner says it.
export default function RefreshIndicator() {
  const { status, retry, settle } = useRefreshStatus()
  const { isMobile } = useBreakpoint()

  useEffect(() => {
    if (status.state !== 'updated') return undefined
    const t = setTimeout(settle, UPDATED_VISIBLE_MS)
    return () => clearTimeout(t)
  }, [status])

  if (status.state !== 'updating' && status.state !== 'updated' && status.state !== 'failed') return null
  const failed = status.state === 'failed'

  // Centred by a full-width wrapper rather than translateX, because the
  // .ch-toast entrance animation owns `transform`. On mobile it starts to the
  // right of the shell's floating menu button (BusinessDashboard.jsx), which
  // a long message would otherwise cover.
  return (
    <div style={{ position: 'fixed', top: 10, left: isMobile ? MOBILE_MENU_LEFT + MOBILE_MENU_SIZE + 8 : 16, right: 16, zIndex: 40, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div
        role='status'
        aria-live='polite'
        className='ch-toast'
        style={{
          pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 12px', borderRadius: theme.radius.full, boxShadow: theme.elevation[2],
          background: failed ? warningBg : 'white', border: `1px solid ${failed ? warning : border}`,
          color: failed ? warning : navy, fontSize: 12.5, fontWeight: 700,
        }}
      >
        {status.state === 'updating' && <><RefreshCw size={14} className='ch-spinner' color={tealDeep} aria-hidden='true' /> Updating…</>}
        {status.state === 'updated' && <><CheckCircle size={14} color={tealDeep} aria-hidden='true' /> Updated just now</>}
        {failed && (
          <>
            <AlertTriangle size={14} aria-hidden='true' style={{ flexShrink: 0 }} />
            <span>Couldn't update. Showing what was loaded earlier.</span>
            <button onClick={retry} style={{ border: `1px solid ${warning}`, background: 'white', color: warning, borderRadius: theme.radius.full, padding: '3px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
              Retry
            </button>
            <button onClick={settle} aria-label='Dismiss' style={{ display: 'flex', border: 'none', background: 'none', color: gray500, cursor: 'pointer', padding: 2, flexShrink: 0 }}>
              <X size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
