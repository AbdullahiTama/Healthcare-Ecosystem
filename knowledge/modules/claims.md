# Claims — Business Domain

## Purpose
The mechanism by which a CareFind end-user establishes a verified connection to a CareHub-owned record — either claiming ownership of a business, or claiming to be a specific staff member CareHub created. This is the clearest, best-evidenced example of genuine two-way integration between the two products in the entire ecosystem, verified by reading both sides of each workflow directly.

## Files
CareFind: `apps/carefind/carefind-main/src/ClaimBusiness.jsx`, `ClaimStaffPosition.jsx`, `BusinessDashboard.jsx` (517 lines — consumes approved business claims), `Profile.jsx` (reads a user's approved staff claims), `AdminPanel.jsx` (approves/rejects business claims). CareHub: `apps/carehub/src/pages/dashboard/Staff.jsx` (approves/rejects staff claims), `lib/supabase.js` (`getStaffClaims`, `approveStaffClaim`, `rejectStaffClaim`).

## Components
CareFind's `ClaimBusiness.jsx` and `ClaimStaffPosition.jsx` are simple claim-submission forms. CareHub's `Staff.jsx` surfaces pending staff claims in a "🔔 Pending CareFind Claims" panel with approve/reject actions, inline within the broader Staff Management domain (no dedicated claims page).

## Services
CareFind side: `supabase.from('business_claims').insert({ user_id, business_id })`, `supabase.from('staff_claims').select(...).eq('user_id', user.id)` (read own claims). CareHub side: `getStaffClaims(businessId)` — one of only two places in CareHub's entire codebase using a PostgREST embedded-resource join (`staff:staff_id(id, full_name, public_title, business_id)`), proving a real foreign key exists between `staff_claims` and `staff`. `approveStaffClaim`/`rejectStaffClaim` update the claim's status. CareFind's `AdminPanel.jsx` `approveClaim()`/`rejectClaim()` do the equivalent for business claims, with approval additionally writing `businesses.visible_on_carefind = true` — a direct CareFind-initiated write into a CareHub-owned table.

## Dependencies
`lib/activeIdentity.js` (CareFind) — once a staff claim is approved, the claiming user can post to the Social Feed domain "as" that staff position, which is this domain's downstream payoff. CareHub's `Staff.jsx` (Staff Management domain) is the sole approval authority for staff claims.

## Database Tables
`staff_claims` (`id, staff_id, user_id, status, created_at` — `staff_id` is a proven FK to CareHub's `staff.id`), `business_claims` (`id, business_id, user_id, status, created_at`). Both tables are read and written from both codebases.

## Current State
Both claim types work end-to-end as real, functioning cross-product workflows: a CareFind user submits a claim; the corresponding CareHub or CareFind admin surface approves or rejects it; the approved claim then unlocks new capability (posting-as-staff on CareFind, or business management access via CareFind's `BusinessDashboard.jsx`). This is the one domain in the ecosystem where the "CareHub and CareFind are two applications within one ecosystem" framing from the project's stated architecture philosophy is demonstrably true in implementation, not just in documentation.

## Missing Documentation
No document formally specifies this domain as a contract between the two products — its existence and mechanics were reconstructed entirely by reading both codebases' source in this and a prior review pass. No document states why `business_claims` approval is entirely CareFind-side (CareHub has no visibility into or approval role for claims on its own businesses) while `staff_claims` approval is entirely CareHub-side (CareFind only submits and displays, never approves) — whether this asymmetry is intentional is not recorded anywhere.
