# Debt Accounts, Supplier Summary, Credit Accounts and POS Stock Limits

Four changes made together (2026-11-14) because three of them share one database migration and one rule: every
summary is built from the underlying records and must add up to them.

| # | Change | Where | Needs the migration |
|---|---|---|---|
| 1 | POS refuses quantities above the stock on hand | `modules/pos/stockLimit.js`, `POS.jsx` | No |
| 2 | Debts split into Receivables and Payables, part payments with history, Excel/CSV import and export | `modules/debts/*` | Yes (falls back) |
| 3 | Purchases › Supplier summary: supplier accounts, account payments, supply records, import/export | `modules/purchases/SupplierAccounts.jsx`, `supplierAccounts.js` | Yes (falls back) |
| 4 | POS › Credit: one account per customer | `modules/pos/CreditCollections.jsx`, `creditAccounts.js` | Account payment only (falls back) |

Migration: `supabase/migrations/carehub_20270117_debt_and_supplier_accounts.sql`, **not applied**. It needs the owner's
approval; its header has the probe to run afterwards. Until then every screen works as before, and the new parts that
need it say so (CODE_AUDIT A26).

## 1. POS stock validation

**Rule.** A cart line can never ask for more units than the product has on hand. Services are not stocked; a negative
stock (636 products from before the ledger's floor) counts as none.

- Adding one more (tap, barcode scan, camera scan) of a product whose units are all in the sale is refused with
  "Only N ... in stock".
- Typing or stepping a quantity above the stock sets it to the stock and says so ("You asked for 10, so the quantity is
  set to 3"). Lowering is always allowed.
- If stock falls after a line was added (another till sold it, a held sale was resumed), the line shows "Only N in
  stock", a banner lists the lines with **Set to available stock**, and Charge / Record credit sale is refused with the
  same message until the cart fits.
- The current stock is read from the catalogue (`productById`), never from the copy stored on the cart line.

**Why only in the till.** `carehub_20261224_sale_stock_ledger` deliberately never refuses a sale for stock ("a sale is
never lost": offline sales must sync) and records a shortfall as `short by N`. Refusing in the database would lose
offline sales; the till is where overselling is prevented. Two tills selling the last unit at the same instant can
still oversell by that unit; the ledger records it.

A barcode scanner typing into a quantity field restores the sale first (POS-Barcode-Scanning.md); the add then checks
the restored cart, so a scan of a product already in the sale still adds one.

## 2. Debts: Receivables and Payables

**Tabs.** Receivables (owed to the business) and Payables (owed by it) replace the Direction filter. Each tab label shows
its outstanding total; the cards show Outstanding, Total owed and Payments (total owed − payments = outstanding). A
warning appears when a debt's balance is not its amount less what was paid (older records), instead of hiding it.
Marks for bulk edit / delete are per tab.

**Payments on debts recorded by hand.** Before: Mark paid overwrote the amounts, part payments were impossible and
nothing recorded when or how. Now **Record payment** opens the debt with its history and takes a full or part payment
(`record_debt_payment`, `debt_payments`). Sale and purchase debts are unchanged: a credit-sale debt is settled through
the sale (`record_sale_payment`), a purchase debt through the purchase (`record_purchase_payment`); the database refuses
`record_debt_payment` on them and says where to pay. Existing paid amounts get one "before history" row each, so every
history adds up to the amount paid. The database now refuses direct edits to a hand-recorded debt's amounts
(`debts_manual_guard`) and derives balance and status on insert (`debts_manual_defaults`).

Bulk delete keeps a deleted debt's payment rows with its copy; restore puts them back (same ids) and invents no
"paid when recorded" row.

**Import.** One row is a debt (Amount Owed, optionally with Amount Paid) or a payment (Amount Paid only). Templates:
Excel (data + Instructions sheets) and CSV, per tab. The app checks each cell's format (`debtImport.js`); everything
else runs in `import_debts`:

- **Matching.** Receivables: a customer by phone (Nigerian `+234…` and `0…` forms are the same number,
  `phone_match_key`), then by name (case and spacing ignored). Several customers sharing a name: linked to the earliest,
  with a note asking for a phone number. Payables: a supplier by the supplier key (`lower(btrim(name))`, the key
  purchases already use), keeping the existing spelling.
- **Creating.** A customer that does not exist is created once (later rows in the same file find it). A supplier that
  does not exist starts its account with that row (suppliers have no table; see §5). Imports are serialised per business
  (advisory lock), so two imports cannot create the same customer.
- **Payments.** Receivables: applied to the customer's hand-recorded / imported debts oldest first. Credit sales are not
  paid from a file: their money belongs in the till and the sales ledger (POS › Credit). Payables: through
  `record_supplier_payment` (§3), so purchases are paid too.
- **Duplicates.** Skipped unless asked: same Reference (stored as `source_ref = 'import:<ref>'`), a CareHub export
  reference (`D-1A2B3C4D`), or for rows without a reference the same party, amount, description, due date and date. A
  payment with a reference already imported is skipped too.
- **Preview = import.** The preview calls `import_debts` with `dry_run`: every row is executed and the whole thing rolled
  back, so it shows exactly which profile each row is linked to, which will be created, and which rows fail and why.
  The real import is one transaction; a bad row is reported and skipped (savepoint), the rest are kept. Audited as
  `debts.imported`.

**Export.** The rows on screen (tab and filters), in the import template's columns plus Balance, Status, Source and the
customer-record link, Excel or CSV, audited through `record_export_audit` (`debts.xlsx|csv`). Owner or
`canExportReports`.

## 3. Purchases › Supplier summary

The detailed Purchase entry (products, quantities, cost and selling prices) is unchanged. The **Supplier summary** tab
replaces "Suppliers & payments" and needs no product details:

- **Accounts** (`get_supplier_accounts`): per supplier key, its purchases plus its supply records (hand-recorded or
  imported "we owe" debts), with supplied, paid, outstanding, open items and last supply. Existing purchases are
  consolidated automatically: nothing is copied or migrated. Debts raised *by* a purchase are excluded (they mirror the
  purchase; counting both would double what is owed). `mismatch_count` flags items whose amount ≠ paid + balance.
- **Record payment** on the account (`record_supplier_payment`): applied to open purchases and supply records oldest
  first, by calling `record_purchase_payment` / `record_debt_payment` for each, so each item's ledger, its debt and its
  balance move exactly as a payment on that item would. All or nothing. The resulting rows share an `allocation_id`; the
  payment history shows them as one payment "applied to N items" and each item keeps its own part.
- **Supply history** (purchases and supply records, each payable on its own; a purchase opens its invoice) and
  **Payment history** (`get_supplier_activity`).
- **Supply record**: an amount owed without products (opening balance, old invoice). Picking an existing supplier
  attaches it to that account; a near spelling ("Emzor Limited" for "Emzor Ltd") is pointed out, since a different
  spelling starts a separate account.
- **Import** (the Payables import, §2) and **Export** (one row per supplier, audited as `supplier_accounts.*`, counted as
  cost data).
- The Owner dashboard's "suppliers owed" follow-up reads the same accounts, so the two figures agree.

## 4. POS › Credit: customer accounts

The Credit tab shows one card per customer instead of one per credit sale: total outstanding, visits owing, owing since,
purchased and paid, with **Record payment**, **View details** and **View transactions**.

- **Who is the same customer** (`groupCreditAccounts`): the client record (`client_id`); an unlinked sale whose name
  matches exactly one client joins that client's account; other named sales group by name and are flagged when several
  clients share it; an unnamed walk-in is its own account. Nothing is merged in the database.
- **View details**: each visit oldest first, its items, what it still owes, its payment history, and Pay this visit.
- **Record payment**: one payment on the account, applied to the oldest visits first, each through
  `record_sale_payment` (cashier, shift, sale and debt), all or nothing (`record_customer_payment`). Before the migration,
  a payment that fits the oldest visit is recorded on it; a larger one asks to pay visit by visit.
- **View transactions**: every credit purchase and payment, oldest first, with the balance after each. For a customer
  with a record it includes their paid credit sales too; for a name-only account its open sales.
- **Export**: one row per account with its transaction numbers, audited as `credit_accounts.*`.

## 5. Decisions and limits

- **No suppliers table.** Suppliers are identified by the normalised name, as purchases always have been
  (`get_supplier_balances`). A table would mean re-keying every purchase and its functions; proposed as a follow-up
  (CODE_AUDIT A26). Until then "creating a supplier profile" means starting its account under the exact name, and the
  import and the supply-record form reuse an existing spelling.
- Customer payments are not imported against credit sales (§2).
- An account payment on a customer's credit account is not grouped by an id in `sale_payments` (that would change
  `record_sale_payment`); each visit's row is in the ledger with the cashier and time.

## 6. Security

No access is widened. Every write goes through a SECURITY DEFINER function that checks the caller's business first and
answers "not found" otherwise; EXECUTE is for `authenticated` only. `debt_payments` is read-only to members (RLS),
written only by the functions and the insert trigger. The read functions are SECURITY INVOKER (RLS decides). Exports
keep `record_export_audit`'s rule. The debts guard closes a gap (any member could rewrite a hand-recorded debt's amounts
with no trace). Found while reading the live grants, not changed here: `anon` holds table grants on `debts` (RLS denies
it every row). Details in the migration header.

## 7. Tests

| Area | Tests |
|---|---|
| Migration (PGlite, live helpers) | `apps/carefind/src/test/debts/debtAccounts.db.test.js` (16): history and guard, delete/restore with payments, supplier accounts reconcile, account payments oldest first, customer account payments, import dry run / real / duplicates / phone match / payables, export audit types; shared fixture `debtsFixture.js` |
| POS stock | `pos/stockLimit.test.js`, `pos/POS.stock.test.jsx`, updated `POS.barcode.test.jsx` |
| Debts | `debts/debtImport.test.js`, `Debts.importExport.test.jsx`, `debtTotals.test.js`, `settleDebt.test.js`, updated `Debts.*.test.jsx` |
| Supplier summary | `purchases/supplierAccounts.test.js`, `SupplierAccounts.test.jsx` |
| Credit accounts | `pos/creditAccounts.test.js`, `CreditCollections.test.jsx` |

**Manual test plan after the migration is applied** (phone and desktop):

1. POS: add a product with 3 in stock four times; type 10; resume a held sale above the stock; charge is refused until
   "Set to available stock".
2. Debts › Receivables: record a debt of ₦10,000, pay ₦4,000 then ₦6,000; history shows both; bulk delete and restore
   it; history unchanged.
3. Import the receivables template with a known customer's phone in the +234 form, a new name twice, the same reference
   twice and a bad date; check the preview, import, re-import (all skipped), and the new customer in Clients once.
4. Purchases › Supplier summary: totals equal the sum of purchases plus supply records; add a supply record for an
   existing supplier typed in capitals; pay the account an amount covering one purchase and part of another; both
   purchases and their debts move; payment history shows one payment applied to 2 items.
5. POS › Credit: a customer with two credit sales shows one card; pay across both; View transactions ends at the
   card's balance.
6. Export each list as Excel and CSV as the Owner; a cashier without export permission sees no Export.
