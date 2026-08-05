# CareFind / CareHub Release Readiness Report

Status: **REPORT READY** · Date: 2026-08-05 · Sentinel (Signed-off via Live Test)
Scope: 10 production bug fixes + 6-task final polish audit, CareHub + CareFind

---

## 1. Summary

Two sequential workstreams landed this cycle:

1. **10-issue production bug sprint** — live-bug fixes for CareFind/CareHub surfaced during acceptance testing
   (modal focus loss, sale-type filtering, seller contact links, requisition normalization, out-of-stock
   POS flow, purchase quantity integrity, facility search, staff role-safety, price visibility toggle,
   CareFind profile crash + listing parity). Each issue fixed, self-reviewed, and verified with tests+builds
   before the next began.
2. **6-task final polish & release-readiness audit** — purchase form completeness, module registry, health
   facility listing eligibility, public business profile completeness, price-visibility coverage, then a full
   regression and this report.

## 2. Verified features (all tested + built)

| # | Fix | Where |
|---|---|---|
| 1 | Modal focus loss (`onCloseRef`) | `apps/carehub/src/components/ui/index.jsx`, `apps/carefind/src/components/ui/index.jsx` |
| 2 | `sale_type` filter now server-side + backfill migration | `apps/carefind/src/modules/healthcare-discovery/Search.jsx`, `apps/carehub/sql/20260805_backfill_product_sale_type.sql` |
| 3 | Owner/seller identity + contact on product cards & profiles | `apps/carefind/src/modules/utils/sellerLookup.js`, `marketplace.js` (`whatsappLink` 080→234) |
| 4 | Demand requisitions normalized (lines table + atomic RPC) | `apps/carehub/sql/20260805_requisition_lines_normalized.sql`, `services/supabase.js`, `modules/demand/Demand.jsx` |
| 5 | OOS inventory hidden from POS grid/suggestions | `apps/carehub/src/modules/pos/POS.jsx` |
| 6 | Purchase qty integrity (Number parse, whole-number guard, balance clamp, dedupe, `markPaid` atomic) | `apps/carehub/src/modules/purchases/Purchases.jsx` |
| 7 | Facility search across name/type/city/state | `apps/carefind/src/modules/healthcare-discovery/Search.jsx` |
| 8 | Owner-only role editing + demote-Owner lockout | `apps/carehub/src/modules/staff/Staff.jsx` |
| 9 | `show_price` toggle (CareHub) → `canShowPrice` (CareFind) | CareHub `ProductModal`, CareFind `marketplace.js` + BusinessProfile/DrugProfile/Search/claims `BusinessDashboard.jsx` |
| 10 | CareFind profile crash fix + legacy `list_on_carefind` parity | `apps/carefind/src/modules/business-profiles-reviews/BusinessProfile.jsx` |

Final-polish tasks: purchase `sell`/`batch`/`expiry` capture + inventory sync; `MODULES` registry +
`rolesForType()`; facility eligibility gate + "Load more" pager; public-profile phone/website + logo/cover
upload; `price_unit` leak fix on hidden prices. **Regressions:** CareHub **251 tests / 20 files**, CareFind
**119 tests / 11 files**, both production builds green.

## 3. Schema changes — REQUIRED, NOT YET APPLIED

Apply manually in the Supabase SQL editor, in order. All idempotent/draft:

1. `apps/carehub/sql/20260805_backfill_product_sale_type.sql` — backfill `sale_type` for tagged legacy rows.
2. `apps/carehub/sql/20260805_requisition_lines_normalized.sql` — `requisition_items` columns + FK +
   `create_requisition()` RPC (fixes every prior requisition save).
3. `apps/carehub/sql/20260805_business_assets_storage.sql` — `business-assets` public bucket + policies
   (required for the Settings "Upload logo / cover" buttons).
4. `apps/carefind/sql/20260805_marketplace_search_indexes.sql` — pg_trgm GIN + partial status indexes
   (performance; non-blocking, but recommended before scale).

> Do NOT ship the Settings upload UI before #3 — uploads fail with no bucket. Do NOT merge the Demand fix
> without #2 — every requisition save errors at runtime.

## 4. Product decisions (no schema column exists — deferred)

- **Business verification badge** on public profiles: `is_verified` exists only on CareFind `profiles`
  (users), not `businesses`. Adding a badge requires a new column + approval workflow.
- **Specialties / accreditations / social links on profiles**: no `businesses` columns. The Settings
  repository's `BUSINESS_PROFILE_FIELDS` whitelist keeps unapplied columns from entering PATCH payloads —
  adding these fields requires a migration first, then form fields on top.
- **Business email display** on CareFind: `email` is the tenant's login credential; exposing it publicly was
  not done by design. Recommend WhatsApp/phone remain the public contact path.

## 5. Performance notes (no code change — deferred)

- CareHub bundle ~1.6 MB minified (**432 kB gzip**), CareFind ~1.1 MB (**284 kB gzip**) — Vite warns on
  both. Route-level code splitting / `react.lazy` + `manualChunks` are the recommended next step.
- Search loads featured promos + results on mount (two purpose-distinct queries — not a duplicate).
- "Load more" pagers page 40-at-a-time via `range()` on the shared query builder.

## 6. Security

- Facility/drug cards and the public profile now enforce `status = 'active'` + `visible_on_carefind` server-
  query-side; a direct URL to a pending/suspended/opt-out business renders an empty state, never data.
- Role editing hardened: Owner demote blocked; non-owner cannot edit roles.
- No secrets added; upload paths are per-business (`businesses/{id}/logo-*`).

## 7. Release checklist

- [ ] Apply the 4 schema migrations (Supabase SQL editor) — order as §3
- [ ] CareHub `npm test` + `npm run build` (251 tests)
- [ ] CareFind `npm test` + `npm run build` (119 tests)
- [ ] Smoke: register→approve→CareFind listing gate, public profile contact/upload, requisition create, POS
      checkout with OOS item, purchases with batch+expiry → inventory + batch row
- [ ] Commit (nothing committed in this cycle yet — all changes staged in working tree)