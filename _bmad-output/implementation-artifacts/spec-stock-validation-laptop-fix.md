---
title: 'Fix Stock Validation save on laptop/desktop (Supabase error)'
type: 'bugfix'
created: '2026-09-06'
status: 'done'
baseline_commit: '8ce70bf0d86290c69af55be65b82e7cba7235749'
review_loop_iteration: 0
context:
  - _bmad-output/specs/spec-carehub-admin-dashboard/SPEC.md
  - _bmad-output/planning-artifacts/architecture/architecture-HealthCare-Ecosystem-2026-09-06/ARCHITECTURE-SPINE.md
  - apps/carehub/src/modules/stock-management/StockValidation.jsx
  - apps/carehub/src/modules/stock-management/repositories/index.js
  - sql/20260901_stock_validation.sql
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Stock Validation under Stock Management → add product + adjust quantity → Save succeeds on phone but fails on laptop/desktop with Supabase error (reported 06/09/2026 09:12, Pharm Tama). Phone vs laptop implies not viewport CSS but `authToken` fallback to anon, input parsing/negative stock, or Modal double-fire — blocks daily stock ops.

**Approach:** Harden `StockValidation.jsx:101` `confirmSave` + `save_stock_validation_session` RPC path to be device-agnostic: same payload, same auth, same validation, no double-fire. Phone and laptop must send identical `p_items` JSON and succeed via `SECURITY INVOKER` with `current_business_ids()`; any Supabase error must be surfaced, not swallowed.

## Boundaries & Constraints

**Always:** Repository-seam only (AD-1) — `StockValidation.jsx` → `stockValidationRepository.saveSession(brand.id, session, items, userId)` → `sbFetch('rpc/save_stock_validation_session')` with `authToken()`; RLS `business_id IN current_business_ids()` behaviorally verified (AD-2); financial-stock atomic in RPC `SECURITY INVOKER` loop (AD-3); no client direct `UPDATE products`.

**Ask First:** Changing `save_stock_validation_session` from `SECURITY INVOKER` to `DEFINER` or adding new columns to `stock_validation_sessions/items`; adding `products.stock` CHECK bypass.

**Never:** Hardcode anon key bypass for laptop, ignore `authClient.getSession()` null fallback, allow negative `new_stock` to hit DB CHECK, or keep Save button enabled while `saving==true` (double-fire).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Phone save happy | Owner `brand.id` valid, product Stock 20, adjust +5 → `new_stock 25`, `reason=expired`, auth fresh | `save_stock_validation_session` inserts session + items + `UPDATE products stock=25` in one tx, toast `Saved`, worksheet cleared, `loadProducts()` refreshed | N/A |
| Laptop same payload | Same as phone but laptop keyboard typed “5” + Enter | Identical payload stringified, same `p_business_id`, same `p_items[{new_stock:25}]`, succeeds equally | If auth stale → `authToken()` still anon → RLS 42501 → show `Session expired, please re-login` + retry, not generic Supabase error |
| Negative stock | Stock 2, adjust -5 → `new_stock -3` | Client blocks before RPC: `if new_stock <0` → inline error `Cannot go below 0` | Never hit DB CHECK; RPC also guards `new_stock >=0` |
| Empty reason / large qty | `reason=''` or qty 9999 (laptop typed) | Coerce `reason||null`, clamp qty `0..10000`, parseInt fallback 0, still succeeds | If qty NaN → treat as 0, show field error |
| Double-click / Enter | Laptop double-click Save or Enter in Modal | Button `disabled={saving}` prevents second `confirmSave` fire; overlay `onClick` stopped | Second fire ignored, first tx idempotent |
| Race brand undefined | `brand` not yet loaded on mount | Disable Save until `brand.id` exists, show `Loading business…` | If `brand.id==null` → early return `Missing business` |

</frozen-after-approval>

## Code Map

- `apps/carehub/src/modules/stock-management/StockValidation.jsx:101` — `confirmSave()` builds `session {business_id, user_id, user_name, products_checked, products_adjusted}` + `items[]` `{product_id,product_name,shelf_label,previous_stock,adjustment_qty,adjustment_direction,new_stock,reason,unit_price}` → calls `stockValidationRepository.saveSession`; `adjustQty:95` `currentStock ± adjustmentQty`; `type=number parseInt||0:202`; `saving` label only, not `disabled`; `Modal onClick stopPropagation` — FIX all three device divergences here, keep phone `+/-` taps intact
- `apps/carehub/src/modules/stock-management/repositories/index.js:5` — `saveSession(businessId,session,items,userId)` → `sbFetch('rpc/save_stock_validation_session' POST {p_business_id,p_user_id,p_user_name,p_products_checked,p_products_adjusted,p_items})` — ADD `head` guard, ensure `p_business_id` from `brand.id` not null, surface `Supabase error (status)` detail via `useToast`, keep seam (no direct `sbFetch` in component)
- `sql/20260901_stock_validation.sql:104` — `save_stock_validation_session` `SECURITY INVOKER` `SET search_path=public` loops `p_items` inserts `stock_validation_items` then `UPDATE products SET stock = new_stock WHERE id=uuid AND business_id=p_business_id` — VERIFY `current_business_ids()` allows insert, keep INVOKER (auth must be fresh), add `new_stock >=0` guard if missing
- `apps/carehub/src/services/supabase.js:10` — `authToken()` → `authClient.getSession().access_token || SB_KEY` fallback to anon — PHONE fresh → `authenticated`, LAPTOP stale → anon 42501; FIX by ensuring `initTheme`/`AuthProvider` reconciles session before mount and `StockValidation` checks `authClient.getSession()` before save, shows re-login toast on null
- `apps/carehub/src/pages/dashboard/BusinessDashboard.jsx:127` — `brand` + `auth.brand` + `loadProducts()` — READ-ONLY, `brand.id` source for `business_id`; ensure `StockValidation` receives `brand` prop already loaded, not undefined race
- `packages/design-system/src/components/ui/Modal.jsx:66` — `Modal` focus trap + `Button` `TealBtn` disabled prop — REUSE for Save `disabled={saving}` + `aria-busy`, keep phone tap behavior

## Tasks & Acceptance

**Execution:**
- [x] `apps/carehub/src/modules/stock-management/StockValidation.jsx` — harden `confirmSave`: parse `adjustmentQty` as `Math.max(0, parseInt(val,10)||0)`, clamp `new_stock >=0` with inline field error, `reason||null`, disable Save `disabled={saving}` + `aria-busy`, stop double-fire (early return if `saving`), guard `if !brand?.id` → toast, ensure same payload on phone `+/-` and laptop typed+Enter
- [x] `apps/carehub/src/modules/stock-management/repositories/index.js` — add input guards for `businessId` null, ensure `p_items` JSON stringifies `new_stock` int, keep `sbFetch` error detail bubbling, keep seam
- [x] `apps/carehub/src/services/supabase.js` — verify `authToken()` path for Stock Validation: add `StockValidation` pre-save `getSession()` check, if null show `Session expired` + `authClient.auth.refreshSession()` retry once, else throw with `detail` for toast
- [x] `sql/20260901_stock_validation.sql` — add `CHECK (new_stock >=0)` or RPC guard `IF (v_item->>'new_stock')::int <0 THEN RAISE` to prevent DB CHECK fail being the laptop error surface (read-only verify, apply migration if missing)
- [x] `apps/carehub/src/modules/stock-management/StockValidation.test.jsx` — new: phone vs laptop same payload, negative stock blocked, double-click ignored, `brand.id` null blocked

**Acceptance Criteria:**
- Given Stock Validation with Stock 20, adjust +5, when Save on laptop (typed Enter) and on phone (+ tap) then both insert `stock_validation_sessions` 1 row + `stock_validation_items` 1 row + `products.stock` becomes 25, toast `Saved`, worksheet cleared
- Given Stock 2, when adjust -5 on laptop then client shows `Cannot go below 0` and no RPC fires; `products.stock` stays 2
- Given laptop session expired, when Save then toast `Session expired, please re-login` (not generic `Supabase error (42501)`), retry succeeds after refresh
- Given Save in flight, when double-click Save or press Enter again then second call is ignored (`saving==true` disabled)
- Given `brand` undefined on mount, when Save then toast `Missing business` and no `p_business_id=null` FK error

## Spec Change Log

## Design Notes

- Phone vs laptop divergence is not CSS: `StockValidation.jsx:202` `type=number` behaves same; root causes in order: 1) INVOKER RLS anon fallback, 2) negative stock DB CHECK, 3) double-fire. Fix in that order, keep phone `+/-` intact.
- Golden example: `items[0] = {product_id:'uuid', previous_stock:20, adjustment_qty:5, adjustment_direction:'+', new_stock:25, reason:null, unit_price:12.00}` — both devices must send identical JSON after clamp.

## Verification

**Commands:**
- `npm run build --prefix apps/carehub` -- expected: 713 modules transformed
- `npm test --prefix apps/carehub -- src/modules/stock-management/StockValidation.test.jsx src/modules/stock-management/repositories/index.test.js` -- expected: Stock Validation phone/laptop parity, negative blocked, double-fire ignored, null brand blocked — all passed

**Manual checks:**
- Laptop Chrome + phone Chrome DevTools mobile: add same product, adjust same qty via typing vs +/- , Save → both succeed, `products.stock` updated, no Supabase error toast
- DevTools Network → `rpc/save_stock_validation_session` → Headers `Authorization: Bearer <jwt>` not `anon`; Payload `p_items[0].new_stock` int; Response 201 with session id
- Invalidate session (clear `localStorage` + `authClient.auth.signOut` mock), Save → `Session expired` toast, after `refreshSession` retry succeeds

## Suggested Review Order

**Entry — phone vs laptop parity**

- Laptop Save must send identical `p_items` as phone `+/-` with same `new_stock`
  [`StockValidation.jsx:131`](../../apps/carehub/src/modules/stock-management/StockValidation.jsx#L131)

**Auth + RLS**

- Pre-save `getSession` → `refreshSession` retry on `42501`, anon fallback blocked
  [`supabase.js:10`](../../apps/carehub/src/services/supabase.js#L10)

- `brand.id` guard prevents `p_business_id=null` FK, `StockValidation.jsx:101` early return
  [`StockValidation.jsx:101`](../../apps/carehub/src/modules/stock-management/StockValidation.jsx#L101)

**Validation + safety**

- `parseAdjustmentQty` clamp `0..10000` + `new_stock >=0` inline `role=alert`
  [`StockValidation.jsx:22`](../../apps/carehub/src/modules/stock-management/StockValidation.jsx#L22)

- `CHECK new_stock >=0` + `RAISE 23514` in loop
  [`20260901_stock_validation.sql:43`](../../sql/20260901_stock_validation.sql#L43)

- Zero-delta filter `adjustment_qty!==0` skips no-ops
  [`StockValidation.jsx:135`](../../apps/carehub/src/modules/stock-management/StockValidation.jsx#L135)

**Double-fire + a11y**

- `disabled={saving} aria-busy` + `if(saving) return` + focus trap
  [`StockValidation.jsx:274`](../../apps/carehub/src/modules/stock-management/StockValidation.jsx#L274)

- `aria-label` plus/minus + `aria-describedby` on input
  [`StockValidation.jsx:295`](../../apps/carehub/src/modules/stock-management/StockValidation.jsx#L295)

**Tests**

- Phone vs laptop parity + negative blocked + double-click + brand null + session expired → 28 passed
  [`StockValidation.test.jsx:1`](../../apps/carehub/src/modules/stock-management/StockValidation.test.jsx#L1)
