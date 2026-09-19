---
title: 'CareFindHub Businesses: searchable, manageable, exportable'
type: 'feature'
created: '2026-09-05'
status: 'done'
baseline_commit: '5336eeef1aaacd34f25cfb2c5f47ef4516978325'
review_loop_iteration: 0
context:
  - 'apps/carefind/sql/20260906_carefindhub_foundation.sql'
  - 'apps/carehub/src/services/supabase.js'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Businesses table is source for all registered businesses but lacks searchable/paginated list, detail, Suspend/Revoked/Delete actions, per-business E-commerce view, and Export — blocking Super Admin operations.

**Approach:** Build paginated `ilike name` search, detail drawer/page, `Suspend` (`status=suspended` retains data, dashboard gone) vs `Revoke` (`status=revoked` requires reapply, copy distinguishes) vs `Delete` (confirm, hard vs soft `deleted_at` per decision), E-commerce sub-tab (`name,price,units sold,live/inactive` from `ecommerce_enabled` business’s products), and Export filtered/all `XLSX` (preferred) with columns `business name,owner name,owner email,category,state,plan,status,date onboarded`.

## Boundaries & Constraints

**Always:** Use `businesses` columns `name,owner_name,owner_email,category,state,plan,status(pending/active/suspended/revoked),created_at,ecommerce_enabled,deleted_at`; keep `visible_on_carefind`/`status` gating; E-commerce reads existing `ecommerce_products` for that `business_id` only.

**Ask First:** Hard vs soft delete (`deleted_at` nullable now, decision later — preserve ledger); XLSX vs CSV for export (confirm).

**Never:** Delete without confirmation modal; mix Suspend/Revoked copy; allow `suspended`/`revoked` to retain dashboard access; export without required columns.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Search | `ilike name` + pagination `limit 20 offset` | Correct page, `count` exact | No crash on empty |
| Detail | Row click | Full registration record (all columns) | 404 if deleted |
| Suspend | `status=active` → `suspended` | Dashboard gone, data retained, status `suspended` | Only `active`→`suspended` allowed |
| Revoke | `active`/`suspended` → `revoked` | Approval withdrawn, must reapply, copy “Revoked — approval withdrawn, reapplication required” vs “Suspended — temporary, data retained” | Not idempotent from `revoked` |
| Delete | Confirm modal Yes | Hard delete `delete()` or soft `deleted_at=now()` per decision, row removed from list | Without confirm → no delete |
| E-commerce | `ecommerce_enabled=true` business | Sub-tab shows only that business’s `name,price,units sold,live/inactive` | `ecommerce_enabled=false` → empty state “No store” |
| Export | Filtered or all | XLSX (or CSV first pass) with 8 columns, correct filtered set vs all | Large export → background/stream, no freeze |

</frozen-after-approval>

## Code Map

- `apps/carefind/sql/20260906_carefindhub_foundation.sql:156` -- `businesses` `status` check + `ecommerce_enabled` + `deleted_at` + indexes `businesses_status_idx` etc.
- `apps/carehub/src/services/supabase.js:72` -- `BUSINESS_PUBLIC_COLUMNS` for reads; `supabase.from('businesses').select(..., {count:'exact'}).ilike('name', `%q%`).range(offset,offset+19).order(created_at desc)`.
- `apps/carefind/src/modules/dashboard-hub/DashboardHub.jsx:42` -- pending list links to Businesses detail (reuse).
- Existing `AdminPanel.jsx` `BusinessDashboard` patterns for `update`/`delete` with `eq(host_id)` RLS.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carefind/src/modules/businesses-hub/BusinessesHub.jsx` (new) -- paginated list `limit 20` with `ilike name` (client or server), row click → detail (all registration fields), actions: `Suspend` (`update status=suspended` where `status=active`), `Revoke` (`status=revoked` with distinct copy), `Delete` with `ConfirmDialog` → `delete()` or `update deleted_at` per decision (add `deleted_at` column now, decision later), `E-commerce` sub-tab `supabase.from('ecommerce_products').eq('business_id', id).select('name,price,units_sold,is_live')`, `Export` filtered (`current query`) and `Export all` to XLSX (or CSV via `exportToCSV`) with 8 columns.
- [x] `apps/carefind/src/modules/businesses-hub/BusinessesHub.test.jsx` (new) -- tests: search + pagination, detail, Suspend retains data but no dashboard, Revoke requires reapply copy, Delete only after confirm, E-commerce only that business, Export filtered vs all columns.

**Acceptance Criteria:**
- Given search, when typing name, then pagination shows correct results (filtered vs all)
- Given detail, when opened, then all registration data shown
- Given Suspend, when executed, then `status=suspended`, dashboard gone, data retained
- Given Revoke, when executed, then `status=revoked`, distinct copy, requires reapply
- Given Delete without confirm, when not confirmed, then no delete; with confirm, then removed per hard/soft decision
- Given E-commerce tab for `ecommerce_enabled` business, when opened, then only that business’s products with `live/inactive` shown
- Given Export filtered/all, when exported, then file has 8 required columns and correct rows

## Spec Change Log

## Design Notes

Suspend vs Revoke copy must be explicit in Admin confirm modal. `deleted_at` added nullable for soft-delete option; hard delete would `delete()` and risk ledger history — keep decision open, implement both paths with flag.

## Verification

**Commands:**
- `npm test -- src/modules/businesses-hub/BusinessesHub.test.jsx` -- expected: search/paginate/detail/Suspend/Revoke/Delete confirm/E-commerce/Export
- `npm run build` (apps/carefind) -- expected: vite build clean
