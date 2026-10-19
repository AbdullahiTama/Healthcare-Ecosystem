# Wallet integrity — decision brief

**Date:** 2026-10-19
**Status:** updated 2026-10-19. **D2 — applied to production, verified** (the nightly scan now publishes business wallets). **Follow-up 6 — applied** (a custom role granted Wallet gets a read-only page). **D1 — evidence gathered: no receipt exists for the N5,000; awaiting the owner's one-line decision.** **No balance has been touched.**
**Scope:** business `business_wallets` only. The 3 CareFind withdrawals and 9 legacy shop orders are Rem-09 — frozen pending explicit financial authorisation.
**Tracked by:** `planning/financial-system/00-master-plan.md` Rem-06; `docs/architecture/Production-Readiness.md` section 5.4.

---

## 1. Live state (verified 2026-10-19)

`reconcile_business_wallets()` (migration `carefind_20261115`, **detect-only**) returns:

| business | kind | detail |
|---|---|---|
| d8663307 Test Pharmacy — QA | `no_ledger_rows` | holds 500,000 kobo (N5,000); zero ledger rows; zero `payment_intents` ever; wallet row last touched 2026-09-21; business created 2026-07-18 |
| fdba0136 Health Plus Pharmacy | `balance_not_derivable` | holds 1,840,000 kobo; its 13 ledger rows explain 1,340,000 (delta 500,000; 840,000 released) |

Total: **1,000,000 kobo (N10,000)** of business balance with nothing behind it.

fdba0136 arithmetic, from its own ledger: every row since 2026-09-29 nets to zero (the withdrawal/refund pairs, including the pending legacy pair) except `shop_credit` +840,000 and `topup` +500,000 — and the two `shop_release` rows (held → available, net zero to the total). So the unexplained N5,000 **was already in the balance before 2026-09-29** (pre-ledger era). It is not caused by any recent flow: the 2026-10-11 wallet top-up is fully ledgered (intent `ch_topup_fdba0136_ae85188db6c6`, N5,500 paid / N5,000 credited — 10% fee), and the plan renewal one minute later is a **card** payment (`plan_renewal` / `_settle_plan_renewal`; the wallet-pay variant purpose is `plan_renewal_wallet`), so it does not touch the wallet.

## 2. Decisions

### D1 — the N10,000 itself

The migration is explicit that this needs the owner's judgement, not a mechanical fix (was the money received outside the ledger, or is it drift?). Options:

- **d8663307 (QA test business)** — (a) reset the row to zero (one audited UPDATE; it is a test fixture — no intents, no ledger, no withdrawals), or (b) leave it and acknowledge the finding. Recommend (a).
- **fdba0136 (Health Plus Pharmacy)** — (a) if a matching receipt exists (pre-ledger era; Paystack/ops evidence), keep the balance and ledger an explicit legacy credit row so balance and ledger agree; (b) if it is drift, reduce the balance to 1,340,000; (c) leave it and acknowledge. Recommend (a) if the owner can confirm the receipt, else (b). Financial decision — the owner's to make.

A correction needs a new single-purpose migration plus a note in the reconciliation docs. Note `business_wallets` rows are write-locked to server paths but nothing records a hand correction today, so the corrective row should carry an unmistakable reference (e.g. `correction_2026_10_<nn>`).

**Evidence gathered 2026-10-19 (read-only): no receipt exists in the database.** Every money path for fdba0136 is accounted: `payment_intents` begin 2026-10-07 and each settled one is ledgered (two shop credits, the 10-11 top-up); the only two paid `shop_orders` are credited; all four appointments are unpaid and never released; `platform_transactions` has zero rows; `business_wallet_transactions` (globally) begin 2026-09-29. The N5,000 is pre-ledger residue with no surviving record — option (a) can no longer be confirmed from the data; it would rest on the owner's own bank/ops records. The live choice is **(a′) keep and ledger a `correction_*` legacy credit if the owner recognises the N5,000**, **(b) reduce to 1,340,000**, or **(c) keep and acknowledge** the warning. d8663307 (QA) stands as a test-fixture reset to zero (recommend (a) there). One word applies the correction.

### D2 — the check is not wired into the nightly scan (found 2026-10-19)

`run_db_reconciliation` publishes these sources: `coins`, `commissions`, `withdrawals`, `refunds`, `shop_vendor`, `intents`, `events`. It **never publishes business wallets** — nothing outside the db tests calls `reconcile_business_wallets()`. The migration header says the findings "surface in `reconciliation_findings`", but in production they do not: the N10,000 is visible only when someone runs the function by hand, and admin Money Checks does not show it. (This is also why a wallet-filtered `reconciliation_findings` query returns `[]`.)

**Proposal (recommended first):** one small migration — build the `_rs` temp rows from `reconcile_business_wallets()` and `_recon_publish('business_wallets')` with severity `warning`, plus a db test pinning that a drifted wallet becomes a finding and a clean ledger reports none. Visibility only; no balance moves.

**APPLIED 2026-10-19 (approved).** Migration `carefind_20261116_business_wallet_reconciliation_wiring` (ledger version 20261019084144): `run_db_reconciliation` re-created **verbatim** from `carefind_20261020` plus one source — `_rs` from `reconcile_business_wallets()`, published as `business_wallets`, severity `warning`, subject `business` / the business id, with a guard that skips the redefinition where the function is absent — then `_apply_engine_timeouts()` re-applied (a redefinition drops the timeouts), per the "redefine ⇒ re-apply" rule. Verified in production: a light run published both rows (`business_wallets` → inserted 2: fdba0136 `balance_not_derivable`, d8663307 `no_ledger_rows`), `proconfig` intact (`lock_timeout=10s`, `statement_timeout=120s`), still `service_role` only. Pinned by four new tests in `apps/carefind/src/test/payments/businessWalletReconciliation.db.test.js` (source list, finding lifecycle including reopen, timeout/ACL preservation). The source is non-heavy, so both the nightly (heavy) and light runs publish it; Money Checks shows the two rows.

### D3 — business wallets still have no balance write-guard (structural, Rem-06 note)

CareCoin wallets cannot drift: `wallets_guard` lets a balance change only while the ledger primitive runs. `business_wallets` relies on privileges alone. **Proposal:** mirror that guard for business wallets (its own design pass — the posting paths are `fn_credit_business_booking`, vendor release, topup/plan/appointment-fee settles, withdrawals). Larger change; needs its own spec before any code.

## 3. Already explained — no action offered

- The N2,000 legacy pending pair (withdrawal 2026-09-29, refund 2026-10-04; both `pending`, no references) is documented in `carefind_20261115` as net-zero — it never moved the balance. Cosmetic only.
- **Rem-09 (frozen):** 3 CareFind stuck withdrawals (2 `reserved` since July with `payout_kobo = NULL`, 1 `processing` since 2026-10-11 — the acknowledged finding) and the 9 legacy shop orders (N1,170). Awaiting explicit financial authorisation; do not touch.

## 4. Evidence (read-only, run 2026-10-19)

- `select * from reconcile_business_wallets()`
- `select w.business_id, w.available_balance, w.held_balance, w.updated_at, b.name, b.created_at from business_wallets w join businesses b on b.id = w.business_id`
- `select type, status, count(*) from business_wallet_transactions group by 1, 2` → 16 confirmed + 2 pending (the legacy pair)
- `select source, kind, severity, status, detail from reconciliation_findings order by last_seen_at desc` → shop_vendor 9 (info) + withdrawals 4 (1 resolved, 2 open, 1 acknowledged); last scan 2026-10-19 02:59
- `select purpose, expected_amount, status, reference, created_at from payment_intents where business_id = 'fdba0136-…'` (and `'d8663307-…'` → zero rows)
