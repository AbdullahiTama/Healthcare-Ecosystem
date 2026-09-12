# Glossary

| Term | Meaning |
|---|---|
| `payment_channel` | How money moves: `cash` (hand), `pos` (external card terminal), `transfer` (bank transfer), `paystack` (Paystack inline), `carecoins` (CareFind wallet, not used in this spec for split). One per row. |
| `payment_status` | Ledger truth: `null` free, `unpaid`, `paid`, `refunded` (manual). Only RPC may set to `paid`. |
| `payment_reference` | Opaque idempotency key (`bk_…`, `CF-…`, `appt_…`) stored before Paystack init; unique partial index. |
| `paystack_reference` | Paystack's `reference` echoed back on verify; unique partial index; used for replay detection. |
| `verified_by/at` | Who/when a manual `pos|transfer|cash` was attested (staff id + timestamp). |
| `pos_reference` | Last 4-6 digits or receipt code from external POS terminal, optional audit field. |
| `transfer_proof_url` | Private storage URL of bank transfer screenshot/PDF, optional. |
| `shop_allow_pay_on_delivery` | Business-level boolean; when true Shop Checkout shows Pay-at-Pickup secondary CTA. |
| `settle_card_booking` | Existing RPC that splits booking fee 80% held / 20% platform and writes `staff_notifications` kind `booking_paid`. |
| `settle_shop_payment` | New RPC mirroring above for `shop_orders`, splitting `commission_kobo` + fulfilment/delivery. |
