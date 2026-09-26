---
title: 'Persist and display expiry date on purchase records; apply expiry migration live'
type: 'feature'
created: '2026-08-19'
status: 'done'
baseline_commit: '5802e5410647ef57ce119258b627885346633f84'
review_loop_iteration: 0
context: []
---

## Intent

**Problem:** The purchases form already captures a per-item expiry date and creates `stock_batches` rows, but the purchase record itself never stores the expiry, and the Purchases table's "Expiry Date" column reads `p.expiry_date` — a column that does not exist on `purchases` (its columns are `expiry` and `batch`). The column therefore always renders "—". Separately, the committed `products.expiry_date` migration was never applied to the live database and contains a SQL typo (`COMMON ON COLUMN`), so Inventory's expiry UI references a column that does not exist in production.

**Approach:** Persist an aggregated expiry/batch summary onto the purchase record at save time (earliest item expiry + joined unique batch numbers), fix the Purchases table cell to read `p.expiry`, fix and apply the `products.expiry_date` migration to the live database, and unit-test the aggregation helper.

## Boundaries & Constraints

**Always:** Keep the single-purchase expiry/batch aggregation in a pure helper so it is unit-testable (the `save()` handler lives inside a React component). Persist to the existing `purchases.expiry` / `purchases.batch` columns — no new purchases column. `products.expiry_date` must be `date` to match `stock_batches.expiry_date`. The migration file typo must be fixed so the SQL is valid.

**Ask First:** None anticipated. Applying DDL to the live database is already human-approved in this task.

**Never:** No new `purchases` migration (columns already exist). Do not change `stock_batches` handling — `expiry_date` on batches is correct. Do not add a second expiry column to `products` beyond `expiry_date`. Do not touch Inventory/Stock runtime logic beyond what the migration enables. Do not deploy to Vercel.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No expiry on any item | items with `expiry: ''` | `purchases.expiry` = null; table cell shows "—" | N/A |
| Single item with expiry | one item `expiry: '2027-01-15'` | `purchases.expiry` = '2027-01-15' | N/A |
| Multiple items, distinct expiries | expiries 2027-01-15, 2026-12-01 | `purchases.expiry` = '2026-12-01' (earliest) | N/A |
| Mixed empty + set values | batch ''/'B-1', expiry ''/'2027-01-15' | empties filtered; expiry='2027-01-15', batch='B-1' | N/A |
| Duplicate batch numbers | batches B-1, B-1 | `purchases.batch` = 'B-1' (deduped, single occurrence) | N/A |
| Save when aggregation null | no expiry/batch supplied | purchase still created; `expiry`/`batch` null | N/A |

## Code Map

- `apps/carehub/src/modules/purchases/Purchases.jsx` — `save()` builds the purchase create body (lines ~81-93) without `expiry`/`batch`; table cell reads `p.expiry_date` (line 284) but the live `purchases` column is `expiry`; form already captures per-item `expiry` (line 334) and `batch` (line 331).
- `apps/carehub/src/modules/purchases/repositories/index.js` — `create()` is a pass-through POST; no change needed. Test seams via injected `request`.
- `apps/carehub/src/modules/purchases/repositories/index.test.js` — in-memory adapter test pattern (`createInMemoryClient`); extend to assert `expiry`/`batch` persist on create.
- `apps/carehub/src/lib/utils.js` — `fmtDate` (line 13) formats dates to `en-NG` locale and returns "—" for falsy; reuse for the table cell.
- `apps/carehub/sql/20260819_add_product_expiry_date.sql` — committed migration, never applied live; contains invalid `COMMON ON COLUMN` and `TIMESTAMPTZ` type. Fix then apply.
- `apps/carehub/src/modules/inventory/Inventory.jsx` — reads/writes `products.expiry_date` (lines 480-492, 681, 716, 742); works only once the migration is applied live.
- Live DB (verified via information_schema) — `purchases.expiry` (date) + `purchases.batch` (text) exist; `stock_batches.expiry_date` (date) exists; `products` has `expiry`/`batch` but NOT `expiry_date`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carehub/src/modules/purchases/expirySummary.js` -- new pure helper `purchaseExpirySummary(items)` returning `{ expiry, batch }` (earliest ISO date; unique non-empty batches joined with ', '; null when none) -- keeps aggregation testable outside the React component.
- [x] `apps/carehub/src/modules/purchases/expirySummary.test.js` -- unit tests covering the I/O matrix rows -- red first, then green.
- [x] `apps/carehub/src/modules/purchases/repositories/index.test.js` -- extend `create` test to assert `expiry`/`batch` are stored on the created row -- pass-through regression guard.
- [x] `apps/carehub/src/modules/purchases/Purchases.jsx` -- import `purchaseExpirySummary`; add `expiry`/`batch` to the purchase create body; change table cell `p.expiry_date` → `fmtDate(p.expiry)` -- persistence + correct display.
- [x] `apps/carehub/sql/20260819_add_product_expiry_date.sql` -- fix `COMMON` → `COMMENT`; `TIMESTAMPTZ` → `date` -- valid, schema-consistent SQL.
- [x] Supabase live -- `apply_migration` `add_product_expiry_date` with the fixed SQL -- makes `products.expiry_date` exist in production (Inventory expiry live).

**Acceptance Criteria:**
- Given a purchase with items carrying expiry dates, when save is submitted, then the created `purchases` row stores `expiry` = earliest item expiry and `batch` = deduped joined batch numbers.
- Given a saved purchase with a non-null `expiry`, when the Purchases list renders, then the Expiry Date column shows the formatted date instead of "—".
- Given the migration applied live, when `products` columns are inspected, then `expiry_date` (date, nullable) exists.
- Given a product saved from Inventory with an expiry date, when the Inventory DataTable renders, then the expiry shows (no column-not-found error).

## Verification

**Commands:**
- `npm test` (in `apps/carehub`) -- expected: all vitest suites pass, including the new `expirySummary` and extended purchase repository tests.
- `npm run build` (in `apps/carehub`) -- expected: production build succeeds.
- Supabase `information_schema` query on `products` -- expected: `expiry_date` column present with `date` type.

## Suggested Review Order

**Persistence wiring**

- Entry point: the purchase record now carries the aggregated expiry/batch summary — where intent meets the DB write
  [`Purchases.jsx:82`](../../apps/carehub/src/modules/purchases/Purchases.jsx#L82)

- The `expiry`/`batch` fields forwarded into the create payload
  [`Purchases.jsx:95`](../../apps/carehub/src/modules/purchases/Purchases.jsx#L95)

**Aggregation logic**

- Pure helper: earliest expiry + deduped trimmed batches, null-safe
  [`expirySummary.js:5`](../../apps/carehub/src/modules/purchases/expirySummary.js#L5)

**Display**

- Expiry Date column now reads the real `p.expiry` column via `fmtDate`
  [`Purchases.jsx:288`](../../apps/carehub/src/modules/purchases/Purchases.jsx#L288)

**Schema change**

- Migration fixed (typo + `date` type, idempotent) — applied live
  [`20260819_add_product_expiry_date.sql:5`](../../apps/carehub/sql/20260819_add_product_expiry_date.sql#L5)

**Tests**

- Aggregation matrix coverage incl. null/whitespace guards
  [`expirySummary.test.js:4`](../../apps/carehub/src/modules/purchases/expirySummary.test.js#L4)

- Repository pass-through guard for expiry/batch on create
  [`index.test.js:36`](../../apps/carehub/src/modules/purchases/repositories/index.test.js#L36)