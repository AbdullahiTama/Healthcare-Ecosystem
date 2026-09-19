import { ArrowLeft } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Button, Input, Select } from '@care-ecosystem/design-system/components/ui'
export { useToast } from '../../hooks/useToast'
export { Button, Card, Pill, Badge, StatusBadge, Avatar, Loading, Skeleton, CardSkeleton, Empty, ErrorState, Input, Select, Textarea, Toggle, Label, HelperText, ErrorMessage, Modal, ConfirmDialog, Toast, DataTable, StatCard } from '@care-ecosystem/design-system/components/ui'

// ── LOGO ─────────────────────────────────────────────────────────────────────
// The one CareHub brand mark — connected nodes symbol representing
// "connected care. Better health." Flat teal, no gradient, same icon
// everywhere the brand appears so it reads as one consistent mark.
export function Logo({ size = 30, style = {} }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 103.4 99.53"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="CareHub"
      style={{ flexShrink: 0, color: theme.tealDeep, ...style }}
    >
      <title>CareHub</title>
      <path d="M46.36 69.98 L55.57 70.24 C55.38 66.75 58.99 62.2 61.2 60.51 C90.65 94.47 39.38 115.83 32.17 84.06 L32.02 69.58 L30.22 67.44 C-12.65 71.94 -9.74 14.78 36.95 34.28 C22.43 -10.19 82.11 -12.51 69.28 33.81 C109.09 7.11 123.14 87.14 61.2 60.51 C67.18 53.9 69.77 52.92 75.98 52.99 L75.73 44.43 C73.12 46.35 65.42 43.67 62.43 40 C59.15 37.19 56.41 32.23 56.39 29.09 L48.13 28.95 C48.69 35.06 34.64 48.31 29.34 43.68 L29.03 54.09 C29.53 53.81 29.2 53.61 29.73 53.49 C37 51.84 48.02 64.13 46.36 69.98" fill="currentColor" fillRule="evenodd" />
      <path d="M52.38 11.16 C55.53 11.16 58.09 13.86 58.09 17.19 C58.09 20.51 55.53 23.21 52.38 23.21 C49.23 23.21 46.67 20.51 46.67 17.19 C46.67 13.86 49.23 11.16 52.38 11.16" fill="white" fillRule="evenodd" />
      <path d="M86.26 42.35 C89.41 42.35 91.97 45.05 91.97 48.38 C91.97 51.71 89.41 54.41 86.26 54.41 C83.1 54.41 80.55 51.71 80.55 48.38 C80.55 45.05 83.1 42.35 86.26 42.35" fill="white" fillRule="evenodd" />
      <path d="M18.05 41.96 C21.2 41.96 23.76 44.66 23.76 47.98 C23.76 51.31 21.2 54.01 18.05 54.01 C14.9 54.01 12.34 51.31 12.34 47.98 C12.34 44.66 14.9 41.96 18.05 41.96" fill="white" fillRule="evenodd" />
      <path d="M50.7 75.35 C53.86 75.35 56.41 78.05 56.41 81.38 C56.41 84.71 53.86 87.41 50.7 87.41 C47.55 87.41 45 84.71 45 81.38 C45 78.05 47.55 75.35 50.7 75.35" fill="white" fillRule="evenodd" />
    </svg>
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
