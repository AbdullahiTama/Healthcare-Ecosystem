# Transaction Details and Credit Customers

Four CareHub changes. Every existing workflow keeps working.

## 1. A credit sale needs a customer record

**Before:** the POS linked a sale to a customer only when the typed name
exactly matched a saved client. Credit sales could be recorded for "Walk-in"
or a misspelt name. In production on 2026-10-27, 10 of 15 credit sales had no
`client_id`.

**Now:**
- When the cashier picks **Credit**, a customer picker appears in the cart. It
  searches by name (words in any order) or phone (prefix and spacing ignored).
- Two customers with the same name are told apart by phone number.
- **Add a new customer** creates the record without leaving the sale; the cart
  is kept.
- The charge button reads **Select a customer** and stays disabled until one
  is chosen.
- The sale and its debt carry the chosen customer's `client_id`.
- An unambiguous exact name typed in the header, or a resumed held sale, is
  picked automatically.
- Editing the name or pressing **Change** clears the selection.
- **Server enforcement:** the `sales_require_credit_customer` trigger
  (`carehub_20261213`) refuses a completed credit sale without a `client_id`
  from the same business. The refusal text, "Select the customer for this
  credit sale.", is shown at the till.
- Cash, transfer, POS and split sales, held sales and existing rows are not
  affected.

Files: `modules/pos/customerPick.js`, `modules/pos/CustomerPicker.jsx`,
`modules/pos/POS.jsx`.

## 2. Sale details

Each sale in **POS → Recent**, and in **Recent sales** on the dashboard, opens
the existing `SaleDetailModal` from the Sales & Accounts report. It shows:
- every item with quantity, unit price and line total;
- discount, total, paid and outstanding;
- customer, cashier, method and status;
- the payments ledger;
- **Reprint**.

Repayment and (for owners and managers) refund are offered as in the report.
The Recent card's **Reprint** button still works without opening the sale.

## 3. Purchase (supplier invoice) details

Each purchase row opens `PurchaseDetailModal`
(`modules/purchases/PurchaseDetail.jsx`). The supplier name is the row's
keyboard-reachable button. The view shows:
- supplier, supply and due dates, status, and invoice notes;
- each line: item, quantity × unit cost, line total, and batch, expiry or
  selling price where given;
- total, paid and balance;
- payments to the supplier;
- **Record payment**.

Purchases in a supplier's list (Suppliers & payments) open the same view.

**Line items:** purchases used to store one squashed row: names joined
together, total quantity and an *average* unit cost.
- New purchases now save their lines in `purchases.items` (jsonb, an array,
  added by `carehub_20261213`).
- Older purchases are shown as one summary line labelled "average", with a
  note explaining why.
- The full record is loaded by id (`usePurchase`), because the list's page
  function returns summary columns only.

## 4. Debt details

Each debt row opens `DebtDetail` (`modules/debts/DebtDetail.jsx`):

| Debt source | Opens |
|---|---|
| Credit sale (`source_ref` = transaction number) | The original sale in `SaleDetailModal`: items bought, payments made, outstanding balance, repayment and reprint. |
| Purchase (`source_ref` = purchase id) | The supplier invoice in `PurchaseDetailModal`, with **Record payment**. |
| Manual, or the original record is gone | A summary: amount, paid, outstanding, due date and description, with **Mark paid**. |

The row's own **Mark paid** button works as before, without opening the debt.

## Deploying before the migrations are applied

Both pending migrations (`carehub_20261212_supplier_payments`,
`carehub_20261213_credit_customer_and_purchase_items`) are additive, and the
app works with or without them:

| Missing | App behaviour |
|---|---|
| `purchases.items` | The purchase is saved without its lines (`isMissingColumn`) and shown as a summary line. |
| Credit-customer trigger | The POS still requires a customer; only the server-side check is absent. |
| Supplier-payments functions | History and supplier totals say "available once the latest database update is applied". Paying the **full** balance marks the purchase and its debt paid, as before. A part payment explains it needs the update. Debts → Mark paid on a purchase debt marks the debt paid, as before. |

`isMissingObject` / `isMissingColumn` now live in `lib/dbErrors.js`.
`modules/pos/repositories` re-exports `isMissingObject` for existing callers.

## Security implications

- **No permission changes.** Who may sell, record purchases, record payments
  and refund is unchanged. Refunds stay owner/manager only and are enforced by
  the database (`refund_sale`).
- The credit-customer trigger is SECURITY DEFINER only so it can read the one
  client row whatever the caller's RLS. It writes nothing, and EXECUTE is
  revoked from everyone.
- Adding a customer from the till uses the existing `clients` insert, scoped
  to the business by RLS. A duplicate phone number is refused by the existing
  unique index, and the till explains it.
- Detail views read only through the existing tenant-scoped repositories
  (`business_id` filter plus RLS).

## Test plan

- **Automated:**
  - `customerPick.test.js`: matching by name or phone; duplicates are never
    guessed.
  - `POS.credit.test.jsx`: credit is blocked until a customer is picked; the
    picked customer is used for the sale and debt; duplicate names are told
    apart; add a customer in place; Change clears the selection; a Recent sale
    opens in full.
  - `DashboardHome.test.jsx`: a recent sale opens in full.
  - `purchaseInvoice.test.js`, `SupplierPayments.test.jsx`: invoice lines;
    the older-purchase summary; history unavailable before the migration; the
    full-payment fallback; the part payment explained.
  - `purchases/repositories/index.test.js`: lines saved, and the retry
    without lines when the column is missing.
  - `Debts.detail.test.jsx`: sale, purchase and manual debts open; a missing
    sale falls back; the row's Mark paid still works.
  - `settleDebt.test.js`: purchase debt fallback before the migration.
  - PGlite `apps/carefind/src/test/credit-customer` (7 tests): the trigger
    allows the business's own customer and refuses none, another business's
    customer, or an unknown id; cash, held and existing sales are unaffected;
    `items` keeps lines, older rows are NULL, a non-array is refused; the
    migration can be re-run.
- **Manual:**
  1. On a phone, choose Credit, search a customer by phone, and record the
     sale. Check that the debt shows the customer record pill.
  2. Try to record credit without a customer: the button stays disabled.
  3. Open a Recent sale and reprint.
  4. Record a purchase with two lines, then open it. Check each line's
     quantity and price.
  5. Open a credit-sale debt, a purchase debt and a manual debt.
