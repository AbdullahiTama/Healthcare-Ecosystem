---
title: 'P0 FEFO batch selection and expired-batch block at POS'
type: 'feature'
created: '2026-08-19'
status: 'in-review'
baseline_commit: '169234e194e47cf25b2ead4f1f134ec44dc5bb40'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent â€” do not modify unless human renegotiates">

## Intent

**Problem:** Sales at the POS never attribute a line to a stock Batch and never consume `stock_batches.quantity` â€” the `sale_stock_movement` trigger decrements only `products.stock` (20260804_sale_stock_movement.sql). So the POS cannot pick the nearest-expiry Batch (FEFO) and can still sell an Expired Batch, which is the top trust-risk for pharmacies.

**Approach:** Add Batch attribution end-to-end: sale line items carry `batch_id`/`batch_number`/`batch_expiry`; a pure allocation helper picks FEFO batches at charge time; a BEFORE INSERT guard trigger rejects lines that reference an Expired or non-available Batch unless the Owner overrides; an AFTER INSERT trigger decrements `stock_batches.quantity` and journals `stock_movements` (type `sale`). Products without batches keep today's behavior.

## Boundaries & Constraints

**Always:**
- Sales are money that already changed hands: the AFTER INSERT decrement must never raise (fail-safe like `apply_sale_stock_movement`).
- New triggers/RPCs follow house style: SECURITY INVOKER, `SET search_path = public`, tenant-scoping via existing business-scoped RLS plus explicit `business_id = NEW.business_id`, trusted service roles / platform admins pass through.
- The Expired-Batch Block must be enforceable server-side (covers POS online, offline queue replay, and PharmacyForm dispense paths), not just in React.
- Line items that reference a product/batch not in this business are skipped, never fatal (established failure policy).
- Do not change `apply_sale_stock_movement` behavior â€” `products.stock` still decrements for every line; batch decrement is additive.

**Ask First:**
- Adding a new permission key (e.g. `canOverrideExpiredStock`) to roles presets â€” for this slice, override is Owner-only via the existing Owner-by-email/staff-role resolution.
- Changing the offline-queue replay error contract (a replayed sale with an expired batch will now be server-rejected and stay queued, reported as rejected).

**Never:**
- No `SECURITY DEFINER` on new functions.
- No new client-side-only gates for the Expired-Batch Block (must be DB-enforced).
- No backfill/migration of existing sales history.
- No change to `guard_sale_item_prices` or `apply_sale_stock_movement`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | Product has 2 available batches; qty 5; FEFO batch A (qty 3), batch B (qty 2) | Sale recorded; items split into two lines with batch_id A qty 3 and batch_id B qty 2 | N/A |
| EXPIRED_BLOCK | Line references an expired batch, cashier is not Owner | INSERT rejected (check_violation) with message naming batch + expiry; no stock decremented | Surfaces as server rejection via `cleanServerError`/`isServerRejection` |
| OVERRIDE | Line references an expired batch, cashier IS Owner, line carries `override_expired: true` | INSERT accepted; batch decremented; override recorded in items | N/A |
| NO_BATCHES | Product has zero batches (legacy/service) | Line has no batch_id; behaves exactly as today | N/A |
| BATCH_OTHER_TENANT | Line references a batch of another business | Skipped, not blocked (RLS returns zero rows) | N/A |
| BATCH_STATUS | Batch status = reserved/damaged/returned/expired | Treated as not sellable; blocked unless Owner override | Same as EXPIRED_BLOCK |
| UNPARSEABLE_ITEMS | items is null or not an array (held sale / malformed) | Triggers return NEW, no batch processing | Never raises |

</frozen-after-approval>

## Code Map

- `apps/carehub/src/modules/pos/POS.jsx` -- `add` (line 145), `setQty` (151), `tagItems` (180-189), `charge` (222-295), `chargeCredit` (297+), hold path (354-367), resume parse (396). Line shape today: `{...p, qty, price?, source}` â€” no batch key.
- `apps/carehub/src/modules/pos/repositories/index.js` -- `saleRepository.create` (127-158), offline queue (21-47), `syncQueued` (188-208). New batch fields travel in `saleData.items` untouched.
- `apps/carehub/src/modules/stock/repositories/index.js` -- `getBatches` (23-25), `createBatch`, `updateBatch`; stock_batches columns incl. `quantity`, `expiry_date`, `status`, `batch_number`, `location_id`.
- `apps/carehub/src/modules/pos/repositories/index.test.js` -- house test pattern: `build({seed, online, queued})` injects in-memory `request`, offline queue, `isOnline`.
- `apps/carehub/src/test/inMemoryClient.js` -- in-memory transport used by tests; supports eq. filters, POST auto-ids.
- `apps/carehub/src/lib/dbErrors.js` + `isServerRejection` -- 4xx = server rejection surfaced to cashier; new check_violation maps to 400.
- `apps/carehub/sql/20260804_sale_stock_movement.sql` -- existing `apply_sale_stock_movement` AFTER INSERT trigger (decrements products.stock), house style reference, double-encoded items unwrap.
- `apps/carehub/sql/20260814_guard_sale_item_prices.sql` -- BEFORE INSERT guard trigger pattern: trusted-role exemption, Owner-by-email + staff-role resolution, per-line loop, RAISE with ERRCODE, per-line skip on unknown product.
- `apps/carehub/sql/20260805_atomic_stock_transfer.sql` -- `transfer_stock_batch` / `adjust_stock_batch` RPC pattern: `FOR UPDATE` lock, tenant guard, journaling stock_movements, REVOKE/GRANT.
- `apps/carehub/sql/phase2_rls_pilot.sql` -- RLS policies for sales/stock_batches/stock_movements/products (business_id IN current_business_ids() OR is_platform_admin()).
- `apps/carehub/src/modules/purchases/Purchases.jsx` -- creates batches with `expiry_date`, `batch_number`, status available (the FEFO data source).

## Tasks & Acceptance

**Execution:**
- [x] `apps/carehub/sql/20260819_sale_batch_attribution.sql` -- new migration: `guard_sale_batch_expiry()` BEFORE INSERT trigger + `apply_sale_batch_movement()` AFTER INSERT trigger on sales; both handle double-encoded items, per-line batch lookup tenant-scoped, skip unknown/missing batches; guard rejects non-available or expired batches (check_violation) unless line has `override_expired: true` and caller resolves to Owner; AFTER trigger decrements `stock_batches.quantity` (greatest(0,...), `FOR UPDATE` not needed inside same-tx AFTER trigger but lock via UPDATE) and inserts a `stock_movements` row (movement_type `sale`, negative qty, reason with txn_no).
- [x] `apps/carehub/src/modules/pos/batchAllocation.js` -- new pure helper `allocateBatches(items, batchesByProduct, { date, isOwner })`: splits each line across FEFO-sorted non-expired available batches; returns lines with `batch_id`, `batch_number`, `batch_expiry`, `override_expired` when only expired remain and isOwner; throws when a line's qty exceeds total available non-expired and no override path.
- [x] `apps/carehub/src/modules/pos/batchAllocation.test.js` -- unit tests covering HAPPY_PATH split, expired block, owner override, no-batches passthrough, tenant batch ignored, qty overflow error.
- [x] `apps/carehub/src/modules/pos/POS.jsx` -- load batches via `stockRepository.getBatches(brand.id)` in the brand effect (line 124-130); call `allocateBatches` inside `tagItems` (180-189) so both charge and chargeCredit paths get batch attribution; block `add` (145-149) with a toast when a product's batches are all expired and the cashier is not Owner; render batch number + expiry on cart lines; pass `isOwner` from `role === 'Owner'`.
- [x] `apps/carehub/src/modules/pos/repositories/index.test.js` -- extend `build` seed with stock_batches; assert batch fields pass through `create` into the POST body untouched.

**Acceptance Criteria:**
- Given a sale with a line referencing an expired batch and a non-owner cashier, when POSTed to sales, then the insert is rejected with a check_violation message naming the batch and expiry, and no stock is decremented.
- Given a sale with a line referencing an expired batch and an Owner with `override_expired: true`, when POSTed, then the insert succeeds and the batch quantity decrements and a `sale` movement row is journaled.
- Given a sale line with qty 5 and FEFO batches of 3 and 2, when charged, then the sale items contain two lines with the correct batch_ids and quantities.
- Given a product with no batches, when charged, then its line carries no batch_id and sales behave exactly as before.
- Given a queued offline sale replayed that now references an expired batch, when synced, then it is reported as rejected and remains queued (never silently dropped).
- Given all existing tests, when run, then no previously passing test fails.

## Spec Change Log

- 2026-08-19 (review patches, within frozen boundaries): guard made authoritative for unattributed lines — a line omitting `batch_id` for a product whose batches are ALL expired/unavailable is now rejected (same Owner-override contract), closing the strip-attribution bypass surfaced by review findings #2/#3. Owner resolution extended to active staff with role 'Owner' (mirrors guard_sale_item_prices and the UI's `role === 'Owner'`), closing finding #4. AFTER trigger now journals the ACTUAL decrement (LEAST(line qty, on-hand), zero → no journal) instead of the raw line qty, closing the phantom-movement finding #7/#8. All changes respect the frozen boundaries: NO_BATCHES passthrough preserved (product with zero batches), BATCH_OTHER_TENANT still skipped, no new permissions, no SECURITY DEFINER, `apply_sale_stock_movement` unchanged.

## Design Notes

The guard and the decrement are two separate triggers on the same event â€” guard is BEFORE INSERT (blocks before any stock moves), decrement is AFTER INSERT (fires only on committed sale, skipping held sales via the existing `is_on_hold` check pattern). The allocation helper lives client-side because FEFO is a picking preference, not an authorization boundary â€” the hard rule (never sell expired/unavailable) is enforced server-side. `movement_type` stays a free-text column; `sale` joins `transfer`/`adjustment`.

## Verification

**Commands:**
- `cd apps/carehub; npx vitest run src/modules/pos` -- expected: all POS + batchAllocation tests pass.
- `cd apps/carehub; npm run build` -- expected: production build succeeds.
- Supabase: apply `20260819_sale_batch_attribution.sql` as a tracked migration; run `get_advisors(security)` -- expected: no new findings vs baseline (no SECURITY DEFINER, no function_search_path_mutable).

**Manual checks (if no CLI):**
- In a test business, create a product with an expired batch (via Purchases or direct insert), open POS as a non-owner, attempt to charge â€” expect rejection message; as Owner with override â€” expect success and stock_batches.quantity decreased and a `sale` stock_movement row.



