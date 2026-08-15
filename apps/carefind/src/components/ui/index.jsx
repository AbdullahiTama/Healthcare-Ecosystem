import { useEffect, useRef } from 'react'
import { AlertTriangle, Check, Inbox, Star, WifiOff, X } from 'lucide-react'
import { theme } from '../../styles/theme'
export { useToast } from '../../hooks/useToast'

const { navy } = theme

// Shared component library for CareFind, built on the tokens in
// ../../styles/theme.js. Mirrors the shape and naming of CareHub's
// components/ui/index.jsx (docs/design/DESIGN_PRINCIPLES.md's consistency
// principle applies across the ecosystem, not just within one product) while
// meeting the states/responsiveness/accessibility bar in
// docs/design/COMPONENT_LIBRARY.md and docs/design/ACCESSIBILITY.md.

// â”€â”€ BADGE / PILL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Always paired with text â€” never a bare color dot (ACCESSIBILITY.md).
export function Pill({ label, type = 'gray', style = {} }) {
  const map = {
    gray: { bg: theme.gray100, color: theme.gray600 },
    green: { bg: theme.successBg, color: theme.success },
    amber: { bg: theme.warningBg, color: theme.warning },
    red: { bg: theme.dangerBg, color: theme.danger },
    blue: { bg: theme.infoBg, color: theme.info },
    purple: { bg: '#f5f3ff', color: theme.purple },
    teal: { bg: theme.tealMist, color: theme.tealDeep },
  }
  const s = map[type] || map.gray
  return (
    <span style={{ padding: '3px 10px', borderRadius: theme.radius.full, fontSize: 11, fontWeight: 700, letterSpacing: '0.02em', background: s.bg, color: s.color, whiteSpace: 'nowrap', ...style }}>
      {label}
    </span>
  )
}
export const Badge = Pill

// â”€â”€ CARD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function Card({ children, style = {}, onClick, className }) {
  return (
    <div
      onClick={onClick}
      className={className}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e) } } : undefined}
      style={{
        background: theme.cardBg,
        borderRadius: theme.radius.lg,
        boxShadow: theme.elevation[1],
        cursor: onClick ? 'pointer' : 'default',
        transition: `box-shadow ${theme.motion.base} ${theme.motion.easeOut}, transform ${theme.motion.fast} ${theme.motion.easeOut}`,
        ...style,
      }}
      onMouseEnter={onClick ? (e) => { e.currentTarget.style.boxShadow = theme.elevation[2] } : undefined}
      onMouseLeave={onClick ? (e) => { e.currentTarget.style.boxShadow = theme.elevation[1] } : undefined}
      onMouseDown={onClick ? (e) => { e.currentTarget.style.transform = 'scale(0.98)' } : undefined}
      onMouseUp={onClick ? (e) => { e.currentTarget.style.transform = 'scale(1)' } : undefined}
    >
      {children}
    </div>
  )
}

// â”€â”€ STAT CARD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function StatCard({ icon, label, value, sub, alert, onClick }) {
  return (
    <Card onClick={onClick} style={{ padding: theme.space[10], border: alert ? `1px solid ${theme.amberBorder}` : `1px solid ${theme.border}` }}>
      <div style={{ fontSize: 22, marginBottom: theme.space[4] }}>{icon}</div>
      <div style={{ fontSize: theme.type.h1.size, fontWeight: theme.type.h1.weight, color: theme.textDark }}>{value}</div>
      <div style={{ fontSize: theme.type.bodySm.size, color: theme.textLight, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: theme.type.caption.size, color: theme.gray300, marginTop: 2 }}>{sub}</div>}
    </Card>
  )
}

// â”€â”€ BUTTONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 44px minimum touch height on every button regardless of visual padding
// (COMPONENT_LIBRARY.md â†’ Buttons, ACCESSIBILITY.md â†’ touch targets).
const btnBase = {
  minHeight: 44,
  padding: '10px 20px',
  borderRadius: theme.radius.md,
  border: 'none',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: theme.fontFamily,
  transition: `all ${theme.motion.base} ${theme.motion.easeOut}, transform ${theme.motion.fast} ${theme.motion.easeOut}`,
}

const btnHover = {
  teal: { background: theme.tealHover },
  dark: { background: '#092D25' },
  ghost: { borderColor: theme.gray300, background: theme.gray50 },
  red: { background: theme.dangerBg, color: '#b91c1c' },
}

const btnActive = { transform: 'scale(0.97)' }

export function TealBtn({ children, onClick, style = {}, disabled, type = 'button', ...rest }) {
  const ref = useRef(null)
  return (
    <button ref={ref} type={type} onClick={onClick} disabled={disabled} {...rest}
      style={{ ...btnBase, background: disabled ? theme.gray200 : theme.tealDeep, color: disabled ? theme.gray400 : 'white', cursor: disabled ? 'not-allowed' : 'pointer', ...style }}
      onMouseEnter={disabled ? undefined : () => { if (ref.current) ref.current.style.background = theme.tealHover }}
      onMouseLeave={disabled ? undefined : () => { if (ref.current) ref.current.style.background = theme.tealDeep }}
      onMouseDown={disabled ? undefined : () => { if (ref.current) ref.current.style.transform = 'scale(0.97)' }}
      onMouseUp={disabled ? undefined : () => { if (ref.current) ref.current.style.transform = 'scale(1)' }}>
      {children}
    </button>
  )
}
export function DarkBtn({ children, onClick, style = {}, disabled, type = 'button', ...rest }) {
  const ref = useRef(null)
  return (
    <button ref={ref} type={type} onClick={onClick} disabled={disabled} {...rest}
      style={{ ...btnBase, background: navy, color: 'white', ...style }}
      onMouseEnter={disabled ? undefined : () => { if (ref.current) ref.current.style.background = '#092D25' }}
      onMouseLeave={disabled ? undefined : () => { if (ref.current) ref.current.style.background = navy }}
      onMouseDown={disabled ? undefined : () => { if (ref.current) ref.current.style.transform = 'scale(0.97)' }}
      onMouseUp={disabled ? undefined : () => { if (ref.current) ref.current.style.transform = 'scale(1)' }}>
      {children}
    </button>
  )
}
export function GhostBtn({ children, onClick, style = {}, disabled, type = 'button', ...rest }) {
  const ref = useRef(null)
  return (
    <button ref={ref} type={type} onClick={onClick} disabled={disabled} {...rest}
      style={{ ...btnBase, minHeight: 40, padding: '7px 13px', border: `1px solid ${theme.gray200}`, background: 'white', color: theme.gray600, fontSize: 12, ...style }}
      onMouseEnter={disabled ? undefined : () => { if (ref.current) { ref.current.style.borderColor = theme.gray300; ref.current.style.background = theme.gray50 } }}
      onMouseLeave={disabled ? undefined : () => { if (ref.current) { ref.current.style.borderColor = theme.gray200; ref.current.style.background = 'white' } }}
      onMouseDown={disabled ? undefined : () => { if (ref.current) ref.current.style.transform = 'scale(0.97)' }}
      onMouseUp={disabled ? undefined : () => { if (ref.current) ref.current.style.transform = 'scale(1)' }}>
      {children}
    </button>
  )
}
export function RedBtn({ children, onClick, style = {}, disabled, type = 'button', ...rest }) {
  const ref = useRef(null)
  return (
    <button ref={ref} type={type} onClick={onClick} disabled={disabled} {...rest}
      style={{ ...btnBase, minHeight: 40, padding: '7px 13px', background: theme.dangerBg, color: theme.danger, fontSize: 12, ...style }}
      onMouseEnter={disabled ? undefined : () => { if (ref.current) { ref.current.style.background = theme.dangerBg; ref.current.style.color = '#b91c1c' } }}
      onMouseLeave={disabled ? undefined : () => { if (ref.current) { ref.current.style.background = theme.dangerBg; ref.current.style.color = theme.danger } }}
      onMouseDown={disabled ? undefined : () => { if (ref.current) ref.current.style.transform = 'scale(0.97)' }}
      onMouseUp={disabled ? undefined : () => { if (ref.current) ref.current.style.transform = 'scale(1)' }}>
      {children}
    </button>
  )
}

// â”€â”€ SECTION HEAD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function SectionHead({ title, sub, btn, onBtn }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: theme.space[10], flexWrap: 'wrap', gap: theme.space[6] }}>
      <div>
        <div style={{ fontSize: theme.type.h1.size, fontWeight: theme.type.h1.weight, color: theme.textDark }}>{title}</div>
        {sub && <div style={{ fontSize: theme.type.body.size, color: theme.textLight, marginTop: 3 }}>{sub}</div>}
      </div>
      {btn && <TealBtn onClick={onBtn}>{btn}</TealBtn>}
    </div>
  )
}

// â”€â”€ AVATAR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// `src`: a real profile photo, when one exists â€” falls back to an initial on
// a colored background otherwise. Every avatar in the product should use
// this, not a hand-built circle, so the fallback treatment stays consistent.
export function Avatar({ name, size = 32, bg = theme.tealDeep, src, style = {} }) {
  if (src) {
    return (
      <div style={{ width: size, height: size, borderRadius: theme.radius.full, backgroundImage: `url(${src})`, backgroundSize: 'cover', backgroundPosition: 'center', flexShrink: 0, ...style }} role="img" aria-label={name || 'Profile photo'} />
    )
  }
  return (
    <div style={{ width: size, height: size, borderRadius: theme.radius.full, background: bg, color: 'white', fontWeight: 900, fontSize: size * 0.38, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...style }}>
      {(name || '?')[0].toUpperCase()}
    </div>
  )
}

// â”€â”€ RATING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// A rating shown as five icons, with the value always available as text for
// assistive tech â€” shape and colour alone never carry the number
// (ACCESSIBILITY.md). Every rating in the product renders through these, so
// stars never drift between hand-built rows and icon sets screen to screen.
export function Stars({ value = 0, size = 14 }) {
  const rounded = Math.round(value)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }} role="img" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          color={n <= rounded ? theme.warning : theme.gray300}
          fill={n <= rounded ? theme.warning : 'none'}
          aria-hidden="true"
        />
      ))}
    </span>
  )
}

// The interactive twin of `Stars` â€” picking a rating rather than reading one.
export function StarPicker({ value = 0, onChange, size = 24 }) {
  return (
    <div role="group" aria-label="Your rating" style={{ display: 'flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          type="button"
          key={n}
          onClick={() => onChange(n)}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          aria-pressed={n === value}
          style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', lineHeight: 0 }}
        >
          <Star
            size={size}
            color={n <= value ? theme.warning : theme.gray300}
            fill={n <= value ? theme.warning : 'none'}
            aria-hidden="true"
          />
        </button>
      ))}
    </div>
  )
}

// â”€â”€ TOAST â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Desktop: corner-anchored. Mobile: full-width, safe-area anchored
// (COMPONENT_LIBRARY.md â†’ Notifications). role="status" + aria-live so
// screen readers hear it without it stealing focus.
const TOAST_VARIANTS = {
  success: { bg: theme.success, Icon: Check },
  error:   { bg: theme.alert, Icon: X },
  warning: { bg: theme.warning, Icon: AlertTriangle },
  info:    { bg: theme.tealDeep, Icon: null },
}

export function Toast({ msg, type = 'info', actionLabel, onAction }) {
  if (!msg) return null
  const v = TOAST_VARIANTS[type] || TOAST_VARIANTS.info
  return (
    <div role="status" aria-live="polite" className="cf-toast" style={{
      position: 'fixed', zIndex: 9999,
      left: '50%', transform: 'translateX(-50%)', bottom: 88,
      maxWidth: 'calc(100% - 32px)',
      padding: '12px 20px', borderRadius: theme.radius.lg,
      background: v.bg, color: 'white', fontWeight: 700, fontSize: 13,
      boxShadow: '0 4px 16px rgba(14,111,90,0.4)', textAlign: 'center',
      display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center',
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {v.Icon && <v.Icon size={16} strokeWidth={2.6} aria-hidden="true" style={{ flexShrink: 0 }} />}
        {msg}
      </span>
      {actionLabel && onAction && (
        <button onClick={onAction} style={{ background: 'rgba(255,255,255,0.25)', border: 'none', color: 'white', fontWeight: 800, fontSize: 12, padding: '4px 10px', borderRadius: theme.radius.sm, cursor: 'pointer', flexShrink: 0 }}>{actionLabel}</button>
      )}
    </div>
  )
}

// â”€â”€ MODAL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// `sheet`: bottom sheet (mobile default per COMPONENT_LIBRARY.md â†’ Modals).
// `preventBackdropClose`: for destructive/irreversible content â€” backdrop
// click and Escape are disabled, only the explicit footer actions can close it
// (SCREEN_PATTERNS.md pattern 27's rule for irreversible-action modals).
// `onClose` is kept in a ref so the focus-trap only re-arms on an open-state
// change, never on a parent re-render (which would steal focus back on every
// keystroke). Initial focus lands on the first editable field, never the
// close/cancel button â€” typing works immediately on open.
export function Modal({ show, onClose, title, children, footer, wide, sheet, preventBackdropClose, hideCloseButton }) {
  const cardRef = useRef(null)
  const triggerRef = useRef(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    if (!show) return
    triggerRef.current = document.activeElement
    const node = cardRef.current
    const focusable = () => node?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')

    // A modal is opened to type into its fields, not to land focus on its
    // own close/cancel button. Focus the first editable field (so the user can
    // start typing immediately â€” no "click into the input first") and fall
    // back to the first button only when there are no fields, which keeps
    // ConfirmDialog's Cancel-default-focused behavior (pattern 29).
    // preventScroll stops the sheet jolting when the mobile keyboard opens.
    const editable = () => node?.querySelectorAll('input:not([type="hidden"]), textarea, select, [contenteditable="true"]')
    const initialFocus = editable()?.[0] || focusable()?.[0]
    initialFocus?.focus({ preventScroll: true })

    function onKeyDown(e) {
      if (e.key === 'Escape' && !preventBackdropClose) { onCloseRef.current?.(); return }
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
  }, [show, preventBackdropClose])

  if (!show) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cf-modal-title"
      className="cf-backdrop-enter"
      onClick={() => { if (!preventBackdropClose) onClose?.() }}
      style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(11,74,62,0.55)', display: 'flex', alignItems: sheet ? 'flex-end' : 'center', justifyContent: 'center', padding: sheet ? 0 : 16, overflowY: 'auto' }}
    >
      <div ref={cardRef} onClick={(e) => e.stopPropagation()} className={sheet ? 'cf-sheet-enter' : 'cf-dialog-enter'} style={{
        width: '100%', maxWidth: wide ? 700 : 500,
        maxHeight: sheet ? '88vh' : undefined,
        margin: sheet ? 0 : 'auto',
        background: theme.cardBg,
        borderRadius: sheet ? `${theme.radius.xl}px ${theme.radius.xl}px 0 0` : theme.radius.lg,
        boxShadow: theme.elevation[4],
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div id="cf-modal-title" style={{ fontWeight: 800, fontSize: 16 }}>{title}</div>
          {!hideCloseButton && (
            <button onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, borderRadius: theme.radius.full, background: theme.gray100, border: 'none', cursor: 'pointer', color: theme.gray600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>
        <div style={{ padding: '20px 24px', maxHeight: sheet ? undefined : '65vh', overflowY: 'auto' }}>{children}</div>
        {footer && <div style={{ padding: '14px 24px', borderTop: `1px solid ${theme.border}`, display: 'flex', gap: theme.space[6], flexShrink: 0 }}>{footer}</div>}
      </div>
    </div>
  )
}

// â”€â”€ CONFIRMATION DIALOG â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// SCREEN_PATTERNS.md pattern 29: reserved for irreversible actions, states the
// specific consequence, Cancel is always default-focused, the destructive
// button is never auto-focused. Not a generic "Are you sure?" â€” `consequence`
// is required so callers state what will actually happen.
export function ConfirmDialog({ show, onClose, onConfirm, title, consequence, confirmLabel = 'Delete', danger = true }) {
  return (
    <Modal show={show} onClose={onClose} title={title} preventBackdropClose hideCloseButton footer={
      <>
        <GhostBtn onClick={onClose} style={{ flex: 1 }}>Cancel</GhostBtn>
        {danger
          ? <RedBtn onClick={onConfirm} style={{ flex: 1, minHeight: 44, fontSize: 13 }}>{confirmLabel}</RedBtn>
          : <TealBtn onClick={onConfirm} style={{ flex: 1 }}>{confirmLabel}</TealBtn>}
      </>
    }>
      <div role="alertdialog" style={{ fontSize: 13, color: theme.gray600, lineHeight: 1.6 }}>{consequence}</div>
    </Modal>
  )
}

// â”€â”€ FORM INPUTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Validate on blur/submit, never on keystroke (UX_PATTERNS.md â†’ Validation).
// `error` renders an adjacent, specific message and marks the field
// aria-invalid â€” required indicators are programmatic, not color-only.
export function Inp({ label, value, onChange, onBlur, type = 'text', placeholder = '', required, style = {}, readOnly, min, error, id, ...rest }) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div style={style}>
      {label && <label htmlFor={inputId} style={{ display: 'block', fontSize: 11, fontWeight: 700, color: theme.gray600, marginBottom: 6 }}>{label}{required && <span style={{ color: theme.danger }} aria-hidden="true"> *</span>}</label>}
      <input id={inputId} type={type} value={value || ''} onChange={e => onChange && onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder} readOnly={readOnly} min={min} {...rest}
        required={required} aria-invalid={!!error} aria-describedby={error ? `${inputId}-error` : undefined}
        style={{ width: '100%', minHeight: 44, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${error ? theme.danger : theme.gray200}`, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: readOnly ? theme.gray50 : 'white', fontFamily: theme.fontFamily, transition: `border-color ${theme.motion.fast} ${theme.motion.easeOut}, box-shadow ${theme.motion.fast} ${theme.motion.easeOut}` }} />
      {error && <div id={`${inputId}-error`} style={{ fontSize: 11, color: theme.danger, marginTop: 4 }}>{error}</div>}
    </div>
  )
}

export function Sel({ label, value, onChange, options = [], required, style = {}, error, id, placeholder = 'Select...', ...rest }) {
  const selectId = id || label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div style={style}>
      {label && <label htmlFor={selectId} style={{ display: 'block', fontSize: 11, fontWeight: 700, color: theme.gray600, marginBottom: 6 }}>{label}{required && <span style={{ color: theme.danger }} aria-hidden="true"> *</span>}</label>}
      <select id={selectId} value={value || ''} onChange={e => onChange && onChange(e.target.value)} required={required} {...rest}
        aria-invalid={!!error} aria-describedby={error ? `${selectId}-error` : undefined}
        style={{ width: '100%', minHeight: 44, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${error ? theme.danger : theme.gray200}`, fontSize: 13, outline: 'none', background: 'white', color: value ? theme.navy : theme.textLight, boxSizing: 'border-box', fontFamily: theme.fontFamily }}>
        <option value=''>{placeholder}</option>
        {options.map(o => typeof o === 'string' ? <option key={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <div id={`${selectId}-error`} style={{ fontSize: 11, color: theme.danger, marginTop: 4 }}>{error}</div>}
    </div>
  )
}

export function Textarea({ label, value, onChange, rows = 3, placeholder = '', id }) {
  const areaId = id || label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div>
      {label && <label htmlFor={areaId} style={{ display: 'block', fontSize: 11, fontWeight: 700, color: theme.gray600, marginBottom: 6 }}>{label}</label>}
      <textarea id={areaId} value={value || ''} onChange={e => onChange && onChange(e.target.value)} rows={rows} placeholder={placeholder}
        style={{ width: '100%', padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${theme.gray200}`, fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: theme.fontFamily }} />
    </div>
  )
}

export function Toggle({ label, desc, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: `1px solid ${theme.gray100}` }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: theme.textDark }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: theme.textLight, marginTop: 2 }}>{desc}</div>}
      </div>
      <button role="switch" aria-checked={!!value} aria-label={label} onClick={() => onChange(!value)}
        style={{ width: 44, height: 24, borderRadius: theme.radius.full, border: 'none', cursor: 'pointer', position: 'relative', background: value ? theme.tealDeep : theme.gray200, flexShrink: 0, transition: `background ${theme.motion.fast}` }}>
        <div style={{ position: 'absolute', top: 2, left: value ? 22 : 2, width: 20, height: 20, borderRadius: theme.radius.full, background: 'white', transition: `left ${theme.motion.fast}`, boxShadow: theme.elevation[1] }} />
      </button>
    </div>
  )
}

// â”€â”€ LOADING (spinner) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function Loading({ text = 'Loading...', fullScreen = false }) {
  return (
    <div role="status" aria-live="polite" style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: fullScreen ? 0 : 60,
      minHeight: fullScreen ? '100vh' : undefined,
      color: theme.gray400,
    }}>
      <div className="cf-spinner" style={{ width: fullScreen ? 36 : 28, height: fullScreen ? 36 : 28, borderRadius: theme.radius.full, border: `3px solid ${theme.gray200}`, borderTopColor: theme.tealDeep, marginBottom: 14 }} />
      <div style={{ fontSize: fullScreen ? 15 : 14, fontWeight: 600, color: theme.textLight }}>{text}</div>
    </div>
  )
}

// â”€â”€ SKELETON (structured content loading â€” MOTION.md) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function Skeleton({ width = '100%', height = 14, radius, style = {} }) {
  return <div className="cf-skeleton" style={{ width, height, borderRadius: radius ?? theme.radius.sm, ...style }} />
}

export function CardSkeleton() {
  return (
    <Card style={{ padding: theme.space[10] }}>
      <Skeleton width={40} height={40} radius={theme.radius.full} style={{ marginBottom: 12 }} />
      <Skeleton width="70%" height={14} style={{ marginBottom: 8 }} />
      <Skeleton width="45%" height={12} />
    </Card>
  )
}

// â”€â”€ EMPTY STATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// `cause` distinguishes the three real empty-state situations
// (SCREEN_PATTERNS.md pattern 30) so the message and action are appropriate:
// 'none' = nothing exists yet, 'filtered' = filters/search excluded everything,
// 'positive' = a genuinely good empty state (e.g. "no pending approvals").
export function Empty({ icon, message, action, onAction, cause = 'none' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, color: theme.gray300, textAlign: 'center' }}>
      <div style={{ fontSize: 44, lineHeight: 1, marginBottom: 16, display: 'flex' }} aria-hidden="true">
        {icon || <Inbox size={44} color={theme.gray300} strokeWidth={1.5} />}
      </div>
      <div style={{ fontSize: 15, color: theme.gray500, marginBottom: action ? 20 : 0, maxWidth: 320 }}>{message}</div>
      {action && (cause === 'filtered'
        ? <GhostBtn onClick={onAction}>{action}</GhostBtn>
        : <TealBtn onClick={onAction}>{action}</TealBtn>)}
    </div>
  )
}

// â”€â”€ ERROR STATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// SCREEN_PATTERNS.md pattern 32. `variant`: 'network' gets reassuring,
// auto-retry framing; 'app' is a generic-but-human failure message. Always
// offers a next step â€” never a dead end.
export function ErrorState({ variant = 'app', message, onRetry }) {
  const copy = variant === 'network'
    ? { Icon: WifiOff, heading: "You're offline", body: message || "We'll keep trying to reconnect automatically." }
    : { Icon: AlertTriangle, heading: 'Something went wrong', body: message || "We couldn't load this. Please try again." }
  return (
    <div role="alert" aria-live="assertive" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, textAlign: 'center' }}>
      <div style={{ marginBottom: 12, display: 'flex' }} aria-hidden="true">
        <copy.Icon size={40} color={theme.gray400} strokeWidth={1.5} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: theme.textDark, marginBottom: 4 }}>{copy.heading}</div>
      <div style={{ fontSize: 13, color: theme.gray500, marginBottom: onRetry ? 20 : 0, maxWidth: 320 }}>{copy.body}</div>
      {onRetry && <TealBtn onClick={onRetry}>Retry</TealBtn>}
    </div>
  )
}
