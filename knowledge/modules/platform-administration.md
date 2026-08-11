# Platform Administration — Business Domain

## Purpose
Each product's own internal back-office, entirely separate systems with no shared code or data: CareHub's covers business-registration approval and its own admin roster; CareFind's covers content moderation, verification requests, business/staff claim approval, and its own, differently-named admin roster.

## Files
CareHub: `apps/carehub/src/pages/admin/AdminDashboard.jsx`. CareFind: `apps/carefind/carefind-main/src/AdminPanel.jsx` (1,868 lines — the largest single file in either repository), `AdminLogin.jsx`, `AdminStaff.jsx`, `AdminTeams.jsx`, `api/admin-auth.js`, `api/admin-setup.js`.

## Components
CareHub's `AdminDashboard.jsx` is a single component covering business approval/rejection and admin-team management. CareFind's admin surface is split across four files (`AdminPanel.jsx` plus three smaller supporting screens), with `AdminPanel.jsx` alone managing verification requests, business claims, staff claims, content reports, transactions, tasks, and two separate admin rosters in one file.

## Services
CareHub: `lib/supabase.js`'s `getBusinesses`, `updateBusiness`, `getAdminTeam`, `addAdminTeam`, `removeAdminTeam`, plus `lib/email.js`'s `emailBusinessApproved`/`emailBusinessRejected`. CareFind: direct `supabase-js` calls scattered through `AdminPanel.jsx` — up to 12 queries fired in parallel on a single page load, no centralized admin service file.

## Dependencies
CareHub's admin surface depends on the Authentication domain's `isAdmin` flag (client-side only). CareFind's depends on `api/admin-auth.js`'s forgeable token scheme (see `authentication.md`) — the weakest link in either product's security posture sits directly behind this domain's CareFind half.

## Database Tables
CareHub: `businesses`, `admin_team`. CareFind: `verification_requests`, `business_claims`, `staff_claims` (both also touched from the CareFind consumer side — see `claims.md`), `reports`, `transactions`, `tasks`, `task_submissions`, `admin_teams` (plural — distinct from CareHub's `admin_team`) and `admin_users`, `businesses` (CareFind's admin can write `visible_on_carefind` here — a direct write into a CareHub-owned table).

## Current State
Both admin surfaces are functionally built out — business approval works in CareHub, and content/claims moderation works in CareFind. **Both sit behind weak access control**: CareHub's is gated only by a client-side `isAdmin` boolean derived from a hardcoded credential match; CareFind's is gated by the authentication scheme documented in `authentication.md` as a full bypass. Neither product's admin tables were found to have any RLS enforcement confirmable from source.

## Missing Documentation
No document explains why CareFind's admin roster is split into two tables (`admin_teams`, `admin_users`) queried together, or how that relates to CareHub's single `admin_team` table of a near-identical name — whether this reflects two unrelated systems that happened to choose similar names, or an intended-but-unbuilt convergence, is unknown. No document records the severity of the authentication gap behind CareFind's `AdminPanel.jsx` given how much moderation authority (including writing to CareHub's own `businesses` table) sits behind it.
