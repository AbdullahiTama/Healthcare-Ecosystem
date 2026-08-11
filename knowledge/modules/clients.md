# Clients — Business Domain

## Purpose
A generic CRM record for a business's customers — name, contact details, demographics, lifetime spend, visit count. For hospital-type tenants, this screen's page title is relabeled "Patients" in the UI, but it remains a fully separate system from the clinical `patients` domain documented in `patient.md` — no shared identifier or code path connects a row in one to a row in the other.

## Files
`apps/carehub/src/pages/dashboard/Clients.jsx` (the entire module, 142 lines — a single file, no sub-components in separate files).

## Components
`Clients` (default export: list, search, add-client modal, detail modal) — all defined inline in one file. Shared primitives: `Card`, `StatCard`, `SectionHead`, `Modal`, `Pill`, `Inp`, `Sel`, `Textarea`, `GhostBtn`, `TealBtn`, `Avatar`, `Loading`, `Empty`.

## Services
`lib/supabase.js`: `getClients`, `addClient`, `updateClient`. A fourth function, `searchClients`, is defined in the service file but has zero call sites anywhere in the codebase — `Clients.jsx` instead re-implements the same search client-side via `.filter()` against the full unfiltered list.

## Dependencies
`lib/utils.js` (`fmt`, `todayDate`), `components/ui/index.jsx`. No dependency on the Patients/Hospital Workflow domain despite the shared "Patients" label in hospital-tenant UI.

## Database Tables
`clients` (`id, business_id, full_name, phone, email, address, date_of_birth, gender, notes, total_spend, visit_count, created_at`). No foreign key or shared identifier to the `patients` table.

## Current State
Add, view, and search (client-side, unfiltered fetch) are implemented and functional. `total_spend`/`visit_count` are stored fields with no code path found in this domain that increments them on a sale — their update mechanism (if any) was not located within this file. The `searchClients` service function is dead code.

## Missing Documentation
No document states whether the `clients` and `patients` tables were intended to converge, stay permanently separate, or eventually be reconciled — this is the same open question raised in `patient.md` and `hospital.md`, listed here from this domain's side. No document specifies what is supposed to update `total_spend`/`visit_count`, since no write path for either field was found in this file.
