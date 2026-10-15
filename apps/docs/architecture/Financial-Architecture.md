# Financial Architecture — Target Design (Phase 01)

Status: DESIGN ONLY. Nothing here is implemented. Every claim about the current system cites `Financial-Architecture-Audit.md` (finding ids `F-nn`).
Scope: CareFind + CareHub money (Paystack today, provider-agnostic by design). Commercial rules (₦200/coin, 80/20 booking split, 40%/5% referral, 20% withdrawal fee, plan prices) are **inputs, not changed**.

## 1. Why the current shape fails (summary)

Settlement is defined in at least eight places (top-up, subscription, consultation, card booking, coins booking, plan, shop, withdrawal) and each is re-implemented twice — once in the redirect handler, once in the webhook (F-11, F-14). Nothing binds a provider reference to an *expected* amount, purpose and payer (F-10). Balances are mutated directly beside loosely-linked ledger rows (F-17). Two money systems (kobo and CareCoin) are converted ad hoc (F-06, F-19, F-20). Mutation rights were granted to the browser (F-24, now closed). The design below fixes the class, not the instances.

## 2. Design principles

1. **One definition of settlement.** Redirect, webhook and reconciliation all call the same function.
2. **The server decides every number.** The client names *what it wants*; the server computes amount, currency, payer and payee, stores them *before* talking to the provider, and later accepts only a provider confirmation that matches that record exactly.
3. **Money moves only inside Postgres transactions** that also write the ledger. No Node code does arithmetic on balances.
4. **Append-only ledger is the truth; balances are projections** that the same transaction updates and a job can recompute.
5. **Two currencies, never mixed in one journal:** `NGN` (integer kobo, real money) and `CARECOIN` (integer coins). Conversion is an explicit, logged `coin_purchase`/`coin_cashout` journal pair at a recorded rate.
6. **Provider calls never happen while holding row locks**; provider outcomes are recorded by idempotent callbacks.
7. **Every state machine is monotonic and enforced in the database** (guarded transitions, CHECK constraints), never only in application code.
8. **Clients get SELECT only** on money tables (F-24). All writes are service-role RPCs.

## 3. Components and ownership

| Component | Owns | Never does |
|---|---|---|
| **Payment Intent** (`payment_intents`) | The canonical record of *one expected gateway payment*: purpose, payer, payee, expected kobo, currency, reference, expiry, state | Move money |
| **Provider Adapter** (Node, `PaymentProvider` interface) | Talking to Paystack: initialize, verify, refund, transfer, balance. Timeouts, retries, error mapping, correlation id | Know about wallets, products, or business rules; write to money tables |
| **Verification** (Node, thin) | Fetch provider truth for a reference and normalise it into a `VerifiedTransaction` (`provider`, `provider_txn_id`, `reference`, `amount_kobo`, `currency`, `status`, `payer_email`, raw) | Decide settlement |
| **Settlement Engine** (Postgres `settle_payment_intent`) | Given intent + `VerifiedTransaction`: lock, check identity/amount/currency/provider, check already-settled, run the purpose handler, write journal(s), emit events, mark `settled` — exactly once | Call the provider |
| **Ledger** (`ledger_journals`, `ledger_entries`) | Append-only double-entry for NGN and CARECOIN; the only writer of balances | Be edited or deleted (no UPDATE/DELETE, enforced by trigger and grants) |
| **Wallet** (`wallets`, `business_wallets`) | Projections of ledger accounts (`available`, `held`) with CHECK ≥ 0 | Be written outside `post_journal()` |
| **Commission Engine** | Referral commission rows derived *from a settled plan payment inside the same transaction* | Be computed by Node after the fact (F-05) |
| **Withdrawal Engine** | Reserve → provider transfer → settle/fail/reverse, with its own state machine (§5.2) | Reuse references, look up "latest row" (F-01) |
| **Refund Engine** | Card, CareCoin and platform-funded refunds with their own state machine (§5.3) | Mark a gateway refund completed before the provider confirms |
| **Webhook** | Authenticate and persist provider events, then route them to the settlement/withdrawal/refund engines by *stored* reference lookup | Guess purpose from metadata shape (F-11) |
| **Reconciliation** | Detect and report/repair divergence between provider, intents, ledger, balances, commissions | Silently fix money without an audit row |

Application layering (per CLAUDE.md): handlers = thin HTTP + auth; `services/financial/*` = orchestration; Postgres = invariants. No business logic in components.

## 4. Data model (conceptual; exact DDL is Phase 02/05)

* `payment_intents` — `id, reference (unique), provider, provider_txn_id, application ('carefind'|'carehub'), purpose, customer_id, business_id, entity_type, entity_id, expected_amount_kobo, currency, status, metadata, expires_at, verified_at, settled_at, created_at, updated_at`. Identity columns immutable after insert (trigger).
* `payment_provider_events` — every webhook/redirect observation: `id, provider, event_id, event_type, reference, payload, signature_ok, received_at, processed_at, outcome`. Unique `(provider, event_id)` (replay protection).
* `ledger_accounts` — `id, kind ('user_wallet'|'business_available'|'business_held'|'platform_revenue'|'platform_clearing'|'provider_clearing'|'agent_commission_payable'|…), owner_id, currency`.
* `ledger_journals` — `id, kind, reference (unique per kind), intent_id, created_at, meta`.
* `ledger_entries` — `journal_id, account_id, amount (signed integer), currency`; CHECK that each journal sums to 0 per currency (deferred constraint trigger); append-only.
* `wallets` / `business_wallets` — balance projections; updated only by `post_journal()`.
* `withdrawals` — one table for CareFind (CareCoin→NGN) and CareHub (NGN): `id, subject_type, subject_id, amount, currency, payout_amount_kobo, fee_kobo, reference (unique, server-generated at insert), recipient snapshot, state, provider_transfer_code, state timestamps`.
* `refunds` — `id, kind ('card'|'carecoin'|'platform'), original_intent_id, original_journal_id, amount, state, provider_refund_id, reference (unique)`; unique `(original_journal_id)` per refund *cause* to stop double refunds.
* `commissions` — `payment_intent_id (unique), agent_id, business_id, type, rate, base_amount_kobo, amount_kobo, status` plus a `first_payment_claims(business_id PK)` row inserted in the settlement transaction (the atomic first-payment determination).
* `financial_config` — one row per constant: `coin_value_kobo`, `booking_platform_rate`, `withdrawal_fee_rate`, referral rates, plan price table version. Single source of truth for JS and SQL (F-18).

## 5. State machines

### 5.1 Payment intent
```
created ──initialize ok──▶ pending ──verified──▶ verified ──settle──▶ settled
   │                          │                                   (terminal)
   └─init failed─▶ failed     ├─expired──▶ expired
                              ├─provider failed/abandoned──▶ failed
                              └─verified but settle cannot apply (duplicate payer, domain gone)
                                     ──▶ needs_refund ──refund engine──▶ refunded
```
Rules: transitions are guarded `UPDATE … WHERE status = <expected>`; `settled`, `failed`, `expired`, `refunded` are terminal; a late success on `expired/failed` is accepted and routed to settlement or `needs_refund`, never dropped (matches the shop's "late payment on a closed attempt" behaviour that exists today).

### 5.2 Withdrawal
```
requested ──reserve (debit/hold + ledger)──▶ reserved ──transfer call──▶ processing
                │ (insufficient/limit)                                      │
                └─▶ rejected                        ┌────success─────────────┴────failed────┐
                                                    ▼                                        ▼
                                               completed                               failed ──refund reservation──▶ refunded
                                                    │ transfer.reversed (later)
                                                    ▼
                                                reversed ──refund reservation──▶ refunded
```
Rules: `reference` is generated by the server at the `requested` insert and is the only key used to attach provider data (no latest-row lookup); reserve is one transaction; the provider call happens after commit; `processing` rows older than the grace period are polled by reconciliation; `failed → refunded` and `reversed → refunded` each post one journal guarded by the state transition, so a refund cannot happen twice; a `reversed` after `completed` is a real state (today it is ignored, F-11).

### 5.3 Refund
```
requested ──▶ processing ──provider confirms──▶ completed
                  │                                  
                  └─provider rejects/timeouts─▶ failed ──retry──▶ processing
```
Kinds: **card** (provider refund; ledger reversal posted only on `completed`), **carecoin** (single journal, completes atomically), **platform-funded** (journal against `platform_revenue`, no provider call). One refund per `(original_journal, cause)`.

### 5.4 Commission
`pending_settlement → accrued → payable → paid`, plus `voided` (original payment refunded). Created only by the settlement transaction of a plan payment; unique per `payment_intent_id`.

## 6. Invariants (each becomes a test in Phase 13 and a reconciliation query in Phase 11)

I1. A `payment_intents.reference` maps to exactly one intent; identity columns never change.
I2. An intent is `settled` at most once; settlement posts exactly one journal group, keyed by the intent.
I3. Settled amount = `expected_amount_kobo` = provider-verified amount, currency equal, provider equal, payer/payee equal to the intent's.
I4. Every ledger journal sums to zero per currency; entries are never updated or deleted.
I5. `wallet.balance = Σ ledger entries` for its account, and is ≥ 0, always.
I6. No money object is credited without a journal; no journal without an intent/withdrawal/refund/gift parent.
I7. A withdrawal's reservation is released (refunded) at most once and never after `completed`.
I8. A refund (per original journal and cause) completes at most once; a card refund's ledger reversal exists iff the provider confirmed.
I9. A plan payment yields at most one commission; a business has exactly one "first payment".
I10. NGN and CARECOIN never share a journal; conversion journals carry the rate used.
I11. Webhook events are processed at most once per `(provider, event_id)` and are persisted before processing.
I12. Provider calls occur outside DB locks; DB state changes occur only from verified provider facts or server decisions.

## 7. Client-controlled vs server-controlled

| Item | Client may supply | Server decides |
|---|---|---|
| Top-up | package id | coins, kobo, reference, payer (from JWT), currency |
| Subscription | creator id | price (from the creator's offer), amount, payee, expiry |
| Consultation | professional id | fee (from the offer), amount, payer, payee |
| Booking | slot/service id, guest name/phone | fee (service price), amount, business, payer identity |
| Plan | `months ∈ {1,12}` | plan price (server table), business (from session) |
| Shop | cart lines | totals/delivery/promo (already server-side), vendor |
| Withdrawal | amount, bank details, PIN | fee, payout, reference, limits, recipient verification, trust tier |
| Refund | "I want a refund" + reason | eligibility, amount, kind, journal |
| Commission | nothing | everything |
| Anything in `metadata` returned by the provider | — | treated as **untrusted**; the stored intent is the authority |

## 8. Trust boundaries

Browser ⟂ API (JWT-verified identity; ownership checked server-side, F-03/F-25) ⟂ Provider (HMAC-verified webhooks; outbound verify by reference) ⟂ Database (service-role RPCs only for mutations). Redirect callbacks are *hints*: they trigger verification of a stored reference, nothing more. The webhook signature proves "the provider said it", the stored intent proves "this is what we expected".

## 9. Mapping: current flow → target

| Today | Target |
|---|---|
| `credit_wallet_topup`, `settle_subscription_payment`, `settle_consultation_payment`, `settle_card_booking`, `renew_business_plan`, `verify_shop_payment` + JS fallbacks | one `settle_payment_intent` dispatching to per-purpose internal handlers, each posting journals |
| redirect handler + webhook handler per flow | `POST /pay/verify` and webhook both → `settleByReference()` |
| `pay_booking_with_credits`, `pay_creator_subscription`, `pay_professional_consultation`, `send_gift` | CARECOIN journals via `post_journal()` with server-derived prices (F-04) |
| `request_withdrawal` / `request_business_withdrawal` | `reserve_withdrawal()` + state machine (§5.2) |
| `computeCommission()` in Node + cron backstop | commission rows created inside `settle_payment_intent` for plan intents |
| `refund_appointment_payment`, ad-hoc shop duplicate flags | Refund Engine (§5.3) |
| single webhook guessing purpose from metadata | `payment_provider_events` + reference→intent lookup |
| hard-coded ₦200/20%/20% | `financial_config` |

## 10. Decisions this design makes (flag disagreement before Phase 02)

* **D1 — Settlement lives in Postgres** (one `SECURITY DEFINER`, service-role-only function), not in Node. Reason: atomicity and the existing RPC pattern; Node only verifies with the provider.
* **D2 — Keep `wallets`/`business_wallets` as projections** rather than replacing them with computed balances, to avoid rewriting every reader. Reconciliation (I5) proves they agree.
* **D3 — Two currencies, one ledger mechanism.** CareCoin and NGN use the same tables with a `currency` column; no mixed journals.
* **D4 — Anonymous guest bookings stay supported** (appointment UUID as capability for the *patient* role), but they must create a `payment_intent` with `customer_id = null` and a stored guest contact; refunds go back to the card, never to a wallet (fixes F-06/F-07 refund gaps).
* **D5 — Backward-compatible rollout:** new tables first (Phase 02), existing flows are migrated one at a time (Phase 04/06) behind the same endpoints; old RPCs stay until their last caller is gone, then are dropped (check `pg_proc` for siblings after every replace — known trap).
* **D6 — Shop is in scope but unfinished in the audit:** `verify_shop_payment` only flips order status; there is no vendor settlement, vendor ledger or use of `calculate_shop_commission` in settlement. Whether vendors are paid out (and how) must be decided with the business before the shop joins the engine.

## 11. Open questions needing an owner decision

1. Shop vendor payout model (D6): platform collects and pays vendors later, or Paystack split? Today money sits with the platform and no vendor liability is recorded.
2. Consultation/subscription commercial split: today a card consultation/subscription credits the professional/creator 100% of `ceil(fee/200)` coins with no platform fee (F-20). Intentional?
3. Refund policy for card bookings (72-hour window exists only in dead code, F-25 note): who may refund, up to when, from whose funds?
4. Should CareHub get its own webhook endpoint (F-11) or keep sharing CareFind's? Recommendation: one provider-events endpoint per deployment that routes by stored intent `application`.
5. Newly found, not yet scoped: `claim_payment_event` is executable by `authenticated` (any user can pre-mark a shop payment event as processed/duplicate — settlement still proceeds, but audit data can be polluted). Add to Phase 14 list.

## 12. What Phase 02 will do (preview, not started)

Create `payment_intents` and `payment_provider_events` (+ indexes, RLS = no client access, immutable identity trigger, integer-only CHECKs, state-machine guard), `financial_config`, and tests; no flow is migrated yet.
