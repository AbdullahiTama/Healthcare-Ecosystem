# Appointments — Business Domain

## Purpose
Scheduling for client/patient visits — booking, editing, and cancelling appointments against a date. Available to every business type via `ALL_NAV_DEFAULT`/`ALL_NAV_HOSPITAL`.

## Files
`apps/carehub/src/pages/dashboard/Appointments.jsx` (the entire module).

## Components
Single default-exported component with inline list/add-modal views, consistent with every other CareHub domain's lack of sub-component decomposition. Shared primitives from `components/ui/index.jsx`.

## Services
`lib/supabase.js`: `getAppointments`, `addAppointment`, `updateAppointment`, `deleteAppointment` — full CRUD, correctly centralized.

## Dependencies
`lib/utils.js` (`todayDate`). No dependency on and no code-level connection to the Patients/Hospital Workflow or Clients domains.

## Database Tables
`appointments` (`id, business_id, date`, plus client-identifying fields — not fully enumerated in prior review passes).

## Current State
Full CRUD is implemented. This domain is **isolated from the Reception intake flow**: a booked appointment has no link to a `patients` row, and Reception's registration screen has no code path that reads or consumes an existing appointment — a hospital's patient still has to be manually re-registered at Reception even if they were scheduled in advance through this domain.

## Missing Documentation
No document specifies whether Appointments was intended to feed Reception (i.e., an appointment becoming a registered patient without re-entering demographic data) — nothing in either domain's code shows awareness of the other. No document records the exact `appointments` table schema; this entry's column list is incomplete relative to the other domains in this set because the file was not read in full detail during prior review passes.
