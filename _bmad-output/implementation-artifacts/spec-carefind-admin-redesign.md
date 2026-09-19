---
title: 'CareFind Admin Redesign - Replicate CareHub Pattern'
type: 'feature'
created: '2026-09-16'
status: 'done'
review_loop_iteration: 0
baseline_commit: '1c0f11296c08414819d5d041008096b7c08b5851'
context:
  - apps/carehub/src/pages/admin/AdminDashboard.jsx
  - apps/carehub/src/styles/theme.js
  - apps/carehub/src/components/ui/index.jsx
  - apps/carehub/src/components/ui/Sheet.jsx
  - apps/carehub/src/lib/platformPermissions.js
  - apps/carefind/src/modules/admin/AdminPanel.jsx
  - apps/carefind/src/modules/social-feed/Logo.jsx
  - apps/carefind/src/styles/theme.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** CareFind admin panel is a 1074-line monolith with ~163 useState hooks, inconsistent design, broken features, and no unified component system. It does not match CareHub's admin design pattern, making the ecosystem feel disjointed.

**Approach:** Complete rewrite of CareFind admin following CareHub's exact patterns: collapsible sidebar rail, CSS variable theme, shared design-system components, repository data layer, Cmd+K command palette, and domain-specific panels. Every tab will be rewritten to match CareHub's content patterns (tables, forms, empty/loading/error states).

## Boundaries & Constraints

**Always:** Use CareFind's Logo component (`apps/carefind/src/modules/social-feed/Logo.jsx`). Use shared design-system components from `packages/design-system/src/components/ui/`. Follow CareHub's exact CSS variable naming (`--bg`, `--panel`, `--fg`, `--muted`, `--border`, `--teal`, `--amber`, `--green`, `--red`). All data fetching must go through repository pattern with `callAdminAuth` for service-role access.

**Ask First:** Whether to keep existing tab structure (19 tabs) or consolidate to match CareHub's domain pattern (6 domains). Whether to implement full RBAC or keep simple admin check.

**Never:** Never use hardcoded colors (must use CSS variables). Never query Supabase directly from components (must use repository). Never create separate pages for forms (must use inline card forms). Never skip loading/empty/error states.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First load | Admin opens /admin | Dashboard with KPI cards, recent activity, pending counts | Show ErrorState with retry |
| Tab navigation | Admin clicks sidebar item | Smooth transition, correct panel loads | Show ErrorState if panel fails |
| Data fetch | Panel loads data | Loading skeleton → data table → empty state if no data | ErrorState with retry button |
| CRUD operation | Admin creates/edits/deletes | Optimistic update + undo toast, audit log entry | Rollback on error, show error toast |
| Realtime update | New data arrives via Supabase | Incremental state update without full reload | Log error, continue with current data |
| Command palette | Cmd+K pressed | Modal with fuzzy search, recent commands, dynamic actions | Close on Esc, navigate on Enter |
| Responsive | Mobile/tablet/desktop | Rail collapses, tables scroll horizontally, bottom sheets on mobile | Maintain functionality at all sizes |

</frozen-after-approval>

## Code Map

**CareHub reference files (read to understand patterns):**
- `apps/carehub/src/pages/admin/AdminDashboard.jsx` — Root layout, sidebar rail, tab routing, Cmd+K palette
- `apps/carehub/src/styles/theme.js` — CSS variables, theme toggle, dark-first design tokens
- `apps/carehub/src/components/ui/index.jsx` — Shared component library (Card, Button, Pill, DataTable, etc.)
- `apps/carehub/src/components/ui/Sheet.jsx` — Linear-style slide-over panel
- `apps/carehub/src/lib/platformPermissions.js` — RBAC permission definitions
- `apps/carehub/src/pages/admin/commandRegistry.js` — Cmd+K command definitions
- `apps/carehub/src/modules/health/repositories/index.js` — Repository pattern example
- `apps/carehub/src/hooks/useToast.js` — Toast notification hook

**CareFind files to create/modify:**
- `apps/carefind/src/modules/admin/AdminPanel.jsx` — REWRITE: Root layout with sidebar rail
- `apps/carefind/src/modules/admin/AdminSidebar.jsx` — REWRITE: Collapsible sidebar with Logo
- `apps/carefind/src/styles/theme.js` — MODIFY: Add CSS variables matching CareHub
- `apps/carefind/src/modules/admin/tabs/DashboardTab.jsx` — CREATE: KPI cards, recent activity
- `apps/carefind/src/modules/admin/tabs/UsersTab.jsx` — REWRITE: DataTable with status dots
- `apps/carefind/src/modules/admin/tabs/VerificationsTab.jsx` — REWRITE: Trust queue pattern
- `apps/carefind/src/modules/admin/tabs/PostsTab.jsx` — REWRITE: Content moderation table
- `apps/carefind/src/modules/admin/tabs/ReportsTab.jsx` — REWRITE: Reports queue
- `apps/carefind/src/modules/admin/tabs/ModerationQueue.jsx` — REWRITE: Unified moderation
- `apps/carefind/src/modules/admin/tabs/OrdersTab.jsx` — REWRITE: Financial table
- `apps/carefind/src/modules/admin/tabs/WithdrawalsTab.jsx` — REWRITE: Payout queue
- `apps/carefind/src/modules/admin/tabs/ShopTab.jsx` — REWRITE: E-commerce management
- `apps/carefind/src/modules/admin/tabs/AuditLog.jsx` — REWRITE: Audit trail viewer
- `apps/carefind/src/modules/admin/tabs/ErrorsTab.jsx` — CREATE: Error inbox
- `apps/carefind/src/modules/admin/AdminAiCopilot.jsx` — MODIFY: Match CareHub patterns
- `apps/carefind/src/modules/admin/commandRegistry.js` — CREATE: Cmd+K commands
- `apps/carefind/src/modules/admin/repositories/index.js` — CREATE: Repository pattern
- `apps/carefind/src/styles/tokens.css` — MODIFY: Ensure CSS variables match CareHub

## Tasks & Acceptance

**Execution:**
- [x] `apps/carefind/src/styles/theme.js` — Add CSS variables matching CareHub (--bg, --panel, --fg, --muted, --border, --teal, --amber, --green, --red, --overlay), add initTheme() and toggleTheme() functions, add dark-first default with light override via [data-theme="light"]
- [x] `apps/carefind/src/modules/admin/AdminPanel.jsx` — REWRITE: Collapsible sidebar rail (256px/64px), content area with sticky header, Cmd+K integration, tab routing, all state lifted to root
- [x] `apps/carefind/src/modules/admin/AdminSidebar.jsx` — REWRITE: Logo at top, nav items with icons, active state = filled teal background, collapse toggle, logout at bottom
- [x] `apps/carefind/src/modules/admin/repositories/index.js` — CREATE: Repository functions for all data (users, posts, reports, orders, withdrawals, verifications, audit_log) using callAdminAuth
- [x] `apps/carefind/src/modules/admin/commandRegistry.js` — CREATE: Cmd+K commands for navigation + dynamic actions (approve/reject/delete) based on current tab
- [x] `apps/carefind/src/modules/admin/tabs/DashboardTab.jsx` — CREATE: 6 KPI cards (users, posts, reports, orders, revenue, pending verifications), recent activity list, pending items summary
- [x] `apps/carefind/src/modules/admin/tabs/UsersTab.jsx` — REWRITE: DataTable with search, status dots (verified/unverified), hover actions (view, verify, ban), bulk selection, CSV export
- [x] `apps/carefind/src/modules/admin/tabs/VerificationsTab.jsx` — REWRITE: Trust queue pattern with SLA tracking, approve/reject actions, detail sheet
- [x] `apps/carefind/src/modules/admin/tabs/PostsTab.jsx` — REWRITE: DataTable with content preview, report count badge, status dots (active/flagged/deleted), hover actions (view, delete)
- [x] `apps/carefind/src/modules/admin/tabs/ReportsTab.jsx` — REWRITE: Reports queue with reason, post preview, resolve/dismiss actions
- [x] `apps/carefind/src/modules/admin/tabs/ModerationQueue.jsx` — REWRITE: Unified queue with priority scoring, source filters, bulk actions
- [x] `apps/carefind/src/modules/admin/tabs/OrdersTab.jsx` — REWRITE: Financial table with status (pending/completed/refunded), amount, buyer/seller, hover actions
- [x] `apps/carefind/src/modules/admin/tabs/WithdrawalsTab.jsx` — REWRITE: Payout queue with approve/process/pay flow, amount, seller info
- [x] `apps/carefind/src/modules/admin/tabs/ShopTab.jsx` — CREATE: E-commerce products table with status (active/pending/rejected), price, seller, hover actions
- [x] `apps/carefind/src/modules/admin/tabs/AuditLog.jsx` — REWRITE: Append-only table with actor, action, target, timestamp, filters
- [x] `apps/carefind/src/modules/admin/tabs/ErrorsTab.jsx` — CREATE: Error inbox with message, stack trace, count, resolve action
- [x] `apps/carefind/src/modules/admin/AdminAiCopilot.jsx` — MODIFY: Match CareHub's floating panel pattern, add Cmd+K integration
- [x] `apps/carefind/src/modules/admin/components/` — CREATE: Shared admin components (AdminPageHeader, StatusDot, RowActions, BulkActionBar)

**Acceptance Criteria:**
- Given admin opens /admin, when page loads, then collapsible sidebar rail appears with CareFind logo, nav items, and content area with KPI dashboard
- Given admin clicks sidebar item, when tab changes, then content area updates with correct panel, active state shows filled teal background
- Given admin presses Cmd+K, when palette opens, then fuzzy search shows navigation commands + dynamic actions based on current tab
- Given admin is on Users tab, when data loads, then DataTable shows users with status dots, search works, hover actions appear
- Given admin approves a user, when action completes, then optimistic update shows success, undo toast appears for 5 seconds, audit log entry is created
- Given admin is on mobile, when screen resizes, then sidebar collapses to 64px rail, tables scroll horizontally, bottom sheets appear for modals
- Given new data arrives via Realtime, when subscription fires, then incremental state update happens without full reload
- Given admin creates/edits/deletes, when operation completes, then all changes are logged in audit trail

## Spec Change Log

## Design Notes

**Sidebar Rail Pattern:** Following CareHub exactly — 256px expanded, 64px collapsed. Logo at top, nav items with icons + labels (hidden when collapsed), collapse toggle at bottom, logout at very bottom. Active item = filled teal background with white icon.

**Table Pattern:** 36px row height, sticky headers, status dots (colored circles with sr-only label), hover actions (icon buttons that appear on row hover), horizontal scroll on mobile, bulk selection bar at bottom.

**Form Pattern:** Inline card forms (not separate pages). Grid layout with `repeat(auto-fit, minmax(200px, 1fr))`. Cancel + Save buttons at bottom. Validation inline.

**Empty/Loading/Error:** Every panel handles all three states. Loading = skeleton or spinner. Empty = icon + message + optional CTA. Error = message + retry button.

**Command Palette:** Cmd+K opens modal. Fuzzy search with `command-score`. Recent commands boosted via localStorage. Dynamic per-tab actions (approve, reject, delete). Arrow keys to navigate, Enter to execute.

## Verification

**Commands:**
- `npx vite build` — expected: build succeeds with no errors
- Manual: Open /admin, verify sidebar rail collapses/expands
- Manual: Click each tab, verify correct panel loads with data
- Manual: Press Cmd+K, verify command palette opens and searches
- Manual: On Users tab, verify table loads with status dots and hover actions
- Manual: Approve a user, verify optimistic update and undo toast
- Manual: On mobile, verify sidebar collapses and tables scroll
- Manual: Check audit log, verify all actions are logged

**Manual checks (if no CLI):**
- All CSS variables are used (no hardcoded colors)
- All data fetching goes through repository (no direct Supabase queries)
- All panels handle loading/empty/error states
- Realtime subscriptions work for live updates
- Cmd+K palette works with fuzzy search
