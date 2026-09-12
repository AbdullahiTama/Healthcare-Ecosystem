---
title: 'CareHub Super Admin — Command Center (Rail, Table, Cmd+K)'
type: 'feature'
created: '2026-09-06'
status: 'done'
review_loop_iteration: 0
baseline_commit: '9b10456a2a6e3900dc7dcefec4825a55c165ad0f'
context:
  - _bmad-output/specs/spec-carehub-admin-dashboard/SPEC.md
  - _bmad-output/planning-artifacts/architecture/architecture-HealthCare-Ecosystem-2026-09-06/ARCHITECTURE-SPINE.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Owner lives in `carefindhub.com/admin` (1,023 lines, 7 equal top tabs, card lists, modal detail, 30s poll) — pending approvals are 3 pages down, table clamp misses rows, and every approve requires navigation, not command. It fails the 10-second trust test.

**Approach:** Rebuild as quiet-chrome command center: 256px sidebar → 64px rail + `Cmd+K` (Stripe-Linear), dense Stripe table as product (36px, sticky header, status dot, hover actions), Linear sheet not modal, 6-cap KPIs, dark-first tokens. One spec, cross-layer (DB view, BE RLS, UI).

## Boundaries & Constraints

**Always:** Repository-seam only (AD-1) — UI→repo→sbFetch, no direct PostgREST; RLS `business_id IN current_business_ids() OR is_platform_admin()` behaviorally verified (AD-2); financial `SECURITY DEFINER` idempotent `calculate_agent_earnings` / `mark_payout_paid` never client calc (AD-3); dark-first CSS vars, color=state only, Quiet Chrome (AD-4); permission reuse `navCatalogueFor` (AD-5); module registry single source (AD-6).

**Ask First:** Changing `supabase/migrations/` vs loose `sql/`; adding new deps beyond `cmdk`+`command-score`; changing 20-cap trigger or `platform_team_members` view `security_invoker`.

**Never:** Chat-widget AI, 5 decorative charts, poll Refresh, hard-delete default, second permission system, Tailwind/MUI, chat over old UI, light-only hardcoded hex.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cmd+K approve | Owner hits Cmd+K, types `app ac`, selects `Approve Acme` (pending) | Executes `updateBusiness(id, active)` via repo, table optimistic + undo toast 5s, audit logged | If 20-cap? Not here; if RLS denies → toast `No permission` + locked card |
| Table search | `ilike` “acme, inc” with specials | Encoded filter, paginated via `getBusinessesFiltered` limit/offset, no clamp miss | Invalid chars → escaped, returns 0 rows + empty with CTA |
| Sheet detail | Click row → sheet opens | Shows timeline pending→active→sus→revoked with distinction, suspend vs revoke copy | Mobile → bottom sheet 50% drag |
| KPI strip | 28 businesses, 3 pending | Hero Pending + 5 secondary with delta+sparkline, one 30d onboarding chart only | Empty → onboarding illustration + one CTA |
| Cmd+K fuzzy | Types `pay` | Lists `Mark Paid`, `Go to Payouts`, recent top | No match → “No commands” + create role hint |

</frozen-after-approval>

## Code Map

- `apps/carehub/src/pages/admin/AdminDashboard.jsx:65` — CURRENT 1,023-line 7-tab panel, card lists, modal `Business Details`, 30s poll — REPLACE with rail+table+sheet+Cmd+K per AD-4/10; keep `DashboardStats` but cap 6, add Daily Brief card
- `apps/carehub/src/services/supabase.js:42` — `getBusinesses` (all) → USE `getBusinessesFiltered` (already added) with `limit/offset` + `deleted_at=is.null`; add `pagedQuery` fallback for 1000-row clamp
- `apps/carehub/src/lib/platformPermissions.js:1` — 8-perm matrix reuse AD-5 — KEEP, add `cmdk` registry entry per permission
- `apps/carehub/src/lib/carefindhubExports.js:1` — statement PDF `window.open+print` — KEEP for Ledger, not touched here
- `apps/carehub/src/styles/theme.js` — tokens `tealDeep, amber, border` — EXTEND with CSS vars `data-theme` dark-first per AD-4
- `apps/carehub/sql/20260907_admin_roles_description_and_platform_view.sql` — view `platform_team_members` → ENSURE `security_invoker=true` per AD-2
- `apps/carehub/src/components/ui/index.jsx` — `Card, Pill, Modal, ConfirmDialog, StatCard` — REUSE, add `Sheet` (slide-over) variant for AD-4

## Tasks & Acceptance

**Execution:**
- [x] `apps/carehub/src/styles/theme.js` — add CSS var dark-first tokens + `data-theme` switch, color=state only — AD-4
- [x] `apps/carehub/src/pages/admin/AdminDashboard.jsx` — replace top tabs with 256px sidebar → 64px rail + Cmd+K palette (`cmdk` + `command-score`), Businesses cards→Stripe table (36px, sticky, dot, hover actions, bulk bar), modal→sheet (40%/50% mobile), KPI cap 6 + one trend, 30s poll→realtime pulse — AD-1,4,6,10
- [x] `apps/carehub/src/components/ui/Sheet.jsx` — new slide-over (Linear) with drag handle, focus trap — AD-4
- [x] `apps/carehub/src/pages/admin/commandRegistry.js` — new `kbar` registry: 20 commands (Approve/Revoke/Pay, Go to…) filtered by `navCatalogueFor` perms — AD-5,10
- [x] `apps/carehub/src/services/supabase.js` — wire BusinessesPanel to `getBusinessesFiltered` + count header, encode ilike specials — AD-1,2

**Acceptance Criteria:**
- Given owner on `/admin` pending=3, when `Cmd+K` → `app ac` → `Enter`, then `Acme` becomes active, table shows undo toast, no navigation, recent top
- Given 28 businesses, when search “acme, inc” then table filters server-side, pagination 10/page, no clamp miss via count header
- Given click row, when sheet opens then timeline shows pending→active→sus/rev distinction, Suspend (temp) vs Revoke (withdrawal) copy + correct next state
- Given dark OS, when load then dark tokens active, color only on status pills/dots, WCAG AA passes, light toggle persists
- Given mobile 375px, when open sheet then bottom sheet 50% with drag, table collapses to card

## Spec Change Log

## Design Notes

- Quiet Chrome: near-monochrome surfaces, one accent (teal), 13px body, symbols over labels (Linear). Reference `brainstorm.html:Research mirror` for 4 KPIs→6-cap.
- Golden example — table row: `• Acme Pharmacy • Lagos • pharmacy • growth — [dot amber] pending [hover: Approve | Suspend]`; amount `₦ 1,200.00` right-aligned mono.

## Verification

**Commands:**
- `npm run build --prefix apps/carehub` -- expected: 304 modules transformed, no `color` hardcoded outside tokens
- `npm test --prefix apps/carehub -- src/lib/__tests__/platformPermissions.test.js src/lib/__tests__/carefindhubExports.test.js` -- expected: 10 passed (after tinypool fix, manual `node:file://` verification is fallback)

**Manual checks:**
- Visual: rail 256→64 collapses, table sticky header, sheet slide-over, KPI sparklines, pulse dot replaces Refresh
- A11y: Cmd+K focus trap, arrow nav, `aria-pressed` on rail, sheet `role=dialog` + Esc close, 95+ Lighthouse

## Suggested Review Order

**Entry — quiet-chrome command center**

- Rail 256→64 + Cmd+K palette is the spine — start here to grasp nav + command
  [`AdminDashboard.jsx:1263`](../../apps/carehub/src/pages/admin/AdminDashboard.jsx#L1263)

**Command & permissions**

- 20+ commands filtered by `navCatalogueFor` perms, recent boosting, Cmd+K fuzzy
  [`commandRegistry.js:39`](../../apps/carehub/src/pages/admin/commandRegistry.js#L39)

- Platform perm reuse — `normalizePlatformPermissions` single pattern
  [`platformPermissions.js:8`](../../apps/carehub/src/lib/platformPermissions.js#L8)

**Table as product**

- Stripe dense table 36px sticky dot + hover bulk bar replaces cards
  [`AdminDashboard.jsx:286`](../../apps/carehub/src/pages/admin/AdminDashboard.jsx#L286)

- Server ilike + count header avoids 1000-row clamp
  [`supabase.js:411`](../../apps/carehub/src/services/supabase.js#L411)

**Sheet + lifecycle**

- Linear sheet 40%/50% mobile with focus trap + timeline `pending→revoked`
  [`Sheet.jsx:13`](../../apps/carehub/src/components/ui/Sheet.jsx#L13)

**Tokens + realtime**

- Dark-first CSS vars `data-theme` + `color=state` only
  [`theme.js:13`](../../apps/carehub/src/styles/theme.js#L13)

- Realtime pulse `authClient.channel` replaces 30s poll, with offline + reduced-motion
  [`AdminDashboard.jsx:1391`](../../apps/carehub/src/pages/admin/AdminDashboard.jsx#L1391)

**KPI + brief**

- 6-cap KPI hero Pending + sparklines + 30d single trend + DailyBrief
  [`AdminDashboard.jsx:64`](../../apps/carehub/src/pages/admin/AdminDashboard.jsx#L64)

**Tests & config**

- Platform + export tests 10 passed — matrix spot-check
  [`platformPermissions.test.js:1`](../../apps/carehub/src/lib/__tests__/platformPermissions.test.js#L1)

- View `security_invoker=true` masked columns
  [`20260907_admin_roles_description_and_platform_view.sql:8`](../../apps/carehub/sql/20260907_admin_roles_description_and_platform_view.sql#L8)
