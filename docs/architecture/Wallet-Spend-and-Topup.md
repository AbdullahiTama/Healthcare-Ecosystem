# Wallet top-up, wallet spend and CareCoin provenance (Phase 16)

Status: implemented and tested. **Migration `carefind_20261020_wallet_spend_and_topup` is NOT applied to production.** (Authored by Joepuils; merged onto the payout-accounts branch with the payout-account and PIN-code parts left out, since `Payout-Accounts-and-KYC.md` covers those.)

## 1. The shape

```
wallet spend / top-up          client names WHAT                          server + engine decide the rest
  1. initiate  top-up only: whole-kobo amount bounded N100 - N100,000, verified business;
               reference minted server-side (ch_topup_*), the intent row is written BEFORE Paystack
  2. provider  Paystack charge for the intent's stored expected_amount
  3. settle    settle_payment_intent (the ONLY door) -> private _settle_*_wallet handler
                 business_wallet_topup: credit on a provider payment that matches the intent exactly, once
                   (replay -> already_settled, wrong amount -> needs_refund)
                 *_wallet spends: debit the payer (CareCoin ledger, or business available_balance),
                   credit the payee in the purpose's currency; insufficient / declined -> the intent
                   fails with no money moved (wallet pays never create provider money)
```

1 CareCoin = N200 = 20,000 kobo (`coin_value_kobo`); coin conversions round UP so the payer never under-pays.

## 2. Requirements -> how each is met

| Requirement | Mechanism |
|---|---|
| wallet spends cannot double-pay or self-price | one engine door `settle_payment_intent`: row lock, status machine, replay -> `already_settled`, amounts re-checked from the stored intent; handlers are EXECUTE-private |
| top-up credited only for matching money | intent written before Paystack with the server's bounds; settle compares provider, currency and amount; mismatch -> `needs_refund`, wallet untouched |
| top-up bounded | whole-kobo integer between N100 and N100,000 checked at initiate |
| no held money silently spent | `plan_renewal_wallet` / `appointment_fee_wallet` update `available_balance ... where available_balance >= amount`; held money is never touched |
| every withdrawable coin traceable | provenance rule (section 3) enforced inside `create_withdrawal`, reported by `reconcile_coin_provenance()` |

## 3. Provenance

A positive `coin_ledger` credit is traceable iff (a) its `kind` is an engine-only internal source (`opening_balance`, `topup`, `gift_received`, `withdrawal_refund`, `booking_refund`, `shop_payment_refund`); or (b) a settled `payment_intents` row carries the same reference; or (c) its reference has a prefix only service-role code mints (`wd_refund_`, `appt_refund_`, `sref_`, `gift_`, `sub_`, `consult_`, `bk_`, `adj_`); or (d) it is an earning vouched for by a `transactions` settlement row. Everything else (e.g. a forged `adjustment`) is untraceable: `reconcile_coin_provenance()` returns it, `run_db_reconciliation()` surfaces a critical `untraceable_credit` finding, and `create_withdrawal` refuses to withdraw past `balance - untraceable` (`untraceable_credits`). The handler answers 403 with the withdrawable/held split, never calls Paystack, and queues one `wallet_needs_attention` email. Business withdrawals are exempt.

## 4. Behaviour changes

* The CareHub Wallet screen gained the "Add funds" flow (Paystack redirect; N100-N100,000).
* A withdrawal can be refused with `untraceable_credits` even when the raw balance is sufficient; nothing is moved or frozen.
* The engine recognises seven more purposes. **Only `business_wallet_topup` has client handlers/UI today**; the other six are engine capability with tests.
* `coin_ledger`'s kind CHECK gained `shop_payment` / `shop_payment_refund`.

## 5. Tests

`walletSpendAndTopup.db.test.js` and `walletProvenance.db.test.js` (PGlite, production-order migrations), `initiate-withdrawal.provenance.test.js`, CareHub `walletTopup.test.js`, `topupApi.test.js`, `Wallet.test.jsx`.

## 6. Rollout

1. Apply `carefind_20261020_wallet_spend_and_topup` **with the Phase 04-16 code deploy** (the wallet purposes and the provenance guard only exist after it). It rewrites `settle_payment_intent` and `create_withdrawal`, so apply it in a quiet period and run the checks below.
2. After applying, re-read `proacl`: `reconcile_coin_provenance()` executable by service_role only; the seven `_settle_*_wallet` handlers executable by nobody; one `settle_payment_intent` carrying all dispatch branches.
3. Run `select * from run_db_reconciliation()`: expect no `untraceable_credit` (any row found is a real quarantined credit, review before anyone withdraws).
4. Watch `wallet_needs_attention` mail and the `untraceable_credit` finding.

## 7. Not built

The six non-top-up `*_wallet` purposes have no client initiator yet; CareFind's top-up UI is intentionally unchanged.
