# Staff Management — Business Domain

## Purpose
Team roster management for a CareHub tenant — adding staff with a role and password, activating/deactivating accounts, and (for CareFind-connected businesses) approving staff members' claims to their public CareFind position.

## Files
`apps/carehub/src/pages/dashboard/Staff.jsx` (the entire module), `lib/permissions.js` (`ROLE_LIST`, the role matrix this domain assigns from), `lib/email.js` (`emailStaffWelcome`).

## Components
Single default-exported component; add-staff modal and claims-approval panel are inline, not separate files. Shared primitives from `components/ui/index.jsx`.

## Services
`lib/supabase.js`: `getStaff`, `addStaff`, `updateStaff`, `deleteStaff`, `getStaffClaims`, `approveStaffClaim`, `rejectStaffClaim`. `lib/email.js`'s `emailStaffWelcome` is called on every successful `addStaff`.

## Dependencies
`lib/permissions.js` (`ROLE_LIST` — the role picker is not filtered by business type, see `pharmacy.md`), `lib/email.js`. This is CareHub's side of the `staff_claims` bridge to CareFind — see `claims.md`.

## Database Tables
`staff` (`id, business_id, full_name, email, password, role, phone, status, show_on_carefind, public_title, created_at`), `staff_claims` (read/approved/rejected here; written from CareFind's side — see `claims.md`).

## Current State
Add/deactivate/remove and claim approval are all implemented and functional. The full staff roster — including every employee's email address — is visible to any authenticated staff member who navigates to this route directly, regardless of role; only the add/remove/status-toggle *actions* are hidden for non-Owner roles, not the list itself. `password` is stored and transmitted in plaintext, and `emailStaffWelcome` sends that plaintext password directly to the new hire's email, along with a stale `skincarepro.vercel.app` link.

## Missing Documentation
No document specifies which fields of a staff record are meant to be visible to which roles — the current behavior (full roster visible, only actions restricted) is not stated as intentional anywhere. No document records the plaintext-password-in-email pattern as a known, accepted tradeoff versus an unaddressed gap.
