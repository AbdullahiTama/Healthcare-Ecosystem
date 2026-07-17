# CareFind Listing — Business Domain

## Purpose
Controls which of a CareHub business's products are publicly visible on the CareFind discovery platform, via a per-product `list_on_carefind` boolean toggle. The CareHub-side half of the cross-product relationship documented fully in `claims.md` and the `architecture/Shared-Services.md` document produced in a prior session.

## Files
`apps/carehub/src/pages/dashboard/CareFind.jsx` (the dedicated module), `pages/dashboard/Inventory.jsx` (which independently implements the identical toggle for the same field).

## Components
`CareFind.jsx`'s default-exported component (listed/unlisted/out-of-stock product tabs, each with its own quick-toggle switch). This toggle UI is hand-built twice — once here, once inside `Inventory.jsx`'s product table — rather than as one shared component.

## Services
`lib/supabase.js`: `updateProduct` — the only function this domain calls, and the same function `Inventory.jsx` calls for the identical field.

## Dependencies
`lib/utils.js` (`fmt`, `businessIcon`, `businessName`). No dependency the underlying CareFind application is aware of beyond the shared `products` table.

## Database Tables
`products.list_on_carefind` (boolean), `businesses.visible_on_carefind` (boolean, business-level equivalent, set in Settings rather than here).

## Current State
Fully functional as a duplicate of Inventory's own toggle — this screen adds no capability Inventory doesn't already have for the same field. CareFind's `Search.jsx`/`BusinessProfile.jsx` read several additional product columns (`whatsapp`, `image_url`, `sale_type`, `price_unit`, `min_purchase`, `seller_location`) that **no screen in CareHub, including this one, provides a way to set**.

## Missing Documentation
No document explains why this screen exists as a separate page from Inventory's own toggle rather than the two being consolidated, or which one is meant to be authoritative. No document identifies where (if anywhere) `whatsapp`/`image_url`/`sale_type`/`price_unit`/`min_purchase`/`seller_location` are supposed to be set, given CareFind depends on them and CareHub has no UI for them — this is the same gap identified from CareFind's side in the cross-product architecture review.
