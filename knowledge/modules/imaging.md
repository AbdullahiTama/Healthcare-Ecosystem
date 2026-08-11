# Imaging — Business Domain

## Purpose
The radiographer-facing station in CareHub's hospital clinical pipeline. Lets a radiographer see scans a doctor has ordered for a patient, upload a findings report (and optionally a link to the image/PDF), and message the ordering doctor. Structurally the mirror of the Laboratory domain, exists only within the Hospital business-type vertical.

## Files
`pages/dashboard/hospital/Imaging.jsx` (239 lines), `pages/dashboard/hospital/Doctor.jsx` (sole producer of `imaging_requests`), `lib/permissions.js` (`ALL_NAV_HOSPITAL`'s `imaging` entry), `App.jsx` (`useAuth()`).

## Components
No sub-component decomposition — list view, request-detail/report-upload view, and communication thread are conditional blocks inside the single `Imaging` function. Shared primitives: `Card`, `StatCard`, `Inp`, `Sel`, `Textarea`, `GhostBtn`, `TealBtn`, `Pill`, `Loading`, `Empty`.

## Services
No shared service layer. `Imaging.jsx` defines its own private copy of the Supabase credentials and `sbFetch`, plus `getImagingRequests`, `updateImagingRequest`, `addPatientMessage`, `getPatientMessages` (a third near-identical copy of the same two message functions also duplicated in `Doctor.jsx` and `Lab.jsx`) — none of this lives in `lib/supabase.js`.

## Dependencies
Its own local `sbFetch`, `App.jsx`'s `useAuth()`, `components/ui/index.jsx`. Entirely dependent on `Doctor.jsx` as the only source of work — no walk-in imaging intake exists. Uses fixed `SCAN_TYPES` and `BODY_PARTS` arrays hardcoded in the file, distinct from (and not shared with) any list elsewhere.

## Database Tables
`imaging_requests` (`id, patient_id, business_id, consultation_id, patient_name, requested_by, scan_type, body_part, clinical_info, status, report, report_url, performed_by`), `patient_messages` (shared with Doctor and Lab).

## Current State
Ordering and report-submission both work mechanically, including an optional external image/PDF URL link. **Shares the same pipeline dead-end as Laboratory**: `submitReport()` never calls `updatePatient()`, so a patient sent only to Imaging is never discharged by anything in the application. No priority/urgency field exists on imaging requests at all (unlike Lab's `routine`/`urgent`/`stat`), so all imaging requests display identically regardless of clinical urgency.

## Missing Documentation
No document records that Imaging (like Laboratory) never advances patient status — this is the same class of gap as Laboratory's, affecting the same shared `patients.status` state machine, and nothing ties the two domains' identical dead-end together as one root cause. No document explains why Imaging has no priority field when Laboratory does, despite both being structurally parallel doctor-ordered diagnostic domains.
