# Client Position (Client Owes Us / We Owe Client) and Opening Balances

Requested 2026-11-15 (items 4 and 5): show whether a client owes the business or the business owes the client, kept in
step with Debt Management; and accept opening balances in the client upload, recorded as opening entries rather than
sales or payments.

| Part | Where |
|---|---|
| Position (pure) | `clientPositions`, `positionOf`, `describePosition` in `apps/carehub/src/modules/clients/clientFilters.js` |
| Upload with opening balances (pure + save step) | `modules/clients/clientImport.js` |
| Upload dialog | `modules/clients/components/ClientImportModal.jsx` (replaces the inline CSV upload in `Clients.jsx`) |
| Profile panel and Add opening balance | `modules/clients/components/ClientPosition.jsx` |
| Database | `supabase/migrations/carehub_20270120_client_opening_balances.sql` |

## 1. One source of truth: the client's debts

There is no separate client balance to keep in step. A client's position is read from the **open debts** Debt
Management shows:

- **Client owes us**: open `owes_us` debts of the client: credit sales (moved by the till: payments, refunds, Owner
  corrections), debts recorded by hand, and an opening balance. A debt without a client link counts when its name
  matches exactly one client (the till's rule).
- **We owe client**: open `we_owe` debts **linked** to the client (an opening balance in their favour). Never matched
  by name: a supplier may share a client's name.
- **Net** = owes − credit: positive reads *Client owes us ₦X*, negative *We owe client ₦X*, zero *Settled*. When both
  parts are open the profile shows them ("Owes us ₦4,000 · we owe them ₦1,000").

Because every screen reads the same debts, a credit sale, a payment at the till or on Debts, a refund or an Owner
correction changes the position everywhere at once (Clients list, profile, totals, filter, export, Debts).

**Clients screen:** each client card shows its position; the totals show *Clients owe us* and, when any, *We owe
clients*; the filter is *Account position* (Client owes us / We owe client / Settled); the CSV export has Client Owes
Us, We Owe Client and Position columns. If open debts cannot be read the page says so instead of showing ₦0.

## 2. Opening balances

An opening balance is what a client owed, or was owed, before CareHub. It is an **opening entry**, never a sale or a
payment: a hand-recorded debt linked to the client:

| Field | Value |
|---|---|
| `direction` | `owes_us` (Client Owes Us) or `we_owe` (We Owe Client) |
| `client_id`, `party_name` | the client |
| `source` / `source_ref` | `manual` / `opening_balance` |
| `amount`, `balance` | the balance; `amount_paid` 0 |
| `created_at` | the opening balance date |
| `description` | Opening balance |

`source = 'manual'` keeps the database's existing rules for hand-recorded debts: amounts checked and balance/status
derived on insert, amounts editable only through Record payment, payment history. It shows on Debts (Receivables or
Payables, with the client badge) and is paid there like any recorded debt.

**One per client**: the partial unique index `debts_one_opening_balance_per_client`. A file uploaded twice, or an
opening balance added on the profile after an import, is reported as "already has an opening balance", never recorded
twice.

**Who:** the Owner or a manager, the roles that record debts (Debts page). Other roles can upload clients; their
file's opening balances are skipped with a note. (The database allows members to insert debts, as Record Debt always
has; the role check is in the app.)

### Upload template

Excel (Clients sheet, text cells so phone numbers keep their leading 0, a Balance Type drop-down, and an Instructions
sheet) or CSV:

`Client Name *` · `Phone Number *` · `Address` · `Opening Balance` · `Balance Type` · `Opening Balance Date` · `Email` ·
`Gender` · `Date of Birth` · `Notes`

The previous template (First Name, Last Name, Phone…) is still read. Excel files are now read properly (the old upload
read every file as text).

**Checks** (preview, before anything is saved): name and phone required (7 to 15 digits); email, gender, date of birth;
an opening balance needs a valid amount, Balance Type (Client Owes Us / We Owe Client; also "owes us", "receivable",
"DR", "we owe", "credit", "advance"…) and a date not in the future. Rows are **New**, **Already in your list** (matched
by phone digits, as the database's unique index; an opening balance on the row goes to that client), **Repeated in
file** (only the first row with a phone is used) or **Needs fixing**. Totals of opening balances in each direction are
shown before importing.

**Saving:** new clients first (a phone added meanwhile is skipped, with its opening balance; uploading again adds it),
then the opening balances, one by one, each reported.

## 3. Database (carehub_20270120_client_opening_balances)

1. `get_supplier_accounts`, `get_supplier_activity` and `record_supplier_payment` treated every manual `we_owe` debt
   as a supplier's supply record, so a "We owe client" balance would have appeared as a supplier named after the
   client and could have received a supplier payment. Each now also requires `client_id IS NULL`. The edit is applied to
   the live definitions with a check of the expected number of predicates (1, 2, 3); the migration aborts on any
   mismatch or if run twice. The app's supplier suggestions (`knownSuppliers`) skip client-linked debts too.
   `import_debts` is unchanged (its supplier lookup only reuses an existing spelling).
2. The unique index above.

No access is widened; the functions keep their signatures, security settings and grants.

## 4. Tests

| Area | Tests |
|---|---|
| Migration (PGlite over carehub_20270117, live helpers) | `apps/carefind/src/test/debts/clientOpeningBalances.db.test.js` (8: reproduces the supplier leak first) |
| Position rules | `modules/clients/clientFilters.test.js` |
| Upload rules and save step | `modules/clients/clientImport.test.js` (8) |
| Clients list totals, badges and filter | `modules/clients/Clients.filters.test.jsx` |
| Upload dialog | `modules/clients/Clients.import.test.jsx` (6) |
| Profile position and Add opening balance | `modules/clients/Clients.position.test.jsx` (5) |
| Supplier suggestions skip client balances | `modules/debts/debtParty.test.js` |

The debts migration fixture (`debtsFixture.js`) now provides `createDebtsDb()`, shared by both debts migration tests.

**Manual test plan** (phone and desktop):

1. Download the Excel template; fill a new client owing ₦15,000, one we owe ₦5,000, an existing client (phone written
   differently) with ₦2,000, a repeated phone and a wrong Balance Type. Check the preview counts, totals and tabs;
   import.
2. Clients: the cards show *Client owes us ₦15,000* and *We owe client ₦5,000*; totals; filter by each position;
   export.
3. Debts: the opening balances are under Receivables and Payables with the client badge; Purchases › Supplier summary
   does **not** list the client we owe.
4. Record a part payment on the ₦15,000 opening balance in Debts; the client's position drops by that amount.
5. Make a credit sale to a client we owe ₦5,000: the profile shows both parts and the net.
6. Upload the same file again: every opening balance is reported as already recorded.
7. As a cashier: Upload clients works, opening balances are skipped with the note; no Add opening balance on profiles.
