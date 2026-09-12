# Point of Sale (POS) — Business Domain

## Purpose
The checkout/sales-transaction domain for every CareHub business type — cart building, discount application, split/credit payment handling, receipt generation, held sales, and same-day sales history. The primary revenue-recording surface of the product.

## Files
`apps/carehub/src/modules/pos/POS.jsx` (the module), `apps/carehub/src/modules/pos/receiptPrint.js` (HTML receipt builder), `apps/carehub/src/modules/pos/receiptEscpos.js` (raw ESC/POS encoder), `apps/carehub/src/modules/pos/escposUsb.js` (WebUSB transport), `apps/carehub/src/hooks/useToast.js` (feedback).
Legacy path `pages/dashboard/POS.jsx` was split into the feature module above.

## Components
Single large default-exported `POS` component with internal `view` state switching between `pos`/`held`/`recent`/`credit` sub-views, all in one file — no sub-component extraction. Shared primitives: `Card`, `Modal`, `Pill`, `GhostBtn`, `TealBtn`, `DarkBtn`, `Inp`, `Sel`, `Avatar`, `Toast`.

## Services
`apps/carehub/src/modules/pos/repositories/` (sales: `getToday`/`getAll`/`create` with localStorage offline queue `carehub_v1_offline_sales`; `is_on_hold`/`is_credit` domain), `apps/carehub/src/modules/settings/repositories/` (business settings: `tax_rate`, `receipt_width`, `receipt_header`/`footer`, `refund_policy`, `logo_url`), `apps/carehub/src/modules/debts/repositories/` (auto-created credit-sale debts). Cross-aggregate reads `getClients`/`getLatestConsultation` still via `services/supabase.js`.

## Receipt Printing

CareHub renders the same `{ receipt, business, settings }` object through two paths:

- **ESC/POS-first** (default when available): `receiptEscpos.js:buildReceiptEscpos` builds raw command bytes (ESC/POS, CP437-safe ASCII, `receipt_width` → 32/48 columns, manual centering, `GS V` cut); `escposUsb.js` writes them over WebUSB (class-code 7 printer interface, Chromium-only, HTTPS + user-gesture required; `navigator.usb.getDevices()` keeps paired printers after the first picker grant). On success the button shows "Sending… → Receipt printed" and no browser dialog appears.
- **Browser fallback**: `legacyPrint` path renders `receiptPrint.js:buildReceiptHtml` into a popup window and calls `window.print()`. Used immediately when WebUSB is unsupported (Firefox/Safari/iOS), when the user cancels the picker, or when connection fails before any bytes are sent. After a successful `transferOut` the fallback never fires (duplicate-receipt guard); mid-transfer failures surface as error toasts via `EscposTransferError.sent`.
- Both entry points — post-sale "Print receipt" and Recent Sales "Reprint" (which rebuilds the receipt object from the sale row — `JSON.parse(items)`, `payment_split`, `amount_paid`, `created_at`) — behave identically. The "Print receipt" / "Reprint" buttons disable and show "Sending…" during the transfer.

## Dependencies
`lib/utils.js` (`fmt`, `genId`, formatting), `components/ui/index.jsx`. Reads the `products` array as a prop from `BusinessDashboard.jsx` (Inventory domain) to build the sale screen — this is the domain's primary cross-domain dependency.

## Database Tables
`sales` (`id, business_id, txn_no, client_name, items` — a JSON-stringified blob of line items, not normalized rows — `subtotal, discount, total, payment_method, payment_split, amount_paid, balance, is_credit, is_on_hold, created_at`). Also writes to `debts` when a sale is underpaid.

## Current State
Cart, discount, split-payment, hold, and credit flows are all implemented and functional as a checkout experience, including an offline queue that stores a sale locally and replays it once connectivity returns. **The one critical gap**: on checkout, `products.stock` is decremented only in local React component state (`setProducts(prev => ...)`) — `updateProduct()` is never called, so the sale's effect on inventory is never persisted to the database (see `inventory.md`). Every underpaid or credit sale automatically creates a `debts` row via logic duplicated independently from `purchases.md`'s equivalent reconciliation code.

## Missing Documentation
No document specifies the intended contract between POS and Inventory regarding stock — nothing states whether POS was ever meant to write back to `products.stock` directly, or whether a separate reconciliation process (not found anywhere in the codebase) was intended to own that. No document describes the `items` JSON blob's schema, which every report/reconciliation feature that might need line-item detail would have to reverse-engineer from `POS.jsx`'s cart-building code, as this entry did.
