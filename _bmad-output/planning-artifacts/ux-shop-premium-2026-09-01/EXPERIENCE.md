---
status: final
date: 2026-09-01
type: experience
workspace: _bmad-output/planning-artifacts/ux-shop-premium-2026-09-01
project: HealthCare-Ecosystem
feature: Shop — Premium E-commerce
design_ref: ./DESIGN.md
---

# Shop — EXPERIENCE.md
> How it works, for CareFind (customer) + CareHub (vendor/ops). Visuals in `DESIGN.md`.

## Foundation
* **Form-factor:** Mobile-first (375), tablet (768), desktop (1280) — `packages/design-system` + `theme.js`. `Shop` is a *tab inside MedMarket* (`apps/carefind/src/modules/healthcare-discovery/Search.jsx:413`), not a standalone app; desktop uses `AppShell` (`Search.jsx:593`), mobile uses `BottomNav`.
* **UI system:** Shared shadcn-ish tokens + lucide; no new library. Tokens referenced as `{colors.primary} /* #0E6F5A */` etc.
* **Principles:** Inventory is source of truth (A10); public visibility requires `Approved + Active + image + in-stock + !restricted` (A4.4, RLS `is_ecommerce_vendor_approved`); fees are part of the product (B24) — never a surprise at the end.

## Information Architecture
* **MedMarket → Shop** `Search.jsx:249 CATEGORY_TABS[3]=Shop` deep-link `?tab=shop`. Inside Shop: `Sale-type pills (All/Retail/Wholesale/Distributor) → Featured horizontal → Catalog grid (≥2/row) → Detail → Cart → Checkout → Orders`.
* **CareHub Ecosystem→E-commerce** `getNavItems: ecommerce` `lib/permissions.js:242` — *Application* → *Inventory→E-commerce* (search+status filter+Missing) → *Orders inbox* (ref/customer/product search, status filter, detail + history + message) → *Setup modal* (description/category/price/Rx/warnings/restrictions/is_restricted + ordered images).
* **Admin → Shop** (`AdminPanel.jsx: shop`) — Applications (Approve/Reject/Suspend), Products (Restrict/Pause), Recent `shop_orders`.

## Voice and Tone
* Calm pharmacist: “Ask for price”, “Out of stock”, “Prescription required ⚠️”, `PENDING (quoted within 24h)`, `MAX(₦600, 3%)`. Never “Deals!!!” or bazaar caps. Commission line: “Commission {10|5|2.5}% deducted from vendor payout” — vendor-facing. Customer-facing: “Fulfilment MAX…”

## Component Patterns (behavioral)
* **Shop grid:** `getActiveProducts({segment, query, limit:50})` → server `status=Active && !is_restricted` + `is_ecommerce_vendor_approved` (RLS), client `sale_type` filter (retail default for untagged legacy) + `primary_image_url` batch (`shopRepository.js:45`). Cards `role=listitem`link to `/shop/:id`.
* **Detail gallery:** swipe `touchStartX diff>50` + chevrons + dots `aria-current` + `1/N` (`ProductDetail.jsx:44`). Blocks if `is_restricted` or `stock<=0`.
* **Checkout delivery:** `APPROVED_CITIES` check on city/state; `pickup → station select` (required, `shop_pickup_stations is_active`); `home + approved → MAX bracket` `₦600*ceil((km-3)/3)`; `home + !approved → PENDING` **B27 Step 3B** copy + `Quote Delivery` vendor action. `segment` lifted from cart `sale_type/qty` (distributor `cartonCount=totalQty` → `FULFILMENT_RATES.distributor min 350*cartons`). `Maps TODO` placeholder noted.
* **Cart:** `CartProvider` `localStorage carefind_cart`, `sale_type` preserved for segment, quantity ±, remove, subtotal `₦total`.
* **Orders:** `shop_orders` `order_ref CF-…`, `status in (pending_payment, delivery_quote_pending, paid, accepted, processing, ready_for_pickup, in_transit, delivered, cancelled, …)`. Customer `Verify Paystack (simulate)` → `rpc/verify_shop_payment`, `Cancel → rpc/cancel_shop_order` restores `products.stock`.

## State Patterns
* **Loading:** Shop `6 skeleton cards 180h gray100`; Detail `Loading product…`; Orders `Loading…`.
* **Empty:** Shop `Empty Browse Shop` when no Active; Detail `Empty Back to Shop`; Cart `Empty Continue Shopping → /search?tab=shop` with `sale_type` preserved; Checkout `Empty` guards `items.length===0`.
* **Error:** `role=alert dangerBg retry`; `price mismatch → PRICE_CHANGED` re-check cart; `stock → INSUFFICIENT_STOCK`; `vendor not approved`.
* **Restricted/Paused/OutOfStock:** card filtered or badge; Detail disabled ATC `Out of Stock` gray; `is_restricted` blocks `activate`.

## Interaction Primitives
* Filters: `aria-pressed` pills, `onClick → setSaleTypeFilter` (server-effect via `useEffect` on `[segment, query]`). Address form: required `street/city/state + phone≥10 + email@`, station required for pickup, mobile `44h` targets. Messages: `rpc/shop_add_message` (server derives `auth.uid()` + role). Image reorder: 2-phase `position 1000+i → i` to avoid `UNIQUE(pos)` violation.

## Accessibility Floor
* `role=list / listitem`, `aria-label Featured products / Shop catalog / gallery, image k of n / aria-live polite`, `aria-current` dots, `aria-label Previous/Next/Go to image k / Back to Shop`. All state uses icon+text + tint, never tint alone. Tab order: filters → featured → grid.

## Responsive & Platform
* Shop `isMobile ? flex col gap 8 : grid auto-fill minmax(340px,1fr)` for MedMarket result cards; Shop grid `minmax 160px` ensures 2/row from 340px up (e.g. 375 → 2, 768 → 4, 1280 → ~7). Detail `maxW 720 centered`. Vendor E-commerce scales at `375/768/1280` per audit. Touch swipe 50px threshold; keyboard chevrons.

## Key Flows
**Amina (23, Lagos Yaba, retail refill):** lands `/search?tab=shop` → `Retail` pill → taps `Vitamin` (card `thumb/name/₦`) → swipes `2/5` gallery → sees `Rx not required`, `Warnings` → `Add to Cart 1` → `/cart` → `/checkout` → fills `Yaba, Lagos, 080...` (approved) → picks `Pickup from Station → Yaba Hub` → sees `Subtotal ₦3,500 + Fulfilment MAX(600,3%) ₦600 + Delivery FREE = ₦4,100` **climax: total matches B26 Example 1** → `Place Order CF-000001` → vendor gets `staff_notifications + notifications` → vendor `Accepted→Processing→Ready` → Amina `SMS ready at Yaba Hub` → pickup FREE.

**Chidi (Lekki, 8km, antibiotic):** same → `home` → enters `5` km? actually `8` → `Delivery ₦1,200 (7–9 bracket)` → `Total ₦11,800` (**B26 Ex 2**). Cross-city Ibadan: `is_approved_city=false` → `FULFILMENT only + Delivery PENDING` → `Proceed to Pay for Products Now` → order `delivery_quote_pending` → ops `Quote Delivery ₦…` → moves to `pending_payment`.

**Vendor Hadiza (CareHub Owner):** `Ecosystem→E-commerce` → `Not Applied → Submit` (terms+phone) → `Submitted` → Admin `Approved` → `Inventory: Paracetamol stock 5 → Setup description 10+ chars + category medicine + ₦ price + Rx false + warnings + 2 photos` → `Activate` → `Active` pill → `Orders` sees `CF-000007 pending_payment` → opens, checks `price snapshot vs inventory price`, `Accepts`, vendor chat `Ready at Yaba` → customer `Delivered`.

## Open Questions
* `APPROVED_CITIES` canonical list + warehouse `lat/lng → distance` via Maps (currently manual `distanceKm` input).
* Distributor `cartonCount` vs `quantity` semantics for `is_restricted` devices.
* Admin shop tab needs `service_role` verify via `callAdminAuth` (already service_role RLS) — confirm with ops.

## Traceability
* A5.2 Shop tab 4th, A5.3 grid 2/row, A5.4 gallery + dots + counter, A4.3 ordered `ecommerce_product_images`, A10 `SELECT … FOR UPDATE` in `create_shop_order`, A11 price snapshot, A12 `Rx/warnings/restrictions/is_restricted`, A13 `order_ref/shop_order_status_history`, A6.1 delivery fields + station, B24–B27 fees + brackets + quote-pending — all live in `shopRepository/Checkout/orderRepository/Ecommerce`.
