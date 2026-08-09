# CareHub Six-Issue Fix — 2026-08-09

Closed five of the six pending issues from today's list via code; the sixth
(requisition/out-of-stock save) is a database-migration apply that needs live
DB access and is documented for a manual apply.

## What changed

### Issue 5 — Purchase page blank screen
`apps/carehub/src/modules/purchases/Purchases.jsx:20` — added the missing
`gray50` to the theme destructure. Line 266 used bare `gray50` (`background:
gray50`), which threw `ReferenceError` at render and blanked the page whenever
a purchase table with rows rendered. Root cause, not a styling tweak — the other
sibling modules (`Appointments`, `Lab`, `Messages`) all already destructure it.

### Issue 1 — Price Visibility toggle (business-level)
- New `apps/carehub/sql/20260809_price_visibility.sql` — adds
  `businesses.show_prices boolean NOT NULL DEFAULT true` (existing businesses
  unaffected).
- `settings/repositories/index.js` — `BUSINESS_PROFILE_FIELDS` gains
  `show_prices`, `latitude`, `longitude`.
- `Settings.jsx` — new Toggle "Show product prices on CareFind" (desc: 'When
  off, patients see "Ask for price" instead of your product prices'); empty GPS
  inputs normalize to `null`, filled ones to `Number(...)`.
- `carefind/src/modules/utils/marketplace.js` — `canShowPrice(product)` now
  also returns false when `product.businesses?.show_prices === false`. This is
  the single choke point used by every buyer view (Search, DrugProfile,
  BusinessProfile), so one edit covers all three.
- The three consumer selects (`Search.jsx:105,145`, `DrugProfile.jsx:48`,
  `BusinessProfile.jsx:221`) now embed `businesses(show_prices)`.
- New `canShowPrice` test in `marketplace.test.js` for the business-hide path.

### Issue 6 — Geocoordinates
- `Settings.jsx` — Latitude/Longitude inputs in a 2-col grid with a helper note
  pointing the owner at Google Maps to copy coordinates.
- `BusinessProfile.jsx` — added `latitude, longitude` to the business select;
  new derived `mapHref` constant: `maps_link` wins, else
  `google.com/maps/search/?api=1&query=<lat>,<lng>` when both coordinates are
  set, else no Directions button. Both Directions spots (sidebar + mobile body)
  use it.

### Issue 4 — Unlimited products
`carefind/src/modules/account/ProductUpload.jsx` — removed the 20-product free
cap entirely: deleted `FREE_LIMIT`, the `count`/`subscribed` state, the
`loadCount` gate, the "You've used your 20 free products" block, the
subscription button, the now-unused `Check` icon import and the `showToast`
destructure entry. Kept the seller-location fetch (renamed to
`loadSellerLocation`). Products are now unlimited for everyone.

### Issue 3 — Split Add New Client modal
`apps/carehub/src/modules/clients/Clients.jsx` — modal's single 'Full Name *'
input replaced with a 2-col 'First Name *' + 'Surname *' grid (`gap: 12px`,
the spacing fix). `save()` now builds `full_name` as
`[form.firstName, form.lastName].filter(Boolean).map(s => s.trim()).join(' ')`.
Validation requires first name, surname and phone.

## Verification
- CareFind: 120 tests pass (11 files), clean `vite build`.
- CareHub: 258 tests pass (22 files), clean `vite build`.
- The chunk-size warning on both builds is pre-existing (tracked in
  `planning/CODE_AUDIT.md`), not introduced here.

## Not done — Issue 2 (requisition / out-of-stock save) needs a manual DB apply
The client already posts correctly-named RPC params
(`p_business_id, p_supplier_name, p_note, p_items` — `supabase.js:252`);
`apps/carehub/sql/20260805_requisition_lines_normalized.sql` defines a
`create_requisition(...)` whose signature matches exactly, plus the four
normalized `requisition_items` columns and the out-of-stock columns
(`quantity_needed, target_price, supplier_notes`). The migration was never
applied to the live DB, which is why save fails. No client change is needed —
apply the SQL in the Supabase editor and run the probe block at lines 92-101.
`CODE_AUDIT.md` updated to reflect this.

Also applied today (separate, earlier session): CareFind public `About` page
— `apps/carefind/src/modules/marketing/About.jsx`, route in `main.jsx`,
nav/footer links in `ForBusiness.jsx`.
