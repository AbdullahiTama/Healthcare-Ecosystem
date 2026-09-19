# Payments Deployment Checklist - Wallet Lifecycle (Top-up, Subscriptions, Withdrawal)

> Generated from spec-payments-end-to-end-hardening (wallet lifecycle). Use before every deploy that touches `apps/carefind/api/_handlers/*payment*`, `api/_lib/paystack*`, `supabase/migrations/*payment*`, or `supabase/migrations/*withdrawal*`.

## 1. Environment Variables (both apps share same Supabase project szdybxmgmhndoytqanfb eu-west-1)

Check `apps/carefind/.env` and `apps/carehub/.env` (and Vercel env dashboard):

| Var | Expected | How to verify |
|-----|----------|---------------|
| `SUPABASE_URL` | `https://szdybxmgmhndoytqanfb.supabase.co` | `echo $SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_service_role_...` (NOT anon key) | must be set, service-role client created at runtime |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | `sb_publishable_...` | client bundle |
| `PAYSTACK_SECRET_KEY` | `sk_live_...` (prod) or `sk_test_...` (test) | `node -e "require('./apps/carefind/api/_lib/paystack.js').getPaystackSecretKey()"` with pk_live must throw `Invalid Paystack key: must be a secret key` |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | `re_...` / `CareFind <support@mail.carefind.app>` | EmailService `email_outbox` -> `email_logs` |
| `CRON_SECRET` | random string, same value set in Vercel cron Authorization header | `check-subscription-expiry` handler checks Bearer token |

**Blocker:** `PAYSTACK_SECRET_KEY` placeholder `sk_live_REPLACE_WITH_YOUR_REAL_PAYSTACK_SECRET_KEY` must be replaced before live payments work. The code now throws descriptive `Invalid Paystack key` instead of Paystack generic error.

## 2. Paystack Dashboard

- Webhook URL: `https://<carefind-deployment>/api/paystack-webhook` (single webhook for both apps - they share Supabase project)
- Events enabled: `charge.success`, `transfer.success`, `transfer.failed`, `transfer.reversed`
- Secret: must match `PAYSTACK_SECRET_KEY` in both apps (if keys differ, webhook signature verification fails for one app - split webhook or use same secret)
- Test the HMAC: `x-paystack-signature` is `hmac sha512(secret, rawBody)` - invalid returns 401
- Verify immediately after webhook: response is `200 {received:true}` before async processing (prevents Paystack timeout retries). All handlers idempotent (`already_processed`).

## 3. Database Migrations - Must Be Applied Before Code Deploy

| Migration | What it does | Verify |
|-----------|--------------|--------|
| `carefind_20260818_payment_idempotency_hardening.sql` | safe `pay_creator_subscription(creator,price)` with `auth.uid()` lock, `settle_subscription_payment`, `renew_business_plan`, `request_withdrawal` with reference-at-creation | `SELECT proname FROM pg_proc WHERE proname='pay_creator_subscription'` => exists, `proacl` only `authenticated` |
| `carefind/sql/wallet_payment_hardening.sql` | drops leaky `send_gift(uuid,uuid,...)` overloads, `transactions_topup_reference_uniq` partial unique, `credit_wallet_topup` RPC | `SELECT indexname FROM pg_indexes WHERE indexname='transactions_topup_reference_uniq'` |
| `carefind_20260814_request_withdrawal_user_id_and_account_verify.sql` | `withdrawal_requests.paystack_reference` unique, `request_withdrawal` | `SELECT column_name FROM information_schema.columns WHERE table_name='withdrawal_requests' AND column_name='paystack_reference'` |
| `carefind_20260816_withdrawal_pin.sql` | `withdrawal_pins` + `get/set/verify_withdrawal_pin` | `SELECT * FROM withdrawal_pins LIMIT 1` (RLS deny-all, service-role only) |
| `carehub_20260811_business_wallets_and_booking_payments.sql` | `business_wallets` (available/held) + `settle_card_booking` 80/20 | `SELECT * FROM business_wallets LIMIT 1` |

If any migration shows `NOT YET APPLIED` in its header, apply via Supabase SQL editor and re-verify with `SELECT * FROM supabase_migrations.schema_migrations`.

## 4. Outbox & Cron

- `email_outbox` + `email_logs` tables exist (EmailService)
- Cron `apps/carefind/vercel.json` -> `/api/cron/process-email-outbox` (*/min) and `/api/cron/subscription-expiry` (08:00 daily) are registered
- `processBatch()` processes `pending, failed` where `next_retry_at <= now` limit 20, exponential backoff `baseDelayMs * 2^attempts`, dead after 5
- Subscription expiry cron dedupes against recent `email_outbox` rows for same `business_id + template_key`

Verify: `SELECT status, count(*) FROM email_outbox GROUP BY status;` should show `pending->sent` after webhook + verify paths.

## 5. Code Invariants To Keep

- `TOPUP_PACKAGES` server lookup only (never trust client amount)
- `NAIRA_PER_COIN=200`, `MAX_PRICE_COINS=12` (2400 max) enforced in `charge-subscription.js:27` and `verify-subscription-payment.js` + `paystack-webhook.js handleSubscription`
- `paystackFetch` throws on empty body (`Paystack returned an empty response`) and invalid JSON before crediting
- `resolveAccount` uses `GET /bank/resolve?account_number=...&bank_code=...` (not POST) and `normalizeAccountName` lower+trim+collapse whitespace for comparison
- Withdrawal unsupported bank: `initiate-withdrawal.js` now allows manually-entered `accountName` when `resolveAccount` throws `not supported` (same as `/api/resolve-account` `unsupportedBank:true`)
- Wallet `balance` is coins (int), not kobo; withdrawal fee 20% => `payoutNaira = floor(coins*200*0.8)`

## 6. Manual Smoke Tests (Paystack test mode sk_test_)

Use Paystack test card `4084084084084081`, 09/30, CVV 408, OTP `123456`, and test account `0123456789` (if bank supported) or unsupported bank code `999` for manual fallback.

1. **Top-up 1 coin**: `POST /api/initiate-payment` packageId 1 -> redirect -> `POST /api/verify-payment` reference -> expect `alreadyProcessed:false newBalance:+1`; repeat same reference -> `alreadyProcessed:true` balance unchanged
2. **Wallet subscription 5 coins**: `subscriptions.subscribe(subscriber, creator, 5)` with balance 20 -> creator +5, subscriber -5, `creator_subscriptions` +30d; second call same reference idempotent
3. **Paystack subscription 5 coins (wallet insufficient)**: `POST /api/charge-subscription` creatorId priceCoins 5 -> verify 5 coins via `/api/verify-subscription-payment` -> `creator_subscriptions` extended exactly once even if webhook + redirect race; test price 13 -> 400 rejection
4. **Withdrawal 5 coins to 0123456789**: set PIN `1234` via `/api/withdrawal-pin/set`, then `POST /api/initiate-withdrawal` amount 5 bankCode `044` accountNumber `0123456789` accountName `Test User` pin `1234` -> 200 success; wrong PIN 5 times -> 403 lockout 15m; wrong normalized name -> 400 mismatch; unsupported bank code `999` with manual name -> 200 manual fallback
5. **Check email_outbox**: `SELECT template_key, status FROM email_outbox WHERE template_key='subscription_created' ORDER BY created_at DESC LIMIT 5;` -> `sent`

## 7. Build & Test Gate Before Deploy

```bash
# from repo root
npm test -- --run --config apps/carefind/vitest.payments.config.js  # payment suites including new walletLifecycle + chargeSubscriptionCap + withdrawalUnsupportedBank
npm test -- --run  # full suites (carefind ~500+ tests should pass)
npm run build  # apps/carefind (~1996 modules) + apps/carehub (~301 modules) must be clean
```

## 8. Rollback Triggers

- Paystack returns `empty response` repeatedly -> check `PAYSTACK_SECRET_KEY` prefix sk_ and network
- `pay_creator_subscription` returns `insufficient` for funded wallets -> check `wallets.balance` row-lock and `auth.uid()` mapping
- Withdrawal `insufficient` even with balance -> check `wallets` vs `withdrawal_requests` pending not yet deducted confusion
- `paystack-webhook` logs `Invalid signature` -> secret mismatch between Paystack dashboard and env

---
*Keep this checklist versioned with the spec. Update when adding a new payment surface.*
