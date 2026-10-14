# Plan: Release vendor shop credits on delivery (no 7-day hold)

Owner decision (2026-10-14): a vendor can withdraw the instant an order is **delivered**.
The 7-day payout hold is removed. The customer's 7-day **return window is unchanged**.

## Why not zero the config

`financial_config.shop_vendor_return_window_days = 7` drives two things at once:
the payout hold (`release_shop_vendor_credits`) and the customer return window
(`request_shop_return`, `request_shop_return_service`). Zeroing it would delete
customers' return rights. So we **decouple**: stop reading it in the release path.

Accepted tradeoff (owner): a customer who returns after delivery may find the money
already withdrawn. The refund engine claws back from `available_balance`; if it is gone
it records a shortfall the platform absorbs. Refunds never over-debit or double-pay.

## Safety decision: an AFTER UPDATE trigger, not an edit to `update_shop_order_status`

Production's `update_shop_order_status` is `carefind_20261021` (delivery-quote branch
removed as a security tightening). The test harness loads `carefind_20261019`, which
still has that branch. Editing that function risks overwriting a security-hardened body
against a divergent harness. Instead a row trigger fires only on the transition to
`delivered`, catches every delivery path (vendor RPC, refund-restore, return-completion,
admin), and reuses the guarded release function. Lock order stays shop_orders →
shop_vendor_credits → business_wallets (same as the sweep), so no deadlock.

## Task 1: migration `carefind_20261105_release_on_delivery.sql`
(mirrored byte-identical in `supabase/migrations/` and `apps/carefind/sql/`)

- `drop function public.release_shop_vendor_credits(integer)` — signature change, no overload.
- `create or replace public.release_shop_vendor_credits(p_limit integer default 200, p_order_id uuid default null)`
  - eligibility drops the `<= now() - v_window` history clause; adds `and (p_order_id is null or c2.order_id = p_order_id)`
  - drop the now-unused `v_window` declaration
  - every guard kept: held, amount > reversed, delivered, no live refund, no open return,
    lock order order→credit→wallet, replay-safe, partial/shortfall handling
- re-grant: service_role only (unchanged posture)
- `create or replace public.release_vendor_credit_on_delivery()` — SECURITY DEFINER trigger
  fn, calls `release_shop_vendor_credits(1, NEW.id)` for that one order
- `create trigger trg_shop_order_release_on_delivery after update of status on public.shop_orders
  for each row when (NEW.status = 'delivered' and OLD.status is distinct from 'delivered')`
  — follows the existing `trg_shop_orders_status_email` pattern; no recursion (release never
  writes `shop_orders`)

## Task 2: tests

`vendorPayouts.db.test.js` (PGlite):
- add `M('carefind_20261105_release_on_delivery')` to the load list (after 20261018)
- rewrite `release after delivery` block to the new contract:
  - delivered ⇒ released immediately (trigger), one ledger row; a later sweep does nothing
  - undelivered stays held; an order with an open return stays held (refund created before delivery)
  - live-refund guard: `requestRefund(half)` **then** `deliver` ⇒ still held (guard blocks trigger)
  - service_role-only, partial/shortfall tests keep passing unchanged

`vendorPayoutsConcurrency.pg.test.js` (real PG):
- add the migration to the load list
- the existing "12 overlapping sweeps" now finds it already released by the trigger ⇒
  sweeps sum 0, invariant (one ledger row, wallet correct) unchanged
- add: N orders delivered concurrently ⇒ each released exactly once (exercises the trigger)

## Task 3: docs
- `docs/architecture/Vendor-Payout-Model.md`: the flow diagram, the "Return window = hold"
  bullet, and the security/test sections updated to the decoupled model.

## Test plan / definition of done
- `vendorPayouts.db.test.js` green (PGlite)
- `vendorPayoutsConcurrency.pg.test.js` green where a real PG URL is present, else SKIPPED
- `redTeam.db.test.js`, `financialInvariants.db.test.js`, `engineTimeouts.db.test.js` still green
- migration exists byte-identical in both SQL directories
- no app deploy required: both changed objects are database functions
