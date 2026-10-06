# Red-team audit (Phase 14)

Status: findings confirmed and fixed in `supabase/migrations/carefind_20261019_red_team_fixes.sql`. **The migration is written and tested but NOT YET APPLIED to production** (the apply call was blocked by the permission classifier; see section 5). Until it is applied, every finding below is still exploitable in production.

## 1. Method

Attacker's view: enumerate every SECURITY DEFINER function executable by `anon`/`authenticated`, read the live bodies of the money- and PII-adjacent ones, dump DML grants and write policies on money tables, and chain what an unauthenticated visitor can do (register a business, sign up, call RPCs). Each finding below was reproduced as a test against real Postgres (`apps/carefind/src/test/payments/redTeam.db.test.js`: the attack is first run against the vulnerable bodies, then the migration is applied and the same attack must fail).

## 2. Findings

| ID | Severity | Attack | Fix |
|---|---|---|---|
| F-37 | CRITICAL | Anyone can register a business (anon) and so becomes a business member; members can insert staff rows with any email (RLS); `provision_staff_auth` then **reset the password** of the existing account with that email. Account takeover of any user, including platform admins and wallet holders. | An existing account's password and confirmation are never changed; staff rows link to it. A business must be `active` to mint accounts; a staff row already linked elsewhere is refused. |
| F-38 | CRITICAL | `create_shop_order` stored the client's `p_subtotal_kobo` without comparing it with the items (only the total was checked). The vendor credit is `subtotal - commission`, so a vendor with a colluding buyer could mint arbitrary vendor credit. | Subtotal must equal the items' sum. Defence in depth: `_settle_shop_order` refuses (`needs_refund`, `subtotal_mismatch`) an order with no items or whose items do not sum to the subtotal; reconciliation gains `credit_not_backed_by_items`. |
| F-39 | HIGH | `update_shop_order_status`: any signed-in user could change any order's status by passing their own id as `p_changed_by`. | Only admin/service role may name an actor. A vendor member may only move a PAID order forward through fulfilment (or quote delivery); never payment, refund, cancel or dispute states. `add_tracking_event` follows the same rules. |
| F-40 | HIGH | `complete_appointment_and_release` released the full fee from the held balance a second time (the `appointments_after_update` trigger already releases the booking credit), and for an appointment not paid through the platform released OTHER customers' held money: a business could drain its own hold with dummy appointments. | The function no longer moves money; the trigger releases exactly that appointment's booking credit, once. |
| F-41 | HIGH | `get_purchase_totals` / `get_purchases_page`: executable by anon, no ownership check: any business's supplier and balance data readable with just a business id. | Ownership check; anon revoked. |
| F-42 | MEDIUM | Expense readers, `get_customer_purchase_summary`, `get_order_notification_history` had no ownership check. | Service role / admin / own business / own customer only. |
| F-43 | MEDIUM | Client write policies on `shop_order_items` and `shop_order_returns` (a customer could insert items or an `approved` return for any order, blocking its real return); `record_shop_notification` let anyone post a fake "payment confirmed" to any user; `validate_promo_code` (anon) answered for any user id. | Policies dropped; function revoked; promo check answers for the caller only, anon revoked. |
| F-44 | LOW | `cleanup_old_sequences` (deletes rows) and `book_appointment_slot` (caller-chosen fee) callable by users. | Revoked from public/anon/authenticated. |

## 3. Tests

`redTeam.db.test.js`: 30 tests. All pass. The full PGlite payments suite (33 files, 621 tests) passes with the new fixture. The fixture (`liveSchemaSubset.sql`) gained the production tables the fix touches.

Not yet done: add the migration to the chains of the concurrency (`*.pg`) suites and bench, mutants for the new guards (subtotal check, vendor-forward-only rule, trigger-only release), and a re-run of `test:finance:pg`.

## 4. Residual risks (not fixed)

* **Vendor-controlled "delivered"**: a vendor may still mark a paid order delivered, which starts the 7-day release clock. Accepted design risk; mitigated by the return window, refund recovery and reconciliation.
* `mint_confirmed_auth_user` allows pre-registering (squatting) an address before its owner signs up (medium).
* `lookup-appointment` (unauthenticated PII by phone + business id) and `resolve-account` (unauthenticated account-name oracle) remain open.
* Legacy `wallet_transactions` and `withdrawal_history_log` own-row write policies are still writable (trust level is computed server-side, so no money impact found).
* Promo-code enumeration needs rate limiting.
* **Not reviewed in this phase**: Node endpoint auth and rate limits (initiate-payment, charge-*, withdrawal PIN set), webhook forgery/replay, CORS and secret exposure, CareHub handlers, agent/referral abuse (self-referral, own-ALL policies), storage buckets.

## 5. Applying the fix

Apply `carefind_20261019_red_team_fixes.sql` (copy in `apps/carefind/sql/`), then verify: ACLs on the revoked functions, the three dropped policies, `_settle_shop_order` proconfig timeouts, one `create_shop_order` 20-arg, and run `run_db_reconciliation`. Then check the callers still work: CareHub `complete_appointment_and_release`, `provision_staff_auth`, vendor `update_shop_order_status`, `get_expense_*` and `get_purchase*`. Note for callers: a CareHub flow that relied on `provision_staff_auth` resetting an existing user's password will now link the staff row to the existing account instead.
