# UI/UX Transformation Roadmap — HealthCare Ecosystem

**Version**: 1.0
**Baseline**: Current state (see UI-UX-AUDIT.md)
**Target**: Premium, cohesive SaaS design system (see DESIGN-SYSTEM.md, INFORMATION-ARCHITECTURE.md)
**Approach**: 8-stage BMAD implementation loop

---

## Stage Overview

| Stage | Focus | Duration | Key Deliverables |
|-------|-------|----------|------------------|
| 1 | Design Foundation | 1-2 weeks | Unified tokens, single theme.js |
| 2 | Application Shell | 1-2 weeks | Mobile shell, tablet rail, desktop layout |
| 3 | Core Primitives | 2-3 weeks | Button, Input, Modal, Toast, Table, Card, Form |
| 4 | Dashboard | 1 week | Role-adaptive KPI, worklist, quick actions |
| 5 | High-Frequency Workflows | 2-3 weeks | POS, Inventory, Appointments, Staff |
| 6 | Secondary Modules | 2 weeks | Purchases, Debts, Reports, Settings |
| 7 | CareFind | 2 weeks | Search, Profiles, Seller Dashboard, Wallet |
| 8 | Final Polish | 1 week | Accessibility, responsiveness, motion, consistency |

**Total Estimated**: 12-16 weeks

---

## Stage 1: Design Foundation (Weeks 1-2)

### Objective
Single source of truth for all design tokens across both apps.

### Tasks

#### 1.1 Unify Theme Tokens
- [ ] Merge `carefind/theme.js` → `carehub/theme.js` (single canonical token file)
- [ ] Align neutral scale to CareHub's warmer gray values
- [ ] Unify semantic colors: success = green `#16a34a` (not brand teal)
- [ ] Remove duplicate aliases (`amberText`, `starAmber`, `amberBg`, `amberSoft`, etc. → single amber set)
- [ ] Add missing tokens: `outline` button variant, `combobox`, `datepicker` states
- [ ] Verify all tokens used in components (no hardcoded values remain)

#### 1.2 CSS Variables Sync
- [ ] Update `carefind/global.css` `:root` to match unified theme.js
- [ ] Update `carehub/global.css` `:root` to match
- [ ] Add CSS custom properties for new components (combobox, datepicker, command menu)
- [ ] Ensure reduced-motion media query covers all new animations

#### 1.3 Token Documentation
- [ ] Create `docs/design/TOKENS.md` with complete token reference
- [ ] Add usage guidelines per token category
- [ ] Document CareHub vs CareFind differences explicitly

### Acceptance Criteria
- Single `theme.js` imported by both apps (or shared package)
- Zero hardcoded color/space/radius values in component library
- All semantic states have accessible contrast ratios
- CSS variables match JS tokens exactly

---

## Stage 2: Application Shell (Weeks 3-4)

### Objective
Consistent, responsive shell across all routes in both apps.

### Tasks

#### 2.1 Mobile Shell (P0)
- [x] **CareHub**: Replace floating ☰ hamburger with proper IconButton (44×44px, aria-label)
- [x] **CareHub**: Remove magic number `paddingLeft: 56px` — use CSS variable for drawer width
- [x] **CareFind**: AppShell renders mobile header + BottomNav (not passthrough) — AppShell always renders DesktopHeader (so mobile has a header), and every shell page renders `{isMobile && <BottomNav />}` on mobile; verified across 20+ pages
- [x] Both apps: Mobile drawer (240px max, 80vw) with consistent backdrop
- [x] Both apps: BottomNav on all mobile routes (5 items max)

#### 2.2 Tablet Rail (P1)
- [x] CareHub: Icon-only rail (64px) with tooltips — already implemented, verify
- [x] CareFind: Collapsed LeftSidebar (64px) with tooltips
- [x] Both: Right sidebar moves below main content on tablet

#### 2.3 Desktop Layout (P1)
- [x] CareHub: Sidebar (210px) + TopBar + Content (max-width 1200px centered)
- [x] CareFind: Header + LeftSidebar (240px) + Main (max 900px) + RightSidebar (300px)
- [x] Both: Three-column block centered with max-width, not edge-to-edge

#### 2.4 Page Header Pattern (P1)
```
StandardPageHeader:
├── Breadcrumb (desktop only)
├── Title (h1)
├── Description (optional)
├── Context Actions (filter, view toggle)
└── Primary Action (TealBtn, right-aligned)
```
- [x] Create `PageHeader` component in shared UI
- [x] Migrate all routes to use it
- [x] Remove hand-rolled headers (POS, Warehouses, Search, etc.)

#### 2.5 Navigation IA Implementation
- [x] CareHub: Group 30+ nav items into workflow sections (Overview, Operations, Patients, Clinical, Finance, People, Intelligence, Ecosystem, Admin)
- [x] CareHub: Role-aware visibility (clinical only for hospital type)
- [x] CareFind: LeftSidebar for authenticated, BottomNav for public — desktop/tablet LeftSidebar (240px, icon rail at 64px), mobile BottomNav (5 tabs + authenticated More overflow: Wallet/Saved/Notifications)
- [x] Both: Badge counts on nav items with attention needs — CareHub sidebar NotificationBell, CareFind LeftSidebar notifications badge, BottomNav unread-news badge, header bell badge

### Acceptance Criteria
- Every route has consistent header/nav on all breakpoints
- No "passthrough" mobile layouts
- Touch targets ≥44px
- Keyboard navigation works end-to-end
- Role-based nav filtering works

---

## Stage 3: Core Primitives (Weeks 5-7)

### Objective
Single, reusable component library — zero duplication between apps.

### 3.1 Button System
- [x] Single `Button` component with variants: `primary`, `secondary`, `ghost`, `danger`, `outline` — `packages/design-system/src/components/ui/Button.jsx`
- [x] Sizes: `sm` (40px), `md` (44px), `lg` (48px)
- [ ] States: default, hover, active, focus-visible, disabled, loading — hover/active/disabled/loading done; **focus-visible outline not yet styled**
- [x] Icon support: `leftIcon`, `rightIcon` — **`iconOnly` not yet added**
- [x] Deprecate: `TealBtn`, `DarkBtn`, `GhostBtn`, `RedBtn` — **Slice 2**: all four alias the shared `Button` (`primary`/`secondary`/`ghost`/`danger`) in both apps' `components/ui/index.jsx`; new code uses `<Button variant>` directly, remove aliases after call sites migrate. Also fixed: Button's spinner keyframes are now injected once into `<head>` (a `<style>` inside `<button>` polluted `button.textContent` and duplicated per-instance)

### 3.2 Form Inputs
- [x] `Input` (text, email, password, number, tel, url) — **Slice 3**: shared `Input` in `Form.jsx` (label, error, helperText, `fill`, readOnly, min)
- [x] `Select` (single, with placeholder, error state) — **Slice 3**: shared `Select` (string or `{value,label}` options, placeholder, error, helperText, `fill`)
- [x] `Textarea` (auto-resize option) — **Slice 3**: shared `Textarea` (rows, error, helperText); **auto-resize not yet implemented**
- [ ] `Checkbox`, `Radio`, `RadioGroup`
- [x] `Toggle` (switch) — **Slice 3**: shared `Toggle` (role=switch, 44px, settings-row layout)
- [x] `Label` + `HelperText` + `ErrorMessage` composition — **Slice 3**: shared, wired into Input/Select/Textarea via `aria-describedby`
- [ ] **New**: `Combobox` (autocomplete, async options, creatable)
- [ ] **New**: `DatePicker` / `DateRangePicker` (critical for healthcare)
- [ ] **New**: `FileUpload` (drag-drop, preview, validation)
- Slice 3 deprecation: `Inp`/`Sel` alias the shared `Input`/`Select` in both apps; new code uses `Input`/`Select` directly

### 3.3 Modal / Drawer / Sheet
- [x] Single `Modal` component with props: `variant` (dialog|drawer|sheet), `size`, `preventClose` — **Slice 4**: shared `Modal.jsx` (dialog 500 / lg 700 / sm 420; drawer slides right, full-height; sheet slides up, bottom-anchored); legacy `sheet` boolean and `wide` boolean still supported; `preventClose`/`preventBackdropClose` both block backdrop-click + Escape
- [x] Focus trap, initial focus on first editable, return focus on close — **Slice 4**: shared, preserved from the CareHub implementation (verified by `modal.focus.test.jsx`)
- [x] Animations: dialog (fade+scale), drawer (slide right), sheet (slide up) — **Slice 4**: self-contained `ds-fade-in`/`ds-dialog-enter`/`ds-drawer-enter`/`ds-sheet-enter` keyframes injected once at module load (replaces CareFind's `cf-*-enter` classes; CareHub previously had none)
- [ ] Mobile: default to `sheet` variant (responsive)
- [x] Deprecate: separate Modal implementations — **Slice 4**: both app barrels re-export the shared `Modal`/`ConfirmDialog`; local copies deleted (backdrop unified on neutral-slate `theme.overlay`, CareFind loses its teal-tinted backdrop; close button unified on lucide `X`, CareHub loses its "×" text button; content wrapper unified on shared `Card`; aria id unified as `ds-modal-title`)

### 3.4 Toast / Notification
- [x] Single `Toast` component with responsive position (desktop: top-right, mobile: bottom) — **Slice 5**: shared `Toast.jsx` — responsive by default via an injected `.ds-toast` rule (mobile: bottom-center, anchored above the bottom nav at 88px, matching CareFind's previous placement; desktop: top-right); explicit `position` prop (`bottom-right`|`bottom-center`|`top-right`) pins one placement
- [x] Variants: success, error, warning, info — **Slice 5**: shared `TOAST_VARIANTS` (Check / X / AlertTriangle / no-icon) with `role="status"` + `aria-live="polite"`; slide-in `ds-toast-in` (nested inner div so the translateY animation never fights the centering transform), reduced-motion handled
- [ ] Swipe-to-dismiss on mobile
- [x] Action button support — **Slice 5**: one inline action for the Undo pattern (existing `actionLabel`/`onAction`)
- [x] Deprecate: separate Toast implementations — **Slice 5**: both app barrels re-export the shared `Toast`; local copies + `ch-toast`/`cf-toast` CSS classes and keyframes removed from app usage. Visual deltas: CareHub toasts move bottom-right → responsive (bottom-center mobile / top-right desktop); CareFind toasts move bottom-center → top-right on desktop (mobile unchanged). The `useToast` hooks remain app-local (byte-identical); promoting them to the shared package is deferred.

### 3.5 DataTable (The One Table)
- [x] Desktop: Full `<table>` with sort, paginate — **Slice 6**: shared `DataTable.jsx` (sortable `aria-sort` headers, sort chips for the cards variant, controlled pagination with X–Y of N footer, trailing actions column, `onRowClick`/`rowStyle`). Filtering, column visibility, row selection, bulk actions not yet implemented
- [x] Tablet: Horizontal scroll — **Slice 6**: `overflowX: auto` wrapper; sticky first column not yet implemented
- [x] Mobile: Card-list transform — **Slice 6**: automatic table → stacked-card transform via the shared `useBreakpoint`, with a `mobileCard(row)` override
- [x] Loading: Skeleton rows — **Slice 6**: `loading` renders 3 `CardSkeleton`s
- [x] Empty/Error: Standard state components — **Slice 6**: `empty`, `error`+`onRetry` wired to shared `Empty`/`ErrorState`
- [ ] Virtualization for 1000+ rows
- [ ] Column pinning (left/right)
- [ ] Row density toggle (comfortable/compact)
- Slice 6 notes: `useBreakpoint` promoted to the shared package (both apps' `hooks/useBreakpoint.js` are now re-export shims; CareFind's `isMobileOrTablet` preserved). CareHub's DataTable is deleted from its barrel; the row-hover rule moved from `.ch-data-row` to an injected `.ds-data-row` style (one shared style id, no per-app CSS). CareFind now also exports `DataTable` (previously CareHub-only) but has no call sites yet.

### 3.6 Card System
- [ ] Single `Card` with variants: `default`, `dense`, `elevated`, `interactive`, `sheet`
- [ ] Consistent padding/radius/shadow per variant
- [x] Clickable card: focus styles, keyboard activation — **Slice 1**: shared `Card` in `packages/design-system/src/components/ui/` (forwardRef, border + `elevation[1]`, clickable→button semantics with `currentTarget` check so Space inside a child input still types, hover elevation lift); CareFind cards gained a border as part of unification

### 3.7 State Components
- [x] `Loading` (spinner, full-screen, inline) — **Slice 1**: shared `Loading` (`text`, `fullScreen`)
- [x] `Skeleton` (card, table row, list item, custom) — **Slice 1**: shared `Skeleton` (composed via `width`/`height`/`radius`) + `CardSkeleton`; table-row/list-item variants compose from `Skeleton` when needed
- [x] `EmptyState` (cause: none|filtered|positive, action) — **Slice 1**: shared `Empty` (`cause`, string/emoji/lucide `icon`, ghost action for filtered)
- [x] `ErrorState` (variant: network|app, retry) — **Slice 1**: shared
- [ ] `SuccessState` (inline confirmation)

### 3.8 Navigation Components
- [ ] `Breadcrumb` (with collapse on mobile)
- [ ] `Tabs` (keyboard operable, indicator)
- [ ] `Tooltip` (hover/focus, accessible)
- [ ] `Dropdown` (menu, combobox-style)
- [ ] `CommandMenu` (⌘K global search, actions)
- [ ] `Pagination` (standalone, not just in DataTable)

### 3.9 Feedback Components
- [x] `Badge` / `Pill` (semantic types) — **Slice 1**: shared `Pill` (`Badge` alias) in `packages/design-system/src/components/ui/`
- [x] `StatusBadge` (shared registry) — **Slice 1**: shared `StatusBadge` (patient-flow + generic workflow registry, raw-status fallback)
- [x] `Avatar` (with fallback, group) — **Slice 1**: shared `Avatar` (initial fallback); avatar *group* still app-specific
- [ ] `Progress` (linear, circular, indeterminate)
- [ ] `Stepper` (multi-step forms)

### Acceptance Criteria
- Zero duplicate components between apps
- All components use theme tokens only (no hardcoded values)
- Storybook/visual docs for each component
- Accessibility audit passed (axe + manual)
- TypeScript types exported

---

## Stage 4: Dashboard (Week 8)

### Objective
Role-adaptive, actionable dashboard — "what needs me now?"

### Tasks

#### 4.1 KPI System
- [ ] KPI definitions per role (Owner, Pharmacist, Inventory Officer, Cashier, Clinician)
- [ ] `StatCard` with trend sparkline (optional) — the base `StatCard` KPI tile is already shared (**Slice 7**): promoted from CareHub into `packages/design-system/src/components/ui/StatCard.jsx` (icon+label row, large value, `tone`/'alert' coloring, clickable); CareFind's unused, differently-laid-out local StatCard was removed and its barrel re-exports the shared one. Trend sparkline still to build
- [ ] Clickable KPIs → navigate to relevant module

#### 4.2 Attention Section (Worklist)
- [ ] Unified "Needs Attention" feed across modules
- [ ] Items: Low stock, Out of stock, Overdue payments, Pending appointments, Expiring meds, Pending approvals
- [ ] Group by urgency, expandable sections
- [ ] "Show all" progressive disclosure

#### 4.3 Recent Activity
- [ ] Last 5-10 sales/appointments/actions
- [ ] Link to full history

#### 4.4 Quick Actions
- [ ] Role-aware primary actions (New Sale, Add Product, New Appointment, etc.)
- [ ] Permission-gated

#### 4.5 Trends (Owner)
- [ ] 7/30-day revenue, sales count, new clients
- [ ] Mini sparklines

### Acceptance Criteria
- Dashboard loads <1s (parallel data fetching)
- Zero horizontal scroll on mobile
- Every item actionable (click → detail/action)
- Role switching works without reload

---

## Stage 5: High-Frequency Workflows (Weeks 9-11)

### Objective
Migrate the most-used modules to the new system.

### 5.1 POS / Sales (CareHub) — P0
- [ ] New Sale flow: product search (Combobox), cart, payment, receipt
- [ ] Held sales management
- [ ] Credit sales workflow
- [ ] Mobile: compact header, bottom action bar
- [ ] Keyboard: barcode scanner support, quick keys

### 5.2 Inventory (CareHub) — P0
- [ ] Product list: DataTable with inline edit (stock, reorder, price)
- [ ] Low stock / Out of stock views (pre-filtered)
- [ ] Expiry tracking page
- [ ] Stock adjustments (modal form)
- [ ] Transfer between locations (drawer)

### 5.3 Appointments (CareHub) — P0
- [ ] Calendar view (month/week/day)
- [ ] Booking modal (DatePicker + TimePicker + Combobox for patient)
- [ ] Waitlist management
- [ ] Recurring appointments
- [ ] Mobile: agenda view

### 5.4 Staff (CareHub) — P1
- [ ] Staff directory with role badges
- [ ] Invite/onboard flow
- [ ] Schedule/shift view
- [ ] Permissions matrix UI

### 5.5 Clients/Patients (CareHub) — P1
- [ ] Directory with search, filters
- [ ] Profile: tabs (Overview, History, Communications, Documents)
- [ ] Credit/debt inline
- [ ] Add client modal (Combobox for existing, new form)

### 5.6 Search (CareFind) — P0
- [ ] Unified search: Products | Facilities | Professionals tabs
- [ ] Filter bar: Category, Location, Rating, Price, Availability
- [ ] Map view toggle
- [ ] Results: Card grid (mobile) / Table (desktop)
- [ ] Infinite scroll / pagination
- [ ] Recent searches, saved searches

### 5.7 Provider Profiles (CareFind) — P0
- [ ] Pharmacy: Products, Info, Reviews, Book Appointment
- [ ] Hospital: Services, Doctors, Book, Reviews
- [ ] Professional: Consultations, Subscriptions, Book
- [ ] Booking modal: DatePicker + TimePicker + Payment choice (CareCoins/Card)

### Acceptance Criteria
- All migrated pages use new component library
- Mobile experience intentional (not shrunk desktop)
- Loading/empty/error states on every async surface
- Keyboard navigation complete
- No regression in functionality

---

## Stage 6: Secondary Modules (Weeks 12-13)

### Objective
Migrate remaining modules with consistent patterns.

### Modules
| Module | Key Patterns |
|--------|--------------|
| Purchases | PO list, create PO (multi-line form), receive stock |
| Debts | Credit sales, payments, aging, collection actions |
| Expenses | Category, receipts, approval workflow |
| Reports | Report builder, saved reports, scheduling, export |
| Settings | Tabbed sections, form patterns, feature flags |
| Locations | CRUD, map picker, hours editor |
| Master Catalog | Search, categories, variant management |
| Messages | Threaded, compose, templates |
| Overview | Multi-branch KPI, comparison, drill-down |

### Patterns to Enforce
- List → DataTable (or Card grid)
- Create/Edit → Modal (simple) or Drawer (complex) or Page (very complex)
- Detail → Page with tabs
- Bulk actions → Toolbar when rows selected
- Export → Standard button in SectionHead

---

## Stage 7: CareFind (Weeks 14-15)

### Objective
Complete consumer marketplace experience.

### 7.1 Wallet & Payments
- [ ] Balance display (CareCoins + NGN equivalent)
- [ ] Top Up: package selection → Paystack → webhook confirmation
- [ ] Withdraw: bank selection (curated list), PIN, amount
- [ ] History: filters, export, retry failed

### 7.2 Bookings (Consumer)
- [ ] My Bookings: Upcoming | Past tabs
- [ ] Booking detail: modify, cancel, reschedule
- [ ] Prescription upload/view

### 7.3 Subscriptions
- [ ] Active subscriptions management
- [ ] Auto-renew toggle
- [ ] Billing history

### 7.4 Seller Dashboard
- [ ] Products CRUD (images, variants, pricing, stock)
- [ ] Orders: New → Processing → Ready → Completed
- [ ] Booking management (slots, fees, medium)
- [ ] Analytics: Views, conversions, revenue
- [ ] Payout settings (bank, schedule)

### 7.5 Public Pages
- [ ] Landing page (marketing, Lora font, BrandArt)
- [ ] Category browse (grid, filters)
- [ ] Map view (facilities, clustering)
- [ ] Verification flow (business, professional)

---

## Stage 8: Final Polish (Week 16)

### 8.1 Accessibility Audit
- [ ] axe-core automated scan (zero violations)
- [ ] Manual keyboard navigation (every route)
- [ ] Screen reader test (NVDA/VoiceOver)
- [ ] Color contrast verification (all text, states)
- [ ] Focus indicator visibility (all interactive)
- [ ] Reduced motion test (all animations)
- [ ] Touch target audit (mobile)

### 8.2 Responsiveness
- [ ] Test at: 320, 375, 428, 768, 1024, 1440, 1920
- [ ] Table mobile transform (all DataTables)
- [ ] Form stacking (all forms)
- [ ] Modal/drawer/sheet sizing
- [ ] Navigation behavior

### 8.3 Visual Consistency
- [ ] Spacing audit (no arbitrary values)
- [ ] Radius audit (only scale values)
- [ ] Shadow audit (only elevation scale)
- [ ] Color audit (only semantic tokens)
- [ ] Typography audit (only type scale)
- [ ] Icon size audit (only icon scale)

### 8.4 Motion & Micro-interactions
- [ ] Hover/active states on all buttons
- [ ] Transition timing consistent
- [ ] Skeleton loading on all async
- [ ] Toast enter/exit smooth
- [ ] Modal/drawer/sheet animations

### 8.5 Performance
- [ ] Bundle size check (code-split by route)
- [ ] Lazy-load heavy components (charts, maps, editors)
- [ ] Image optimization (WebP, srcset)
- [ ] Font loading (preload, font-display: swap)

### 8.6 Documentation
- [ ] Component library docs (Storybook or equivalent)
- [ ] Design token reference
- [ ] Migration guide for future pages
- [ ] Accessibility checklist
- [ ] Responsive breakpoints guide

---

## Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Token unification breaks CareFind visual | Medium | High | Stage 1: visual regression tests, feature flag rollout |
| Mobile shell breaks existing routes | High | High | Stage 2: test every route on mobile before merge |
| Component migration misses edge cases | Medium | Medium | Stage 3: storybook + visual tests per component |
| Dashboard role logic complex | Medium | Medium | Stage 4: unit test role→KPI mapping |
| POS regression (critical path) | Low | Critical | Stage 5: E2E tests, staging validation |
| CareFind seller onboarding broken | Medium | High | Stage 7: test with real sellers |

---

## Success Metrics

| Metric | Baseline | Target |
|--------|----------|--------|
| Visual regression (percy/chromatic) | N/A | 0 unexpected changes |
| Accessibility (axe) | Unknown | 0 violations AA |
| Mobile usability (Lighthouse) | Unknown | ≥90 |
| Bundle size (gzipped) | ~1.7MB | ≤1.2MB |
| First Contentful Paint | Unknown | ≤1.5s |
| Time to Interactive | Unknown | ≤3s |
| Component duplication | 2× (CareHub/CareFind) | 1× (shared) |
| Hardcoded values in UI | ~500 | 0 |
| Design token coverage | ~60% | 100% |

---

## Governance

### Design Review Gate (per stage)
1. Token compliance check
2. Accessibility audit
3. Responsive test
4. Visual regression
5. Functionality verification
6. Performance budget

### Merge Policy
- Feature branches per stage
- PR template with checklist
- Design review required for UI changes
- No direct commits to main

### Rollback Plan
- Feature flags for: new shell, new components, unified tokens
- Instant rollback via flag flip
- Database migrations separate from UI deployments

---

## Timeline Summary

```
Week 1-2   ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  Stage 1: Design Foundation
Week 3-4   ░░░░████████░░░░░░░░░░░░░░░░░░░░░░░░░░  Stage 2: Application Shell
Week 5-7   ░░░░░░░░████████████░░░░░░░░░░░░░░░░░  Stage 3: Core Primitives
Week 8     ░░░░░░░░░░████░░░░░░░░░░░░░░░░░░░░░░░  Stage 4: Dashboard
Week 9-11  ░░░░░░░░░░░░████████████░░░░░░░░░░░░  Stage 5: High-Frequency Workflows
Week 12-13 ░░░░░░░░░░░░░░████████░░░░░░░░░░░░░░  Stage 6: Secondary Modules
Week 14-15 ░░░░░░░░░░░░░░░░████████░░░░░░░░░░░░  Stage 7: CareFind
Week 16    ░░░░░░░░░░░░░░░░░░████░░░░░░░░░░░░░░░  Stage 8: Final Polish
```

---

## Next Immediate Actions

1. **Create unified theme.js** (Stage 1.1) — single PR
2. **Set up visual regression testing** (Percy/Chromatic) — before Stage 2
3. **Create shared UI package** (`packages/design-system`) — extract components/ui
4. **Mobile shell spike** — prototype CareHub + CareFind mobile shell in isolation
5. **Accessibility baseline** — run axe on current production

---

*This roadmap is a living document. Update after each stage based on learnings.*