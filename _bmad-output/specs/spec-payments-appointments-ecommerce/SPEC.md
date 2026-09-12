---
id: SPEC-payments-appointments-ecommerce
companions:
  - state-machines.md
  - api-contracts.md
  - glossary.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Payments — Appointments + E-commerce Shop

## Why

CareHub appointments and CareFind Shop orders can be created but cannot be reliably collected. CareFind bookings already use Paystack (`apps/carefind/api/_handlers/booking.js:124`), CareHub appointments only store `payment_channel='cash|pos|transfer|credit'` as a string (`apps/carehub/src/modules/appointments/Appointments.jsx:82`) with a post-hoc pay-link (`apps/carehub/api/initiate-appointment-payment.js:1`), and Shop checkout explicitly defers Paystack (`apps/carefind/src/modules/shop/Checkout.jsx:358` creates `pending_payment` and never charges). This leaves revenue uncollected, wallet `held→available` never settled, and no auditable cash/POS/transfer path for Nigeria's dominant offline channels. Unifying to one state machine + one Paystack service + explicit manual attest unlocks collection in both products.

## Capabilities

- **CAP-1** — **intent:** CareHub staff can create an appointment with explicit `payment_channel` (`cash|pos|transfer|paystack`) and `fee_amount` snapshotted from business pricing.
  - **success:** Creating with `fee>0` without a channel is rejected (400); creating with valid channel persists `payment_channel`, `fee_amount`, `payment_status` correctly; fee is server-derived not client-supplied.

- **CAP-2** — **intent:** Manual `pos` and `transfer` appointments can be confirmed as paid by authorized staff via a single attest action.
  - **success:** `unpaid+pos|transfer` row flips to `paid` only via `confirm_pos_payment` / `confirm_transfer_payment` RPC that checks `business_id IN current_business_ids()`, stamps `verified_by`/`verified_at`+`pos_reference`, and writes audit; direct PATCH to `payment_status` is rejected (42501/C18-style trigger).

- **CAP-3** — **intent:** `cash` channel marks appointment `paid` instantly at creation with staff attestation.
  - **success:** `payment_channel=cash` appointment is `paid` after create, carries `verified_by` = creator, and appears as `paid` in `Appointments.jsx:308` pill without further step.

- **CAP-4** — **intent:** `paystack` channel creates a shareable Paystack authorization URL and only marks `paid` after server-side verification + settlement.
  - **success:** `initiate-appointment-payment` returns `authorization_url`+`reference`; `verify-appointment-payment` fetches `paystackFetch /transaction/verify/:ref`, checks `amount === fee_amount`, then `settle_card_booking` returns `ok` and flips `payment_status=paid, payment_reference set`, idempotent on replay (`already_paid`); webhook `paystack-webhook.js:120` settling the same reference is a safe no-op.

- **CAP-5** — **intent:** Shop checkout can create a `pending_payment` order and collect via Paystack (strict).
  - **success:** `Checkout.jsx:114` `orderRepository.create` → `create_shop_order` (idempotent on `payment_reference`, throws `INSUFFICIENT_STOCK`/`PRICE_CHANGED`) then `POST /api/initiate-shop-payment` returns `authorization_url`; redirect to Paystack and back verifies via `verify_shop_payment` and flips `shop_orders.status paid`, commission split persisted, webhook settlement is idempotent.

- **CAP-6** — **intent:** Business owner can toggle whether Shop allows pay-at-pickup / pay-on-delivery for their products.
  - **success:** `businesses.shop_allow_pay_on_delivery boolean default false` toggle visible only to Owner in `Ecommerce.jsx:294` or `Settings.jsx`; toggling persists and controls Checkout rendering; unauthenticated toggle rejected.

- **CAP-7** — **intent:** When allowed, Shop can create an order without Paystack as `pay at pickup` awaiting vendor acceptance.
  - **success:** With `allow_pay_on_delivery=true` and `delivery_preference=pickup`, Checkout shows secondary **Pay at Pickup** CTA that creates order `status=pending_payment|delivery_quote_pending`, `payment_status=unpaid`, skips Paystack, and vendor sees it in `Ecommerce.jsx:450` orders inbox.

- **CAP-8** — **intent:** Single Paystack webhook dispatches all charge types (booking, shop order, top-up, consultation, plan) idempotently.
  - **success:** `charge.success` event with `metadata.appointment_id` settles booking, with `metadata.order_id` settles shop order; second delivery of same `reference` returns `alreadyProcessed`/`already_paid` and does not double-credit wallet or duplicate `staff_notifications`.

## Constraints

- All amounts are server-snapshotted: `feeKobo` from `business_services.price_kobo` or `businesses.online_consultation_fee` (`booking.js:99`), `total_kobo` from `ecommerce_products.ecommerce_price_kobo` (`shopRepository.js:10`); client `unit_price_kobo` is checked, `PRICE_CHANGED` thrown on mismatch.
- `payment_status → paid` only inside `SECURITY DEFINER` RPC after verification (`settle_card_booking`/`settle_shop_payment`) or manual RPC with `current_business_ids()` ownership + `verified_by` stamp; no direct `PATCH appointments SET payment_status='paid'` allowed (trigger mirroring `guard_business_privileged_columns` `apps/carehub/sql/20260805_guard_business_privileged_columns.sql:1`).
- Paystack webhook uses `bodyParser:false` (`paystack-webhook.js:15`), HMAC `sha512` with `PAYSTACK_SECRET_KEY` (`paystack-webhook.js:185`), and cross-checks `amount === fee_amount/total_kobo` before settlement (`verify-booking-payment.js:47` pattern).
- `payment_reference` and `paystack_reference` are globally unique partial indexes; RPCs are idempotent (`ok` vs `already_paid`).
- Repository seam: reads/writes go through `createAppointmentRepository({request})` (`apps/carehub/src/modules/appointments/repositories/index.js:1`) and `createOrderRepository` (`apps/carefind/src/modules/shop/orderRepository.js:1`) with injected transport; UI never calls `supabase.from('appointments').update({payment_status})` directly.
- Strict Paystack default for Shop; manual channels only for appointments; one channel per appointment/order (no split).
- No auto-refund on cancel: `cancel-appointment.js:55` flips `status='cancelled'` only, leaves `payment_status` untouched; finance resolves manually.

## Non-goals

- No integrated Paystack Terminal API — POS remains external terminal + manual confirm (no card-reader SDK).
- No automatic bank-transfer webhook for `transfer` channel — manual staff confirm only.
- No split / partial payments per appointment or order (one channel, one settlement).
- No automatic Paystack refund on cancellation or no-show; no `transfer.reversed` → appointment revert.
- No subscription/billing conversion for appointments — separate `plan` system (`apps/carehub/api/_handlers/paystack-webhook.js:156` plan handler) stays untouched.

## Success signal

A CareHub owner creates four appointments (cash, pos, transfer, paystack) and a Shop customer completes a strict-Paystack order with a vendor that has `allow_pay_on_delivery=false` then repeats with `true` and uses pay-at-pickup: cash is instantly `paid`, pos/transfer become `paid` only after Owner taps Confirm, paystack/link and shop Paystack only become `paid` after `verify`/`webhook` with correct amount and HMAC, webhook replay returns `already_paid`, and direct PATCH to `paid` is rejected — all verified behaviorally in live Supabase, not by catalog alone.

## Assumptions

- Paystack secret is configured via `PAYSTACK_SECRET_KEY` env (already `apps/carehub/.env.example:10`); `getPaystackSecretKey()` is the single accessor.
- `business_wallets` held→available split is 80/20 for bookings (existing `settle_card_booking`) and commission `SEGMENT_RATES` for Shop (`apps/carefind/src/modules/shop/pricing.js:1` 10%/5%/2.5%) inside `settle_shop_payment`.
- Manual `pos|transfer` confirm is Owner/Manager only; regular Staff can create but not confirm чужой business's row.
- Transfer proof image is optional; when provided it is stored in existing `order-files` or new `appointment-payment-proofs` private bucket (5MB, MIME `image/*,application/pdf` mirroring `apps/carefind/sql/20260822_credentials_bucket_hardening.sql:99`).

## Open Questions

- Should manual `pos_reference` be required (last 4-6 digits of receipt) or optional note?
- Should `transfer_proof_url` be mandatory before Confirm Transfer is enabled?
- Should Shop `pay at pickup` be limited to `pickup` preference only or also `home` with `is_approved_city=false` quote_pending flow (`Checkout.jsx:90`)?
