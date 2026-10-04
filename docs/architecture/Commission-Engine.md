# Referral Commission Engine (Phase 07)

Status: implemented and tested in the repo; the migration `carefind_20261007_commission_engine` is **written, NOT yet applied** to production (see section 6).

## 1. Rules (existing, unchanged)

A referred business's FIRST successful plan payment earns its referring agent **40%** (`referral_bonus`); every later payment earns **5%** (`residual`). Rates live in `financial_config` (`referral_first_payment_rate`, `referral_residual_rate`); the inactive-agent policy (previously the JS constant `ACCRUED_WHILE_INACTIVE = false`) is now `referral_accrue_while_inactive` (0 = flag for review, 1 = keep accruing). Math is `round(base x rate, 2)` in `numeric`, never floats.

## 2. What was wrong (audit F-05 and its neighbours)

| Problem | Before | Now |
|---|---|---|
| First-payment race | `renew_business_plan` counted earlier payments before taking any lock: two simultaneous first payments could both be "first" (two 40% bonuses) | the business row is locked **first**; plus unique partial indexes (one first payment per business, one `referral_bonus` per business) as a backstop |
| Commission created outside the payment | Node ran `computeCommission` after settlement; a crash lost it, the webhook path relied on a cron with caps (90 days, 200 payments, first 1000 businesses) | `_record_referral_commission` runs **inside** `renew_business_plan`, same transaction as the payment row: payment + expiry + commission (or review flag) commit together or not at all. Every door (engine, legacy webhook branch, retries) goes through it |
| No base amount; floats | `commissions` kept amount and rate only; JS float rounding | `base_amount` column; `amount = round(base_amount x rate, 2)` enforced by CHECK; rate within 0..1; type/status enumerated |
| Client-side creation | relied on grants alone | INSERT/UPDATE/DELETE/TRUNCATE revoked from **every** role (incl. `service_role`) on `commissions` and `commission_review_flags`; only the definer function writes |
| Mutability | any admin UPDATE | trigger: identity, rate, base and amount are immutable; `status` moves only `accrued -> payable -> paid` (or `void`), through `set_commission_status()` (service role / platform admin); rows are never deleted |

## 3. One payment -> at most one commission

`UNIQUE(payment_id)`; `ON CONFLICT DO NOTHING`; replays of the same reference return `already_processed` before any commission logic. A commission records: payment id, agent id, business id, type, rate, base amount, commission amount, status, created_at.

## 4. Reconciliation

* `reconcile_commissions()` (service role) returns one row per problem: `missing_commission`, `wrong_type`, `wrong_rate` (configuration drifted since payment), `wrong_base`, `wrong_agent`, `first_payment_integrity`, `double_program` (the same payment also paid by the tier-based `agent_earnings` program). The migration refuses to apply if production does not reconcile.
* `backfill_missing_commissions(limit)` repairs payments that predate the engine: set-based, oldest first, no window; a payment leaves the candidate set as soon as it has a commission or flag, so repeated runs finish the job. It locks the business row like a payment does.
* CareHub's `cron-reconcile-payments` now calls both and logs every inconsistency (`api/_lib/commissionReconcile.js`).

## 5. Deliberately not changed

* The **tier-based `agent_earnings` / payout program** (10% / 5% / 3%) is a separate scheme feeding `payout_requests` and agent dashboards. Unifying the two programs is a commercial decision and is Phase 08 (payout) scope; `double_program` makes any overlap visible meanwhile. Production has zero rows in both, so nothing is paid twice today.
* Commission `payable -> paid` is an administrative status change; money movement for agent payouts is Phase 08.

## 6. Rollout

1. Apply `carefind_20261007_commission_engine` (assertions inside check ACLs, one `renew_business_plan`, no write grants, reconciliation clean). Re-read `proacl` afterwards (project trap).
2. Deploy CareHub (it no longer calls `computeCommission`; deploying before the migration would leave new payments without commissions until the nightly backfill).
3. Any payment made between steps is repaired by `backfill_missing_commissions`.

## 7. Tests

`commissionEngine.db.test.js` (25, PGlite): rates, rounding to kobo, inactive/suspended/missing agent, config-driven policy, replay, rollback on commission failure, invariants (second bonus, second first payment, amount/rate/type/status, immutability), no-client-write for anon/authenticated/service_role, ACLs, reconciliation kinds, backfill. `commissionConcurrency.pg.test.js` (6, real Postgres): 30 payments for a new business at once, 12 genuinely overlapping transactions, 40 callers on one reference, many businesses, backfill racing payments, engine settlement by 3 callers per reference. **Mutation-checked:** removing the business lock and the unique indexes makes the overlapping test fail (12 "first" payments). CareHub: `commissionReconcile` (3), `paymentFlows` (no commission written from Node).
