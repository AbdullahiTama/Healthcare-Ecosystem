import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { theme } from '../../styles/theme'

// Sheet — Linear-style slide-over (AD-4, Quiet Chrome)
// Desktop: 40% width (380–560) from right
// Mobile (≤768px): bottom sheet 50% height with drag handle to dismiss
// Focus trap, Esc close, overlay click close, body scroll lock

const SHEET_KEYFRAMES = `
@keyframes ds-sheet-slide-in {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
@keyframes ds-sheet-slide-in-mobile {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
@keyframes ds-sheet-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .ds-sheet-panel, .ds-sheet-overlay { animation-duration: 0.01ms !important; }
}
`
if (typeof document !== 'undefined' && !document.getElementById('ds-sheet-keyframes')) {
  const s = document.createElement('style')
  s.id = 'ds-sheet-keyframes'
  s.textContent = SHEET_KEYFRAMES
  document.head.appendChild(s)
}

export function Sheet({ show, onClose, title, children, footer }) {
  const panelRef = useRef(null)
  const triggerRef = useRef(null)
  const prevActiveElement = useRef(null)
  const onCloseRef = useRef(onClose)
  const [isMobile, setIsMobile] = useState(false)
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startYRef = useRef(0)
  const prefersReducedMotion = useRef(false)

  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 768px)')
    const upd = () => setIsMobile(mq.matches)
    upd()
    mq.addEventListener ? mq.addEventListener('change', upd) : mq.addListener(upd)
    return () => {
      mq.removeEventListener ? mq.removeEventListener('change', upd) : mq.removeListener(upd)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try { prefersReducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch {}
  }, [])

  useEffect(() => {
    if (!show) return
    // store prevActiveElement on open for focus-return on close
    prevActiveElement.current = document.activeElement
    triggerRef.current = document.activeElement
    // lock scroll
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const node = panelRef.current
    const focusable = () => node?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    const editable = () => node?.querySelectorAll('input:not([type="hidden"]), textarea, select, [contenteditable="true"]')
    // focus first editable or first focusable (respect reduced-motion without delay)
    const focusDelay = prefersReducedMotion.current ? 0 : 30
    setTimeout(() => {
      const el = editable()?.[0] || focusable()?.[0]
      el?.focus({ preventScroll: true })
    }, focusDelay)

    function onKeyDown(e) {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current?.(); return }
      // keyboard equivalent for drag: Esc to close (handled above), no drag via keyboard needed
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
      document.body.style.overflow = prev
      // return focus to prevActiveElement
      const target = prevActiveElement.current || triggerRef.current
      try { target?.focus?.() } catch {}
    }
  }, [show])

  // drag handle for mobile bottom sheet
  const onPointerDown = (e) => {
    if (!isMobile) return
    setDragging(true)
    startYRef.current = e.touches ? e.touches[0].clientY : e.clientY
    e.preventDefault()
  }
  const onPointerMove = (e) => {
    if (!dragging) return
    const y = e.touches ? e.touches[0].clientY : e.clientY
    const dy = y - startYRef.current
    if (dy > 0) setDragY(dy)
  }
  const onPointerUp = () => {
    if (!dragging) return
    setDragging(false)
    if (dragY > 100) {
      setDragY(0)
      onCloseRef.current?.()
    } else {
      setDragY(0)
    }
  }

  useEffect(() => {
    if (!dragging) return
    const move = (e) => onPointerMove(e)
    const up = () => onPointerUp()
    window.addEventListener('touchmove', move, { passive: false })
    window.addEventListener('mousemove', move)
    window.addEventListener('touchend', up)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('touchmove', move)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('touchend', up)
      window.removeEventListener('mouseup', up)
    }
  }, [dragging, dragY])

  if (!show) return null

  const isReduced = prefersReducedMotion.current
  const panelStyleMobile = isMobile ? {
    width: '100%',
    maxWidth: '100%',
    height: '50vh',
    maxHeight: '50vh',
    borderRadius: `${theme.radius.xl}px ${theme.radius.xl}px 0 0`,
    transform: dragging ? `translateY(${dragY}px)` : undefined,
    transition: dragging ? 'none' : (isReduced ? 'none' : 'transform 200ms cubic-bezier(0.16,1,0.3,1)'),
    animation: isReduced ? 'none' : 'ds-sheet-slide-in-mobile 300ms cubic-bezier(0.16,1,0.3,1)',
  } : {}

  // backdrop click closes, role/aria on panel wrapper
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ds-sheet-title"
      onClick={() => onClose?.()}
      className="ds-sheet-overlay"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'var(--overlay)',
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'stretch',
        justifyContent: isMobile ? 'center' : 'flex-end',
        animation: isReduced ? 'none' : 'ds-sheet-fade-in 200ms ease-out',
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ds-sheet-title"
        onClick={(e) => e.stopPropagation()}
        className="ds-sheet-panel"
        style={{
          width: isMobile ? '100%' : '40%',
          minWidth: isMobile ? undefined : 380,
          maxWidth: isMobile ? '100%' : 560,
          height: isMobile ? undefined : '100%',
          background: 'var(--panel)',
          borderLeft: isMobile ? 'none' : '1px solid var(--border)',
          boxShadow: 'var(--elevation-2)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: isReduced ? 'none' : (isMobile ? undefined : 'ds-sheet-slide-in 300ms cubic-bezier(0.16,1,0.3,1)'),
          ...panelStyleMobile,
        }}
      >
        {/* drag handle — mobile only, keyboard Esc already closes */}
        {isMobile && (
          <div
            onTouchStart={onPointerDown}
            onMouseDown={onPointerDown}
            onKeyDown={(e)=> { if(e.key==='Escape'){ e.stopPropagation(); onCloseRef.current?.() } }}
            tabIndex={0}
            role="button"
            aria-label="Drag to dismiss, or press Escape to close"
            style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 6px', cursor: 'grab', touchAction: 'none', flexShrink: 0 }}
            aria-hidden="false"
          >
            <div style={{ width: 36, height: 4, borderRadius: 9999, background: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} />
          </div>
        )}

        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: 'var(--panel)' }}>
          <div id="ds-sheet-title" style={{ fontWeight: 800, fontSize: 15, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 8 }}>
            {!isMobile && <span aria-hidden="true" style={{ width: 3, height: 16, borderRadius: 9999, background: 'var(--teal)', display: 'inline-block' }} />}
            {title}
          </div>
          <button onClick={onClose} aria-label="Close sheet" style={{ width: 36, height: 36, borderRadius: 9999, background: 'var(--bg)', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', scrollbarWidth: 'thin', scrollbarColor: 'var(--teal) transparent' }}>
          {children}
        </div>

        {footer && (
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0, background: 'var(--panel)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export default Sheet
