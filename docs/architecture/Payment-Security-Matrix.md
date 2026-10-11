# Payment security matrix (H03)

One row per money-in flow: where the price comes from, how the payment is bound to the payer and the entity, how it is verified, where it settles, why a replay cannot pay twice, and the test that proves it. Written 2026-10-10 from the code and the tests, not from memory; a claim without a test reference is marked **untested**.

Common to every card flow:

* **Intent first.** The initiator records a `payment_intents` row (reference, application, purpose, payer, entity, expected amount in integer kobo, currency) **before** Paystack is contacted. The reference is unique; identity fields are immutable by trigger; the table has no client access and no delete.
* **Return address.** `callback_url` is validated by `resolveCallbackUrl` (`shared-payments/src/callbackUrl.js`): absolute, no credentials, https (http only for localhost), and an origin that is the request's own or listed in `PAYMENT_CALLBACK_ORIGINS`. Anything else is a 400 before an intent exists (F-27).
* **Verification.** Redirect handlers and the Paystack webhook call the same `settleByReference`: it asks Paystack's verify API for the reference and passes the provider's facts (provider, transaction id, amount, currency) to `settle_payment_intent`. Webhook metadata is never used to decide what is paid.
* **One engine.** `settle_payment_intent` (Postgres, service_role only) rejects provider, currency and amount mismatches and transaction-id conflicts, parks anything it cannot apply as `needs_refund`, and is idempotent per reference. Per-purpose handlers (`_settle_*`) are executable by nobody.
* **Provider path never touches wallet-funded purposes** (`*_wallet`): `not_provider_payment`, intent unchanged (`walletPurposeGuard.test.js`).
* **Webhook.** HMAC-SHA512 over the raw body, constant-time compare; event persisted before processing; a failure answers 500 so Paystack retries; a handled replay is acknowledged (`paystack-webhook.*.test.js`).
* **Anonymous settle** (guest bookings only) is deliberate: the unguessable reference is the patient's handle, settlement is idempotent and credits only the intent's own entities.

| Flow | Purpose | Price / amount source (server) | Bound to | Settles in | Duplicate callbacks | Proven by |
|---|---|---|---|---|---|---|
| CareCoin top-up (CareFind) | `wallet_topup` | `TOPUP_PACKAGES` table + processing fee (below). Client names a package id only | payer (`customer_id`) | `_settle_wallet_topup`: whole coins to the ledger | unique reference + `transactions` unique + engine status | `topupFlow.test.js`, `topupProcessingFee.db.test.js`, `settlementEngine.db.test.js`, `settlementConcurrency.pg.test.js` |
| Creator subscription (card) | `creator_subscription` | creator's listed price (coins) x `coin_value_kobo`; `price_mismatch` if the intent disagrees | payer + creator | `_settle_creator_subscription` | same | `subscriptionFlow.test.js`, `settlementEngine.db.test.js` |
| Consultation (card) | `consultation` | the professional's offer | payer + professional | `_settle_consultation` | same | `consultationFlow.test.js`, `settlementEngine.db.test.js` |
| Booking / appointment (card, guest or user) | `booking` / `appointment` | stored appointment fee; settled from the amount actually paid | appointment (+ payer, null for guests) | `_settle_booking` | same; `already_paid` -> `needs_refund` | `bookingFlow.test.js`, `bookingCredits.test.js`, `settleCardBookingActualAmount.db.test.js` |
| Shop order | `shop_order` | the order's own total, re-checked under the order lock | order + customer + vendor | `_settle_shop_order` | same; `needs_refund` if not payable | `shop-payment.engine.test.js`, `centralSettlement.db.test.js`, `vendorPayouts.db.test.js` |
| Plan renewal (CareHub) | `plan_renewal` | plan table (monthly / annual) | business | `_settle_plan_renewal` -> `renew_business_plan` | same + unique first-payment commission | `paymentFlows.test.js` (CareHub), `carehubSettlement.db.test.js`, `commissionEngine.db.test.js` |
| Business wallet top-up (CareHub) | `business_wallet_topup` | amount chosen within N100-N100,000 (what the wallet receives) + processing fee | business | `_settle_business_wallet_topup`: credits the base | unique reference + `business_wallet_transactions` unique | `walletTopup.test.js` (CareHub), `topupProcessingFee.db.test.js` |
| CareCoin-paid purchases | RPC, not a card payment | listed price, validated in SQL | caller (`auth.uid()`) | `pay_creator_subscription`, `pay_professional_consultation`, `send_gift` via the coin ledger | ledger reference unique | `coinWriters.db.test.js`, `coinConcurrency.pg.test.js` |
| Wallet-funded purposes (6) | `booking_wallet`, `subscription_wallet`, `consultation_wallet`, `shop_order_wallet`, `plan_renewal_wallet`, `appointment_fee_wallet` | wallet balance | payer | `_settle_*_wallet` | engine status | `walletSpendAndTopup.db.test.js`. **No client creates these intents yet**: engine capability only, nothing exposed, nothing to attack |

Refunds, withdrawals and reconciliation are covered by their own documents (`Refund-Engine.md`, `Withdrawal-Engine.md`, `Reconciliation.md`) and by H04.

## Top-up processing fee (owner decision 2026-10-10)

Every card top-up, CareCoin package or CareHub wallet, is charged the listed amount **plus 10%**, added on top, and the customer receives the full amount: a N200 coin costs N220 and credits one whole coin; a N10,000 wallet top-up costs N11,000 and credits N10,000. Future top-ups only.

* Rate: `financial_config.topup_processing_fee_rate` (a ratio, `0.10`), read on every top-up, no deploy to change, `0` disables. If the row cannot be read the code uses 10% and logs `topup.fee_rate_unavailable`: a missing row neither stops top-ups nor waives the fee.
* Fee = `round(base_kobo x rate)` (nearest kobo, half up): integer kobo throughout. Every CareCoin package is exact.
* The intent's `expected_amount` is the total charged. `metadata` carries `base_amount_kobo`, `fee_kobo`, `fee_rate`. The engine already requires Paystack's paid amount to equal `expected_amount` exactly; the handlers additionally refuse an intent whose base + fee is not the charged total (`topup_amount_mismatch` -> `needs_refund`) and credit only the base.
* Nothing is converted into rounded coins: coins come from the package, the fee stays in kobo on the intent and is the platform's processing revenue (Paystack's own charge is covered by it).
* `{ quote: true }` on `/api/initiate-payment` and `/api/initiate-wallet-topup` returns the current rate and creates nothing; both wallet screens use it to show the fee before checkout. The client never supplies a fee, a total or a rate.
* Receipts: the CareCoin receipt shows the total charged and names the fee; the CareHub top-up email shows the amount credited.

## Known limits (not defects of this phase)

* Card-paid subscriptions and consultations still pay the creator or professional `floor(price x 80%)` whole coins and the platform the remainder (Phase 04 design, owner decision D-A (1) of H03: kept unchanged). The platform keeps up to one coin (N200) more than 20% on such a payment. Paying card-funded earnings in exact kobo would need a separate kobo ledger for creators and is not part of H03.
* Payments that Paystack reports late or ambiguously are resolved by the sweeps in `shared-payments/src/reconciliation.js`. **They only run if the cron endpoint is deployed and its Vault secrets are set**; as of 2026-10-10 neither is (see the master plan, H03).
