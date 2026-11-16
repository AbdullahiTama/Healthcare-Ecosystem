# Edit Client and Current Client Names

Requested 2026-11-15: authorised users edit a client's name, phone number and address; the change shows wherever the
client appears (including the POS and Debt Management) without altering past transactions, payments, account entries
or financial history. No database change was needed.

| Part | Where |
|---|---|
| Edit rules (pure) | `apps/carehub/src/modules/clients/clientEdit.js` |
| Edit dialog | `modules/clients/components/ClientEditModal.jsx`, opened from the client's profile (`Clients.jsx`) |
| Save | `clientRepository.update` (tenant-scoped PATCH, returns the row) and `useUpdateClient` (`hooks/queries.js`) |
| Current names on linked records | `apps/carehub/src/lib/clientNames.js` |

## 1. Editing

- **Where:** a client's profile (Clients › click a client) › **Edit**. The profile closes while the dialog is open
  (one dialog at a time) and reopens with the saved details.
- **Who:** anyone who can open Clients, which is the same rule as Add Client and bulk edit. There is no separate
  permission; adding one would be a new role setting (owner decision).
- **Fields:** full name and phone (required), email, address, gender, date of birth, notes. Only changed fields are
  sent. The business is never sent.
- **Visits and total spent** are kept from sales. Only the Owner, or staff whose role has **Adjust client visits and
  total spent** (Staff › Roles, `canAdjustClientTotals`), see and can correct them here; the client's next sale
  recalculates both. The database enforces this (`carehub_20270122_client_totals_guard`, CODE_AUDIT A30).
- **Checks:** name required; phone 7 to 15 digits and not used by another client of the business (compared by digits,
  exactly like the database's `clients_phone_unique_per_business`); email format; date of birth valid and not in the
  future; gender one of Male / Female / Other; address 300 and notes 2,000 characters at most. A duplicate phone the
  database refuses anyway (added meanwhile) is shown on the phone field; any other failure keeps the dialog and its
  values. Save is disabled until something changed.
- The saved row goes into the shared client list at once, so every screen reading it (POS customer picker, credit
  accounts, Debts, reports) has the new details without a reload.

## 2. Past records are not rewritten

Sales keep `client_name` and debts keep `party_name` as saved; receipts and the audit trail depend on that. They stay
linked by `client_id`, and screens show the **current** name through `withCurrentClientNames` (a view copy; never
written back), with **Recorded as …** where the saved name differs:

| Screen | Shows current name | "Recorded as" |
|---|---|---|
| Debts list, search, sort, export, bulk-delete names, payment dialog | Yes | Under the name; in the debt detail |
| POS › Held and Recent, sale detail | Yes | Sale detail ("Recorded on the sale as") |
| POS › Credit accounts | Already used the client record | n/a |
| POS › Sales report (rows, customer filter, search, export, detail) | Yes | Sale detail |
| Reports › transactions list, search and CSV | Yes | Sale detail |
| Dashboard recent sales and credit due | Yes | Sale detail |
| **Reprinted receipt** | **No: the recorded name** (a copy of the original document) | n/a |

An unlinked record (a walk-in, or a name typed without picking a client) keeps its saved name everywhere.

## 3. Defect fixed: resuming a held sale lost its client

Resuming a held sale restored only the customer's **name**; at checkout the POS found the client by an exact name
match (`creditCustomerFor`). A client renamed since the sale was held, or sharing a name with another client, was
charged without (or to the wrong) client record, and a credit sale on it was refused for having no customer.
`openHeld` now re-picks the client by the sale's `client_id` under their current name (or, when the client list has
not loaded, by that id under the saved name). Pinned by `POS.held.test.jsx` "Held sales linked to a client"; the
same-name case fails on the previous code.

## 4. Security

No access changes. The edit is the existing members-only `clients` policy (`current_business_ids()`), filtered by
business as well as id; nothing matched is reported, not shown as saved. Found while reading the live grants, not
fixed since (CODE_AUDIT A30, 2026-11-16): `visit_count` and `total_spend` change only for the Owner, staff given
access, or the database's recalculation; `anon` has no privileges on `clients`.

## 5. Tests

| Area | Tests |
|---|---|
| Edit rules | `modules/clients/clientEdit.test.js` (6) |
| Current names | `lib/clientNames.test.js` (4) |
| Clients screen: edit, duplicate phone (before and from the database), failure, cancel | `modules/clients/Clients.edit.test.jsx` (5) |
| Repository: returns the row, refuses another business's client | `modules/clients/repositories/index.test.js` |
| POS held sales after a rename and with a shared name | `modules/pos/POS.held.test.jsx` (3) |
| Debts under the current name, search, record untouched | `modules/debts/Debts.linking.test.jsx` (1) |

**Manual test plan** (phone and desktop):

1. Open a client with a credit sale, a held sale and a hand-recorded debt. Edit name, phone and address; the profile
   shows them; the toast lists what changed.
2. POS › Held: the held sale shows the new name; open and charge it; the sale is on the client's history.
3. POS › Recent and Sales report: the client's earlier sale shows the new name; its detail shows "Recorded on the sale
   as" the old one; Reprint prints the old one.
4. Debts: the debt shows the new name with "Recorded as"; searching the new name finds it; export shows the new name.
5. Try another client's phone number (refused on the field), an invalid email, a future date of birth.
