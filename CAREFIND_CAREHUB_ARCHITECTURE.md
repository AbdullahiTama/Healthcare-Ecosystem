# CareFind + CareHub — Architecture Map

> Phase 0 output. Two applications, one Supabase project, one Paystack account.
> Feature ownership is strict: do not cross-contaminate surfaces.

## Repository layout

```
apps/
  carefind/   CareFind CLIENT — public discovery + booking + social platform
  carehub/    CareHub PROVIDER — business operations (POS, inventory, requisitions, clients, appointments)
packages/
  shared-marketplace/     SALE_TYPES / units / validation (single source of truth)
  shared-notifications/   notification contracts + per-app adapters
sql/                      shared landing zone (phase2_rls_pilot, qa seeds — copies of apps/carehub/sql)
```

Both apps: Vite + React SPA, deployed to Vercel, talk to the shared Supabase
project via PostgREST (RLS-protected). Both have `api/` (serverless) and
`sql/` (migrations). One Paystack account; a single webhook
(`apps/carefind/api/_handlers/paystack-webhook.js`) serves every app.

## CareFind — client/public surface

- `src/modules/healthcare-discovery/` — Search, DrugProfile (marketplace discovery)
- `src/modules/business-profiles-reviews/` — **BusinessProfile + BookingCard (appointment booking + payment UI)**, reviews
- `src/modules/subscriptions-monetization/` — creator subscriptions, professional consultations, gifts
- `src/modules/wallet-payments/` — CareCoins wallet (top-up/withdraw), Paystack return handling
- `src/modules/social-feed/`, `news-publishing/`, `live-streaming/`, `playlists/`, `account/`, `admin/`, `claims/`, `marketing/`, `media-upload/`
- `api/` — single catch-all `router.js` (Vercel 12-function cap) → `_handlers/` (14) + `_lib/` (7)

## CareHub — provider/business surface

- `src/modules/appointments/` — appointment scheduling + **payment states** (unpaid/paid/pending)
- `src/modules/clients/` — **patients/clients records** (canonical entity: `clients` table)
- `src/modules/demand/` — **requisitions** (supplier orders), out-of-stock, customer requests
- `src/modules/pos/` — **POS / sales / receipt printing** (`POS.jsx`, `receiptPrint.js` — pure `buildReceiptHtml`, shared `esc` from `lib/escape.js`)
- `src/modules/inventory/`, `master-catalog/`, `stock/`, `purchases/`, `warehouses/`, `orders/`, `debts/`, `expenses/`, `reports/`, `settings/`, `staff/`, `locations/`, `overview/`, `dashboard-home/`, `live-activity/`, `messages/`, `consultation/`, `territories/`, `carefind/`, `referral-agent/`
- `api/` — 3 handlers: `initiate-business-withdrawal.js`, `initiate-plan-payment.js`, `verify-plan-payment.js` (+ `_lib/`)

## Shared backend / database

- **One Supabase project** (`szdybxmgmhndoytqanfb`); base schema not tracked in repo — lives in live DB. Repo `sql/` holds incremental idempotent migrations.
- **Shared tables**: `businesses`, `products`, `appointments`, `sales`, `clients`, `staff`, `wallets`, `transactions`, `business_wallets`, `business_settings`, `plan_payments`, etc. RLS scopes by `current_business_ids()` / `is_platform_admin()`.
- **Auth**: Supabase Auth; CareHub writes directly (browser), CareFind writes CareHub-owned tables only via service-role server functions (never from the browser).
- **Payments**: Paystack. Single webhook in CareFind dispatches by metadata: top-ups, subscriptions, consultations, CareHub plan payments. Redirect-verify endpoints race the webhook; SECURITY DEFINER RPCs make settlement idempotent on reference.

## Feature ownership matrix

| Feature | Primary surface | Supporting surface |
|---|---|---|
| 1. Appointment Booking + Payment | **CareFind client** | CareHub provider (appointment record) |
| 2. Requisition Saving | **CareHub** | — |
| 3. POS Edit Price | **CareHub** | — |
| 4. Patient/Client Bulk Upload | **CareHub** | — |
| 5. Receipt Size + Clarity | **CareHub POS** | — |

## RLS / roles summary

- Helpers: `current_business_ids()`, `is_platform_admin()` (SECURITY DEFINER, phase2_rls_pilot).
- Business-scoped policies on `clients`, `requisitions`, `requisition_items`, `sales`, `appointments`, etc.
- Payment RPCs (`settle_card_booking`, `pay_booking_with_credits`, `pay_professional_consultation`, `settle_consultation_payment`) are SECURITY DEFINER, revoked from anon/authenticated (service-role only) — clients reach them via serverless handlers.
- `create_requisition` is SECURITY INVOKER, granted to `authenticated` (RLS applies as caller).
- `guard_sale_item_prices` (BEFORE INSERT on `sales`) is SECURITY INVOKER with a
  pinned `search_path` — adds per-line price authorization on top of RLS:
  price overrides require the frontend-mirrored `canEditPrice` permission
  (business owner, or a custom `roles` row granting it); trusted roles
  (`postgres`, `service_role`, `supabase_admin`, `supabase_auth_admin`,
  `is_platform_admin()`) pass through. A rejected sale aborts before the AFTER
  INSERT stock trigger, so inventory is never decremented for blocked sales.
- `clients_phone_unique_per_business` (partial UNIQUE index) makes the
  database the authority on "one normalized phone per business" — the bulk
  upload's client-side dedupe is a fast-path, not the enforcement. Index
  normalizes with the same `[^0-9]` strip as the app's `normPhone`, is scoped
  per `business_id`, and excludes null/blank phones.
