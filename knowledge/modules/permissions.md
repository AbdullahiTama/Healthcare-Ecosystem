# Permissions — Business Domain

## Purpose
Role-based authorization logic — which navigation items, capabilities, and (in principle) which data a given staff member can see or act on. Almost entirely a CareHub concept; CareFind has no equivalent centralized authorization module.

## Files
`apps/carehub/src/lib/permissions.js` (the entire domain — a single file with no external dependents beyond three consumers). CareFind has no comparable file — its authorization is scattered inline in individual pages (e.g., `AdminPanel.jsx`'s own role checks).

## Components
None — this is a pure logic module, not a UI domain.

## Services
`getPerms(role)`, `can(role, action)`, `getNavItems(role, businessType)`. Exports `ROLES` (the full role → capability matrix), `DEFAULT_STAFF_PERMS`, `ALL_NAV_DEFAULT`, `ALL_NAV_HOSPITAL`, `ALL_NAV_ENTERPRISE`, `ROLE_LIST`.

## Dependencies
No I/O — entirely in-memory logic over hardcoded objects. Consumed by exactly three files: `Sidebar.jsx`, `BusinessDashboard.jsx`, `Staff.jsx` — every other dashboard page receives already-resolved `perms`/`role` as props rather than importing this module directly, which is a genuinely centralized pattern.

## Database Tables
None — this domain has no database presence; a staff member's `role` (stored as a plain string on the `staff` table, owned by the Staff Management domain) is the only persisted input to this logic.

## Current State
Nav-item filtering works correctly and is the sole mechanism differentiating what a role/business-type combination can see in the sidebar. **This domain's output is advisory to the UI only** — nothing in `lib/supabase.js` re-checks a `perms` value before executing a write; every enforcement observed anywhere in the codebase is a disabled form field or a hidden button, not a blocked request. Several role grants (`ROLES.Pharmacist.nav` including `rx_inbox`, and similarly for `Doctor`/`Nurse`/`Lab Technician`) reference nav ids that only exist in `ALL_NAV_HOSPITAL`, making those grants inert for every other business type with no warning anywhere in the code (see `pharmacy.md`).

## Missing Documentation
No document states that this module's authorization is UI-only and not enforced at the data layer — a reader of `lib/permissions.js` in isolation would reasonably assume `canEditPrice: false` prevents a price edit, when in practice nothing stops the underlying REST call. No document reconciles the role-permission matrix against the business-type nav arrays to catch grants like `Pharmacist.rx_inbox` that can never actually render.
