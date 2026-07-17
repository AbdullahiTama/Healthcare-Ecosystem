# Laboratory — Business Domain

## Purpose
The lab-technician-facing station in CareHub's hospital clinical pipeline. Lets a Lab Technician see tests a doctor has ordered for a patient, enter structured results, write an interpretation, and message the ordering doctor. Exists only within the Hospital business-type vertical (see `hospital.md`) — no equivalent exists for any other business type.

## Files
`pages/dashboard/hospital/Lab.jsx` (the module itself, 318 lines — no dedicated subfolder), `pages/dashboard/hospital/Doctor.jsx` (sole producer of `lab_requests`), `lib/permissions.js` (`ROLES['Lab Technician']`), `App.jsx` (`useAuth()` for result attribution), `pages/dashboard/BusinessDashboard.jsx` (route registration). A codebase-wide grep for every lab-related identifier confirmed these are the only files with any lab-domain reference.

## Components
No sub-component decomposition — the queue list, request-detail/result-entry view, and doctor-communication thread are all conditional JSX blocks inside the single `Lab` function. Shared primitives: `Card`, `StatCard`, `Inp`, `Sel`, `Textarea`, `GhostBtn`, `TealBtn`, `Pill`, `Loading`, `Empty`.

## Services
No shared service layer. `Lab.jsx` defines its own private copy of the Supabase credentials and `sbFetch`, plus `getLabRequests`, `getLabResults` (defined, never called), `addLabResult`, `updateLabRequest`, `addPatientMessage`, `getPatientMessages` — none of these live in `lib/supabase.js`. `Doctor.jsx` independently defines a second copy of the same credentials plus its own `addLabRequest()`.

## Dependencies
Its own local `sbFetch`, `lib/permissions.js`, `App.jsx`'s `useAuth()`, `components/ui/index.jsx`. Entirely dependent on `Doctor.jsx` as its only source of work — there is no walk-in/self-referred lab intake. Result-widget selection depends on a locally-defined 18-entry `COMMON_TESTS` catalogue matched by exact string against the ordered test name.

## Database Tables
`lab_requests` (written by Doctor on order, updated by Lab on completion), `lab_results` (written by Lab, never read back by anything including this module), `patient_messages` (shared with Doctor and Imaging). No date filter or pagination on `getLabRequests`; filtering into pending/completed tabs happens client-side.

## Current State
Ordering and result-submission both work mechanically. **The pipeline dead-ends here**: `submitResults()` never calls `updatePatient()`, so a patient sent only to Lab is never discharged by anything in the application (see `patient.md`). Doctor's 10-item quick-add test-name list does not exactly string-match Lab's 18-entry `COMMON_TESTS` catalogue, so a meaningful share of ordered tests silently render as a plain free-text box instead of the intended structured input. Submitted results are never displayed anywhere — `getLabResults()` is dead code, and the "completed" view shows only a static confirmation banner, not the actual result data. `stat`-priority requests are visually indistinguishable from `routine` ones.

## Missing Documentation
No specification exists for the `COMMON_TESTS` catalogue's intended relationship to `Doctor.jsx`'s separate 10-item quick-add list — nothing states whether these are meant to be the same list (in which case they've drifted) or deliberately different. No document describes what `lab_results`'s `unit`/`normal_range` fields were meant to support, given nothing in the codebase currently reads or displays them. No document records that lab-only visits do not currently reach discharge — this is a significant enough operational gap that its absence from any known-issues list is itself worth noting.
