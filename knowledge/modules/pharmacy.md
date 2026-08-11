# Pharmacy — Business Domain

## Purpose
"Community Pharmacy" is one of eight selectable `business_type` values, intended to let a standalone pharmacy run counter sales, drug stock, and staff on CareHub. In practice there is no pharmacy-specific page, folder, or workflow — a pharmacy tenant receives the same generic screens as any other retail business type (`ALL_NAV_DEFAULT`). The only pharmacy-flavored elements are a `Pharmacist` role and a `'Medicines'` product category.

## Files
`lib/utils.js` (`BUSINESS_TYPES` pharmacy entry, `PRODUCT_CATS`), `lib/permissions.js` (`ROLES.Pharmacist`, `ALL_NAV_DEFAULT`, `getNavItems()`), `pages/auth/Register.jsx`, `pages/dashboard/Staff.jsx`, `pages/dashboard/Inventory.jsx`, `pages/dashboard/POS.jsx` (the domain's actual reachable functionality — both are generic, documented under `inventory.md`), `pages/dashboard/hospital/RxInbox.jsx` and `Doctor.jsx` (the code that visually calls itself "Pharmacy" but is unreachable from this business type — see Current State).

## Components
None specific to this domain. `RxInbox.jsx` self-labels "💊 Pharmacy — Prescription received from Doctor" but lives under `pages/dashboard/hospital/` and is functionally part of the Hospital Workflow domain, not this one.

## Services
None specific to this domain. A pharmacy tenant's UI calls only the generic `getProducts`/`addProduct`/`updateProduct` (Inventory) and `addSale`/`getSales` (POS) functions. `getPrescriptions`/`addPrescription`/`updatePrescription` exist in `lib/supabase.js` and are correctly centralized, but nothing in a pharmacy tenant's reachable UI ever calls them.

## Dependencies
`lib/permissions.js` (the mechanism responsible for this domain's central finding — see Current State), `lib/utils.js`, `lib/email.js` (`emailStaffWelcome`, fired whenever a Pharmacist is onboarded).

## Database Tables
Same footprint as any retail tenant: `products`, `sales`, `staff`. The `prescriptions` table exists in the schema and is referenced by `lib/supabase.js` and `RxInbox.jsx`/`Doctor.jsx`, but no pharmacy-type tenant's session can ever write or read a row in it.

## Current State
`getNavItems(role, businessType)` selects `ALL_NAV_DEFAULT` for `businessType === 'pharmacy'`, and `ALL_NAV_DEFAULT` contains no `rx_inbox`, `doctor`, `lab`, `imaging`, or `triage` entry at all — regardless of what a role's permission list grants, the filtered intersection is always empty for these ids at this business type. **The prescription-dispensing pipeline the codebase itself labels "Pharmacy" is entirely unreachable by the "Community Pharmacy" business type.** `Staff.jsx`'s role picker is not filtered by business type, so a pharmacy owner can assign `Doctor`/`Nurse`/`Lab Technician` roles that have no reachable functionality at this business type. The onboarding email sent to every new staff member (`emailStaffWelcome`) links to `skincarepro.vercel.app`, a leftover from the product's prior identity, and includes the new hire's password in plaintext.

## Missing Documentation
No document states whether the Pharmacist role's `rx_inbox` nav permission being inert outside the hospital business type is a known, intentional limitation or an unresolved defect — `lib/permissions.js` reads, in isolation, as though pharmacies have a working dispensing workflow. No document explains why "Community Pharmacy" and "Hospital / Clinic" are separate `business_type` values when the prescription-dispensing feature was apparently built assuming a hospital's in-house pharmacy, not a standalone pharmacy business. No document records the stale `skincarepro.vercel.app` branding in the staff welcome email as a known cleanup item.
