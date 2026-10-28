# CareHub Subscription Billing and Receipts

Owners can see what their CareHub plan is used for, every plan payment with a printable receipt, and checkouts that
did not renew the plan, which they can confirm with Paystack.

## Where

Settings → Billing (Owner only), below the Renew buttons:

| Section | Shows |
|---|---|
| Plan usage | Staff, locations and products used against the plan's limits; amber at 80%, red at the limit |
| Payment history | Each payment: amount, plan, months, date paid, service period, receipt number. "View receipt" and "Print" |
| Unconfirmed attempts | Plan checkouts from the last 180 days that produced no payment, with their status and a "Check payment" button |

The receipt (A4, printable or save-as-PDF from the browser's print dialog) shows the receipt number, business billed,
plan and period, payment method, CareHub reference, Paystack transaction id and amount.

## Statuses of an attempt

| `payment_intents.status` | Shown as | "Check payment" |
|---|---|---|
| created, pending, verified | Awaiting confirmation | Yes (Paystack) |
| failed | Not completed | Yes (Paystack) |
| expired | Abandoned | Yes (Paystack) |
| needs_refund | Under review | No; platform staff refund or apply it |
| refunded | Refunded | No |

"Check payment" calls `POST /api/verify-plan-payment`, the same endpoint used on return from checkout. It asks Paystack
for the transaction, and only a payment matching the intent's amount, currency and business renews the plan. The
webhook uses the same settlement, so a payment is never applied twice.

## Database (`supabase/migrations/carehub_20261218_subscription_billing.sql`)

- `plan_payments` gains `plan`, `period_start`, `period_end`, `payment_method` (`paystack`, `wallet` or `manual`),
  `provider_transaction_id`, `currency`, `paid_at` and `receipt_number`.
- `receipt_number` is `CH-<year>-<6 digits>` from `plan_receipt_seq`. A trigger assigns it on every insert, and any
  value the writer passes is ignored.
- `renew_business_plan` (the only writer, used by both the Paystack and the wallet settlement) records those details in
  the same transaction that extends the plan. Its signature, result and grants are unchanged.
- Existing rows are backfilled. Their service period was never recorded, so it is taken as the months bought from
  the payment date.
- `business_billing_overview(business_id)` returns the plan, limits, usage, payments and attempts as JSON.

## Security

- `business_billing_overview` returns NULL for everyone except the Owner (`is_business_owner`) and platform admins.
  Staff, including managers, get nothing. It is SECURITY DEFINER only because `payment_intents` has no
  business-facing policy, and it only reads.
- Billing belongs to the top-level business (`verifyBusiness` renews that row), so a branch sees its organisation's
  payments.
- Receipts escape every owner-typed value before printing.
- No grants are widened. Clients still cannot write `plan_payments`.

## Deployment

Apply the migration before or with the app. If the app ships first, the Billing history shows "We couldn't load your
billing history" with a retry button until the migration is applied. Renewals keep working either way.

## Test plan

- PGlite `apps/carefind/src/test/plan-enforcement/subscriptionBilling.db.test.js`: backfill; Paystack, wallet and manual
  renewals record the right details; a replayed reference changes nothing; the receipt number cannot be chosen; the
  overview for the Owner, from a branch, and refused for staff, other businesses and anon.
- Unit: `src/modules/settings/services/billing.test.js` (receipt content and escaping, statuses, usage, confirm call)
  and `src/modules/settings/__tests__/BillingHistory.test.jsx` (usage, receipt and print, check payment, empty, error
  and retry).
- Manual, after applying the migration:
  1. Settings → Billing shows the existing payment with receipt `CH-2026-000001`, and Print opens the receipt.
  2. Renew 1 month in Paystack test mode. On return, the new payment appears with the next receipt number.
  3. Start a checkout and close it. The attempt appears as "Awaiting confirmation", and "Check payment" reports that
     no payment was made.
  4. Sign in as a staff member with a Manager role. Settings, and the overview RPC, show no billing data.
