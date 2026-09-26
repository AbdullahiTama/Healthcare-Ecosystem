---
title: 'Payments Wallet Lifecycle Hardening - Top-up, Subscriptions, Withdrawal'
type: 'feature'
created: '2026-09-19'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'd07ecf1c6d16368a52b517d633bc488b8208f4d7'
context:
  - 'architecture/Service-Catalog.md'
  - 'planning/CODE_AUDIT.md'
  - 'knowledge/modules/wallet-payments.md'
  - 'knowledge/modules/subscriptions-monetization.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** CareFind wallet lifecycle (top-up via Paystack, creator subscriptions via wallet vs card, and withdrawals to bank with PIN) has no single pre-deploy proof that every path is server-authoritative, race-safe, and idempotent, risking wallet-drain, double-credit, or misdirected-transfer defects.

**Approach:** Harden and verify the wallet lifecycle end-to-end (initiate -> Paystack -> verify/webhook -> atomic RPC -> wallet/email) without scope change: close remaining trust/idempotency gaps, add PIN/bank-resolve hardening, and add regression tests plus a focused deployment checklist.

## Boundaries & Constraints

**Always:** Amounts derived server-side (TOPUP_PACKAGES, NAIRA_PER_COIN=200, MAX_PRICE_COINS=12); Paystack secret server-only via getPaystackSecretKey() sk_ guard; every verify/webhook re-asks Paystack /transaction/verify and checks metadata ownership; settlement atomic via SECURITY DEFINER RPC with partial unique index (transactions reference where type=topup).

**Ask First:** Changing Paystack webhook URL or rotating PAYSTACK_SECRET_KEY; altering fee 20% on withdrawals or MAX_PRICE_COINS; modifying RLS on wallets/transactions/creator_subscriptions/withdrawal_requests.

**Never:** Trust client amount/coins; expose Paystack secret client-side; bypass HMAC x-paystack-signature; allow pay_creator_subscription with caller-supplied subscriber.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Top-up init | packageId 5/15/50 auth user | server TOPUP_PACKAGES lookup -> Paystack /transaction/initialize amount naira*100 reference cf_<uid8>_<hex> | 401 no session, 400 bad package, 500 Invalid Paystack key |
| Top-up verify | redirect ?reference=cf_... | Paystack verify success -> credit_wallet_topup atomic (partial unique), already_processed returns 200 no double credit | 403 wrong user, 400 not confirmed |
| Sub via wallet | auth.uid pays creator 5 coins balance 20 | row-locked debit, credit creator, extend creator_subscriptions 30d, 2 transaction rows | insufficient, not_signed_in |
| Sub via Paystack | wallet insufficient -> charge-subscription -> verify-subscription-payment | server price*200 subaccount split if creator paystack_subaccount_code, settle_subscription_payment idempotent | >12 coins rejected, double-charge already_processed |
| Withdrawal | 5+ coins PIN 4-6, bankCode/accountNumber 10 digits, accountName, deviceToken optional | 20% fee deducted via request_withdrawal atomic, Paystack transfer idempotent by reference, trustLevels updated | no PIN 400 Set PIN, 5 wrong -> 403 lockout 15m, unsupported bank manual fallback, insufficient 400, account name mismatch 400 |
| Paystack secret bad | PAYSTACK_SECRET_KEY=pk_live_... | getPaystackSecretKey throws Invalid Paystack key before network | all handlers 500 descriptive |

</frozen-after-approval>

## Code Map

- apps/carefind/api/_handlers/initiate-payment.js:1 -- top-up initiation, TOPUP_PACKAGES server lookup
- apps/carefind/api/_handlers/verify-payment.js:1 -- redirect verify, Paystack verify + creditTopup
- apps/carefind/api/_lib/paystack.js:1 -- secret guard + paystackFetch empty-body defensive parse
- apps/carefind/api/_lib/paystackCredit.js:1 -- creditTopup wrapper for credit_wallet_topup service_role-only
- apps/carefind/sql/wallet_payment_hardening.sql:1 -- partial unique transactions(reference) type=topup, credit_wallet_topup RPC, drop leaky send_gift overloads
- apps/carefind/api/_handlers/charge-subscription.js:1 -- Paystack sub initiation price*200, needs MAX 12 guard
- apps/carefind/api/_handlers/verify-subscription-payment.js:1 -- verify + settle_subscription_payment + email outbox
- apps/carefind/src/modules/subscriptions-monetization/subscriptions.js:1 -- wallet path pay_creator_subscription auth.uid(), NAIRA_PER_COIN 200
- supabase/migrations/carefind_20260818_payment_idempotency_hardening.sql:1 -- safe pay_creator_subscription(creator,price) + settle_subscription_payment
- apps/carefind/api/_handlers/initiate-withdrawal.js:1 -- PIN gate, trustLevels, resolveAccount, checkBalance, 20% fee, reference reuse
- apps/carefind/api/_lib/paystackTransfer.js:1 -- createTransferRecipient, initiateTransfer, resolveAccount GET /bank/resolve, normalizeAccountName, transferReference cf_wd_
- apps/carefind/api/_handlers/resolve-account.js:1 -- 10-digit guard, unsupportedBank flag
- apps/carefind/api/_handlers/withdrawal-pin.js:1 -- set/verify PIN scrypt RPCs
- apps/carefind/api/_handlers/banks.js:1 -- banks proxy + MAJOR_NIGERIAN_BANKS fallback
- apps/carefind/api/_handlers/paystack-webhook.js:1 -- HMAC webhook, charge.success dispatch for topup/subs before other types, transfer handlers for withdrawals
- apps/carefind/src/modules/wallet-payments/Wallet.jsx:1 -- top-up UI, verify reference-only, withdrawal form 10-digit + resolve debounce + PIN modal
- apps/carefind/src/test/payments/*.test.js:1 -- banks, pinCrypto, paystackCredit, transfer, initiateWithdrawal PIN gate, subscriptions, topupPackages
- packages/shared-email/src/EmailService.js:1 -- email_outbox enqueue + processBatch outbox pattern for subscription_created emails
- supabase/migrations/carefind_20260814_request_withdrawal_user_id_and_account_verify.sql:1 -- withdrawal_requests reference, request_withdrawal RPC
- supabase/migrations/carefind_20260816_withdrawal_pin.sql:1 -- withdrawal_pins table + get/set/verify RPCs

## Tasks & Acceptance

**Execution:**
- [x] apps/carefind/api/_handlers/charge-subscription.js:27 -- enforce MAX_PRICE_COINS 12 server-side (currently allows 100) and ensure settle_subscription_payment rejects >12
- [x] apps/carefind/api/_handlers/initiate-withdrawal.js:113 -- fix unsupported-bank handling: when resolveAccount signals unsupportedBank, allow manually-entered accountName instead of 400
- [x] apps/carefind/api/_lib/paystack.js:1 + apps/carefind/api/_handlers/paystack-webhook.js:1 -- verify empty Paystack response and invalid JSON path throws descriptive error and does not credit
- [x] apps/carefind/api/_handlers/verify-subscription-payment.js:1 -- ensure card double-charge idempotency returns already_processed and does not extend subscription twice nor send duplicate email
- [x] apps/carefind/src/test/payments/** -- add regression tests: top-up idempotency (same ref double verify), sub >12 rejected, withdrawal wrong normalized name vs resolved, withdrawal without PIN, lockout after 5 wrong, empty Paystack body defensive
- [x] docs/ + .env.example -- document PAYSTACK_SECRET_KEY sk_ requirement, add .env.example entry, and include wallet lifecycle smoke checklist

**Acceptance Criteria:**
- Given insufficient wallet when subscribing via card for 5 coins then Paystack initialized with 1000*100 kobo and settle creates 30-day creator_subscriptions exactly once even if webhook and redirect race
- Given top-up reference already settled when verify-payment or webhook receives same reference again then credit_wallet_topup returns already_processed and balance unchanged
- Given PAYSTACK_SECRET_KEY=pk_live_... when any handler calls paystackFetch then throws Invalid Paystack key before network
- Given 5+ coins withdrawal with correct bank details whose resolved name differs only in casing then succeeds; different name then rejects account name does not match
- Given withdrawal without PIN then 400 Set a withdrawal PIN first with action; after 5 wrong PINs then 403 lockout ~15 minutes
- Given unsupported bank code when entering account number then resolve-account returns unsupportedBank and withdrawal still proceeds with manually-entered accountName
- Given subscription price 13 coins when calling charge-subscription then 400 rejected (MAX 12)

## Spec Change Log

## Design Notes

Settlement RPCs already hardened: credit_wallet_topup partial unique, pay_creator_subscription uses auth.uid() and row lock, settle_subscription_payment, request_withdrawal with reference-at-creation, transfer idempotent by reference. This work hardens the HTTP trust boundary, not the ledger. Paystack pattern: initiate creates randomBytes(6) reference, verify re-asks /transaction/verify and treats Paystack amount as ground truth, webhook races verify via RPC idempotency.

## Verification

**Commands:**
- npm test -- --run apps/carefind -- expected: payment suites pass including new >12 and wrong-name and empty-body cases
- npm run build apps/carefind -- expected: build clean
- node -e paystack key check with pk_live_ -- expected: throws Invalid Paystack key

**Manual checks:**
- Paystack dashboard webhook URL https://carefind.vercel.app/api/paystack-webhook charge.success + transfer.success/failed enabled, secret matches PAYSTACK_SECRET_KEY
- .env contains real sk_live_/sk_test_, SUPABASE_URL/ SERVICE_ROLE correct per szdybxmgmhndoytqanfb
- Live smoke: top-up 1 coin verify, wallet sub 5 coins then card sub 5 coins (verify 30d extension), withdraw 5 coins to test account 0123456789 with PIN, check email_outbox subscription_created sent
## Suggested Review Order

**Price cap hardening - subscription MAX 12**

- Enforce integer 1-12 via Number.isInteger, rejecting float/string bypass and old 100 limit
  [`charge-subscription.js:27`](../../apps/carefind/api/_handlers/charge-subscription.js#L27)

- Mirror guard in verify path to prevent Paystack metadata 13+ from settling
  [`verify-subscription-payment.js:42`](../../apps/carefind/api/_handlers/verify-subscription-payment.js#L42)

- Same guard in webhook async path to keep race-safe idempotency honest
  [`paystack-webhook.js:39`](../../apps/carefind/api/_handlers/paystack-webhook.js#L39)

**Withdrawal - bank resolve and balance handling**

- Allow manually-entered name when Paystack reports bank not supported, matching resolve-account UX
  [`initiate-withdrawal.js:115`](../../apps/carefind/api/_handlers/initiate-withdrawal.js#L115)

- Require integer coins for withdrawal amount, blocking 10.5 fractional drain
  [`initiate-withdrawal.js:22`](../../apps/carefind/api/_handlers/initiate-withdrawal.js#L22)

- Paystack balance low now 503 with Retry-After 60 and structured error logging for ops
  [`initiate-withdrawal.js:89`](../../apps/carefind/api/_handlers/initiate-withdrawal.js#L89)

**Paystack trust boundary**

- Defensive empty-body and invalid JSON handling before any credit
  [`paystack.js:33`](../../apps/carefind/api/_lib/paystack.js#L33)

- Credit top-up idempotency via partial unique index and atomic RPC already verified
  [`paystackCredit.js:1`](../../apps/carefind/api/_lib/paystackCredit.js#L1)

**Tests - matrix coverage**

- Wallet lifecycle matrix: secret guard, empty body, MAX 12, normalize, idempotency
  [`walletLifecycle.test.js:1`](../../apps/carefind/src/test/payments/walletLifecycle.test.js#L1)

- Handler-level price cap with float string case
  [`chargeSubscriptionCap.test.js:1`](../../apps/carefind/src/test/payments/chargeSubscriptionCap.test.js#L1)

- Verify path MAX 12 with float rejection and already_processed guard
  [`verifySubscriptionCap.test.js:1`](../../apps/carefind/src/test/payments/verifySubscriptionCap.test.js#L1)

**Docs and env**

- Paystack secret must be sk_ not pk_ with descriptive throw before network
  [`.env.example:5`](../../apps/carefind/.env.example#L5)

- Deployment checklist with webhook, migration, outbox, and smoke steps
  [`PAYMENTS_DEPLOYMENT_CHECKLIST.md:1`](../../docs/PAYMENTS_DEPLOYMENT_CHECKLIST.md#L1)

