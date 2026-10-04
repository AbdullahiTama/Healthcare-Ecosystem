# CareCoin Wallet (Phase 05)

Status: implemented and tested in the repo; **the three migrations are not yet applied to production** (see §6).

## 1. The model

```
every CareCoin movement ──▶ _post_coin_entry() / _post_coin_transfer()        (private, Postgres)
                               1. lock the wallet row(s)           (transfers: smaller uuid first)
                               2. refuse to go below zero          -> NULL / false, nothing written
                               3. UPDATE wallets.balance           (marker app.coin_write = on, this UPDATE only)
                               4. INSERT coin_ledger               (unique (user, kind, reference))
                            all one unit: any error rolls the whole thing back
```
* `wallets.balance` — **integer** coins, `>= 0`, changes **only** through the posting functions (trigger).
* `coin_ledger` — append-only, integer, signed `delta` + `balance_after`; the source of truth. `unique (user_id, kind, reference)` makes every leg idempotent, so a replayed settlement/refund/transfer aborts instead of paying twice.
* `transactions` — still the user-facing history the wallet screen reads; now append-only too, and written with a reference wherever one exists. (Legacy rows keep their old, inconsistent signs; **do not** derive balances from them — use `coin_ledger`.)
* `gifts` — append-only.
* `reconcile_coin_wallets()` returns wallets whose balance differs from the sum of their ledger; `verify_coin_ledger_chain()` returns entries whose `balance_after` is not previous + delta. Both must be empty (service_role only).

## 2. Who writes a balance

Only the posting primitives. Thirteen functions were moved onto them (signatures and return values unchanged):

| Flow | Function | Ledger entries |
|---|---|---|
| Card top-up | `_settle_wallet_topup` (engine), legacy `credit_wallet_topup` | `topup` (+) |
| Card subscription | `_settle_creator_subscription`, legacy `settle_subscription_payment` | creator `subscription_earning` (+); subscriber untouched |
| Card consultation | `_settle_consultation`, legacy `settle_consultation_payment` | professional `consultation_earning` (+); patient untouched |
| Pay a booking in coins | `pay_booking_with_credits` | patient `booking_payment` (−) |
| Coin subscription | `pay_creator_subscription` | transfer: `subscription_payment` (−) / `subscription_earning` (+), one reference |
| Coin consultation | `pay_professional_consultation` | transfer: `consultation_payment` (−) / `consultation_earning` (+) |
| Gift | `send_gift` | transfer: `gift_sent` (−) / `gift_received` (+), one reference |
| Withdrawal | `request_withdrawal` | `withdrawal` (−) |
| Withdrawal rejected | `reject_withdrawal_request` | `withdrawal_refund` (+), reference `wd_refund_<request id>` |
| Coin booking refunded | `refund_appointment_payment` | `booking_refund` (+), reference `appt_refund_<appointment id>` |

## 3. Guarantees (each is a test)

* A wallet **never goes negative**, under 40 simultaneous spends from a 25-coin wallet (exactly 25 succeed).
* A transfer is **atomic**: both legs or neither; A→B and B→A at the same instant, and a 3-wallet ring, **cannot deadlock** (fixed lock order).
* A refund happens **once**: 20 simultaneous rejections of one withdrawal refund once (status guard + ledger unique key).
* A gift's **sender is whoever is signed in** (`auth.uid()`); there is no sender argument. Non-positive/null gifts are refused explicitly (F-13); unknown recipients are refused.
* A withdrawal replay is `ok` only if it is the **same user, amount and account**; anything else is `reference_conflict` and nothing moves (F-01, database side). 15 simultaneous identical retries → one debit, all `ok`; 10 users racing for one reference → one wins.
* **Integer accounting**: fractional balances are gone; every ledger amount is a whole number.
* **Conservation**: after every storm, `wallet = Σ ledger` and the running balances chain.
* **No hand-written balance**: an `UPDATE wallets` (even by the owner or service role) is refused; a wallet holding coins cannot be deleted (an account deletion can no longer silently destroy money; its ledger would survive anyway).

## 4. What changed for callers

* `send_gift` may now answer `invalid_coins`, `recipient_not_found` (besides `ok`, `self`, `insufficient`, `unauthorized`); the gift panel shows readable text for each.
* `request_withdrawal` may answer `reference_conflict`; `initiate-withdrawal` already treats any non-`ok` as a failed request.
* `pay_creator_subscription` / `pay_professional_consultation` may answer `self_subscription` / `self_consultation`.
* The client's `ensureWallet` (create an **empty** own wallet) still works.
* Deleting an `auth.users` row still cascades to `transactions`/`gifts` (the append-only trigger lets referential actions through) but is **refused while the user's wallet holds coins**.

## 5. Production data at cutover (read 2026-10-03)

19 wallets, 186.4 coins in total; 49 legacy `transactions` rows (mixed signs, 20 without a reference, some QA seed data such as a 1,000-coin `subscription_earning`). One wallet held 10.4 coins from the era when gifts credited recipients 80%: it becomes **10** coins with an `opening_balance` entry whose `meta` keeps `legacy_balance: 10.4` and `fraction_dropped: 0.4` (₦80). No view, rule, trigger or foreign key depends on `wallets.balance`; one policy does (`wallets insert own empty`) and the migration drops and recreates it. No duplicate active withdrawal references. Every function that hand-writes a balance today is one of the thirteen replaced.

## 6. Rollout (order matters; all three before the lock is meaningful)

1. `carefind_20261005_coin_ledger` — table, primitives, cutover, integer balances, reconciliation
2. `carefind_20261005_coin_writers_use_ledger` — requires 1 and the Phase 04 engine migration (it fails clearly if they are missing, and aborts if any function still updates `wallets` by hand afterwards)
3. `carefind_20261005_lock_wallets_to_ledger` — wallet guard, append-only `transactions`/`gifts`

Apply 1 then 2 then 3 in a row (between 1 and 3 the old functions keep working because the lock only arrives in 3). After applying: re-read `pg_proc.proacl` (project trap), `pg_trigger` on the three tables, and run `select * from reconcile_coin_wallets()` and `verify_coin_ledger_chain()` — both must return no rows.

## 7. Tests

* PGlite (real Postgres engine + the real migrations + a replica of the live tables, legacy functions pre-created with production's ACLs): `coinLedger` 26, `coinWriters` 34 (run with the lock **on**), `coinLockdown` 14.
* Real Postgres 18.4, 9 concurrency tests: `coinConcurrency.pg.test.js` (needs `PG_CONCURRENCY_URL`; `npm run test:concurrency` runs both concurrency suites).
* Mutation-checked: removing the F-01 conflict answer, the gift validation, or the policy workaround each fails tests.
* The concurrency run found a race (identical withdrawal retries returned raw unique-violation errors); fixed with an advisory lock on the reference.

## 8. Open items

* **Q1 — RESOLVED (owner, 2026-10-04): the 20% platform fee applies to CareCoin-paid subscriptions and consultations too** (migration `carefind_20261006_coin_paths_platform_fee`): the payer is debited the full price, the creator/professional receives floor(price x 80%), the remainder is a `platform_fee_*` row in `transactions` and is recorded in the debit entry's `meta.platform_coins`. Card and coin paths now agree.
* `refund_appointment_payment`: the business-wallet side still refunds without deducting when the business already withdrew (the `else null` branch) and a card-paid booking has no patient refund — **Phase 09**.
* `pay_booking_with_credits(p_user_id, …)` takes the user as a parameter (service_role only; the handler passes the verified JWT user). It is safe as long as only the server calls it; moving the identity inside would need a signed-in RPC.
* Business wallets (`business_wallets`, held/available kobo) are not yet on a ledger — **Phase 06/08**.
* Deleting an account with coins is now refused; an admin "forfeit/settle wallet" procedure (posting an `adjustment` entry) is needed before such accounts can be removed.
