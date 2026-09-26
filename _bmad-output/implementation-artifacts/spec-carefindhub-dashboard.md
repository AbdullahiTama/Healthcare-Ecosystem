---
title: 'CareFindHub Dashboard stats-only with pending lists'
type: 'feature'
created: '2026-09-05'
status: 'done'
baseline_commit: 'bfd9478aec04b48b75970e067ded3fedf0781ca2'
review_loop_iteration: 0
context:
  - 'apps/carefind/sql/20260906_carefindhub_foundation.sql'
  - 'apps/carehub/src/services/supabase.js'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Super Admin needs stats-only landing view with live pending business approvals and pending agent applications, both linking to full tabs, and accurate counts for businesses/teams/e-commerce.

**Approach:** Build Dashboard that reads from foundation tables (`businesses`, `admin_team_members` via resolved single table, `ecommerce_enabled`) + `applications`/`agents` pending, using existing Supabase project `szdybxmgmhndoytqanfb` and shared `BUSINESS_PUBLIC_COLUMNS`, no management actions.

## Boundaries & Constraints

**Always:** Use shared project `szdybxmgmhndoytqanfb`; use `admin_team_members` single table (resolved from `platform_team_members`); show `Total businesses, Vendor approvals pending (status=pending), Active users (status=active), Admin teams (count admin_team_members), E-commerce participants (ecommerce_enabled=true)`; pending lists link to Businesses/Applications tabs.

**Ask First:** Adding new stats beyond table.

**Never:** Add management actions to Dashboard (stats-only); create second team table.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stats | `businesses` with mixed statuses | Counts: total, pending, active, admin_team_members, ecommerce_enabled true | 0 when empty |
| Pending businesses | `status=pending` rows exist | List shows pending businesses with link to Businesses tab detail | Empty state "No pending approvals" |
| Pending agents | `agents status=pending` or `applications type=agent pending` | List shows pending agents with link to Applications | Empty state |
| No data | Empty tables | Stats 0, pending lists empty, no error | No crash |

</frozen-after-approval>

## Code Map

- `apps/carefind/sql/20260906_carefindhub_foundation.sql:156` -- `businesses` columns `status`/`ecommerce_enabled`; `admin_team_members` single table.
- `apps/carehub/src/services/supabase.js:72` -- `BUSINESS_PUBLIC_COLUMNS` for reads.
- `apps/carefind/src/pages/admin` or `carefindhub` panel path (to be created) -- Dashboard component reads `supabase.from('businesses').select('id,status,ecommerce_enabled', {count:'exact'})` etc. + `admin_team_members` + `agents`/`applications`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carefind/src/modules/dashboard-hub/DashboardHub.jsx` (new) or `apps/carefindhub/src/pages/Dashboard.jsx` -- fetch counts: `businesses` total, `status=pending`, `status=active`, `admin_team_members` count, `ecommerce_enabled=true` count; fetch pending lists `businesses where status=pending limit 5` + `agents where status=pending` or `applications type=agent pending` with link to `/admin/businesses` and `/admin/applications`; stats-only, no actions.
- [x] `apps/carefind/src/modules/dashboard-hub/DashboardHub.test.jsx` (new) -- tests: counts with 0/1/many, pending lists link, no management buttons.

**Acceptance Criteria:**
- Given businesses with statuses, when opening Dashboard, then stats show correct counts for total/pending/active/teams/e-commerce
- Given pending businesses exist, when viewing Dashboard, then pending list shows them and link opens Businesses detail
- Given pending agents exist, when viewing Dashboard, then pending list shows them and link opens Applications
- Given no pending, when viewing, then empty states shown without error

## Spec Change Log

## Design Notes

Dashboard is read-only per Purpose §2. Pending lists are `limit 5` previews linking to full tabs. Use `admin_team_members` count, not `platform_team_members` string.

## Verification

**Commands:**
- `npm test -- src/modules/dashboard-hub/DashboardHub.test.jsx` -- expected: counts and pending lists with links
- `npm run build` (apps/carefind or carefindhub) -- expected: vite build clean
