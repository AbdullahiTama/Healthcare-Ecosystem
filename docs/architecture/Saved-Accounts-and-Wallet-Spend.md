# Saved Payout Accounts & Wallet Spend (Phase 16)

Status: implemented and tested. **The three migrations are NOT applied to production** — apply them with the Phase 04-16 deploy (see section 7).

## 1. The shape

```
saved payout account          owner names WHAT (bank, number, name)     server decides the rest
  1. add           10-digit number; optional BVN/NIN format-checked (11 digits) and kept as LAST-4 ONLY
                   Paystack resolveAccount: the typed name must match the bank's name (else refuse)
                   -> status pending_review, event `added`
  2. review        admin action payout_account_review: verified | failed   (event `reviewed:<decision>`)
  3. edit          re-resolved exactly like add
                   event `edited` with a snapshot of the OLD details is written BEFORE the row changes
                   -> status pending_review again, verified_at cleared, is_default CLEARED
  4. set-default   ownership + status must be `verified` + withdrawal PIN + a FRESH emailed OTP
                   the previous default is cleared first, then the new one is set (event `set_default`)
  5. remove        refused on the default account (switch first)
                   event `removed` with a snapshot is written BEFORE the delete; the event row
                   survives the delete (FK is `on delete set null`)

wallet spend / top-up          client names WHAT                          server + engine decide the rest
  1. initiate  top-up only: whole-kobo amount bounded N100 - N100,000, verified business;
               reference minted server-side (ch_topup_*), the intent row is written BEFORE Paystack
  2. provider  Paystack charge for the intent's stored expected_amount
  3. settle    settle_payment_intent (the ONLY door) -> private _settle_*_wallet handler
                 wallet_topup / business_wallet_topup: credit on a provider payment that matches
                   the intent exactly, once (replay -> already_settled, wrong amount -> needs_refund)
                 *_wallet spends: debit the payer (CareCoin ledger, or business available_balance),
                   credit the payee in the purpose's currency; insufficient / declined -> the intent
                   fails with no money moved (wallet pays never create provider money)
```

1 CareCoin = N200 = 20,000 kobo (config `coin_naira_rate`); coin conversions always round UP so the payer never under-pays (`ceil(kobo / 20000)`).

## 2. States

```
pending_review --admin verified--> verified --edit--> pending_review
pending_review --admin failed----> failed   --edit--> pending_review
```

Any non-default account can be removed (the row is deleted; its events stay, id nulled).

Invariants:

* **Exactly one default per owner** — partial unique indexes `payout_accounts_default_user_uniq` / `payout_accounts_default_business_uniq` (one per owner column, `where is_default`).
* **Default implies verified** — set-default checks `status = 'verified'`; edit always clears `is_default`, so a `pending_review` account can never be default.
* **The default cannot be removed** — remove refuses it; switch the default first (which needs the account below to be verified).
* **Audit-first** — for `edit` and `remove` the event row (with a snapshot of the old `account_number`, `bank_code` and owner in `meta`) is inserted BEFORE the row is changed or deleted; the events FK is `on delete set null`, so history outlives the account.
* **No client writes money or OTP rows** — `payout_accounts`, `payout_account_events`, `withdrawal_email_otps`: RLS on, zero policies, nothing granted to anon/authenticated; the `_settle_*_wallet` handlers and the provenance function have EXECUTE revoked from every role.

## 3. Requirements -> how each is met

| Requirement | Mechanism |
|---|---|
| several accounts, one default | partial unique indexes per owner column; set-default clears the old flag in the same handler before setting the new one |
| the bank's name, not the user's claim | `resolveAccount` (CareFind: normalize-and-compare; CareHub: shared `verifyBankAccount`) on **add and edit**; a resolver failure refuses — an unresolvable account is never saved |
| minimal PII | BVN/NIN are format-checked as 11 digits, only the last 4 are stored (`bvn_last4`/`nin_last4`), the full value is discarded, never logged, no billed KYC calls (owner decision: manual review instead) |
| a trustworthy default | set-default = ownership + `verified` status + withdrawal PIN + fresh OTP, in that order; every step refuses before any write |
| PIN not settable by a stolen session | every PIN set/change needs a fresh emailed OTP; changing an existing PIN additionally needs the current PIN (**F-32 closed**) |
| OTP not brute-forceable | 6 digits stored as `sha256(code:userId)`; 10-minute expiry; single-use (`consumed_at`); 5 attempts then burn; 3 codes per hour per user (429); only to a confirmed email; the code never appears in a response |
| audit survives account removal | events FK `on delete set null` + snapshot in `meta` + event-before-write ordering |
| every withdrawable coin traceable | provenance rule (section 4) enforced inside `create_withdrawal`, reported by `reconcile_coin_provenance()` |
| wallet spends cannot double-pay or self-price | one engine door `settle_payment_intent`: row lock, status machine, replay -> `already_settled`, amounts re-checked from the stored intent; handlers are EXECUTE-private |
| top-up credited only for matching money | intent written before Paystack with the server's bounds; settle compares provider, currency and amount; mismatch -> `needs_refund`, wallet untouched |
| top-up bounded | whole-kobo integer between N100 and N100,000 checked at initiate (server-side, both sides of the API) |
| no held money silently spent | `plan_renewal_wallet` / `appointment_fee_wallet` update `available_balance ... where available_balance >= amount` (guarded); held money is never touched |

## 4. Controls added

* **PIN step-up via email OTP (A1-A5):** table `withdrawal_email_otps` (RLS on, service-role only); `/api/withdrawal-pin-otp` on both apps issues the code (`withdrawal_pin_otp` template through the shared outbox); the PIN set handlers verify it before changing anything, and replacing an existing PIN still requires the current one. One helper `api/_lib/emailOtp.js` implements issue/verify with the limits above.
* **Saved payout accounts (A6-A9):** tables + handlers on both apps (`GET/POST /api/payout-accounts`, `/set-default`, `/edit`, `/remove`); admin `payout_account_review` in `admin-auth.js` flips `pending_review -> verified | failed` and records `reviewed:<decision>`. Withdrawals stay free-form (A9 decision): a saved account is convenience and a trust signal, not a gate — nothing about the withdrawal engine changed except the provenance check below.
* **Provenance (D1):** a positive `coin_ledger` credit is traceable iff (a) its `kind` is an engine-only internal source (`opening_balance`, `topup`, `gift_received`, `withdrawal_refund`, `booking_refund`, `shop_payment_refund`); or (b) a settled `payment_intents` row carries the same reference; or (c) its reference has a prefix only service-role code mints (`wd_refund_`, `appt_refund_`, `sref_`, `gift_`, `sub_`, `consult_`, `bk_`, `adj_`); or (d) it is an earning vouched for by a `transactions` settlement row. Everything else — e.g. a forged `adjustment` — is untraceable: `reconcile_coin_provenance()` returns it (`adjustment_without_allowed_reference`, `earning_without_settlement_record`, `no_settled_intent`), `run_db_reconciliation()` surfaces it as a critical `untraceable_credit` finding, and `create_withdrawal` refuses to withdraw past `balance - untraceable` (`untraceable_credits` outcome). The handler answers 403 with the withdrawable/held split, never calls Paystack, and queues one `wallet_needs_attention` email. Business withdrawals are exempt (their credits only arrive through the engine). Full rule: `CareCoin-Wallet.md` §3; reservation row: `Withdrawal-Engine.md` §3.
* **CareHub business top-up (B1-B2):** `initiate-wallet-topup` / `verify-wallet-topup` (purpose `business_wallet_topup`), plus the "Add funds" card on the CareHub Wallet screen. Verify reads `reference`/`trxref` from the return URL, settles through `settleIntentForRequest` with a purpose guard, then cleans the URL with `history.replaceState` before reloading the wallet. `topupApi.js` exposes `goToPaystack` as a seam so the component tests never navigate jsdom.

## 5. Behaviour changes to be aware of

* **Setting or changing a withdrawal PIN now requires a 6-digit emailed OTP on both apps** (and a change also requires the current PIN). The PIN forms ask for the code; a user without a confirmed email cannot arm a PIN.
* The CareHub Wallet screen gained the "Add funds" flow (Paystack redirect; N100-N100,000).
* A withdrawal request can be refused with `untraceable_credits` and a `wallet_needs_attention` email even when the raw balance is sufficient: the untraceable portion stays put pending reconciliation. Nothing is moved or frozen.
* The engine now recognises seven more purposes (`booking_wallet`, `subscription_wallet`, `consultation_wallet`, `shop_order_wallet`, `plan_renewal_wallet`, `appointment_fee_wallet`, `business_wallet_topup`). **Only `business_wallet_topup` has client handlers/UI today**; the other six are engine capability with tests — no initiator creates those intents yet, and the existing CareFind coin flows keep their direct RPCs (`pay_creator_subscription`, `pay_professional_consultation`, booking/shop credits), whose references remain traceable by prefix.
* The payout-account surface is **API + database only**: no management UI shipped, and withdrawal forms still take a typed account (A9).
* `coin_ledger`'s kind CHECK gained `shop_payment` / `shop_payment_refund` (shop wallet spends).

## 6. Tests

* `apps/carefind/src/test/payments/payoutAccounts.db.test.js` (10): shape and CHECKs, one-default-per-owner uniqueness (both columns), append events, delete keeps events (FK set null), ACLs (no API-role grants; service_role keeps UPDATE/DELETE — the project convention).
* `apps/carefind/src/test/payments/withdrawalEmailOtp.db.test.js` (5): table shape, expiry default, attempts, grants.
* `apps/carefind/src/test/payments/walletSpendAndTopup.db.test.js` (11, PGlite): `business_wallet_topup` credits once and refunds on wrong amount; `booking_wallet` pays a booking from coins; `subscription_wallet` moves coins subscriber -> creator; `plan_renewal_wallet` / `appointment_fee_wallet` debit business available balance; `consultation_wallet` happy + insufficient; `shop_order_wallet` happy, `amount_changed` (refund leg `sref_*`), insufficient.
* Handler tests: CareFind `payout-accounts.test.js` (15 — ownership scoping, audit-first edit/remove ordering, the set-default step-up gates), CareHub `payout-accounts.test.js` (9, business-scoped mirror), CareHub `walletTopup.test.js` (18 — server bounds, intent-before-Paystack, settle/already/needs_refund/wrong-purpose), `withdrawal-pin-otp.test.js` / `withdrawalPinOtp.test.js` (code never echoed, 429, failed enqueue), `withdrawalPin` (10 + 7: OTP required, current PIN required to change), `initiate-withdrawal.provenance.test.js` (forged credit refused with the split), CareHub `Wallet.test.jsx` (5) + `topupApi.test.js` (6).
* Suites on the final code: CareFind payments 657 passed / 58 skipped; CareFind full 1,935 (153 files); CareFind api 294 (37 files); CareHub full 1,250 (106 files); shared-payments 334; shared-email 294 (incl. the `withdrawal_pin_otp` renderer).

## 7. Rollout (order matters)

1. Apply `carefind_20261020_withdrawal_email_otp`, `carefind_20261020_payout_accounts`, `carefind_20261020_wallet_spend_and_topup` (repo mirrors in `apps/carefind/sql/`, hash-identical for the PGlite fixture chain) **together with the Phase 04-16 code deploy**. The new PIN/set and payout endpoints do not exist before the migrations; the wallet purposes and the provenance guard only exist after.
2. After apply, re-read the catalog: `withdrawal_email_otps` / `payout_accounts` / `payout_account_events` have RLS on with zero policies and no anon/authenticated grants; both partial unique default indexes present; `reconcile_coin_provenance()` executable by service_role only; the seven `_settle_*_wallet` handlers executable by nobody; one `settle_payment_intent` carrying all dispatch branches.
3. Run `select * from run_db_reconciliation()` — expect no `untraceable_credit` (any row found is a real quarantined credit, review before anyone withdraws).
4. Ops: watch `wallet_needs_attention` mail and the `untraceable_credit` finding; run admins through `payout_account_review` for accounts as they arrive (the review action does not email the owner yet).

## 8. Findings from this phase

* **Audit FK cascaded away history** (found in self-review): `payout_account_events.payout_account_id` was written `on delete cascade`, so removing an account destroyed its own audit trail. Fixed in the migration as `on delete set null`; because the FK no longer follows the row, the event insert was also moved BEFORE the delete/edit in both handlers, with the previous `account_number`/`bank_code`/owner snapshotted into `meta` (the old ordering would have referenced a just-deleted row).
* **Plan's edit action was missing from both handlers** (found while closing A7): without edit, a typo in the *default* account was unfixable — the default cannot be removed, and a replacement cannot become default before admin review, so a human was needed to fix a keystroke. Implemented in both apps: re-resolved like add, audit-first, reset to `pending_review`, default cleared; covered by the new handler tests.
* **Plan A8's owner notification is not built**: `payout_account_review` records the event but sends no email — queued for when the payout UI ships.
