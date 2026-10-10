# Withdrawal Engine (Phase 08)

Status: implemented and tested. **Both migrations are APPLIED to production (2026-10-05).** Until the new CareFind and CareHub code is deployed, withdrawals on the OLD live code fail (it calls functions that no longer exist) - deploy now.

## 1. The shape

```
client names WHAT (coins / kobo, bank details, PIN)           server decides everything else
  1. authorise      CareFind: session + PIN.   CareHub: verified OWNER + PIN + owns the wallet being drained
  2. verify account Paystack resolves the account number; the typed name must match (else refuse, nothing reserved)
  3. RESERVE        create_withdrawal / create_business_withdrawal   <- ONE atomic database step
                      balance check, rolling-24h cap, debit (CareCoin ledger / business wallet + ledger row),
                      request row, payout computed from financial_config, reference DERIVED from the request id
  --- the reservation has committed; no lock is held from here on ---
  4. provider       balance check -> recipient -> transfer(reference)
  5. link           attach_*_transfer(request id, transfer code, recipient code)      reserved -> processing
  6. settle         settle_withdrawal / settle_business_withdrawal(outcome)  <- the ONLY door for provider outcomes
                      called by: transfer webhook, reconcile sweep, admin reject, the handler's own recovery
```

## 2. States

```
reserved -> processing -> completed -> reversed -> refunded
reserved|processing -> failed -> refunded
```
`requested` is the client's request before anything is stored: the row is created and the money reserved in one statement, so a request is never stored un-reserved. A database trigger enforces the machine (illegal moves raise), makes owner, amount and bank details immutable, lets the provider linkage be set once, and forbids delete/truncate. INSERT/UPDATE/DELETE/TRUNCATE are revoked from **every** role on both request tables; only the engine functions write.

## 3. Requirements -> how each is met

| Requirement | Mechanism |
|---|---|
| exact internal request ID | the database generates it inside the reservation; settle/attach/recovery address requests by id (or by the reference, which is derived from it) |
| deterministic reference | `cf_wd_<id>` / `ch_wd_<id>` (32 hex chars, lowercase, <= 50). The client can no longer supply or reuse one: the replay branch that made F-01 possible is gone |
| no latest-row lookup | removed everywhere (handlers, recovery, webhook) |
| atomic reservation | one function; wallet row lock serialises a user's / business's requests; cap checked under the same lock |
| exact provider linkage | `attach_*_transfer` by request id; codes can be set once, never re-pointed; the webhook's amount must equal the reserved payout (else `amount_mismatch`, not completed) |
| transfer failure recovery | nothing sent (balance low, recipient failed) -> released at once with no provider lookup; transfer call failed -> refund only after Paystack confirms it was not created (definite refusal checked now, ambiguous waits out the 10 min grace in the sweep) |
| transfer reversal recovery | `transfer.reversed` on a `completed` request -> `reversed` -> coins/balance refunded, once; a reversal before completion is treated as failure |
| no duplicate refund | request row lock + state machine + unique ledger key (`wd_refund_<id>` / `bwd_refund_<id>`); 40 simultaneous failure notices refund once |
| no negative balances | `_post_coin_entry` / wallet CHECKs; reservation checks under lock |
| funds are traceable (Phase 16) | before debiting, `create_withdrawal` sums the user's untraceable credits (`reconcile_coin_provenance()`, rule in CareCoin-Wallet.md §3) and refuses when the request would dip into them: `untraceable_credits` with the withdrawable/held split; the handler 403s, queues one `wallet_needs_attention` email and never calls Paystack |
| concurrency safe | proven on real Postgres: overlapping transactions, 40-way races, cap races (section 6) |
| stale state recovery | sweep (CareFind + CareHub cron) over `reserved`/`processing` past the grace period; `reconcile_withdrawals()` reports anything still stuck |
| no provider calls under locks | reservation commits before the first Paystack call |

Contradictory provider signals are **reported, never auto-fixed**: `conflict_paid_after_refund` (provider paid something already refunded), `conflict_failed_after_completed`, `amount_mismatch` are logged as `withdrawal.needs_attention` and returned.

## 4. Controls added (audit F-08, F-09, F-16, F-01, F-18)

* **CareHub PIN** (F-08): the owner must prove the withdrawal PIN, the same hashed/locked-out PIN CareFind uses (one PIN per person across both apps). New `/api/withdrawal-pin/{status,set}`. **Replacing an existing PIN requires the current PIN**, otherwise a thief with a session would set their own.
* **Account name verification** (F-08): CareHub now resolves the account and requires the typed name to match, as CareFind does; a resolver failure refuses (never pays an unverified account), except banks Paystack says cannot be resolved.
* **Server-side limits**: CareHub minimum N100 and rolling-24h cap N1,000,000 per business, both `financial_config` rows. **New rules, decided by the owner 2026-10-04.** CareFind's trust-tier caps are unchanged. The payout (20% fee, N200/coin) is now computed in SQL from `financial_config`, not hard-coded in JS (F-18, withdrawal part).
* **`verifyBusiness`** matched the owner with an unescaped `ILIKE` (F-09): fixed (separate commit).
* **Legacy surface removed** (F-16, F-01): `request_withdrawal`, both `request_business_withdrawal` overloads, `reject_*`, `refund_business_withdrawal`, `approve_withdrawal_request`, `complete_withdrawal_transfer`. Admin "approve" is gone (nothing to approve); admin "reject and refund" asks Paystack first, then settles through the engine.

## 5. Behaviour changes to be aware of

* Status values changed (`pending` -> `reserved`/`processing`, `rejected`/`failed` -> `refunded`); admin UI, CareHub wallet list and dashboard counts follow. Existing rows are migrated by the migration.
* CareHub owners must set a PIN before their next withdrawal (the form walks them through it).
* **Phase 16**: a withdrawal funded partly by untraceable credits is refused with `untraceable_credits` and a `wallet_needs_attention` email naming the held and withdrawable amounts — the coins stay in the wallet while reconciliation reviews them.
* `cancel-appointment` used to "reverse the held balance" by filing a **fake withdrawal** (bank `refund`, account `0000000000`). That function no longer exists; the call was removed. The wallet reversal and client refund are **Phase 09** (see section 8).
* Paystack `checkBalance` now runs after reservation (the exact payout is only known then); if the provider balance is low the reservation is released immediately.

## 6. Tests

* `withdrawalEngine.db.test.js` (27, PGlite, production-order migrations + a production-shaped legacy-data migration test), `withdrawalConcurrency.pg.test.js` (10, real Postgres): 40 simultaneous failure notices -> one refund; failed/reversed/success racing; 12 genuinely overlapping transactions; 40 requests on a 25-coin wallet -> exactly 5; cap race (cap 50, twenty 10-coin requests -> exactly 5); business wallet and N1M cap races; mixed create+settle storm with books balancing. **Mutation-checked:** removing the row lock in `settle_withdrawal` fails the overlapping tests.
* shared-payments `withdrawals` (23), `pin` (9); CareFind `initiate-withdrawal` recovery (14), webhook transfer settlement, recovery, admin; CareHub `initiateBusinessWithdrawal` (21), `withdrawalPin` (7), `verifyBusiness` (4), recovery, UI `WithdrawalPinField` (9).

## 7. Rollout (order matters)

1. Apply `carefind_20261008_withdrawal_engine` **and deploy CareFind + CareHub together**: the old code calls functions and statuses that no longer exist, the new code needs them. It asserts ACLs, no legacy function surviving, no write grants, and that withdrawals reconcile (ignoring `stuck`).
2. Apply `carefind_20261008_commission_reconcile_first_payment` (replaces the Phase 07 reconcile function; no data change).
3. After applying, re-read `proacl` for the new functions (project trap) and run `select * from reconcile_withdrawals(60)`.

## 8. Findings from this phase

* **F-32 (CareFind) — RESOLVED**: `/api/withdrawal-pin/set` used to let any session replace an existing PIN (only email confirmation required), defeating the PIN as a stolen-session control. Both apps now require a fresh emailed one-time code for any set/change, and a change of an existing PIN additionally needs the current PIN unless the person chose "forgot PIN" (`shared-payments/src/otp.js`, `pin.js`; see `Payout-Accounts-and-KYC.md`).
* **F-33**: `cancel-appointment` marks a card-paid appointment `refunded` and writes a wallet ledger row but moves no money to the client and does not reduce the business wallet (the fake-withdrawal trick it relied on is gone). Phase 09.
* **Production data**: 3 `withdrawal_requests` from July/September are `pending` with coins debited and **no transfer** (two have no reference at all, one has a reference but no code): 41 coins. They become `reserved`; the sweep refunds the one with a reference after Paystack says not found; the two without references need an admin reject (which refunds). Decide before applying.


## 9. Update 2026-10-12: F-32 closed; saved payout accounts + KYC

* **F-32 is fixed.** Setting or replacing the withdrawal PIN (CareFind and CareHub) needs a fresh emailed 6-digit code, and replacing also needs the current PIN unless the person chose "forgot PIN" (the code is then the only proof). A PIN change sends an alert email. See `Payout-Accounts-and-KYC.md`.
* **Saved payout accounts.** A withdrawal may name a `payoutAccountId`; the destination then comes from the database (a bank account the owner proved is theirs), and any bank details in the request are ignored. `financial_config.payout_account_required` (default 0) makes this mandatory.
* **`/api/resolve-account`** (a paid Paystack call made with our secret key) is now for signed-in users only, 10 lookups a minute per user.

## 10. Update: a fresh emailed code on every withdrawal

`initiate-withdrawal` (CareFind) and `initiate-business-withdrawal` (CareHub) check, in order: PIN, then a single-use emailed code (`checkOtp`, purpose `withdrawal`), then the bank re-check, limits and the reservation. The code is requested through `POST /api/withdrawal-pin/otp {"purpose":"withdrawal"}`. See `Payout-Accounts-and-KYC.md` (Withdrawal code) and migration `carefind_20261027_withdrawal_otp_purpose` (not yet applied to production).
