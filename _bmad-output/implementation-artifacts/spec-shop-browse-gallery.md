---
title: 'Shop Browse — MedMarket Shop Tab and Product Gallery'
type: 'feature'
created: '2026-08-30'
status: 'done'
baseline_commit: 'b46d012'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** CareFind MedMarket shows Products/Health Facilities/Professionals but no Shop; even when a vendor activates a product, customers cannot browse a proper catalog or swipe through multi-photo galleries, so activation has no consumer surface.

**Approach:** Add MedMarket 4th tab `Shop` (Products/Health Facilities/Professionals/Shop) surfaced at `src/modules/healthcare-discovery`, render Shop as professional catalog: horizontal featured row + vertical 2-per-row grid (photo/name/price per card, Amazon 2-per-row reference), and product detail with swipeable multi-photo gallery (dots/counter) sourced from `ecommerce_product_images` ordered set, with correct segment unit (Retail single, Wholesale box, Distributor carton) and price snapshot.

## Boundaries & Constraints

**Always:** Shop tab shows only `ecommerce_products.status=Active` where `ecommerce_applications.status=Approved` and `products.stock>0` and not `Restricted`; respect `segment` filter (Retail/Wholesale/Distributor) already used in MedMarket. Reuse `ecommerce_product_images` ordered by `position` for gallery; never show vendor as social tag (A5). Every write still verifies ownership; public reads are `is_active`/`Available` only. Loading/error/empty/responsive (375/768/1280)/a11y (tab `role="tablist"`, gallery `aria-label`, keyboard swipe) on every screen.

**Ask First:** If `ecommerce_products` has no `segment` column yet, derive segment from `business_type` or `product` category vs adding column.

**Never:** Publish `Not Activated`/`Incomplete`/`Paused`/`Restricted`/`Out of Stock` in Shop. Don't duplicate `products` table for Shop; Shop is a view over `ecommerce_products` + `products` + `ecommerce_product_images`. Don't show vendor tag in public listing (internal for order routing only).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| MedMarket tabs | Any user opens MedMarket | Tabs `Products`/`Health Facilities`/`Professionals`/`Shop` — Shop is 4th | 404 if direct `/shop` without tab param still shows Shop |
| Shop browse empty | No Active products | Featured row hidden, grid empty state `No products in Shop yet` | Show empty, not error |
| Shop browse with products | Active products exist | Featured row (horizontal scroll, e.g. 6) + grid `2-per-row` vertical, each card photo/name/price | Loading skeleton, error retry |
| Filter by segment | User picks Retail/Wholesale/Distributor | Grid shows only that segment's products | Empty state if none for segment |
| Product detail gallery | Customer taps card | Detail page with swipeable gallery of all `ecommerce_product_images` ordered, dots/counter `2/5`, name/price/description/category/warnings + Add to Cart (disabled, Goal 3) | If 1 image, hide dots, still show; if 0 images (should not happen for Active), show placeholder |
| Restricted/out of stock | Product becomes Restricted or stock 0 | Immediately not in Shop query, detail shows `Not available` | Not purchasable |
| Keyboard/a11y | Tab, arrow, swipe | Tabs keyboard navigable, gallery left/right arrows, swipe, dots clickable | Focus trap not needed (page, not modal) |

</frozen-after-approval>

## Code Map

- `apps/carefind/src/modules/healthcare-discovery/Search.jsx:1` -- MedMarket with 3 tabs (Products/Health Facilities/Professionals); add 4th `Shop` tab and `?tab=shop` handling, segment filter already there.
- `apps/carehub/src/modules/ecommerce/repositories/index.js:45` -- `getInventoryWithStatus` pattern for joining `products` + `ecommerce_products`; Shop will query `ecommerce_products`+`ecommerce_product_images` similarly but public (anon) with `status=Active` + stock>0.
- `apps/carefind/src/modules/business-profiles-reviews/BusinessProfile.jsx:172` -- Product detail gallery reference (single image vs swipeable); reuse gallery component for Shop detail.
- `apps/carehub/sql/20260830_ecommerce_foundation.sql:1` -- `ecommerce_products`/`ecommerce_product_images` with `position` ordered; Shop reads `Active` + `ecommerce_product_images` ordered.
- `apps/carefind/src/components/ui/index.jsx:1` -- Card, Pill, Empty, Loading, useToast — reuse for Shop cards, featured row, gallery.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/carefind/src/modules/healthcare-discovery/Search.jsx` -- Add 4th tab `Shop` to MedMarket tab bar (`Products`/`Health Facilities`/`Professionals`/`Shop`), handle `?tab=shop` and default, keep existing Retail/Wholesale/Distributor segment filter applicable inside Shop, ensure tab `role="tablist"`/`role="tab"`/`aria-selected` and keyboard (ArrowLeft/Right) navigation.
- [ ] `apps/carefind/src/modules/shop/Shop.jsx` -- New Shop browse component: fetch `Active` ecommerce products (public anon `ecommerce_products` where `status=Active` + join `products` where `stock>0` + `ecommerce_applications` Approved), fetch `ecommerce_product_images` ordered, render featured horizontal row (e.g. first 6) + vertical grid `gridTemplateColumns: repeat(auto-fill, minmax(160px,1fr))` 2-per-row (Amazon reference), each card `photo/name/price` (price from `ecommerce_price_kobo` snapshot else `products.price`), segment unit label, loading skeletons, empty state, error retry, no vendor tag.
- [ ] `apps/carefind/src/modules/shop/ProductDetail.jsx` -- Detail page at ` /shop/:productId` (or `/shop/product/:id`): fetch `ecommerce_products` + `products` + ordered `ecommerce_product_images`, swipeable gallery (touch swipe + left/right buttons + dots/counter `2/5`), show name/price/description/category/warnings, `Add to Cart` button disabled with `Coming in checkout` hint (Goal 3), handle 1 image (no dots) and 0 image placeholder, a11y `aria-label="Product gallery"` and `aria-live` for counter.
- [ ] `apps/carefind/src/App.jsx` or `src/main.jsx` -- Register Shop routes: `/shop` (or `?tab=shop` inside MedMarket) and `/shop/:productId`, ensure deep link works, add `Shop` to nav if needed.
- [ ] `apps/carefind/src/modules/shop/shopRepository.js` -- Public `createShopRepository(request)` seam for `getActiveProducts({segment})` and `getProductDetail(productId)` that encapsulates the `ecommerce_products`+`products`+`images` queries for testability (in-memory adapter).

**Acceptance Criteria:**
- Given user opens MedMarket, when viewed then tabs are `Products`/`Health Facilities`/`Professionals`/`Shop` with Shop 4th, keyboard navigable, and `?tab=shop` deep link shows Shop
- Given Shop has Active products, when browsed then featured horizontal row + 2-per-row grid show photo/name/price per card, with segment filter correctly narrowing, and no vendor tag shown
- Given product with ≥2 images, when opened then gallery is swipeable with dots/counter `2/5` and ordered by `position`, and `Add to Cart` is visible but disabled
- Given product is Paused/Out of Stock/Restricted or business not Approved, when Shop queried then it is not listed and detail shows `Not available`
- Given Shop empty, when viewed then empty state `No products in Shop yet` with `Browse MedMarket` action, not error

## Spec Change Log


## Design Notes

Reuse `ecommerce_product_images` ordered set (Goal 1) — gallery is direct read, not copy. Shop is view over `ecommerce_products`+`products`, not a duplicate catalog. Segment unit: Retail single, Wholesale box/carton, Distributor bulk carton — show `price_unit`/`sale_type` already on `products` where available. Featured row reuses MedMarket `Featured on MedMarket` pattern.

## Verification

**Commands:**
- `npx vitest run src/modules/shop --reporter=verbose` -- expected: Shop repository + gallery ordering tests pass
- `npx vite build --workspace=apps/carefind` -- expected: clean, Shop tab and detail routes resolve

**Manual checks:**
- Open MedMarket → 4 tabs, Shop 4th, `?tab=shop` works, keyboard arrows move tabs
- Shop with Active products → featured row horizontal scroll + 2-per-row grid, no vendor tag, segment filter works
- Tap product with 2+ images → swipeable gallery with dots/counter, ordered, Add to Cart disabled
- Paused product → not in Shop
- Empty Shop → empty state

