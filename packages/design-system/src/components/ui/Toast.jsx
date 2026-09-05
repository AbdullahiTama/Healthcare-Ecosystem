import { Check, X, AlertTriangle } from 'lucide-react'
import { theme } from '../../theme'

// Self-contained positioning + enter animation (Stage 3 / 3.4). The design
// system must not depend on either app's app-specific CSS classes (CareHub's
// ch-toast, CareFind's cf-toast). Injected once into <head> at module load.
//
// Responsive placement (UI-UX-ROADMAP.md 3.4): mobile gets a bottom-centered
// toast anchored above the bottom nav (the CareFind behavior, bottom: 88px);
// desktop gets the standard top-right corner. Pass an explicit `position`
// ('bottom-right' | 'bottom-center' | 'top-right') to pin one placement and
// override the responsive default — inline styles win over the .ds-toast rule.
//
// The outer div is the positioning layer; the inner div carries the card look
// and the slide-in animation. They are separate so the animation's translateY
// can never fight the centering transform (translateX(-50%)) the way the old
// single-element version did.
const TOAST_STYLES = `
@keyframes ds-toast-in {
  from { transform: translateY(12px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
.ds-toast {
  position: fixed; z-index: 9999;
  left: 50%; transform: translateX(-50%); bottom: 88px;
  max-width: calc(100% - 32px);
}
@media (min-width: 768px) {
  .ds-toast { left: auto; transform: none; top: 24px; right: 24px; bottom: auto; }
}
@media (prefers-reduced-motion: reduce) {
  .ds-toast { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
}`
if (typeof document !== 'undefined' && !document.getElementById('ds-toast-styles')) {
  const style = document.createElement('style')
  style.id = 'ds-toast-styles'
  style.textContent = TOAST_STYLES
  document.head.appendChild(style)
}

// Explicit placements fully override the responsive .ds-toast rule (every axis
// is set so no class default leaks through).
const POSITIONS = {
  'bottom-right': { bottom: 24, right: 24, top: 'auto', left: 'auto', transform: 'none' },
  'bottom-center': { bottom: 88, left: '50%', top: 'auto', right: 'auto', transform: 'translateX(-50%)' },
  'top-right': { top: 24, right: 24, bottom: 'auto', left: 'auto', transform: 'none' },
}

const TOAST_VARIANTS = {
  success: { bg: theme.success, Icon: Check },
  error:   { bg: theme.alert, Icon: X },
  warning: { bg: theme.warning, Icon: AlertTriangle },
  info:    { bg: theme.tealDeep, Icon: null },
}

export function Toast({ msg, type = 'info', actionLabel, onAction, position }) {
  if (!msg) return null
  const v = TOAST_VARIANTS[type] || TOAST_VARIANTS.info
  return (
    <div role="status" aria-live="polite" className="ds-toast" style={POSITIONS[position]}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', textAlign: 'center',
        padding: '12px 20px', borderRadius: theme.radius.lg,
        background: v.bg, color: 'white', fontWeight: 700, fontSize: 13,
        boxShadow: '0 4px 16px rgba(14,111,90,0.4)',
        animation: `ds-toast-in ${theme.motion.base} ${theme.motion.easeOut}`,
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {v.Icon && <v.Icon size={16} strokeWidth={2.6} aria-hidden="true" style={{ flexShrink: 0 }} />}
          {msg}
        </span>
        {actionLabel && onAction && (
          <button onClick={onAction} style={{ background: 'rgba(255,255,255,0.25)', border: 'none', color: 'white', fontWeight: 800, fontSize: 12, padding: '4px 10px', borderRadius: theme.radius.sm, cursor: 'pointer', flexShrink: 0 }}>{actionLabel}</button>
        )}
      </div>
    </div>
  )
}

export default Toast
