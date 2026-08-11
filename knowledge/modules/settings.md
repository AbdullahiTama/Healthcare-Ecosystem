# Settings — Business Domain

## Purpose
Per-business configuration screen — business profile fields and operational settings consumed elsewhere (e.g., by Point of Sale).

## Files
`apps/carehub/src/pages/dashboard/Settings.jsx` (the entire module), `pages/dashboard/POS.jsx` (reads settings at checkout).

## Components
Single default-exported component. No sub-component decomposition.

## Services
`lib/supabase.js`: `getSettings`, `saveSettings` (a manual check-then-write upsert against `business_settings`), `updateBusiness` (writes to the `businesses` table directly for profile fields).

## Dependencies
`lib/utils.js` (`businessIcon`, `businessName`, `NIG_STATES`).

## Database Tables
`business_settings` (per-business config, exact column set not fully enumerated in prior review passes), `businesses` (profile fields via `updateBusiness`).

## Current State
Viewing and saving both business profile and operational settings are implemented. `saveSettings`'s upsert is a manual "check if a row exists, then PATCH or POST" sequence rather than a genuine database upsert, which is a read-then-write race under concurrent saves from two devices. This domain has **no configuration surface for any hospital-specific taxonomy** — departments, insurance/HMO panels, and lab/imaging test catalogues are hardcoded in `Reception.jsx`/`Doctor.jsx`/`Lab.jsx`/`Imaging.jsx` rather than editable here (see `hospital.md`).

## Missing Documentation
No document enumerates the full `business_settings` schema — this entry's coverage of it is incomplete because the table's columns were not fully catalogued in prior review passes. No document states whether hospital taxonomy configuration was planned for this screen and not yet built, or was never intended to live here.
