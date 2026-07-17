# Healthcare Discovery — Business Domain

## Purpose
CareFind's genuinely "healthcare discovery" surface — search for products/businesses/professionals, and drug-specific lookup. The one part of CareFind that matches its documented product purpose (`docs/PROJECT_OVERVIEW.md`), out of the ~48-file, ~15,400-line codebase.

## Files
`apps/carefind/carefind-main/src/Search.jsx` (333 lines), `BusinessProfile.jsx` (347 lines, also covers the Business Profiles & Reviews domain), `DrugProfile.jsx` (501 lines).

## Components
`Search.jsx` is a single component with three internal tabs (products/businesses/professionals) and a featured-promotions/products marquee. No shared search-result-card component — each tab renders its own inline result layout.

## Services
Direct `supabase-js` query builder calls (`supabase.from('products').select(...).or(...)`, `supabase.from('businesses').select(...).eq('visible_on_carefind', true)`, `supabase.from('profiles').select(...).eq('is_verified', true)`). Also writes to `search_logs` on every search that has a query or filter. No centralized search-service file.

## Dependencies
`lib/supabaseClient.js`, `lib/AuthContext.jsx` (for attributing search logs to a user), `lib/theme.js`.

## Database Tables
Reads `products` and `businesses` (both CareHub-owned — see `claims.md` and `architecture/Shared-Services.md`), `profiles` (CareFind-owned), `promotions` (featured content). Writes `search_logs`.

## Current State
All three search tabs, the featured-promotions marquee, and the fallback recent-products marquee are implemented and functional. The product search selects several columns (`whatsapp`, `image_url`, `sale_type`, `price_unit`, `min_purchase`, `seller_location`) that have no confirmed write path in CareHub's own product-management UI — see `carefind-listing.md`. A background search-logging failure surfaces as a blocking browser `alert()` to the end user rather than failing silently.

## Missing Documentation
No document specifies the intended source of the marketplace-specific product columns this domain depends on. No document records the search-log-failure `alert()` as an intentional user-facing error versus an oversight (every other silent-failure pattern in both codebases — CareHub's `notify()`, CareFind's own `notify.js` — swallows errors instead).
