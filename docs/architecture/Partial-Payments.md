# Partial Payments — Credit Sales and Supplier Purchases

## What it does

- **POS → Credit.** Staff search outstanding credit sales by customer name or
  transaction number. They can then record a full or partial payment on any of
  them. The balance, the linked debt and the payment history update in one
  database transaction. The list and the outstanding total refresh at once.
- **Purchases → Record payment.** Each purchase can take full or partial
  payments to the supplier. A payment records the method (Transfer, Cash,
  Cheque, POS or Other), the date paid and an optional note or reference.
  A purchase's status becomes `partial`, then `paid`.
- **Purchases → Suppliers & payments.** For each supplier, the screen shows
  purchases, total bought, amount paid, amount owed and open purchases. A
  supplier's details list their unpaid purchases, each with "Record payment",
  and the supplier's full payment history.
- **Debts → Mark paid.** For a debt linked to a credit sale or a purchase,
  this now goes through the same payment functions. The sale or purchase and
  the debt therefore stay in step.

## Data model (`supabase/migrations/carehub_20261211_partial_payments.sql`)

| Table | Purpose |
|---|---|
| `sale_payments` | One row per payment on a sale: amount, method, note, balance after, `recorded_by`, `staff_name`, `kind`. |
| `purchase_payments` | One row per payment to a supplier: the same columns, plus `paid_on` and a generated `supplier_key = lower(btrim(supplier_name))`. |

`kind` records where a row came from:

- `payment` — recorded on the new screens.
- `at_sale` / `at_purchase` — the deposit taken when the sale or purchase was
  created, written by a trigger.
- `before_history` — backfilled amounts already paid before this feature
  existed.

Both tables are **append-only history**. Clients have SELECT only, limited to
their own business by RLS. Rows are written only by the functions below.

### Functions

| Function | Security | Does |
|---|---|---|
| `record_sale_payment(p_sale_id, p_amount, p_method, p_note, p_staff_name)` | SECURITY DEFINER | Locks the sale (`FOR UPDATE`), checks membership, validates the payment, updates `amount_paid` / `balance` / `is_credit`, updates the linked `credit_sale` debt, and writes history. |
| `record_purchase_payment(p_purchase_id, p_amount, p_method, p_paid_on, p_note, p_staff_name)` | SECURITY DEFINER | Does the same for purchases: sets status `partial`/`paid` and updates the linked `purchase` debt. |
| `get_supplier_balances(p_business_id)` | SECURITY INVOKER | Gives per-supplier totals, grouped by `supplier_key`. |
| `get_supplier_purchases(p_business_id, p_supplier_key)` | SECURITY INVOKER | Returns one supplier's purchases. |

The payment functions refuse:

- an amount of zero or less;
- an amount over the balance;
- an unknown method;
- a held sale;
- an item that is already fully paid;
- a payment date in the future;
- a sale or purchase from another business (reported as "not found").

The insert triggers that record deposits are non-blocking. If a history row
cannot be written, the sale or purchase still goes through and a warning is
logged.

## Security implications

- **Who may record payments is unchanged:** any member of the business. The
  definer functions check membership with the same rule as RLS
  (`current_business_ids()` / `is_platform_admin()`).
- `anon` has no EXECUTE on any of the new functions. Neither table can be
  written by clients, so history cannot be edited or deleted from the app.
- `recorded_by` is `auth.uid()` and is the trusted record of who recorded the
  payment. `staff_name` is a display label only.
- The row lock prevents two tills from paying the same balance twice. The old
  POS code did an unlocked read-then-write and could do this.

## Frontend

| File | Role |
|---|---|
| `lib/paymentRules.js` | Client-side amount validation, the same as the server's. |
| `lib/dbErrors.js` → `paymentErrorMessage` | Shows the server's plain-English refusal, or a safe fallback. |
| `components/payments/RecordPaymentForm.jsx` | Shared amount / method / date / note form with a "Full balance" shortcut. |
| `components/payments/PaymentHistory.jsx` | Shared history list with loading, error and empty states. |
| `modules/pos/creditSearch.js` | Pure search and sort over the loaded open credit sales. |
| `modules/pos/CreditCollections.jsx` | POS Credit tab: search, sort, live outstanding total, pages of 30. |
| `modules/purchases/SupplierPayments.jsx` | Purchase payment dialog, supplier balances table, supplier details. |
| `modules/debts/settleDebt.js` | Routes "Mark paid" through the payment functions for linked debts. |

Searching happens in memory. `useOpenSales` already loads every open sale
page by page, so it gets past the 1000-row cap. React Query caches are
updated, or invalidated, after each payment.

## Deployment order

Apply the migration **before** deploying the app. The new screens call the
new functions. The migration is additive, and its backfill is idempotent.

## Test plan

- **Database (PGlite, `apps/carefind/src/test/payments-history/`), 16 tests:**
  - backfill, and that it is idempotent;
  - deposit triggers;
  - partial and full payments;
  - debt kept in step;
  - every refusal;
  - other business and `anon` denied;
  - history read-only and tenant-scoped;
  - supplier grouping;
  - triggers never block a sale or purchase.
- **Unit and component tests (CareHub):**
  - search matching and sorting;
  - repository request shapes;
  - credit collection flow;
  - supplier payment dialogs;
  - `settleDebt` routing.
- **Manual:**
  1. Record a partial and then a full payment on a credit sale. Check that
     the balance, the Debts page and the history all agree.
  2. Search 100+ credit sales by name and by `TXN1234`.
  3. Pay a purchase in two parts. Check the status pill, the supplier totals
     and the history.
  4. On a phone (390 px), check that nothing scrolls sideways.
