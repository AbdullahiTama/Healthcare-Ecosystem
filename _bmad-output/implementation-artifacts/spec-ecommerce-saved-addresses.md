---
title: 'E-commerce Saved Addresses'
type: 'feature'
created: '2026-09-05'
status: 'done'
baseline_commit: 'bfd9478aec04b48b75970e067ded3fedf0781ca2'
review_loop_iteration: 1
context:
  - 'docs/PROJECT_OVERVIEW.md'
  - 'apps/carefind/src/modules/shop/Checkout.jsx'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Customers must re-enter delivery addresses on every checkout. There is no address persistence — addresses exist only as denormalized fields on `shop_orders`. This creates friction, increases checkout abandonment, and prevents features like "reorder to same address."

**Approach:** Add a `customer_addresses` table with RLS (user-owned), build address management UI (list/add/edit/delete/set default), and integrate a saved-address selector into Checkout. Follow the `shop_wishlist` RLS pattern (`user_id = auth.uid() OR is_platform_admin()`). Store structured fields (street, city, state, postal_code, lat, lng) — compose `delivery_address` on read for backward compatibility with `shop_orders`.

## Boundaries & Constraints

**Always:**
- RLS: `user_id = auth.uid() OR is_platform_admin()` for ALL operations (SELECT/INSERT/UPDATE/DELETE)
- Store addresses as structured fields, not concatenated strings
- Compose `delivery_address` for `shop_orders` from structured fields at checkout time
- Default address auto-selected at checkout; user can override
- Max 10 addresses per user (prevent abuse)
- Soft-delete only (set `is_deleted = true`) — preserve order history integrity

**Ask First:**
- Adding `lat`/`lng` columns for future Maps integration (spec says Phase 2)
- Address validation via external API (Google Maps, etc.)
- Syncing addresses across CareFind and CareHub (if needed)

**Never:**
- Modify `shop_orders.delivery_address` schema (backward compatibility)
- Allow users to see/edit other users' addresses
- Hard-delete addresses (breaks order audit trail)
- Store addresses in localStorage (must be server-persisted)

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add first address | User clicks "Add Address", fills form, saves | Address saved, marked as default, appears in list | Validation errors shown inline |
| Add second address | User adds another address | Saved, not default; user can set as default | Max 10 limit enforced |
| Select at checkout | User has 3 saved addresses | Dropdown shows all 3; default pre-selected; "Add new" option | If no addresses, show form |
| Edit address | User clicks edit on saved address | Form pre-filled; changes saved on submit | Concurrent edit: last-write-wins |
| Delete default address | User deletes their default address | Next address becomes default (oldest first) | If last address, warn before delete |
| Checkout with no addresses | New user, no saved addresses | Full address form shown (current behavior) | N/A |
| Order after address edit | User edits address, then views old order | Order shows original address (snapshot at order time) | N/A — orders store denormalized copy |

</frozen-after-approval>

## Code Map

- `apps/carehub/sql/20260905_customer_addresses.sql` -- NEW: `customer_addresses` table with RLS, indexes, max-10 trigger
- `apps/carefind/src/modules/account/addressesRepository.js` -- NEW: CRUD operations (list, get, create, update, delete, setDefault)
- `apps/carefind/src/modules/account/Addresses.jsx` -- NEW: Address management page (list + add/edit modal)
- `apps/carefind/src/modules/account/AddressForm.jsx` -- NEW: Reusable form component (street, city, state, postal_code, label, is_default)
- `apps/carefind/src/modules/shop/Checkout.jsx:27-36` -- MODIFY: Add address selector dropdown above inline form; pre-fill from selected address
- `apps/carefind/src/modules/shop/Checkout.jsx:131-184` -- MODIFY: On submit, save address if "Save this address" checked; compose `delivery_address` from structured fields
- `apps/carefind/src/config/routes.jsx` -- MODIFY: Add `/account/addresses` route (authenticated)
- `apps/carefind/src/components/BottomNav.jsx` -- MODIFY: Add "Addresses" link in account menu (if exists)

## Tasks & Acceptance

**Execution:**
- [x] `apps/carehub/sql/20260905_customer_addresses.sql` -- CREATE TABLE with columns: id (uuid), user_id (uuid FK to auth.users), label (text, e.g., "Home", "Work"), street, city, state, postal_code, country (default 'Nigeria'), lat/lng (numeric, nullable), is_default (boolean), is_deleted (boolean, default false), created_at, updated_at. Add RLS policies (user_id = auth.uid() OR is_platform_admin()). Add unique constraint: one default per user (partial index WHERE is_default = true AND is_deleted = false). Add trigger: enforce max 10 addresses per user. Add function: set_default_address(uuid) that unsets other defaults.
- [x] `apps/carefind/src/modules/account/addressesRepository.js` -- Implement: listAddresses(userId), getAddress(id), createAddress(data), updateAddress(id, data), deleteAddress(id) [soft-delete], setDefaultAddress(id). All via sbFetch with RLS.
- [x] `apps/carefind/src/modules/account/AddressForm.jsx` -- Build controlled form: label (select: Home/Work/Other + custom), street, city, state (dropdown of Nigerian states), postal_code, country (default Nigeria), is_default checkbox. Validation: street/city/state required. Props: initialData (for edit), onSubmit, onCancel.
- [x] `apps/carefind/src/modules/account/Addresses.jsx` -- Page: list saved addresses (cards with label, full address, default badge, edit/delete buttons). "Add Address" button opens modal with AddressForm. Edit opens modal pre-filled. Delete confirms then soft-deletes. Empty state: "No saved addresses" with CTA.
- [x] `apps/carefind/src/modules/shop/Checkout.jsx` -- Add address selector section above inline form: if user has saved addresses, show dropdown (label + preview) + "Add new address" option. Pre-fill form from selected address. Add "Save this address for future orders" checkbox. On submit: if checkbox checked, create new address; compose delivery_address from structured fields.
- [x] `apps/carefind/src/main.jsx` -- Add route: `/account/addresses` → Addresses.jsx (authenticated via RequireAuth).
- [x] `apps/carefind/src/modules/account/addresses.test.js` -- Unit tests: repository CRUD, max-10 enforcement, default-address switching, soft-delete preserves order integrity.

**Acceptance Criteria:**
- Given authenticated user with no saved addresses, when visiting `/account/addresses`, then empty state shown with "Add Address" CTA.
- Given user adds first address, when saving, then address marked as default and appears in list.
- Given user has 3 saved addresses, when visiting checkout, then dropdown shows all 3 with default pre-selected; "Add new address" option available.
- Given user selects saved address at checkout, when submitting order, then `shop_orders.delivery_address` composed from structured fields (street + city + state); address fields stored in order snapshot.
- Given user checks "Save this address" at checkout, when order placed, then address added to `customer_addresses` (not default if another exists).
- Given user has 10 addresses, when attempting to add 11th, then error: "Maximum 10 addresses reached. Delete one to add another."
- Given user deletes default address, when confirmed, then next oldest address becomes default; if last address, list empty.
- Given user edits address, when viewing old order, then order shows original address (snapshot), not edited version.
- Given unauthenticated user, when accessing `/account/addresses`, then redirected to login.

## Spec Change Log

- **Loop 1 (2026-09-05):** Review found 8 patch findings. Fixed: (1) SQL trigger `ensure_one_default_address` now skips soft-deleted rows to prevent unexpected default changes during delete; (2) SQL RPC `set_default_address` error message clarified to "not found or deleted"; (3) Checkout `loadAddresses` no longer overwrites user's manual address entry (added `addressPreFilled` guard); (4) Checkout `maybeSaveAddress` now logs errors via `console.warn` instead of silently swallowing; (5) Test added: first address auto-default assertion; (6) Test added: deleting only address does not call set_default_address RPC; (7) Mock updated to simulate DB trigger auto-default behavior.

## Design Notes

**Structured fields** enable future features (delivery zones, Maps, validation). **Soft-delete** preserves order audit trail. **Max 10** prevents abuse. Compose `delivery_address` at checkout for backward compatibility.

## Verification

**Commands:**
- `npm test -- apps/carefind/src/modules/account/addresses.test.js` -- all repository tests pass
- `npm run build` -- vite build clean
- `npm test` -- full suite passes

**Manual checks:**
- `/account/addresses` shows empty state or list; add/edit/delete works
- Checkout shows address dropdown (if addresses exist); "Save this address" adds to list
- Old orders show original address snapshot (not edited version)

## Suggested Review Order

**Database Schema & RLS**

- `customer_addresses` table with structured fields and user-owned RLS
  [`20260905_customer_addresses.sql:4`](../../apps/carehub/sql/20260905_customer_addresses.sql#L4)

- Max-10 trigger and auto-default trigger enforce data integrity
  [`20260905_customer_addresses.sql:45`](../../apps/carehub/sql/20260905_customer_addresses.sql#L45)

- `set_default_address` RPC with ownership validation
  [`20260905_customer_addresses.sql:59`](../../apps/carehub/sql/20260905_customer_addresses.sql#L59)

**Repository Layer**

- CRUD operations with soft-delete and default reassignment logic
  [`addressesRepository.js:61`](../../apps/carefind/src/modules/account/addressesRepository.js#L61)

**Address Form Component**

- Controlled form with label selection, Nigerian states dropdown, validation
  [`AddressForm.jsx:40`](../../apps/carefind/src/modules/account/AddressForm.jsx#L40)

**Address Management Page**

- List/add/edit/delete UI with default badge and set-default action
  [`Addresses.jsx:136`](../../apps/carefind/src/modules/account/Addresses.jsx#L136)

**Checkout Integration**

- Address selector dropdown and "Save this address" checkbox
  [`Checkout.jsx:334`](../../apps/carefind/src/modules/shop/Checkout.jsx#L334)

- `maybeSaveAddress` called after order creation with error logging
  [`Checkout.jsx:159`](../../apps/carefind/src/modules/shop/Checkout.jsx#L159)

**Tests**

- 8 tests covering CRUD, max-10, soft-delete, default reassignment, auto-default
  [`addresses.test.js:132`](../../apps/carefind/src/modules/account/addresses.test.js#L132)
