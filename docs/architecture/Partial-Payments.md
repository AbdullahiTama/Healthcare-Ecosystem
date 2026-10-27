# Partial Payments — Credit Sales and Supplier Purchases

## What it does

- **POS → Credit.** Staff search outstanding credit sales by customer name or
  transaction number. They can then record a full or partial payment on any of
  them (Cash, Transfer or POS). The balance, the linked debt and the payments
  ledger update in one database transaction. The list and the outstanding
  total refresh at once. Each sale shows its payment history.
- **Purchases → Record payment.** Each purchase can take full or partial
  payments to the supplier. A payment records the method (Transfer, Cash,
  Cheque, POS or Other), the date paid and an optional note or reference. A
  purchase's status becomes `partial`, then `paid`.
- **Purchases → Suppliers & payments.** For each supplier, the screen shows
  purchases, total bought, amount paid, amount owed and open purchases. A
  supplier's details list their unpaid purchases, each with "Record payment",
  and the supplier's full payment history.
- **Debts → Mark paid.**
  - A credit-sale debt asks how the customer paid, then records the payment in
    the POS ledger. This flow came from the Sales & Accounts report work.
  - A purchase debt pays the purchase's remaining balance through
    `record_purchase_payment`, so the purchase, the debt and the history stay
    in step.
  - A manual debt is simply marked paid.

## Two sides, two migrations

| Side | Migration | Owns |
|---|---|---|
| Customer credit | `carehub_20261210_pos_accounting.sql` (applied 2026-10-26; see [POS-Sales-Report.md](POS-Sales-Report.md)) | `sale_payments` ledger, `record_sale_payment(p_sale_id, p_amount, p_method)`, `refund_sale`, shifts |
| Supplier payments | `carehub_20261212_supplier_payments.sql` | `purchase_payments`, `record_purchase_payment`, `get_supplier_balances`, `get_supplier_purchases` |

The credit screens use the POS ledger as it is. They add only a search
screen. The ledger records the cashier and shift from the caller's session,
so the app sends no staff name for customer payments. The ledger accepts only
completed sales, so the credit search lists only completed, not-held credit
sales that still owe money.

### `purchase_payments`

There is one row per payment to a supplier. Columns:

- `amount`, `method`, `paid_on`, `note`, `balance_after`;
- `recorded_by` (`auth.uid()`) and `staff_name`;
- a generated `supplier_key = lower(btrim(supplier_name))`;
- `kind`:
  - `payment` — recorded on the new screens;
  - `at_purchase` — the deposit paid when the purchase was created, written by
    a trigger;
  - `before_history` — backfilled amounts already paid before this feature
    existed.

The table is **append-only history**. Clients have SELECT only, limited to
their own business by RLS. Rows are written only by the function and the
insert trigger.

### Functions

| Function | Security | Does |
|---|---|---|
| `record_purchase_payment(p_purchase_id, p_amount, p_method, p_paid_on, p_note, p_staff_name)` | SECURITY DEFINER | Locks the purchase (`FOR UPDATE`), checks membership and validates the payment. Sets status `partial`/`paid`, updates the linked `purchase` debt and writes history. |
| `get_supplier_balances(p_business_id)` | SECURITY INVOKER | Gives per-supplier totals, grouped by `supplier_key`. |
| `get_supplier_purchases(p_business_id, p_supplier_key)` | SECURITY INVOKER | Returns one supplier's purchases. |

`record_purchase_payment` refuses:

- an amount of zero or less;
- an amount over the balance;
- an unknown method;
- an already-paid purchase;
- a payment date in the future;
- a purchase from another business (reported as "not found").

The deposit trigger never blocks a purchase. If its history row cannot be
written, the purchase is still recorded and a warning is logged.

## Security implications

- **Who may record payments is unchanged:** any member of the business. The
  definer function checks membership with the same rule as purchases' RLS.
- `anon` has no EXECUTE on the new functions. This is revoked explicitly,
  because Supabase grants EXECUTE to `anon` when a function is created.
  `purchase_payments` cannot be written by clients, so history cannot be
  edited or deleted from the app.
- `recorded_by` is `auth.uid()` and is the trusted record of who paid a
  supplier. `staff_name` is a display label only. On the customer side, the
  POS ledger stamps the cashier itself.
- Row locks prevent two people from paying the same balance twice. The old
  POS and Purchases code did unlocked read-then-write updates.

## Frontend

| File | Role |
|---|---|
| `lib/paymentRules.js` | Client-side amount validation, the same as the server's. |
| `lib/dbErrors.js` → `paymentErrorMessage` | Shows a payment function's plain-sentence refusal (400/403/404), or a safe fallback. |
| `components/payments/RecordPaymentForm.jsx` | Shared amount / method / date / note form with a "Full balance" shortcut. |
| `components/payments/PaymentHistory.jsx` | Shared history list for both `purchase_payments` and `sale_payments` rows, with refunds marked. |
| `modules/pos/creditSearch.js` | Pure search and sort over the loaded open credit sales. |
| `modules/pos/CreditCollections.jsx` | POS Credit tab: search, sort, live outstanding total, pages of 30. |
| `modules/purchases/SupplierPayments.jsx` | Purchase payment dialog, supplier balances table, supplier details. |
| `modules/debts/settleDebt.js` | Routes "Mark paid" for purchase debts through `record_purchase_payment`. |

Searching happens in memory. `useOpenSales` already loads every open sale
page by page, so it gets past the 1000-row cap. React Query caches are
updated, or invalidated, after each payment.

## Deployment order

Apply `carehub_20261212_supplier_payments.sql` **before** deploying the app.
The supplier screens call its functions. The migration is additive, and its
backfill is idempotent. The credit side needs no new migration.

## Test plan

- **Database (PGlite, `apps/carefind/src/test/payments-history/`), 12 tests:**
  - backfill, and that it is idempotent;
  - the deposit trigger, and that it never blocks a purchase;
  - partial and full payments;
  - the linked debt kept in step;
  - every refusal;
  - other business and `anon` denied;
  - history read-only and tenant-scoped;
  - supplier grouping;
  - the migration creates no sale-side objects.
- **Customer ledger:** `scripts/db-tests/posAccounting.pglite.mjs`, from the
  Sales & Accounts work.
- **Unit and component tests (CareHub):**
  - search matching, sorting and the completed-sale filter;
  - the credit collection flow against `paymentRepository`;
  - ledger history display;
  - error wording;
  - supplier payment dialogs;
  - `settleDebt` routing.
- **Manual:**
  1. Record a partial and then a full payment on a credit sale. Check that
     the balance, the Debts page, the history and the Sales & Accounts report
     all agree.
  2. Search 100+ credit sales by name and by `TXN1234`.
  3. Pay a purchase in two parts. Check the status pill, the supplier totals
     and the history.
  4. On a phone (390 px), check that nothing scrolls sideways.
