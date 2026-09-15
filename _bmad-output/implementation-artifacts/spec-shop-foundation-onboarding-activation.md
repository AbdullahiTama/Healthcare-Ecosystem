---
title: 'Shop Foundation — Vendor Onboarding and Product Activation'
type: 'feature'
created: '2026-08-29'
status: 'done'
baseline_commit: '8706e196f5f40c33d0f84635a0000c42ea18cd3e'
review_loop_iteration: 1
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** CareHub inventory exists but no vendor can prepare products for public Shop sale; activation is not gated by onboarding, image, or completeness, so Shop would be either empty or unsafe.

**Approach:** Add `Ecosystem → E-commerce` module: vendor onboarding application with `Not Applied→Suspended` states and mandatory terms, inventory-linked `ecommerce_products` with completeness check, mandatory ordered multi-image set (`ecommerce_product_images`), and explicit `activate` that is blocked until business eligible, all mandatory fields complete, and at least one valid image.

## Boundaries & Constraints

**Always:** Reuse existing `businesses`/`products`/`inventory` as source of truth — `ecommerce_products` links to `products` via `product_id`, never duplicates inventory rows. Every write verifies ownership via `current_business_ids()` or `is_platform_admin()`; admin review is service-role only. Validate image formats/size/dimensions before accept; store ordered set per product, not single field. Price shown to customer is snapshotted at activation/order time, not live-linked. Loading/error/empty/responsive/a11y on every screen. Keep audit trail — never delete application history.

**Ask First:** Category-specific mandatory fields (medicine vs device vs cosmetics) beyond image/name/price/description — if product category table not yet formalized, keep generic required set and defer per-category gate to follow-up. CareFind Admin review workflow DB location (existing `admin_users` vs new).

**Never:** Publish product merely because it exists in inventory or because application was submitted — both eligibility + completeness + image + explicit activate required. Don't allow activation without image. Don't bypass compliance/restricted checks once introduced. Don't duplicate products table.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Open E-commerce without application | Owner → Ecosystem → E-commerce, status Not Applied | Show onboarding form with terms, seller info, Submit | 403 if non-Owner/non-permitted |
| Submit application | Owner accepts mandatory terms + seller info → Submit | Row `ecommerce_applications` status `Submitted`, timestamps, not public | 400 if terms not accepted or info incomplete |
| Application under review | Admin reviews | Admin can `Approved`/`Rejected` (with reason); vendor sees status | RLS: only admin or owning business reads own |
| List inventory inside E-commerce | Owner opens E-commerce | All `products` for business with e-commerce status `Not Activated/Incomplete/Active/Paused/Out of Stock/Restricted` + search/filter + missing fields hint | Empty state if no inventory |
| Complete e-commerce info | Seller fills description, category, attributes | Row `ecommerce_products` upsert with completeness flag | 400 if required fields invalid |
| Upload images | Seller adds 1..N images | Rows `ecommerce_product_images(product_id, url, position)` ordered; validate mime/size; allow add/reorder/replace/delete | 400 if mime/size invalid; block activate if zero images |
| Activate product | Seller hits Activate with eligible business + complete + image | `ecommerce_products.status` → `Active`, `active_at` set, visible to future Shop queries | 409 if business not Approved, 400 if incomplete/image missing |
| Deactivate/Pause | Seller pauses | `status` → `Paused`, not purchasable | Idempotent |
| Race activation | Two owners activate same product | Row-locked, only one `Active`; second gets current status | Handle via `SELECT FOR UPDATE` |

</frozen-after-approval>

## Code Map

- `apps/carehub/src/lib/permissions.js:219` -- MODULES registry: add `ecommerce: { label:'E-commerce', types: ALL_TYPES, section:'ecosystem' }`; drives Sidebar, getNavItems, getNavGroups, role editor.
- `apps/carehub/src/modules/settings/Settings.jsx:330` -- Pattern for Services CRUD + validation + multi-image; reuse for E-commerce product setup.
- `apps/carehub/src/modules/inventory/Inventory.jsx:1` -- Inventory product modal (`ProductForm`) source for name/price/stock/category; reuse product fields, do not duplicate.
- `apps/carehub/src/modules/inventory/repositories/index.js:1` -- productRepository (pagedQuery, tenant-scoped) — E-commerce will compose it for `getAll` inventory, not copy.
- `apps/carehub/sql/20260828_business_services.sql:1` -- Reference for new migration `ecommerce_applications`/`ecommerce_products`/`ecommerce_product_images` with RLS `current_business_ids()` pattern and ordered image set.
- `apps/carehub/src/services/supabase.js:15` -- sbFetch transport seam; future `ecommerceRepository` will inject it for testability.
- `apps/carefind/api/_handlers/booking.js:1` -- Service-role handler pattern for admin review (service-role client) vs direct PostgREST for vendor writes.
- `apps/carehub/src/components/ui/index.jsx:1` -- Card, Inp, Textarea, Pill, DataTable, Empty, useToast — reuse for onboarding form, product table, gallery.
- `apps/carehub/src/styles/theme.js:1` -- Design tokens (tealDeep, dangerBg etc.) for loading/error/empty states.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carehub/sql/20260830_ecommerce_foundation.sql` -- Migration: `ecommerce_applications(id, business_id fk, status text CHECK Not Applied/Draft/Submitted/Under Review/Approved/Rejected/Suspended, terms_accepted bool, seller_info jsonb, submitted_at, reviewed_at, reviewer_id, rejection_reason, created_at, updated_at)` + `ecommerce_products(id, business_id, product_id fk→products, status CHECK Not Activated/Incomplete/Active/Paused/Out of Stock/Restricted, description, category, ecommerce_price_kobo, attributes jsonb, active_at)` + `ecommerce_product_images(id, ecommerce_product_id fk, url text, position int, created_at)` with `UNIQUE(business_id, product_id)`, ordered index `(ecommerce_product_id, position)`, RLS `business_id IN (SELECT current_business_ids()) OR is_platform_admin()` for all three, public read none for Goal 1, triggers `updated_at`, `is_ecommerce_product_complete` helper.
- [x] `apps/carehub/src/modules/ecommerce/repositories/index.js` -- `createEcommerceRepository({request, upload})` seam: `getApplication`, `submitApplication` (terms required, upsert merge-duplicates), `getInventoryWithStatus` (pagedQuery + left join), `getEcommerceProduct`, `upsertEcommerceProduct` (price>=0), `getImages` (ordered), `addImage` (mime/size, next position, storage `ecommerce-images`), `reorderImages`, `deleteImage`, `activate` (Approved + description>=10 + category + image>0), `setStatus`; all tenant-scoped.
- [x] `apps/carehub/src/modules/ecommerce/Ecommerce.jsx` -- `Ecosystem → E-commerce` page: application status pill + onboarding form (terms, seller info), inventory `DataTable` with search/status filter, `Pill` status, missing hint, product modal (description/category/price, gallery with add/delete + validation), Activate/Pause gate (`Approved` required), loading/error/empty/responsive/a11y, toast.
- [x] `apps/carehub/src/lib/permissions.js` -- Registered `ecommerce` (`Store` icon, `ALL_TYPES`, `ecosystem`), added to `NAV_ORDER` default/hospital/enterprise, `ROLES.Owner` nav includes `ecommerce`.
- [x] `apps/carehub/src/pages/dashboard/BusinessDashboard.jsx` -- Added `Ecommerce` import and `guard('ecommerce', <Ecommerce>)` route under `TopBar`.
- [x] `apps/carehub/api/ecommerce-review.js` -- Service-role `POST /api/ecommerce/review` (Approve/Reject/Suspend/Under Review) with `is_platform_admin` check, audit `reviewed_at`/`reviewer_id`.
- [x] `apps/carehub/src/modules/ecommerce.test.js` -- In-memory tests (13) for tenant isolation, terms, price validation, activate gates, image ordering.

**Acceptance Criteria:**
- Given Owner opens Ecosystem → E-commerce with no application, when viewed then onboarding form with mandatory terms is shown and Submit is disabled until terms accepted
- Given Owner submits application with terms accepted, when submitted then `ecommerce_applications` is `Submitted` and product activation remains blocked until `Approved`
- Given Approved business with inventory product lacking image, when seller hits Activate then 400 and product stays `Incomplete`/`Not Activated`, not visible to Shop
- Given Approved business with complete info and ≥1 valid image, when seller hits Activate then `ecommerce_products.status` → `Active` and row appears as activatable future Shop query respects it, historical price snapshot preserved on later price change
- Given product with ≥2 images, when seller reorders/deletes one image then `ecommerce_product_images.position` reorders contiguously and gallery reflects order
- Given another business's product, when queried then not visible (tenant isolation via RLS + repository `business_id` filter)
- Given `Paused` product, when Shop queries active products then it is excluded

## Spec Change Log


## Design Notes

Reuse inventory as source — `ecommerce_products.product_id` FK, ordered `ecommerce_product_images` (like `order_files` pattern), price snapshot `ecommerce_price_kobo` separate from `products.price` per `A11`. Front: compose `productRepository` for inventory, do not copy queries. Storage: new `ecommerce-images` bucket (public read after activation, authenticated write tenant-scoped). Validation helper `isProductComplete(product, ecommerceRow, imageCount)` centralizes activate gate.

## Verification

**Commands:**
- `npx vitest run src/modules/ecommerce.test.js --reporter=verbose` -- expected: 13 passed (tenant isolation, terms, price, activate gates, image ordering)
- `npx vitest run src/modules/settings/repositories/index.test.js --reporter=verbose` -- expected: 28 passed
- `npx vite build --workspace=apps/carehub` -- expected: clean (288 modules, E-commerce route resolves)

**Manual checks:**
- Open E-commerce as Owner with no app → onboarding shown, terms required
- Submit → status Submitted, activate blocked
- Admin Approve → add product, try activate without image → blocked with hint, upload 2 images → activate succeeds → `ecommerce_products` Active
- Reorder images → gallery order updates
- Pause → product hidden from `Active` filter
- Cross-tenant business → cannot see other’s products

## Suggested Review Order

**Migration & data model — foundation**

- Ordered image set and RLS with `is_ecommerce_product_complete` helper
  [`20260830_ecommerce_foundation.sql:1`](../../apps/carehub/sql/20260830_ecommerce_foundation.sql#L1)

**Repository seam — tenant isolation and activate gate**

- `getInventoryWithStatus` composes `productRepository` + `ecommerce_products` left join
  [`repositories/index.js:45`](../../apps/carehub/src/modules/ecommerce/repositories/index.js#L45)

- `activate` checks Approved + description/category + image>0 before `Active`
  [`repositories/index.js:165`](../../apps/carehub/src/modules/ecommerce/repositories/index.js#L165)

**UI — onboarding and product setup**

- E-commerce page: application status, onboarding form, inventory DataTable with search/filter
  [`Ecommerce.jsx:22`](../../apps/carehub/src/modules/ecommerce/Ecommerce.jsx#L22)

- Product modal: description/category/price, gallery with add/reorder/delete, Activate/Pause gate
  [`Ecommerce.jsx:104`](../../apps/carehub/src/modules/ecommerce/Ecommerce.jsx#L104)

**Permissions and routing**

- Module registry and `NAV_ORDER` for `ecommerce` under Ecosystem
  [`permissions.js:219`](../../apps/carehub/src/lib/permissions.js#L219)

- Dashboard route `guard('ecommerce', <Ecommerce>)`
  [`BusinessDashboard.jsx:214`](../../apps/carehub/src/pages/dashboard/BusinessDashboard.jsx#L214)

**Tests**

- In-memory repository tests for tenant isolation and activate gates
  [`ecommerce.test.js:46`](../../apps/carehub/src/modules/ecommerce.test.js#L46)

