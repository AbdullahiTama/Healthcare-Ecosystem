# Purchases: bulk stock entry and drafts that survive a reload

2026-10-30. Client only, no database change.

Follow-up (2026-10-31): editing, central history and analytics, the supplier picker and barcodes are in `Purchases-Editing-and-Analytics.md`; the form described here is now `PurchaseForm.jsx`, shared by Record and Edit.

## Why

A pharmacy reported, after a morning of real use:

1. Entering stock for many products in Record Purchase was slow and difficult.
2. Picking an existing product filled in nothing; they wanted its details to appear so only what changed (quantity, price, dates) needs editing.
3. After stepping away, the page reloaded and everything typed was gone.

Root causes, from the code:

| Symptom | Cause |
|---|---|
| Work lost | The form lived only in React state. A tap on the dimmed backdrop (or Escape) closed the sheet and reset it. Phones and installed PWAs discard background tabs, and the page reloads from scratch when the user returns; CareHub has no `location.reload()` or `visibilitychange` handler, so that reload is the browser. Only persisting the draft defends against it. |
| Picking filled nothing | The product field was a bare datalist; every other field had a placeholder and no label, so even prefilled values would have been unreadable. |
| Bulk entry error prone | A started line missing a quantity or unit cost was dropped silently and the toast still said "Purchase recorded". Two lines of the same product were merged into one stock batch that kept only the first line's batch and expiry. A line that failed to reach Inventory was only logged. |
| Permission gap | A role without `canEditPrice` (Manager, Pharmacist presets) could reprice an existing product by typing a selling price on a purchase line. |

Pharmacies reach stock entry through Purchases; `Stock & Batches` is gated to the enterprise verticals.

## What changed

- **Drafts** (`apps/carehub/src/hooks/usePersistentDraft.js`): the Record Purchase form, and whether it was open, is mirrored to `localStorage` as it is typed, under `carehub_draft_purchase_<businessId>_<staffId|owner>`. A reloaded tab reopens the sheet where it was ("Picked up where you left off"). Tapping outside no longer closes it; **Close** keeps the draft and a banner offers Resume or Discard; Discard is confirmed. The draft is removed on save or discard and expires after seven days (the ADR draft backup's period). Every storage call is guarded, so private mode or a full quota only loses persistence, never the form.
- **Prefill** (`apps/carehub/src/modules/purchases/lineItems.js`): picking a product from the list, or scanning its barcode into the field, links the line and fills unit cost, selling price and category, and shows generic name and stock now and after saving. Matching is an exact normalised name or exact barcode, never generic name ("Paracetamol" must not restock "Panadol"). Quantity, batch and expiry stay for the user: they describe this delivery, and a carried over expiry date on a medicine is a safety risk if nobody notices it. Lines typed before the catalogue loaded are linked when it arrives.
- **Fast entry**: every field is labelled; focus jumps to Quantity after a pick; Enter moves product, quantity, next line, adding a line at the end; "Add another item" sits under the list.
- **Validation**: a started line missing a name, a whole number quantity or a unit cost blocks the save, is outlined, and the toast names the lines. Fully blank lines are ignored. An expiry already in the past shows a warning.
- **Save**: lines are grouped by product so a new product is created once and cost and price are written once; then every line is received through the stock ledger (`receive_stock`, since 2026-10-30): one `purchase_receipt` movement per line keyed to the purchase and line, its batch created in the same transaction. New products are created empty and receive their units the same way, so the ledger shows them as this purchase rather than opening stock. A product tracked by batch needs a batch number (and an expiry when tracked by expiry) before anything is saved. Inventory failures are named in the toast. A selling price on an existing product is read only without `canEditPrice` and ignored by the save, the same rule Inventory's Edit form enforces; new products can still be priced. Everything main already had is unchanged: paging, supplier payments, plan restrictions, invoice line items, shared catalogue updates, saving disabled until products load.

## Security

- Drafts hold supplier names, products and prices on the device, the same class of data as the offline product cache and offline sale queue already stored there. They are per business and per staff member, so a shared till never shows one person's draft to another.
- Drafts deliberately survive logout, unlike `modules/adr/draftBackup.js` (patient data, cleared at logout): a forced sign out is exactly when a half entered delivery must not be lost.
- Closes the `canEditPrice` bypass described above. No change to authentication, RLS or any server object.

## Tests

- `apps/carehub/src/hooks/__tests__/usePersistentDraft.test.jsx`: restore after remount, empty draft removed, key switch isolation, corrupt or foreign version ignored, expiry, storage that throws.
- `apps/carehub/src/modules/purchases/__tests__/lineItems.test.js`: matching, prefill, validation, grouping with one batch per line.
- `apps/carehub/src/modules/purchases/__tests__/Purchases.test.jsx`: pick prefills and focuses Quantity; draft survives a remount and reopens; backdrop tap ignored; incomplete line blocks the save; two batches of one product give one increment and two batch rows; price read only without permission; saving waits for the catalogue.
- Mutation checked (backdrop close, reprice gate). Real Chromium at 390px and 1280px against stubbed repositories, including a real page reload.
