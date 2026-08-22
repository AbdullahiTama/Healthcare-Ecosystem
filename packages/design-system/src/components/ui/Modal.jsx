import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { theme } from '../../theme'
import { Card } from './Card'

// Self-contained enter animations — the design-system package must not depend
// on either app's app-specific animation classes (CareFind: cf-*-enter).
// Injected once into <head> at module load (guarded for SSR/envs without
// document). Exit animations are intentionally omitted: the modal unmounts
// immediately on close, which is snappier than a fade for modal-style content
// (MOTION.md). Dialog: fade+scale 200ms; drawer: slide right 300ms; sheet:
// slide up 300ms.
const MODAL_KEYFRAMES = `
@keyframes ds-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes ds-dialog-enter {
  from { opacity: 0; transform: scale(0.97); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes ds-drawer-enter {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
@keyframes ds-sheet-enter {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}`
if (typeof document !== 'undefined' && !document.getElementById('ds-modal-keyframes')) {
  const style = document.createElement('style')
  style.id = 'ds-modal-keyframes'
  style.textContent = MODAL_KEYFRAMES
  document.head.appendChild(style)
}

const ANIMATIONS = {
  dialog: 'ds-dialog-enter 200ms cubic-bezier(0.16, 1, 0.3, 1)',
  drawer: 'ds-drawer-enter 300ms cubic-bezier(0.16, 1, 0.3, 1)',
  sheet: 'ds-sheet-enter 300ms cubic-bezier(0.16, 1, 0.3, 1)',
}

// Unified Modal (Stage 3 / 3.3). One implementation for every dialog/drawer/
// sheet in the ecosystem, replacing the duplicated CareHub/CareFind Modals.
//
// `variant`: 'dialog' (default, centered) | 'drawer' (right, full height) |
// 'sheet' (bottom, mobile default). Backward-compatible with the legacy `sheet`
// boolean and `wide` boolean (-> lg size); `preventClose`/`preventBackdropClose`
// both disable backdrop-click and Escape closing for irreversible content.
//
// Focus contract: initial focus lands on the first editable field (typing works
// immediately), Tab is trapped, Escape closes unless blocked, and on close focus
// returns to whatever opened the modal. `onClose` is kept in a ref so the focus
// trap only re-arms on an open-state change, never on a parent re-render (which
// would steal focus back on every keystroke).
export function Modal({ show, onClose, title, children, footer, wide, sheet, preventBackdropClose, preventClose, hideCloseButton, variant, size }) {
  const cardRef = useRef(null)
  const triggerRef = useRef(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  const blocking = preventClose ?? preventBackdropClose
  const v = sheet ? 'sheet' : variant || 'dialog'
  const maxW = wide || size === 'lg' ? 700 : size === 'sm' ? 420 : 500

  useEffect(() => {
    if (!show) return
    triggerRef.current = document.activeElement
    const node = cardRef.current
    const focusable = () => node?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')

    // A modal is opened to type into its fields, not to land focus on its own
    // close/cancel button. Focus the first editable field (so the user can
    // start typing immediately) and fall back to the first button only when
    // there are no fields, which keeps ConfirmDialog's Cancel-default-focused
    // behavior (pattern 29). preventScroll stops the sheet jolting when the
    // mobile keyboard opens.
    const editable = () => node?.querySelectorAll('input:not([type="hidden"]), textarea, select, [contenteditable="true"]')
    const initialFocus = editable()?.[0] || focusable()?.[0]
    initialFocus?.focus({ preventScroll: true })

    function onKeyDown(e) {
      if (e.key === 'Escape' && !blocking) { onCloseRef.current?.(); return }
      if (e.key !== 'Tab') return
      const items = Array.from(focusable() || [])
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      triggerRef.current?.focus?.()
    }
  }, [show, blocking])

  if (!show) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ds-modal-title"
      onClick={() => { if (!blocking) onClose?.() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 999, background: theme.overlay,
        display: 'flex', alignItems: v === 'sheet' ? 'flex-end' : 'center', justifyContent: v === 'drawer' ? 'flex-end' : 'center',
        padding: v === 'sheet' || v === 'drawer' ? 0 : 16, overflowY: 'auto',
        animation: 'ds-fade-in 200ms ease-out',
      }}
    >
      <Card ref={cardRef} onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: maxW,
        maxHeight: v === 'sheet' ? '88vh' : v === 'drawer' ? '100%' : undefined,
        height: v === 'drawer' ? '100%' : undefined,
        margin: v === 'sheet' || v === 'drawer' ? 0 : 'auto',
        borderRadius: v === 'sheet' ? `${theme.radius.xl}px ${theme.radius.xl}px 0 0` : v === 'drawer' ? `${theme.radius.lg}px 0 0 ${theme.radius.lg}px` : theme.radius.lg,
        boxShadow: theme.elevation[4],
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
        animation: ANIMATIONS[v],
      }}>
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div id="ds-modal-title" style={{ fontWeight: 800, fontSize: 16 }}>{title}</div>
          {!hideCloseButton && (
            <button onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, borderRadius: theme.radius.full, background: theme.gray100, border: 'none', cursor: 'pointer', color: theme.gray600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>
        <div style={{ padding: '20px 24px', maxHeight: v === 'sheet' || v === 'drawer' ? undefined : '65vh', overflowY: 'auto' }}>{children}</div>
        {footer && <div style={{ padding: '14px 24px', borderTop: `1px solid ${theme.border}`, display: 'flex', gap: theme.space[6], flexShrink: 0 }}>{footer}</div>}
      </Card>
    </div>
  )
}

export default Modal
