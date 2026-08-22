import { Star } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Button, Input, Select } from '@care-ecosystem/design-system/components/ui'
export { useToast } from '../../hooks/useToast'
export { Button, Card, Pill, Badge, Avatar, Loading, Skeleton, CardSkeleton, Empty, ErrorState, Input, Select, Textarea, Toggle, Label, HelperText, ErrorMessage, Modal, ConfirmDialog, Toast, DataTable, StatCard } from '@care-ecosystem/design-system/components/ui'

// Shared component library for CareFind, built on the tokens in
// ../../styles/theme.js. Mirrors the shape and naming of CareHub's
// components/ui/index.jsx (docs/design/DESIGN_PRINCIPLES.md's consistency
// principle applies across the ecosystem, not just within one product) while
// meeting the states/responsiveness/accessibility bar in
// docs/design/COMPONENT_LIBRARY.md and docs/design/ACCESSIBILITY.md.

// ── STAT CARD (shared — see packages/design-system/src/components/ui/StatCard.jsx)
// Slice 7: the shared StatCard KPI tile is re-exported directly. CareFind's
// local StatCard was unused dead code; it has been replaced by the shared one.

// ── BUTTONS (deprecated — legacy aliases of the shared Button) ───────────────
// Slice 2: TealBtn/DarkBtn/GhostBtn/RedBtn now alias the shared Button so the
// whole ecosystem has one button implementation (ROADMAP 3.1). New code uses
// <Button variant> directly. Remove these aliases once all call sites migrate.
export const TealBtn = (props) => <Button variant="primary" size="md" {...props} />
export const DarkBtn = (props) => <Button variant="secondary" size="md" {...props} />
export const GhostBtn = (props) => <Button variant="ghost" size="sm" {...props} />
export const RedBtn = (props) => <Button variant="danger" size="sm" {...props} />

// ── SECTION HEAD ─────────────────────────────────────────────────────────────
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

// ── RATING ───────────────────────────────────────────────────────────────────
// A rating shown as five icons, with the value always available as text for
// assistive tech — shape and colour alone never carry the number
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

// The interactive twin of `Stars` — picking a rating rather than reading one.
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

// ── TOAST (shared — see packages/design-system/src/components/ui/Toast.jsx) ───
// Slice 5: the shared Toast (success/error/warning/info, one inline action for
// the Undo pattern, role="status" + aria-live) is re-exported directly. It is
// responsive by default (mobile: bottom-center above the bottom nav — the
// previous CareFind placement; desktop: top-right) and accepts an explicit
// `position` override.

// ── MODAL (shared — see packages/design-system/src/components/ui/Modal.jsx) ───
// Slice 4: Modal + ConfirmDialog are the shared components (dialog/drawer/sheet
// variants, focus trap, pattern 29) re-exported directly; legacy props `sheet`,
// `wide`, `preventBackdropClose`, `hideCloseButton` remain supported.

// ── FORM INPUTS (deprecated — legacy aliases of the shared primitives) ───────
// Slice 3: Inp/Sel now alias the shared Input/Select; Textarea/Toggle are the
// shared components re-exported directly. New code uses Input/Select (ROADMAP
// 3.2). Remove Inp/Sel once all call sites migrate.
export const Inp = (props) => <Input {...props} />
export const Sel = (props) => <Select {...props} />

// ── BRAND ILLUSTRATION ──────────────────────────────────────────────────────
// BRAND_GUIDELINES.md: the one illustration style used across the ecosystem —
// simple, geometric, brand-palette — reserved for empty states and onboarding.
// `BrandArt` is that style as a reusable SVG. `tone` picks the ink colour:
// 'light' on the navy/teal hero surfaces (Onboarding mobile header), 'dark'
// on light surfaces (desktop centered card).
export function BrandArt({ size = 104, tone = 'light', style = {} }) {
  const ink = tone === 'dark' ? theme.navy : '#fff'
  const soft = tone === 'dark' ? theme.tealDeep : 'rgba(255,255,255,0.35)'
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" fill="none" aria-hidden="true" style={style}>
      <rect x="6" y="6" width="84" height="84" rx="24" fill={soft} />
      <rect x="18" y="18" width="60" height="60" rx="16" fill={soft} opacity="0.85" />
      <circle cx="48" cy="40" r="16" fill={ink} />
      <circle cx="48" cy="40" r="5.5" fill={tone === 'dark' ? theme.cardBg : theme.tealDeep} />
      <path d="M34 74c0-8.8 6.3-14 14-14s14 5.2 14 14" stroke={ink} strokeWidth="7" strokeLinecap="round" />
    </svg>
  )
}
