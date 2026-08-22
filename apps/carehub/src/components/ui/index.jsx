import { Activity, ArrowLeft } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Button, Input, Select } from '@care-ecosystem/design-system/components/ui'
export { useToast } from '../../hooks/useToast'
export { Button, Card, Pill, Badge, StatusBadge, Avatar, Loading, Skeleton, CardSkeleton, Empty, ErrorState, Input, Select, Textarea, Toggle, Label, HelperText, ErrorMessage, Modal, ConfirmDialog, Toast, DataTable, StatCard } from '@care-ecosystem/design-system/components/ui'

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

// STAT CARD (shared — see packages/design-system/src/components/ui/StatCard.jsx)
// Slice 7: the shared StatCard KPI tile (icon+label row, large value, optional
// sub, `tone`/'alert' coloring, clickable) is re-exported directly. CareFind's
// unused, differently-laid-out StatCard was replaced by this one.

// ── BUTTONS (deprecated — legacy aliases of the shared Button) ───────────────
// Slice 2: TealBtn/DarkBtn/GhostBtn/RedBtn now alias the shared Button so the
// whole ecosystem has one button implementation (ROADMAP 3.1). New code uses
// <Button variant> directly. Remove these aliases once all call sites migrate.
export const TealBtn = (props) => <Button variant="primary" size="md" {...props} />
export const DarkBtn = (props) => <Button variant="secondary" size="md" {...props} />
export const GhostBtn = (props) => <Button variant="ghost" size="sm" {...props} />
export const RedBtn = (props) => <Button variant="danger" size="sm" {...props} />

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

// ── TOAST (shared — see packages/design-system/src/components/ui/Toast.jsx) ───
// Slice 5: the shared Toast (success/error/warning/info, one inline action for
// the Undo pattern, role="status" + aria-live) is re-exported directly. It is
// responsive by default (mobile: bottom-center above the bottom nav; desktop:
// top-right) and accepts an explicit `position` override.

// ── FORM INPUTS (deprecated — legacy aliases of the shared primitives) ───────
// Slice 3: Inp/Sel now alias the shared Input/Select; Textarea/Toggle are the
// shared components re-exported directly. New code uses Input/Select (ROADMAP
// 3.2). Remove Inp/Sel once all call sites migrate.
export const Inp = (props) => <Input {...props} />
export const Sel = (props) => <Select {...props} />

// ── DATA TABLE (shared — see packages/design-system/src/components/ui/DataTable.jsx) ─
// Slice 6: the shared DataTable (sortable aria-sort headers, count, row hover,
// trailing actions column, controlled pagination, mobile → card-list transform,
// `variant="cards"`) is re-exported directly. useBreakpoint is the shared hook
// (re-exported from the shared package via hooks/useBreakpoint).
