# Shop payment attempts — design

Status: IMPLEMENTED 2026-10-03 (commits 049e638, c4e45fd, db02468 and the client service commit). Not committed (by request).

## Problem

`initiate-shop-payment` reuses one `shop_orders.payment_reference` for every payment attempt on an order.
Retrying an abandoned payment ("Pay now" on the order page) re-initialises Paystack with a reference that may
already have been used. Whether Paystack rejects it is unverified (docs returned 403), so the design must be
correct either way.

Related fixes already committed: `8a556ec` (a payment must belong to the order it settles), `38480aa`
(webhook settlement is retryable), `84264bf` (webhook notification text).

## Key finding

`shop_payments` is already a per-attempt ledger: `payment_reference text UNIQUE NOT NULL`, `order_id` indexed
but not unique, `status in (pending, success, failed, refunded)`. No new table is needed.

## Design

### 1. Starting a payment — `initiate-shop-payment`
1. Authenticate; check ownership and payable status (unchanged).
2. Find the order's newest `pending` attempt in `shop_payments`. If present, verify it with Paystack:
   - succeeded -> return `{ alreadyPaid: true, reference }` and start no new attempt; the client sends the customer to `/orders/:id?reference=...`, where the existing verify flow settles it (no settlement logic duplicated in initiate);
   - abandoned/failed -> mark the attempt `failed`.
3. Mint a fresh unique reference and insert a `pending` attempt row. If the insert fails, return 500 and do not
   call Paystack (today the error is swallowed).
4. Set `shop_orders.payment_reference` to the new reference ("latest attempt", keeps the UI Ref display).
5. Initialise Paystack with `total_kobo` from the database and `metadata.order_id` (unchanged).

### 2. Verifying — `verify-shop-payment`
- A client-supplied reference is accepted only if `shop_payments` has a row for that order and reference.
- With no reference, check the order's attempts newest-first.
- Keep the Paystack `metadata.order_id` and amount checks from `8a556ec`.
- The first successful attempt settles the order.

### 3. Webhook — `paystack-webhook`
- Require the event reference to be an attempt of the order named in the metadata, plus the existing amount check.
- A success for a different attempt on an already-paid order is stored as `success` with a duplicate marker and
  creates a `staff_notifications` row so an admin can refund it in Paystack. It does not settle again.
- The retryable-settlement behaviour from `38480aa` is unchanged.

### 4. Errors and states
- Insert failure -> 500, no Paystack call. Paystack outage -> 502, old attempt untouched.
- "Pay now" shows loading and error states; an already-paid result redirects to the paid order.

### 5. Duplicate payments (decided)
Record the second payment and alert admin to refund manually. No automatic refund, no wallet credit.

### 6. Migration — none needed
The duplicate marker is stored in the existing `shop_payments.gateway_response` jsonb (`{ duplicate: true,
settled_reference }`), so the live schema is untouched. Refund worklist query:
`select * from shop_payments where gateway_response->>'duplicate' = 'true'`.

### 7. Deviations from the approved design
- Settlement is delegated to the order page's verify call, not done inside initiate (see section 1).
- A legacy order (reference on the order, no ledger row) has that reference checked and ledgered before it is replaced.
- Duplicate alert = flagged ledger row + vendor `staff_notifications` + `[shop-duplicate-payment]` log line. There is
  no admin email yet (no admin alert template exists); wiring ADMIN_EMAIL is a follow-up.

## Testing
Handler tests in the existing mock style: retry after abandoned attempt; retry after a success whose callback was
lost; duplicate-success flagged and not re-settled; foreign reference rejected; insert failure -> 500 with no
Paystack call. Plus a manual Paystack test-mode run: abandon, retry, pay twice.

## Out of scope
Auto-refunds, wallet credit, the logged-out shop 401 behaviour, and the checkout/UI standardisation work.
