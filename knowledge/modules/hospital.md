# Hospital Workflow — Business Domain

## Purpose
The business-type vertical that makes CareHub present itself as a hospital/clinic when a tenant is registered with `business_type: 'hospital'`: a dedicated sidebar navigation set (`ALL_NAV_HOSPITAL`), a dashboard-home "Patient Flow" widget, and a relabeled "Clients" screen (title only — see `patient.md` for why this doesn't actually connect the two systems). This domain is the wiring layer around the clinical pipeline documented in `patient.md`, `laboratory.md`, and `pharmacy.md`.

## Files
`pages/dashboard/hospital/*` (all six station files), `pages/dashboard/ConsultationRouter.jsx`, `pages/dashboard/Clients.jsx`, `pages/dashboard/DashboardHome.jsx` (the `isHospital` branch), `pages/dashboard/BusinessDashboard.jsx` (route table), `pages/auth/Register.jsx` (business-type selection), `components/layout/Sidebar.jsx`, `lib/permissions.js`, `lib/utils.js` (`BUSINESS_TYPES` registry).

## Components
Six independent, non-decomposed station page components (see `patient.md`, `laboratory.md`, `pharmacy.md` for each). `DashboardHome.jsx`'s "Hospital Patient Flow" widget is a static, non-data-driven inline diagram duplicating the same six-station list that also exists, independently, inside `lib/permissions.js`'s `ALL_NAV_HOSPITAL`.

## Services
No dedicated service. The mechanism that makes this domain function is `lib/permissions.js`'s `getNavItems(role, businessType)`, which selects `ALL_NAV_HOSPITAL` when `businessType === 'hospital'`. The `business_type === 'hospital'` check that drives *page behavior* (as opposed to nav visibility) is not centralized — it is independently re-derived in `Sidebar.jsx`, `DashboardHome.jsx`, `ConsultationRouter.jsx`, and `BusinessDashboard.jsx`, each with its own hardcoded `'skincare'` fallback.

## Dependencies
`lib/permissions.js`, `lib/utils.js`, `components/ui/index.jsx`. This domain has no dependency on a hospital-specific configuration source — department lists, insurance/HMO panels, and lab/imaging taxonomies are hardcoded directly in `Reception.jsx`/`Doctor.jsx`/`Lab.jsx`/`Imaging.jsx` rather than sourced from `Settings.jsx` or any per-tenant configuration.

## Database Tables
`businesses.business_type` is the field this entire domain is keyed on — set once at registration, never re-validated, cached into `localStorage` as part of the client auth object and not re-fetched on each session. All clinical tables (`patients`, `triage`, `consultations`, `prescriptions`, `lab_requests`, `lab_results`, `imaging_requests`, `patient_messages`) are documented in `patient.md`/`laboratory.md`.

## Current State
Business-type selection at signup works and correctly drives which sidebar the tenant sees. **The underlying routes are not access-controlled by business type** — `BusinessDashboard.jsx`'s route table mounts `reception`/`triage`/`doctor`/`rx_inbox`/`lab`/`imaging` unconditionally for every tenant; only the sidebar hides them for non-hospital business types. A non-hospital tenant's staff member who navigates directly to `/dashboard/reception` can use the full clinical pipeline regardless of their business's configured type. Within hospital tenants, the `Manager` role's nav array does not include any clinical station, while `Owner` and the clinical roles do — an asymmetry not documented anywhere.

## Missing Documentation
No document states which business types are meant to have route-level access to the hospital pipeline versus which merely lack a nav link to it — this ambiguity (nav-hiding vs. actual access control) is not resolved anywhere in the codebase or its documentation. No document explains why `hospital` is the only business type with its own page subfolder (`pages/dashboard/hospital/`) while the enterprise vertical's pages sit flat — whether this is an intentional pattern for future verticals or an artifact of hospital being built first. No document records the hardcoded department/insurance/scan-type taxonomies as a deliberate MVP simplification versus an oversight relative to `Settings.jsx` having no configuration surface for them.
