import { forwardRef, useEffect, useRef, cloneElement, isValidElement } from 'react'
import { Activity, Inbox, WifiOff, AlertTriangle, Check, X } from 'lucide-react'
import { theme } from '../../styles/theme'
export { useToast } from '../../hooks/useToast'

const { darkGradient } = theme
const DARK = darkGradient

// ── LOGO ─────────────────────────────────────────────────────────────────────
// The one CareHub brand mark — flat teal (no gradient, per COLORS.md's rule
// and the client template, which never uses one), same icon everywhere the
// brand appears (Landing.jsx nav/footer, Sidebar.jsx) so it reads as one
// consistent mark rather than a per-screen invention.
export function Logo({ size = 30, style = {} }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.28, background: theme.tealDeep, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...style }}>
      <Activity size={size * 0.55} strokeWidth={2.5} />
    </div>
  )
}

// Shared component library for CareHub, built on the tokens in
// ../../styles/theme.js. Mirrors the shape and naming of CareFind's
// components/ui/index.jsx (docs/design/DESIGN_PRINCIPLES.md's consistency
// principle applies across the ecosystem, not just within one product) while
// meeting the states/responsiveness/accessibility bar in
// docs/design/COMPONENT_LIBRARY.md and docs/design/ACCESSIBILITY.md.

// ── BADGE / PILL ─────────────────────────────────────────────────────────────
// Always paired with text — never a bare color dot (ACCESSIBILITY.md).
export function Pill({ label, type = 'gray', style = {} }) {
  const map = {
    gray: { bg: theme.gray100, color: theme.gray600 },
    green: { bg: theme.successBg, color: theme.success },
    amber: { bg: theme.warningBg, color: theme.warning },
    red: { bg: theme.dangerBg, color: theme.danger },
    blue: { bg: theme.infoBg, color: theme.info },
    purple: { bg: '#f5f3ff', color: theme.purple },
    teal: { bg: '#E3EEE8', color: theme.tealDeep },
  }
  const s = map[type] || map.gray
  return (
    <span style={{ padding: '3px 10px', borderRadius: theme.radius.full, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color, whiteSpace: 'nowrap', ...style }}>
      {label}
    </span>
  )
}
export const Badge = Pill

// ── CARD ─────────────────────────────────────────────────────────────────────
// forwardRef so Modal can focus-trap its content (the ref attaches to this
// div) — every existing call site that doesn't pass a ref is unaffected.
export const Card = forwardRef(function Card({ children, style = {}, onClick, className }, ref) {
  return (
    <div
      ref={ref}
      onClick={onClick}
      className={className}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => {
        // A clickable Card acts like a button for keyboard users — but only
        // when the Card ITSELF is focused. A keydown bubbling up from a child
        // input must NOT be prevented, or the spacebar can never be typed into
        // fields inside the Card (and every Modal wraps its content in one).
        if ((e.key === 'Enter' || e.key === ' ') && e.currentTarget === e.target) { e.preventDefault(); onClick(e) }
      } : undefined}
      style={{
        background: theme.cardBg,
        borderRadius: theme.radius.lg,
        border: `1px solid ${theme.border}`,
        boxShadow: theme.elevation[1],
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
    >
      {children}
    </div>
  )
})

// ── STAT CARD ──────────────────────────────────────────────────────────────
// KPI tile: a muted icon+label row, a large value, and an optional sub-figure.
// `tone` ('warning'|'danger') or the legacy `alert` bool colors the value so a
// figure the owner must not miss stands out. Matches the dashboard/POS template.
export function StatCard({ icon, label, value, sub, alert, tone, onClick }) {
  const valueColor = tone === 'danger' ? theme.danger : (tone === 'warning' || alert) ? theme.warning : theme.navy
  const iconNode = isValidElement(icon) ? cloneElement(icon, { size: 15, strokeWidth: 2 }) : icon
  return (
    <Card onClick={onClick} style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: theme.gray500, marginBottom: 10 }}>
        <span style={{ display: 'flex' }}>{iconNode}</span>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontSize: 25, fontWeight: 900, color: valueColor, lineHeight: 1.1, letterSpacing: '-0.01em' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: theme.gray400, marginTop: 5 }}>{sub}</div>}
    </Card>
  )
}

// ── BUTTONS ──────────────────────────────────────────────────────────────────
// 44px minimum touch height on every button regardless of visual padding
// (COMPONENT_LIBRARY.md → Buttons, ACCESSIBILITY.md → touch targets).
const btnBase = {
  minHeight: 44,
  padding: '10px 20px',
  borderRadius: theme.radius.md,
  border: 'none',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: theme.fontFamily,
}

export function TealBtn({ children, onClick, style = {}, disabled, type = 'button', ...rest }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} {...rest}
      style={{ ...btnBase, background: disabled ? theme.gray200 : theme.tealDeep, color: disabled ? theme.gray400 : 'white', cursor: disabled ? 'not-allowed' : 'pointer', ...style }}>
      {children}
    </button>
  )
}
export function DarkBtn({ children, onClick, style = {}, disabled, type = 'button', ...rest }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} {...rest}
      style={{ ...btnBase, background: DARK, color: 'white', ...style }}>
      {children}
    </button>
  )
}
export function GhostBtn({ children, onClick, style = {}, disabled, type = 'button', ...rest }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} {...rest}
      style={{ ...btnBase, minHeight: 40, padding: '7px 13px', border: `1px solid ${theme.gray200}`, background: 'white', color: theme.gray600, fontSize: 12, ...style }}>
      {children}
    </button>
  )
}
export function RedBtn({ children, onClick, style = {}, disabled, type = 'button', ...rest }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} {...rest}
      style={{ ...btnBase, minHeight: 40, padding: '7px 13px', background: theme.dangerBg, color: theme.danger, fontSize: 12, ...style }}>
      {children}
    </button>
  )
}

// ── SECTION HEAD ─────────────────────────────────────────────────────────────
// `extraBtn`: an optional secondary button rendered beside the primary one
// (e.g. "Export CSV") — { label, icon, onClick }. `extraBtns` renders a whole
// row of them with the same style, for pages that offer several secondary
// actions (Clients: Export CSV + Upload CSV).
export function SectionHead({ title, sub, btn, onBtn, extraBtn, extraBtns }) {
  const secondaries = extraBtns || (extraBtn ? [extraBtn] : [])
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: theme.space[10], flexWrap: 'wrap', gap: theme.space[6] }}>
      <div>
        <div style={{ fontSize: theme.type.h1.size, fontWeight: theme.type.h1.weight, color: theme.textDark }}>{title}</div>
        {sub && <div style={{ fontSize: theme.type.body.size, color: theme.textLight, marginTop: 3 }}>{sub}</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {secondaries.map((b) => (
          <button key={b.label} onClick={b.onClick} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: theme.radius.md, border: `1px solid ${theme.border}`, background: 'white', color: theme.textDark, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            {b.icon} {b.label}
          </button>
        ))}
        {btn && <TealBtn onClick={onBtn}>{btn}</TealBtn>}
      </div>
    </div>
  )
}

// ── AVATAR ───────────────────────────────────────────────────────────────────
// `src`: a real profile photo, when one exists — falls back to an initial on
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

// ── TOAST ────────────────────────────────────────────────────────────────────
// Matches CareFind's Toast — lucide icons, animation class, elevation shadow.
// role="status" + aria-live so screen readers hear it without stealing focus.
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
    <div role="status" aria-live="polite" className="ch-toast" style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      maxWidth: 'calc(100% - 32px)',
      padding: '12px 20px', borderRadius: theme.radius.lg,
      background: v.bg, color: 'white', fontWeight: 700, fontSize: 13,
      boxShadow: '0 4px 16px rgba(15,118,110,0.4)', display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center',
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

// ── MODAL ────────────────────────────────────────────────────────────────────
// `sheet`: renders as a bottom sheet (slides up, anchored to the bottom, rounded
// top corners only) instead of a centered dialog — used by CareHub's enterprise
// vertical (Warehouses/Stock/Territories/Orders/Messages/LiveActivity), which
// relies on the bottom-sheet feel for its mobile-first field-team workflows.
// `preventBackdropClose`/`hideCloseButton`: for destructive/irreversible content
// — backdrop click and Escape are disabled, only the explicit footer actions can
// close it (docs/design/SCREEN_PATTERNS.md pattern 27's rule for irreversible-
// action modals; mirrors apps/carefind/src/components/ui/index.jsx's Modal).
// `onClose` is kept in a ref so the focus-trap below only ever re-runs when the
// modal's open state actually changes. Every call site passes an inline arrow
// (new reference per render), so without this the effect would tear down and
// re-arm itself on every parent re-render — its cleanup would steal focus back
// to the trigger button on each keystroke, destroying the user's caret and, on
// mobile, dismissing the keyboard after every character.
// Initial focus lands on the first editable field, never the close/cancel
// button — so typing works immediately on open (and if focus is ever lost, it
// returns to a field, not to a button the user didn't click).
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
    // start typing immediately — no "click into the input first") and fall
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
      aria-labelledby="ch-modal-title"
      onClick={() => { if (!preventBackdropClose) onClose?.() }}
      style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: sheet ? 'flex-end' : 'center', justifyContent: 'center', padding: sheet ? 0 : 16, overflowY: 'auto' }}
    >
      <Card ref={cardRef} onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: wide ? 700 : 500,
        maxHeight: sheet ? '88vh' : undefined,
        margin: sheet ? 0 : 'auto',
        borderRadius: sheet ? `${theme.radius.xl}px ${theme.radius.xl}px 0 0` : theme.radius.lg,
        boxShadow: theme.elevation[4],
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div id="ch-modal-title" style={{ fontWeight: 800, fontSize: 16 }}>{title}</div>
          {!hideCloseButton && <button onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, borderRadius: theme.radius.full, background: theme.gray100, border: 'none', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>}
        </div>
        <div style={{ padding: '20px 24px', maxHeight: sheet ? undefined : '65vh', overflowY: 'auto' }}>{children}</div>
        {footer && <div style={{ padding: '14px 24px', borderTop: `1px solid ${theme.border}`, display: 'flex', gap: theme.space[6], flexShrink: 0 }}>{footer}</div>}
      </Card>
    </div>
  )
}

// ── CONFIRMATION DIALOG ──────────────────────────────────────────────────────
// docs/design/SCREEN_PATTERNS.md pattern 29: reserved for irreversible actions,
// states the specific consequence, Cancel is always default-focused, the
// destructive button is never auto-focused. Not a generic "Are you sure?" —
// `consequence` is required so callers state what will actually happen.
// Mirrors apps/carefind/src/components/ui/index.jsx's ConfirmDialog exactly.
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

// ── FORM INPUTS ──────────────────────────────────────────────────────────────
// Validate on blur/submit, never on keystroke (UX_PATTERNS.md → Validation).
// `error` renders an adjacent, specific message and marks the field
// aria-invalid — required indicators are programmatic, not color-only.
// `fill` optionally overrides the input's background (default white) — used by
// the branded auth screens (Register/Login) to sit cream fields inside a white
// card; every other caller omits it and keeps the standard white field.
export function Inp({ label, value, onChange, onBlur, type = 'text', placeholder = '', required, style = {}, readOnly, min, error, id, fill, ...rest }) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div style={style}>
      {label && <label htmlFor={inputId} style={{ display: 'block', fontSize: 11, fontWeight: 700, color: theme.gray600, marginBottom: 6 }}>{label}{required && <span style={{ color: theme.danger }} aria-hidden="true"> *</span>}</label>}
      <input id={inputId} type={type} value={value || ''} onChange={e => onChange && onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder} readOnly={readOnly} min={min} {...rest}
        required={required} aria-invalid={!!error} aria-describedby={error ? `${inputId}-error` : undefined}
        style={{ width: '100%', minHeight: 44, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${error ? theme.danger : theme.gray200}`, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: readOnly ? theme.gray50 : (fill || 'white'), fontFamily: theme.fontFamily }} />
      {error && <div id={`${inputId}-error`} style={{ fontSize: 11, color: theme.danger, marginTop: 4 }}>{error}</div>}
    </div>
  )
}

export function Sel({ label, value, onChange, options = [], required, style = {}, error, id, placeholder = 'Select...', fill, ...rest }) {
  const selectId = id || label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div style={style}>
      {label && <label htmlFor={selectId} style={{ display: 'block', fontSize: 11, fontWeight: 700, color: theme.gray600, marginBottom: 6 }}>{label}{required && <span style={{ color: theme.danger }} aria-hidden="true"> *</span>}</label>}
      <select id={selectId} value={value || ''} onChange={e => onChange && onChange(e.target.value)} required={required} {...rest}
        aria-invalid={!!error} aria-describedby={error ? `${selectId}-error` : undefined}
        style={{ width: '100%', minHeight: 44, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${error ? theme.danger : theme.gray200}`, fontSize: 13, outline: 'none', background: fill || 'white', color: value ? theme.navy : theme.textLight, boxSizing: 'border-box', fontFamily: theme.fontFamily }}>
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

// ── LOADING (spinner — button-level / short indeterminate waits only) ───────
export function Loading({ text = 'Loading...' }) {
  return (
    <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, color: theme.gray400 }}>
      <div className="ch-spinner" style={{ width: 28, height: 28, borderRadius: theme.radius.full, border: `3px solid ${theme.gray200}`, borderTopColor: theme.tealDeep, marginBottom: 12 }} />
      <div style={{ fontSize: 14 }}>{text}</div>
    </div>
  )
}

// ── SKELETON (structured content loading — MOTION.md) ───────────────────────
export function Skeleton({ width = '100%', height = 14, radius, style = {} }) {
  return <div className="ch-skeleton" style={{ width, height, borderRadius: radius ?? theme.radius.sm, ...style }} />
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

// ── EMPTY STATE ──────────────────────────────────────────────────────────────
// `cause` distinguishes the three real empty-state situations
// (SCREEN_PATTERNS.md pattern 30) so the message and action are appropriate:
// 'none' = nothing exists yet, 'filtered' = filters/search excluded everything,
// 'positive' = a genuinely good empty state (e.g. "no pending approvals").
export function Empty({ icon, message, action, onAction, cause = 'none' }) {
  // Backward compatible: a string icon (legacy emoji) still renders as text,
  // a passed lucide element renders as-is, and the default is a lucide Inbox.
  const node = icon == null ? <Inbox size={40} strokeWidth={1.5} />
    : typeof icon === 'string' ? <span style={{ fontSize: 44 }}>{icon}</span>
    : icon
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, color: theme.gray300, textAlign: 'center' }}>
      <div style={{ marginBottom: 16, display: 'flex' }} aria-hidden="true">{node}</div>
      <div style={{ fontSize: 15, color: theme.gray500, marginBottom: action ? 20 : 0, maxWidth: 320 }}>{message}</div>
      {action && (cause === 'filtered'
        ? <GhostBtn onClick={onAction}>{action}</GhostBtn>
        : <TealBtn onClick={onAction}>{action}</TealBtn>)}
    </div>
  )
}

// ── ERROR STATE ───────────────────────────────────────────────────────────────
// SCREEN_PATTERNS.md pattern 32. `variant`: 'network' gets reassuring,
// auto-retry framing; 'app' is a generic-but-human failure message. Always
// offers a next step — never a dead end.
export function ErrorState({ variant = 'app', message, onRetry }) {
  const copy = variant === 'network'
    ? { Icon: WifiOff, heading: "You're offline", body: message || "We'll keep trying to reconnect automatically." }
    : { Icon: AlertTriangle, heading: 'Something went wrong', body: message || "We couldn't load this. Please try again." }
  return (
    <div role="alert" aria-live="assertive" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, textAlign: 'center' }}>
      <div style={{ marginBottom: 12, display: 'flex', color: theme.gray400 }} aria-hidden="true"><copy.Icon size={36} strokeWidth={1.75} /></div>
      <div style={{ fontSize: 15, fontWeight: 700, color: theme.textDark, marginBottom: 4 }}>{copy.heading}</div>
      <div style={{ fontSize: 13, color: theme.gray500, marginBottom: onRetry ? 20 : 0, maxWidth: 320 }}>{copy.body}</div>
      {onRetry && <TealBtn onClick={onRetry}>Retry</TealBtn>}
    </div>
  )
}
