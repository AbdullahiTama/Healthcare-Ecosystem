# Supplier List: Contact Details, Import and Export

Requested 2026-11-15: bulk supplier import and export with an Excel template, validation of incomplete and duplicate
entries, and export of the existing supplier list. Built on the Supplier summary
([Debt-Accounts-and-POS-Stock-Limits.md](Debt-Accounts-and-POS-Stock-Limits.md) §3), which already had supplier
accounts and an import of balances.

| Part | Where |
|---|---|
| Table `suppliers` | `supabase/migrations/carehub_20270119_supplier_directory.sql` (applied 2026-11-15, version 20261115224942) |
| Template, file reading, validation, merge, form rules (pure) | `apps/carehub/src/modules/purchases/supplierDirectory.js` |
| Data access | `purchaseRepository.getSuppliers / createSuppliers / updateSupplier` |
| Hooks | `useSuppliers`, `useUpdateSupplier` (`hooks/queries.js`) |
| Import dialog | `modules/purchases/components/SupplierImportModal.jsx` |
| Screen | `modules/purchases/SupplierAccounts.jsx` (Purchases › Supplier summary) |

## 1. Data model

Before this, a supplier was only the name typed on its purchases and "we owe" debts, grouped by `lower(btrim(name))`.
`suppliers` adds one row per supplier per business with `name`, `contact_person`, `phone`, `email`, `address`, `notes`.

- **Key.** `supplier_key` is generated as `lower(btrim(name))`, the key purchases and supplier accounts already use, and
  is unique per business. A record attaches to the supplier's existing purchases and supply records **by name**:
  nothing is re-keyed or copied, and a supplier with purchases but no record keeps working exactly as before.
- **Names.** Stored tidy (spaces collapsed). An edit may change only capitals or spacing; a different name would detach
  the record from its purchases, so the database refuses it (`suppliers_guard`). Renaming a supplier across its
  purchases is out of scope.
- **No delete.** Not requested, and a record holds only contact details; removing one would lose them without trace.

## 2. Screen (Purchases › Supplier summary)

- Each account shows the contact person and phone under the name; search matches name, contact person, phone, email
  and address.
- Suppliers added to the list before any purchase appear with ₦0 and "Nothing supplied yet".
- **Add supplier** (toolbar) and, in a supplier's account, **Edit details** / **Add details** (for a supplier known only
  from purchases: the record is created under its existing name, which is not editable there). The account closes while
  the form is open and reopens after (one dialog at a time).
- **Import** asks what is being imported: **Supplier list** (contact details, this note) or **Opening balances and
  payments** (the existing Payables import).
- **Export** (Owner or `canExportReports`) adds Contact Person, Phone Number, Email, Address and Notes to the existing
  columns and includes suppliers with nothing supplied. Still audited as `supplier_accounts.xlsx|csv` (cost data).
- If contact details fail to load, a notice with Retry is shown and balances and payments stay usable; Add supplier and
  the list import are hidden until they load. Before the migration is applied, the screen is exactly as it was.

## 3. Import

Template: **Excel** (Suppliers sheet with two example rows, text-formatted so leading zeros stay, plus an Instructions
sheet) or **CSV**. Columns are matched by header in any order, with common alternative names (Vendor, Mobile…).
Up to 2,000 rows and 5 MB.

The preview checks every row before anything is saved:

| Row | Status | Saved |
|---|---|---|
| New name, valid | **New** (may carry warnings) | Yes |
| Name already in the list | **Already in your list** | No, unless *Fill in missing details* is ticked: then **Adds details** fills only that record's blank fields, never overwrites |
| Same name as an earlier row (any capitals or spacing) | **Repeated in file** | No (the first row is used) |
| Missing name, invalid phone or email, value too long | **Needs fixing** | No |

Warnings on new rows: **Incomplete** (no phone and no email; still imported), **Has purchases already** (the record
attaches to that account), **Did you mean …?** (a near spelling of a known supplier, which would be a separate
supplier). Tabs filter All rows / Needs attention / Ready.

Saving inserts with `on_conflict=(business_id, supplier_key)` and *ignore duplicates*, in batches of 200: a name added
by someone else meanwhile is skipped and counted, never duplicated or overwritten; a failed batch is reported by name
and the rest continue. Retrying is safe.

## 4. Security

- RLS: members of the business (`current_business_ids()`, as for purchases and debts) read, add and edit; platform
  admins read. Other businesses and `anon` see nothing.
- Grants: `authenticated` SELECT, INSERT, UPDATE; no DELETE or TRUNCATE. The trigger function has no EXECUTE for
  clients (a trigger fires regardless; tested with the live grants).
- Any member can edit contact details, the same as client records. Contact details are not cost data; the export keeps
  its existing audit and permission.

## 5. Tests

| Area | Tests |
|---|---|
| Table, RLS, grants, guard (PGlite, live helpers and function grants) | `apps/carefind/src/test/purchases/supplierDirectory.db.test.js` (10) |
| Template, reading, validation, merge, search, form rules | `modules/purchases/supplierDirectory.test.js` (12) |
| Repository | `modules/purchases/repositories/index.test.js` (supplier list, 3) |
| Screen and import dialog | `modules/purchases/SupplierAccounts.directory.test.jsx` (9) |

**Manual test plan** (phone and desktop):

1. Supplier summary › Import › Supplier list › Excel template; fill 5 rows including a supplier you already buy from
   (typed in capitals), the same name twice, one with no phone or email, one with a bad email. Check the preview
   counts and tabs; import; the new suppliers appear with ₦0, the existing one shows its phone.
2. Upload the same file again: every row is *Already in your list*. Tick *Fill in missing details* on a row with a new
   email: only that blank field is filled.
3. Open a supplier › Edit details: change the phone (saved), try a different name (refused), change only capitals
   (saved; its purchases are still on the account).
4. Export as Excel and CSV as the Owner: contact columns present, suppliers with nothing supplied included. As a cashier
   without export permission: no Export.
5. Phone width: toolbar wraps, the preview list scrolls, the forms are one column.
