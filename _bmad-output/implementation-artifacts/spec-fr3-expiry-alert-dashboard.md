---
title: 'FR-3 Expiry alert dashboard'
type: 'feature'
created: '2026-08-20'
status: 'done'
baseline_commit: '169234e194e47cf25b2ead4f1f134ec44dc5bb40'
review_loop_iteration: 0
context:
  - 'apps/carehub/src/lib/permissions.js'
  - 'docs/design/COLORS.md'
---

## Intent

**Problem:** Owners and managers cannot see the money they are about to lose to stock expiry — `stock_batches` carries `expiry_date` and `quantity`, but no screen aggregates it per warehouse or converts it into expected-loss value, so expiring stock sits unnoticed until it becomes unsellable.

**Approach:** Add an "Expiry Alerts" tab to the existing Reports Hub (`/dashboard/reports/expiry`). It reads the tenant's batches, warehouses and products via the existing repositories, then a pure helper derives per-batch `daysLeft` and `expectedLoss` (quantity × batch `cost_price`, falling back to the product's `cost_price`). The component renders horizon filters (30/15/7/0 days) and a warehouse scope selector with loading, error, and empty states.

## Boundaries & Constraints

**Always:**
- Read-only projection — no writes, no new tables, no new SQL, no new permission keys. This is pure aggregation over already-tenant-scoped reads.
- Expected loss = `quantity` × `batch.cost_price` when the batch cost is a positive number, else `quantity` × `product.cost_price` (product cost may also be 0/absent → loss 0, still shown).
- "0 days" horizon = already expired (`daysLeft <= 0`); 7/15/30 = `0 < daysLeft <= N`. Batches with no `expiry_date`, `quantity <= 0`, or status outside `available`/`expired` are excluded.
- Tab must be reachable by Owner and Manager only (PRD FR-3: "[An Owner or Manager] can view"). Gate via the existing role/nav matrix — never a component-local check.
- Horizon + warehouse state lives in component state; all date math and filtering lives in the pure helper with an injectable `today` for tests.

**Ask First:**
- None anticipated — decisions (tab placement, cost source, client-side aggregation) already human-approved.

**Never:**
- No server-side view, RPC, or SECURITY DEFINER function.
- No change to `stockRepository`, `warehouseRepository`, `getProducts`, or `guard_sale_batch_expiry`.
- No offline caching or notifications (FR-26 digest consumes this data later; it stays out of scope here).
- Do not touch the user's in-flight admin files under `apps/carehub/src/pages/admin/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | Batch qty 10, cost_price 500, expiry in 12 days, status available | Row with daysLeft 12, expectedLoss 5000; included in 30-day + all horizons, not in 7/0 | N/A |
| BATCH_COST_ZERO | Same batch but cost_price 0; product.cost_price 750 | expectedLoss 7500 (product fallback) | N/A |
| BOTH_ZERO | Batch cost 0 and product cost missing/0 | Row shown with expectedLoss 0 | N/A |
| ALREADY_EXPIRED | expiry_date 3 days ago, status available, qty 5, cost 200 | daysLeft -3, included only in 0-day + all horizons, expectedLoss 1000 | N/A |
| STATUS_EXPIRED | status 'expired', qty 8, past expiry | Included (definite loss), expectedLoss = qty × cost | N/A |
| NO_EXPIRY | expiry_date null | Row excluded from every horizon | N/A |
| ZERO_QTY | qty 0, expiry in 10 days | Row excluded | N/A |
| OTHER_STATUS | status 'reserved'/'damaged'/'returned', future expiry | Row excluded | N/A |
| NO_PRODUCT_MATCH | batch product_id not in products list | productName falls back to batch.product_name, cost fallback yields 0 | N/A |
| WAREHOUSE_FILTER | warehouseId set; batch.location_id null | Null-location batches shown only under an "Unassigned" scope, never under a specific warehouse | N/A |
| EMPTY | No batches at all, or none match the selected horizon | Empty state with a clear message, summary shows 0 | N/A |
| LOAD_ERROR | getBatches / getAll / getProducts rejects | Error state with retry; toast with the message | Catch per-call, never crash |

## Code Map

- `apps/carehub/src/modules/reports/expiryAlertsHelper.js` -- NEW pure helper (named `expiryAlertsHelper` to avoid a case-insensitive filename collision with the `ExpiryAlerts.jsx` component on Windows): `deriveExpiryRows(batches, products, { today })` (adds productName, unitCost, expectedLoss, daysLeft, status) + `filterExpiryRows(rows, { horizon, warehouseId })` returning `{ rows, summary }` (count, expectedLoss, expiredCount). No imports beyond nothing — dates injected.
- `apps/carehub/src/modules/reports/expiryAlertsHelper.test.js` -- NEW vitest suite covering the I/O matrix.
- `apps/carehub/src/modules/reports/ExpiryAlerts.jsx` -- NEW component: loads `stockRepository.getBatches`, `warehouseRepository.getAll`, `getProducts`; horizon chips (30/15/7/0/All), warehouse select (All + each location + "Unassigned"); DataTable with Batch, Product, Qty, Warehouse, Expiry Date, Status, Expected Loss; Loading/error/empty states; local-time "today" (not UTC), race-guard on brand change, a11y (aria-pressed horizon chips, aria-label warehouse select, typed buttons).
- `apps/carehub/src/lib/permissions.js` -- MODULES registry: add `expiry: { label: 'Expiry Alerts', icon: CalendarClock, types: ALL_TYPES, section: 'intelligence', path: '/dashboard/reports/expiry' }`; add `'expiry'` to `REPORT_TABS` and `REPORT_TAB_SLUGS` (`expiry: 'expiry'`); add `'expiry'` to `ROLES.Owner.nav` and `ROLES.Manager.nav`; add to all three `NAV_ORDER` lists near `reports`; extend `isModuleActive` with an `expiry` branch (`pathname.startsWith('/dashboard/reports/expiry')`).
- `apps/carehub/src/modules/reports/ReportsHub.jsx` -- subtitle entry for `expiry` + mount `<ExpiryAlerts {...pageProps} brand={brand} />` when `activeTab === 'expiry'`.
- `apps/carehub/src/modules/reports/ReportsHub.test.jsx` -- NEW wiring test: hub at `/dashboard/reports/expiry` mounts ExpiryAlerts for an Owner and redirects a Pharmacist to the ADR default tab.
- `apps/carehub/src/components/ui` -- `DataTable`, `Card`, `Loading` — existing table/card/loading primitives (same usage as Stock.jsx/Reports.jsx).
- `apps/carehub/src/modules/stock/Stock.jsx` -- reference for `locName`/location filtering and expiry tone styling (lines 21-27, 135-138).
- `apps/carehub/src/lib/utils.js` -- `fmt` currency formatter, `fmtDate` — reuse for display.
- `apps/carehub/src/modules/pos/batchAllocation.js` -- pattern reference for pure, injected-date helpers (no DOM, no store).

## Tasks & Acceptance

**Execution:**
- [x] `apps/carehub/src/modules/reports/expiryAlertsHelper.js` -- new pure helper (derive + filter + summary) -- keeps horizon math unit-testable and framework-free.
- [x] `apps/carehub/src/modules/reports/expiryAlertsHelper.test.js` -- vitest coverage of the I/O matrix rows -- red first, then green.
- [x] `apps/carehub/src/lib/permissions.js` -- register `expiry` module, tab, slugs, Owner/Manager nav, NAV_ORDER, `isModuleActive` -- tab appears in hub and sidebar for Owner/Manager only.
- [x] `apps/carehub/src/modules/reports/ReportsHub.jsx` -- subtitle + mount for the `expiry` tab -- tab renders the new component.
- [x] `apps/carehub/src/modules/reports/ExpiryAlerts.jsx` -- component with loading/error/empty states, horizon chips, warehouse scope, summary cards, DataTable -- the dashboard itself.
- [x] `apps/carehub/src/modules/reports/ExpiryAlerts.test.jsx` -- component test covering the LOAD_ERROR matrix row (error state + retry, per read), retry recovery, empty state, out-of-horizon exclusion, warehouse filtering, and the All horizon -- completes the I/O matrix audit at the component boundary.
- [x] `apps/carehub/src/modules/reports/ReportsHub.test.jsx` -- NEW wiring test: hub at `/dashboard/reports/expiry` mounts ExpiryAlerts for an Owner and redirects a Pharmacist to the ADR default tab -- pins the feature's only reachable entry point.

**Acceptance Criteria:**
- Given an Owner or Manager opens `/dashboard/reports/expiry`, then they see the Expiry Alerts tab with horizon filters (30/15/7/0/All) and a warehouse scope selector.
- Given a role without `expiry` in its nav (e.g. Pharmacist, Cashier), then the tab never appears in the hub or sidebar and the URL redirects to the role's default tab.
- Given batches at varied horizons/costs, then each row shows Batch, product, quantity, Expiry Date and expected loss = quantity × (batch cost || product cost), and only batches within the selected horizon and warehouse scope are listed.
- Given no rows match the filter, then an empty state renders with summary showing 0 expected loss.
- Given any load call fails, then an error state with a retry action renders and no crash occurs.

## Verification

**Commands:**
- `npx vitest run` (in `apps/carehub`) -- expected: all suites pass. Current: 44 files / 518 tests pass, including expiryAlertsHelper.test.js (23), permissions.test.js (33), ExpiryAlerts.test.jsx (9) and ReportsHub.test.jsx (2).
- `npm run build` (in `apps/carehub`) -- expected: production build succeeds (note: pre-existing failure in user's admin files may block; run `npx vitest run` for unit verification if build is blocked).

**Manual checks (if no CLI):**
- As Owner, open the sidebar → Intelligence → Expiry Alerts; as a Cashier, confirm the tab is absent.
- Apply each horizon chip and warehouse scope and confirm rows + summary totals update.

## Suggested Review Order

**Entry point — the pure aggregation core**

- Horizons, expected-loss valuation, and the two loss-statuses decision, all date-injected for testability.
  [`expiryAlertsHelper.js:45`](../../apps/carehub/src/modules/reports/expiryAlertsHelper.js#L45)

- Filtering by horizon/warehouse and the summary (count, expectedLoss, expiredCount) over the filtered set.
  [`expiryAlertsHelper.js:95`](../../apps/carehub/src/modules/reports/expiryAlertsHelper.js#L95)

**Entry point — the dashboard**

- Component state machine: three tenant-scoped reads, per-call error catch, race-guard on brand change, and local-time "today".
  [`ExpiryAlerts.jsx:26`](../../apps/carehub/src/modules/reports/ExpiryAlerts.jsx#L26)

- Horizon chips (30/15/7/0/All), warehouse scope select, summary StatCards, and DataTable columns incl. Warehouse + Status.
  [`ExpiryAlerts.jsx:79`](../../apps/carehub/src/modules/reports/ExpiryAlerts.jsx#L79)

**Registry & routing**

- The new `expiry` module registration: label, icon, section, path, and ALL_TYPES gate.
  [`permissions.js:225`](../../apps/carehub/src/lib/permissions.js#L225)

- Report tab list and `isModuleActive` expiry branch that keep the sidebar and hub in sync.
  [`permissions.js:327`](../../apps/carehub/src/lib/permissions.js#L327)

- The hub mount that makes the feature reachable at `/dashboard/reports/expiry`.
  [`ReportsHub.jsx:79`](../../apps/carehub/src/modules/reports/ReportsHub.jsx#L79)

**Tests (supporting)**

- 23-case I/O-matrix suite: batch/product cost fallbacks, expired/zero/other statuses, warehouse scoping.
  [`expiryAlertsHelper.test.js`](../../apps/carehub/src/modules/reports/expiryAlertsHelper.test.js)

- Component tests: per-read error states, retry recovery, empty state, out-of-horizon exclusion, warehouse filtering.
  [`ExpiryAlerts.test.jsx`](../../apps/carehub/src/modules/reports/ExpiryAlerts.test.jsx)

- Hub wiring test: Owner mounts ExpiryAlerts, Pharmacist redirects to the ADR default tab.
  [`ReportsHub.test.jsx`](../../apps/carehub/src/modules/reports/ReportsHub.test.jsx)

- Registry assertions incl. Owner/Manager-only nav and `isModuleActive` for `expiry`.
  [`permissions.test.js:344`](../../apps/carehub/src/lib/__tests__/permissions.test.js#L344)