# Client Account: Summary, Ledger and Statements

Requested 2026-11-15 (item 8): a dedicated **Client Account** in each client's profile, separate from quotations, with
a financial summary, a chronological ledger, summary and detailed statements by date range (Excel and PDF), carried
forward from one period to the next, and captured automatically from existing transactions. Decided 2026-11-16: built
from the records the business already keeps; quotations, credit notes and account adjustments as new record types are
out of scope (CareHub has no quotations feature, so nothing proposed ever enters the ledger). No database change.

| Part | Where |
|---|---|
| Ledger, statements, summary (pure) | `apps/carehub/src/modules/clients/clientLedger.js` |
| Excel and print/PDF builders (pure) | `modules/clients/clientStatementExport.js` (the representative statement's pattern, ADR-Exports.md) |
| Records | `clientRepository.getAccountRecords`, `useClientAccount` (`hooks/queries.js`) |
| Screen | `modules/clients/components/ClientAccount.jsx`, the **Client Account** tab of the client profile (`Clients.jsx`) |

## 1. Where the entries come from

Everything linked to the client by `client_id`, read with the business's own access rules:

| Record | Ledger entry | Side |
|---|---|---|
| Completed sale | Sale · n items (`TXN-…`) | Debit: total |
| Payment at the sale, collection (`sale_payments` sale/collection) | Payment at sale / Payment received · method | Credit |
| Sale before the payments ledger (no rows) | Payment at sale: what the sale says was paid | Credit |
| Refund (`sale_payments` refund) | Return accepted · reason (credit) **and** Refund paid · method (debit) | Both |
| Opening balance (manual debt, `source_ref = 'opening_balance'`) | Opening balance: client owes us / we owe client | Debit / Credit |
| Debt recorded by hand, "owes us" | Debt recorded: description (`D-…`) | Debit |
| Credit to the client, "we owe" | Credit to client: description | Credit |
| Payment on a recorded debt | Payment on debt / opening balance | Credit |
| Payment to the client on a "we owe" debt | Paid to client | Debit |

**Not used:** held, resumed, converted and deleted sales; credit-sale debts (they mirror the sale's balance; counting
both would double it); payments of other sales. Payments on a sale count up to its total: anything beyond is change
(live 2026-11-16, TXN432747 has ₦65,500 of payment rows on a ₦63,500 sale, not a client's), as the sale's own
balance treats it. A refund leaves the balance where it was, as on the sale, because the money went back with the
goods. A payment recorded before payment history began (`before_history`) is dated on its debt.

Owner corrections (Edit sale) show the sale at its corrected value; the correction itself is in the sale's history.
Dates are business dates (Africa/Lagos).

## 2. Accounting

Debit increases what the client owes; credit (payments, returns, credit notes) reduces it. **Balance = debits −
credits**: positive is *Client owes us*, negative *We owe client* (available credit), zero *Settled*. On screen a
balance reads "₦3,000 owed" or "₦500 credit"; files use signed numbers with a note.

**Statements** for a period (`from`, `to`, either open): everything before `from` is the **opening balance brought
forward**, entries in the period carry a running balance, and the **closing balance carried forward** is the opening
balance of the next period (tested). Presets: All dates, This month, Last month, This year, or any From / To. A start
after the end is refused.

- **Summary statement:** opening balance, purchases, payments received, returns and credit notes, refunds paid to the
  client, opening balances recorded (when any), adjustments, closing balance. The lines add up to the closing balance.
- **Detailed statement:** date, reference, description, debit, credit, running balance, between the opening and
  closing rows (100 rows at a time on screen; the totals and files always cover the whole period).

**Financial summary** (all dates): total purchases, payments received, returns and credit notes, outstanding balance,
available credit, account status (with the number of open items), and refunds paid when any.

## 3. Kept in step with Debt Management

The account and the client's position (Clients list and profile, from the open debts) come from the same records, so
they agree; the account also checks it: if its closing balance and Debt Management's position for the client differ,
it says so (usually a sale or debt recorded under the client's name without being linked). Live on 2026-11-16, after
linking 3 old credit-sale debts to their sale's client (CODE_AUDIT A32), every client agrees by link (0 of 39 differ).

Every sale, payment, debt, client edit or import refreshes the account: its query key sits under the client list's
(`['clients', business, 'account', client]`). A credit collection at the till now also refreshes debts and clients
(`useRecordSalePayment`), which it did not before.

## 4. Exports and access

- **Excel**: Summary sheet (header, position, summary lines) and, for the detailed view, a Transactions sheet with
  opening and closing rows. Text cells are neutralised against spreadsheet formulas.
- **PDF / Print**: a print-ready statement (business, client, period, position, summary, transactions) saved as PDF
  by the browser.
- Anyone who can open Clients sees the account (the profile already shows the client's sales and balances). Download
  and print: the Owner or `canExportReports`, as the credit-accounts export. Like the representative statement, a
  single client's statement is not written to the export audit (bulk lists are).

## 5. Tests

| Area | Tests |
|---|---|
| Ledger rules, ordering, exclusions, reconciliation with the sales' balances, carry-forward, summary lines, summary | `modules/clients/clientLedger.test.js` (12) |
| Excel and HTML builders (escaping, rows, balances) | `modules/clients/clientStatementExport.test.js` (4) |
| Records read (scoping, chunking) | `modules/clients/repositories/index.test.js` |
| Screen: summary, periods and carry-forward, summary view, export gate, Debt Management check, empty / failed / invalid period | `modules/clients/Clients.account.test.jsx` (7) |

**Manual test plan** (phone and desktop):

1. A client with a credit sale part paid, a collection at POS › Credit, a refunded return and an opening balance:
   open Client Account; the summary adds up; the detailed statement ends at the outstanding balance shown on the
   Clients card.
2. Last month, then This month: this month opens at last month's closing balance.
3. Collect a payment at the till with the account open in another tab; reopen: the payment is there.
4. Export Excel and PDF in both views as the Owner; a cashier sees no export buttons.
5. Phone width: the summary wraps to one column; the detailed table scrolls sideways inside its box.
