import { forwardRef, useEffect, useMemo, useRef, useState, cloneElement, isValidElement } from 'react'
import { Activity, ArrowLeft, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Inbox, WifiOff, AlertTriangle, Check, X } from 'lucide-react'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
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

// ── STATUS BADGE ─────────────────────────────────────────────────────────────
// The one status→pill registry for CareHub (T3.3). Covers the hospital patient
// flow (Reception/Triage statuses) and the generic workflow statuses every
// module shares (pending/completed/confirmed/cancelled/paid/…). Reception and
// Triage previously kept private copies of this map with divergent fallbacks
// ('Unknown' vs '—'); the shared fallback is the raw status or '—'.
const STATUS_PILLS = {
  // Patient flow (Reception → Triage → Doctor → Pharmacy → Lab → Discharged)
  at_reception: { label: 'At Reception', type: 'blue' },
  at_triage: { label: 'At Triage', type: 'amber' },
  at_doctor: { label: 'With Doctor', type: 'purple' },
  at_pharmacy: { label: 'At Pharmacy', type: 'teal' },
  at_lab: { label: 'At Lab / Imaging', type: 'purple' },
  discharged: { label: 'Discharged', type: 'green' },
  admitted: { label: 'Admitted', type: 'red' },
  referred: { label: 'Referred Out', type: 'purple' },
  transferred: { label: 'Emergency Transfer', type: 'red' },
  // Generic workflow statuses
  pending: { label: 'Pending', type: 'amber' },
  confirmed: { label: 'Confirmed', type: 'green' },
  completed: { label: 'Completed', type: 'green' },
  cancelled: { label: 'Cancelled', type: 'red' },
  done: { label: 'Done', type: 'green' },
  paid: { label: 'Paid', type: 'green' },
  unpaid: { label: 'Unpaid', type: 'red' },
  refunded: { label: 'Refunded', type: 'gray' },
  active: { label: 'Active', type: 'green' },
  suspended: { label: 'Suspended', type: 'red' },
}
export function StatusBadge({ status }) {
  const s = STATUS_PILLS[status] || { label: status || '—', type: 'gray' }
  return <Pill label={s.label} type={s.type} />
}

// ── DETAIL HEADER ─────────────────────────────────────────────────────────────
// The standardized "drill-in" page chrome (T3.4): a back button + title +
// subtitle row. Hospital detail views (Reception registration, Triage vitals,
// Doctor consultation, RxInbox prescription) each hand-rolled this identical
// 38px-back-button header; one component keeps the chrome consistent and the
// aria-label uniform.
export function DetailHeader({ onBack, title, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
      <button onClick={onBack} aria-label='Back' style={{ width: '38px', height: '38px', borderRadius: theme.radius.md, background: 'white', border: `1px solid ${theme.border}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.navy, flexShrink: 0 }}><ArrowLeft size={16} /></button>
      <div><div style={{ fontWeight: '900', fontSize: '18px', color: theme.navy }}>{title}</div>{sub && <div style={{ fontSize: '12px', color: theme.gray400 }}>{sub}</div>}</div>
    </div>
  )
}

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

// ── DATA TABLE ────────────────────────────────────────────────────────────────
// The one table implementation for every operational list in CareHub
// (SCREEN_PATTERNS.md patterns 5–6, 13): a real <table> with sortable
// aria-sort headers, a result count, empty/filtered states, row hover, a
// trailing row-actions column, optional pagination, and a mobile → card-list
// transform via useBreakpoint. `variant="cards"` renders the same column model
// as rich cards (used by the approval/warehouse/client lists whose dense
// multi-field content does not fit a row).
//
// Columns: `{ key, label, sortable, sortValue(row), align, render(row) }`.
// `sortValue` defaults to `row[key]`; render defaults to a plain-text cell.
// Sorting is internal state — click a sortable header to toggle asc/desc.
//
// `count`: a node shown above the list ("12 products"). When pagination is on,
// a "X–Y of N" range replaces it in the footer unless overridden.
// `empty`/`loading`/`error`+`onRetry`: the standard state surface, so callers
// replace their bespoke loading/empty/error blocks with these props.
// `actions(row)`: optional trailing column of per-row controls.
// `onRowClick`/`rowStyle`: row interaction (rowStyle can tint rows, e.g. the
// Inventory low-stock / Appointments "today" highlights).
// Pagination is fully controlled: pass `page`, `setPage`, `pageSize`, and
// optionally `total` (when rows are a slice of a larger set).
// `mobileCard(row)` (table variant only): the mobile card-list transform;
// defaults to a label/value card built from the columns.
// `renderCard(row)` (cards variant only): the rich card body.
export function DataTable({ rows = [], columns = [], actions, onRowClick, rowStyle, count, empty, loading, error, onRetry, page, setPage, pageSize, total, variant = 'table', renderCard, mobileCard }) {
  const { isMobile } = useBreakpoint()
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  const sortable = columns.some(c => c.sortable)
  const sorted = useMemo(() => {
    if (!sortKey) return rows
    const col = columns.find(c => c.key === sortKey)
    if (!col) return rows
    const get = col.sortValue || (r => r[col.key])
    const dir = sortDir === 'desc' ? -1 : 1
    return [...rows].sort((a, b) => {
      const av = get(a); const bv = get(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }, [rows, columns, sortKey, sortDir])

  const hasPagination = pageSize != null && setPage != null && page != null
  const pageCount = hasPagination ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1
  const safePage = hasPagination ? Math.min(page, pageCount - 1) : 0
  const visible = hasPagination ? sorted.slice(safePage * pageSize, safePage * pageSize + pageSize) : sorted
  const shown = total != null ? total : rows.length

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[6] }}>
      {[0, 1, 2].map(i => <CardSkeleton key={i} />)}
    </div>
  )
  if (error) return <ErrorState message={error} onRetry={onRetry} />
  if (rows.length === 0) return empty || <Empty message="Nothing here yet" />

  const toggleSort = (col) => {
    if (!col.sortable) return
    if (sortKey !== col.key) { setSortKey(col.key); setSortDir('asc'); return }
    setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
  }

  const sortBar = sortable && variant === 'cards' && (
    <div role="group" aria-label="Sort" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: theme.space[6] }}>
      {columns.filter(c => c.sortable).map(c => {
        const active = sortKey === c.key
        return (
          <button key={c.key} onClick={() => toggleSort(c)} aria-pressed={active}
            style={{ padding: '6px 12px', borderRadius: theme.radius.full, border: active ? `1px solid ${theme.tealDeep}` : `1px solid ${theme.border}`, background: active ? theme.tealMist : 'white', color: active ? theme.tealDeep : theme.gray600, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {c.label}
            {active && (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
          </button>
        )
      })}
    </div>
  )

  const countLine = (count || shown) != null && (
    <div style={{ fontSize: 12, color: theme.gray500, marginBottom: theme.space[6], fontWeight: 600 }}>{count || `${shown} item${shown !== 1 ? 's' : ''}`}</div>
  )

  // ── CARDS VARIANT (rich card lists: Orders, Stock, Clients) ────────────────
  if (variant === 'cards') {
    return (
      <div>
        {countLine}
        {sortBar}
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[6] }}>
          {visible.map(row => (
            <Card key={row.id} onClick={onRowClick ? () => onRowClick(row) : undefined} style={{ padding: 0, overflow: 'hidden', ...(rowStyle ? rowStyle(row) : {}) }}>
              {renderCard ? renderCard(row) : (
                <div style={{ padding: theme.space[8] }}>
                  {columns.map(c => (
                    <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: `1px solid ${theme.gray100}` }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: theme.gray400, textTransform: 'uppercase' }}>{c.label}</span>
                      <span style={{ fontSize: 13, color: theme.navy, textAlign: 'right' }}>{c.render ? c.render(row) : String(row[c.key] ?? '—')}</span>
                    </div>
                  ))}
                  {actions && <div style={{ display: 'flex', gap: 6, marginTop: theme.space[6] }}>{actions(row)}</div>}
                </div>
              )}
            </Card>
          ))}
        </div>
        {hasPagination && pageCount > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 4px', fontSize: 12, color: theme.gray500 }}>
            <span>{safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, shown)} of {shown}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={safePage === 0} aria-label="Previous page" style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: `1px solid ${theme.border}`, background: safePage === 0 ? theme.gray100 : 'white', color: safePage === 0 ? theme.gray400 : theme.navy, fontWeight: 700, fontSize: 12, cursor: safePage === 0 ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}><ChevronLeft size={13} /> Prev</button>
              <button onClick={() => setPage(Math.min(pageCount - 1, page + 1))} disabled={safePage >= pageCount - 1} aria-label="Next page" style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: `1px solid ${theme.border}`, background: safePage >= pageCount - 1 ? theme.gray100 : 'white', color: safePage >= pageCount - 1 ? theme.gray400 : theme.navy, fontWeight: 700, fontSize: 12, cursor: safePage >= pageCount - 1 ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>Next <ChevronRight size={13} /></button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── TABLE VARIANT ──────────────────────────────────────────────────────────
  // Mobile → card-list transform: at phone width the same column model renders
  // as stacked cards (or the caller's `mobileCard`) instead of a horizontal-
  // scroll table, matching CareFind's mobile-first pattern for long lists.
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[6] }}>
        {countLine}
        {visible.map(row => (
          <Card key={row.id} onClick={onRowClick ? () => onRowClick(row) : undefined} style={{ padding: theme.space[8], ...(rowStyle ? rowStyle(row) : {}) }}>
            {mobileCard ? mobileCard(row) : (
              <div>
                {columns.map(c => (
                  <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: `1px solid ${theme.gray100}` }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: theme.gray400, textTransform: 'uppercase' }}>{c.label}</span>
                    <span style={{ fontSize: 13, color: theme.navy, textAlign: 'right' }}>{c.render ? c.render(row) : String(row[c.key] ?? '—')}</span>
                  </div>
                ))}
                {actions && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: theme.space[6] }}>{actions(row)}</div>}
              </div>
            )}
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div>
      {countLine}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${theme.border}`, background: theme.gray50 }}>
                {columns.map(c => (
                  <th key={c.key}
                    aria-sort={c.sortable && sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    onClick={() => toggleSort(c)}
                    style={{ padding: '12px 14px', textAlign: c.align || 'left', fontSize: 11, fontWeight: 700, color: theme.gray400, textTransform: 'uppercase', whiteSpace: 'nowrap', cursor: c.sortable ? 'pointer' : 'default', userSelect: 'none' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {c.label}
                      {c.sortable && sortKey === c.key && (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                    </span>
                  </th>
                ))}
                {actions && <th style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: theme.gray400, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map(row => (
                <tr key={row.id} className="ch-data-row" onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={{ borderBottom: `1px solid ${theme.gray100}`, cursor: onRowClick ? 'pointer' : 'default', transition: 'background 0.12s ease', ...(rowStyle ? rowStyle(row) : {}) }}>
                  {columns.map(c => (
                    <td key={c.key} style={{ padding: '12px 14px', textAlign: c.align || 'left' }}>{c.render ? c.render(row) : String(row[c.key] ?? '—')}</td>
                  ))}
                  {actions && <td style={{ padding: '12px 14px' }}>{actions(row)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hasPagination && pageCount > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderTop: `1px solid ${theme.border}`, fontSize: 12, color: theme.gray500 }}>
            <span>{safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, shown)} of {shown}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={safePage === 0} aria-label="Previous page" style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: `1px solid ${theme.border}`, background: safePage === 0 ? theme.gray100 : 'white', color: safePage === 0 ? theme.gray400 : theme.navy, fontWeight: 700, fontSize: 12, cursor: safePage === 0 ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}><ChevronLeft size={13} /> Previous</button>
              <button onClick={() => setPage(Math.min(pageCount - 1, page + 1))} disabled={safePage >= pageCount - 1} aria-label="Next page" style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: `1px solid ${theme.border}`, background: safePage >= pageCount - 1 ? theme.gray100 : 'white', color: safePage >= pageCount - 1 ? theme.gray400 : theme.navy, fontWeight: 700, fontSize: 12, cursor: safePage >= pageCount - 1 ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>Next <ChevronRight size={13} /></button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
