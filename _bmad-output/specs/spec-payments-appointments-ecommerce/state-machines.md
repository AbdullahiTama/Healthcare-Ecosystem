# State Machines

## Appointment (CareHub + CareFind shared `appointments` table)

```
[free] --fee=NULL-------------------------------> [*] (no payment)

[unpaid] --channel=cash / create--------------> [paid] (verified_by=creator)
[unpaid] --channel=pos|transfer / create-----> [unpaid-pending]
[unpaid-pending] --confirm_pos_payment RPC----> [paid] (verified_by, pos_reference)
[unpaid-pending] --confirm_transfer_payment---> [paid] (verified_by, proof_url)
[unpaid] --channel=paystack / initialize-----> [unpaid-paylink] (authorization_url, payment_reference)
[unpaid-paylink] --verify / webhook settle----> [paid] (paystack_reference, held 80%)
[paid] --complete RPC-------------------------> [released] (business_wallets.available += held)
[any] --cancel-------------------------------> [cancelled] (payment_status unchanged; no refund)
```

Invariants:
- `payment_status` only `unpaid -> paid` via RPC (manual attest or Paystack verify). No direct PATCH.
- `fee_amount` immutable after create (server snapshot at `booking.js:126` / `Appointments.jsx:66`).
- One channel per row; channel immutable after create except paystack link generation.

## Shop Order (`shop_orders`)

```
[pending_payment] --strict paystack / init-----> [awaiting_paystack] (payment_reference, authorization_url)
[awaiting_paystack] --verify / webhook---------> [paid] (paystack_reference, commission split)
[pending_payment] --allow_pay_on_delivery=true + Pay at Pickup --> [pending_pickup] (unpaid, awaiting vendor Accept)
[pending_pickup] --vendor Accept--------------> [accepted] -> processing -> ready_for_pickup -> in_transit -> delivered
[paid] --vendor Accept------------------------> [accepted] -> ...
[*] --cancel---------------------------------> [cancelled] (restore stock via cancel_shop_order RPC)
```

Invariants:
- Prices re-validated in `create_shop_order` RPC vs `ecommerce_products.ecommerce_price_kobo`; `PRICE_CHANGED` → 409 to client.
- `payment_reference` unique; replay of same reference returns existing order id (idempotency).
- Delivery fee `deliveryFeeDisplay` (`Checkout.jsx:90`) quote_pending does not block product payment; strict = product + fulfilment must be paid via Paystack.

## Wallet

```
held (80% of fee / commission excluded) --complete_appointment_and_release RPC--> available
available --initiate-business-withdrawal RPC--> pending withdrawal (paystack transfer) --> completed|failed
```

Diagram source: `apps/carehub/src/modules/appointments/repositories/index.js:72` (complete) + `apps/carehub/src/modules/appointments/Appointments.jsx:165` withdraw.
