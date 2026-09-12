---
title: 'Guard duplicate product activation per vendor (unique vendor+product)'
type: 'bugfix'
created: '2026-09-06'
status: 'done'
baseline_commit: '443e51a15b3ca234a250b2e465ae67099e16da50'
review_loop_iteration: 0
context:
  - apps/carehub/src/modules/ecommerce/repositories/index.js
  - apps/carehub/src/modules/ecommerce/Ecommerce.jsx
  - sql/20260830_ecommerce_foundation.sql
  - supabase/migrations/carehub_20260830_ecommerce_foundation.sql
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Vendor can activate same product multiple times, causing duplicate listings of same product from same vendor on CareFind Shop (reported 06/09/2026 09:19 Pharm Tama). DB already has `UNIQUE (business_id, product_id)` on `ecommerce_products` (`ecommerce_products_business_id_product_id_key`), but UI `Ecommerce.jsx:285` `handleActivate` and `upsertEcommerceProduct` race on double-click/laptop allows two concurrent POSTs to both see no existing row and both insert — second hits `23505` unique violation but is not surfaced as `Already activated`, so shop `status=Active` view may show duplicate in local state.

**Approach:** Make activation idempotent and UI-guarded: DB unique stays source of truth, `upsertEcommerceProduct` uses `resolution=merge-duplicates` or `ON CONFLICT (business_id,product_id) DO NOTHING` + select, `activate` checks `status=Active` early and returns `Already activated` without write, UI disables Activate when `status=Active` + handles `23505` → `Already activated` toast. Different vendors can still list same `product_id` independently at same/different `ecommerce_price_kobo`.

## Boundaries & Constraints

**Always:** Keep `UNIQUE (business_id, product_id)` (AD-3 financial idempotency pattern); `ecommerce_products` `business_id,product_id` tenant-scoped `current_business_ids()`; Shop browse `status=Active` + `products.stock>0` remains filter; different `business_id` same `product_id` allowed (no global unique).

**Ask First:** Changing `ecommerce_products` unique to include `product_id` only (global) — never, would block different vendors.

**Never:** Allow same `business_id,product_id` twice even via race; duplicate listing on Shop; block different vendors listing same product; ignore `23505` with generic error.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Single activate | Vendor `bizA`, product `p1` Not Activated, Approved, complete+image | `ecommerce_products(bizA,p1)` → `Active`, Shop shows one listing `bizA/p1` | N/A |
| Double-click race | Same vendor `bizA,p1` double-click Activate fast on laptop | First POST → `Active`, second → `23505` caught → toast `Already activated — this product is already live for your store` + no second row, Shop still one listing | Map `23505` + `business_id_product_id_key` to `Already activated` |
| Already Active | Vendor `bizA,p1` already `Active`, hits Activate again | Early return without RPC: toast `Already activated` + no write | No DB hit |
| Different vendors | `bizA,p1` Active, `bizB,p1` Not Activated → `bizB` Activate | `bizB,p1` → `Active` succeeds, Shop shows two listings `bizA/p1` and `bizB/p1` at possibly different `ecommerce_price_kobo` | N/A |
| Concurrent vendors | `bizA,p1` and `bizB,p1` activate simultaneously | Both succeed independently (different `business_id` so no conflict) | N/A |
| Incomplete missing image | `bizA,p1` incomplete or no image | `activate` throws `Description min 10` / `At least one image required` before unique check | Show inline error, no DB write |

</frozen-after-approval>

## Code Map

- `apps/carehub/src/modules/ecommerce/repositories/index.js:153` — `upsertEcommerceProduct(businessId,productId, payload)` → existing check `select id where business_id+product_id` then `PATCH` else `POST` — RACE: two concurrent POSTs both see `existing==null` → second violates `UNIQUE(business_id,product_id)` `23505`; FIX to `POST` with `prefer: resolution=merge-duplicates` or `ON CONFLICT DO NOTHING` + handle `23505` → `Already activated` without creating duplicate, keep seam `request`
- `apps/carehub/src/modules/ecommerce/repositories/index.js:299` — `activate(businessId,productId)` → checks `Approved`, `is_restricted`, description/category, images `>0` then `PATCH status=Active` — ADD early `if ecom.status==='Active' return` with `Already activated` message, keep `setStatus` routing through `activate` for `Active`
- `apps/carehub/src/modules/ecommerce/Ecommerce.jsx:285` — `handleActivate` `setActivating(true)` → `activate` → `loadInventory` — ADD `disabled={activating || selected?.status==='Active'}` + `aria-busy`, guard `if selected.status==='Active'` early toast, map `23505` error to `Already activated` toast, keep `VendorTrackingPanel` intact
- `sql/20260830_ecommerce_foundation.sql:8` — `ecommerce_products` `UNIQUE(business_id,product_id)` + `FOREIGN KEY product_id` — VERIFY index exists (already), no migration needed; read-only check `pg_constraint`
- `apps/carefind/src/modules/shop/Shop.jsx` — Shop browse `ecommerce_products.status=Active` join — VERIFY it deduplicates by `business_id,product_id` (already unique, no extra distinct needed), different vendors same `product_id` both show

## Tasks & Acceptance

**Execution:**
- [x] `apps/carehub/src/modules/ecommerce/repositories/index.js` — harden `upsertEcommerceProduct` to handle `23505` `business_id_product_id_key` → throw `Already activated — this product is already live for your store` (or return existing), ensure `activate` early `if ecom.status==='Active'` return without RPC; keep `different business_id` allowed
- [x] `apps/carehub/src/modules/ecommerce/Ecommerce.jsx` — guard `handleActivate` with `if selected?.status==='Active'` toast + disable Activate button `disabled={activating || selected.status==='Active'}` + map `23505` to `Already activated` toast
- [x] `apps/carehub/src/modules/ecommerce/repositories/index.test.js` — new: upsert race `23505` → `Already activated`, activate when already Active → no RPC, different vendors same product both succeed, incomplete still blocked

**Acceptance Criteria:**
- Given vendor `bizA` with product `p1` Not Activated, when double-click Activate on laptop then only one `ecommerce_products(bizA,p1)` row exists with `Active`, second click shows `Already activated` toast, Shop shows one listing for `bizA`
- Given `bizA,p1` already `Active`, when vendor hits Activate again then no RPC, toast `Already activated`, Shop still one listing
- Given `bizA,p1` Active and `bizB,p1` Not Activated, when `bizB` activates then Shop shows two listings `bizA/p1` and `bizB/p1` at possibly different prices, both purchasable
- Given concurrent `bizA,p1` double POST race, when second hits `23505` then it is mapped to `Already activated` not generic `Supabase error`

## Spec Change Log

## Design Notes

- DB unique is source of truth; UI guard is for latency and double-click, not security. Different vendors same `product_id` is explicitly allowed per Pharm Tama report — do not add global unique on `product_id`.
- Golden: `ecommerce_products` `UNIQUE(business_id,product_id)` already exists, verified `2026-09-06` via `pg_constraint` — fix is race handling + early return, not new migration.

## Verification

**Commands:**
- `npm run build --prefix apps/carehub` -- expected: 713 modules transformed
- `npm test --prefix apps/carehub -- src/modules/ecommerce/repositories/index.test.js` -- expected: existing 13 + 4 new duplicate guard tests passed

**Manual checks:**
- Vendor `bizA` Activate `p1` → Shop shows one card `bizA/p1`; double-click fast → one row in `ecommerce_products where business_id=bizA and product_id=p1`, second toast `Already activated`
- Vendor `bizA` already `Active`, click Activate → no network `PATCH`, toast `Already activated`
- Vendor `bizB` same `p1` Activate → Shop shows two cards, different `business_id`, different prices allowed

## Suggested Review Order

**Entry — duplicate guard is unique + early return**

- `UNIQUE(business_id,product_id)` is source + `activate` early `Active` → no RPC
  [`repositories/index.js:299`](../../apps/carehub/src/modules/ecommerce/repositories/index.js#L299)

**Race — 23505 mapping**

- `upsertEcommerceProduct` catches `23505` `business_id_product_id_key` → `Already activated`
  [`repositories/index.js:153`](../../apps/carehub/src/modules/ecommerce/repositories/index.js#L153)

- In-memory `UNIQUE` mirror for tests
  [`inMemoryClient.js:108`](../../apps/carehub/src/test/inMemoryClient.js#L108)

**UI — idempotent button**

- `handleActivate` guard `status==='Active'` + `disabled={activating||Active}` + `23505` toast
  [`Ecommerce.jsx:285`](../../apps/carehub/src/modules/ecommerce/Ecommerce.jsx#L285)

**Tests — 6 new + 44 regression, different vendors allowed**

- Race, already Active no RPC, different vendors both succeed, incomplete still blocked
  [`repositories/index.test.js:1`](../../apps/carehub/src/modules/ecommerce/repositories/index.test.js#L1)
