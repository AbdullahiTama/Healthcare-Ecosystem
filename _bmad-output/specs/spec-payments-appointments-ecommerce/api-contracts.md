# API & RPC Contracts

## DB changes

```sql
-- appointments (both products share one Postgres, one public schema)
alter table appointments add column if not exists payment_channel text check (payment_channel in ('cash','pos','transfer','paystack','carecoins'));
alter table appointments add column if not exists paystack_reference text;
alter table appointments add column if not exists verified_by uuid references staff(id);
alter table appointments add column if not exists verified_at timestamptz;
alter table appointments add column if not exists pos_reference text;
alter table appointments add column if not exists transfer_proof_url text;
create unique index if not exists appointments_payment_reference_uidx on appointments(payment_reference) where payment_reference is not null;
create unique index if not exists appointments_paystack_reference_uidx on appointments(paystack_reference) where paystack_reference is not null;

-- business toggle for shop pay on delivery
alter table businesses add column if not exists shop_allow_pay_on_delivery boolean not null default false;

-- optional private bucket for proofs if not reusing order-files
-- storage bucket: appointment-payment-proofs (public=false, file_size_limit=5242880, allowed_mime_types image/*,application/pdf)
```

Trigger/RLS hardening: extend `guard_business_privileged_columns()` idea to `appointments.payment_status/payment_channel/verified_*` — only RPC/service-role may set to `paid`.

## RPCs

### confirm_pos_payment(p_appointment_id uuid, p_pos_reference text) -> text
- SECURITY DEFINER, search_path=public, EXECUTE to authenticated only (revoke PUBLIC,anon).
- Checks: caller owns business (`business_id IN select current_business_ids()`), appt exists, `payment_channel='pos'`, `payment_status='unpaid'`.
- Sets `payment_status='paid', verified_by=caller_staff_id, verified_at=now(), pos_reference=p_pos_reference`.
- Returns `ok` | `already_paid` | error `not_found|forbidden|not_pending`.
- Idempotent: second call returns `already_paid`.

### confirm_transfer_payment(p_appointment_id uuid, p_proof_url text) -> text
- Same shape as above, but `payment_channel='transfer'`, sets `transfer_proof_url`.

### initiate_shop_payment(p_order_id uuid) -> json {authorization_url, reference}
- Auth: caller = customer (order.customer_id = auth.uid()) or service-role.
- Validates `shop_orders.status='pending_payment'`, reads `total_kobo` server-side, calls Paystack `paystackFetch /transaction/initialize` with `metadata {order_id, business_id}`, stores `payment_reference` if missing, returns url.

### verify_shop_payment(p_order_id uuid, p_paystack_reference text) -> text
- Calls Paystack verify, checks `amount === total_kobo`, then `settle_shop_payment` (see below). Returns `ok|already_paid`.

### settle_shop_payment(p_order_id uuid, p_reference text, p_amount int) -> text
- SECURITY DEFINER, idempotent. Updates `shop_orders.payment_status='paid', paystack_reference=p_reference, status='paid'`, inserts `shop_order_status_history`, splits `fulfilment+delivery` to platform? Actually commission `commission_kobo` to platform, remainder + fulfilment+delivery to vendor wallet — mirrors `settle_card_booking` 80/20 but uses Shop segment rates. Notifies `staff_notifications` kind `shop_order_paid`.

## HTTP endpoints

### POST /api/initiate-appointment-payment (CareHub)
 existing `apps/carehub/api/initiate-appointment-payment.js:11` — keep, but delegate to shared `paystackInit` lib; body `{appointment_id}`; returns `{authorization_url, reference, fee}`; 401 if not owner, 400 if already paid or fee null, 404 if not found.

### POST /api/verify-appointment-payment
 existing `apps/carehub/api/verify-appointment-payment.js:1` — keep, pattern `verify-booking-payment.js:47` amount check + `settle_card_booking`.

### POST /api/confirm-pos-payment
 new `apps/carehub/api/confirm-pos-payment.js` — body `{appointment_id, pos_reference}`; auth `verifyBusiness` (`apps/carehub/api/_lib/verifyBusiness.js:1`); calls RPC above; returns 200 `{paid:true}` or 409 `already_paid`.

### POST /api/confirm-transfer-payment
 body `{appointment_id, proof_url?}`; optional upload handled client-side via `sbUpload` to `appointment-payment-proofs/<business_id>/<appointment_id>.<ext>` before calling.

### POST /api/initiate-shop-payment (CareFind)
 body `{order_id}`; auth `verifyUser` (`apps/carefind/api/_lib/verifyUser.js:1`); returns `{authorization_url, reference}`; 400 if not `pending_payment`.

### POST /api/verify-shop-payment
 body `{order_id, reference}`; same verify pattern.

### POST /api/paystack-webhook (single)
 existing `apps/carefind/api/_handlers/paystack-webhook.js:1` — add:

```js
async function handleShopOrder(metadata, reference, amount) {
  if (!metadata?.order_id) return null
  const { data: order } = await supabase.from('shop_orders').select('id,total_kobo').eq('id', metadata.order_id).maybeSingle()
  if (!order || amount !== order.total_kobo) return null
  const { data: result } = await supabase.rpc('settle_shop_payment', { p_order_id: order.id, p_reference: reference })
  if (result !== 'ok' && result !== 'already_paid') return null
  if (result === 'already_paid') return {alreadyProcessed:true}
  await supabase.from('staff_notifications').insert({ business_id: ..., kind: 'shop_order_paid', ... })
  return {settled:true}
}
```

Dispatch order: `handleBooking` -> `handleShopOrder` -> `handleTopup` (so `appointment_id` vs `order_id` metadata discriminates).

## Repository changes

`apps/carehub/src/modules/appointments/repositories/index.js`
```js
async confirmPos(appointmentId, businessId, posReference)
async confirmTransfer(appointmentId, businessId, proofUrl)
async initiatePaystack(appointmentId, businessId) -> {url, reference}
async verifyPaystack(reference, businessId)
```

`apps/carefind/src/modules/shop/orderRepository.js`
```js
async initiatePayment(orderId) -> {authorization_url, reference}
async verifyPayment(orderId, reference) // already exists, wire to new endpoint
```

## UI contracts

- `Appointments.jsx:339` Modal: when fee>0, `Sel payment_channel` required, default `cash`. Save branches per CAP-1..4.
- `DataTable actions` `Appointments.jsx:324`: conditional buttons per `payment_channel`+`payment_status`.
- `Ecommerce.jsx:294` Seller Application card: add toggle `Allow pay at pickup` (Owner only, `Pill` shows enabled).
- `Checkout.jsx:347` button: `Pay with Paystack` always; `Pay at Pickup` secondary rendered only if `shop_allow_pay_on_delivery && delivery_preference==='pickup'`.
