# Patients — Business Domain

## Purpose
CareHub's clinical workflow engine for hospital/clinic-type businesses, modeling a patient's physical journey through a facility: Reception → Triage → Doctor → (Lab and/or Imaging, optional) → Pharmacy → Discharge. This is a distinct domain from **Clients** (the generic CRM record, which the hospital UI also labels "Patients" but which shares no data with this domain — see `clients.md`).

## Files
`pages/dashboard/hospital/Reception.jsx`, `Triage.jsx`, `Doctor.jsx`, `RxInbox.jsx`, `Lab.jsx`, `Imaging.jsx` (the six clinical stations); `pages/dashboard/ConsultationRouter.jsx` (placeholder for non-hospital consultation forms); `lib/supabase.js` (partial service layer); `App.jsx`/`BusinessDashboard.jsx` (auth context and route wiring).

## Components
No component decomposition — each of the six station files is a single large default-exported function containing its own list, detail/form, and confirmation views. `StatusBadge` (maps a `patients.status` value to a label/color) is independently redefined in both `Reception.jsx` and `Triage.jsx`. Shared primitives: `Card`, `StatCard`, `SectionHead`, `Inp`, `Sel`, `Textarea`, `GhostBtn`, `TealBtn`, `Avatar`, `Loading`, `Empty`, `Pill`.

## Services
Split three ways. Centralized in `lib/supabase.js`: `getPatients`, `addPatient`, `updatePatient`, `getTriage`, `addTriage`, `addConsultation`, `getPrescriptions`, `addPrescription`, `updatePrescription`. Locally reimplemented, never shared: `Doctor.jsx`, `Lab.jsx`, and `Imaging.jsx` each define their own copy of the Supabase credentials and a private `sbFetch`-equivalent covering `lab_requests`, `lab_results`, `imaging_requests`, and `patient_messages` — four tables with no representation in `lib/supabase.js` at all.

## Dependencies
`lib/permissions.js` (nav gating only, no field-level checks), `lib/utils.js`, `components/ui/index.jsx`, `App.jsx`'s `useAuth()` (used in Doctor/Lab/Imaging for staff attribution, absent in Reception/Triage). Cross-domain: `Doctor.jsx` reads the shared `products` prop (Inventory domain) to search "Medicines" for prescribing — read-only, no stock reservation.

## Database Tables
`patients` (`id, business_id, reg_no, full_name, date_of_birth, gender, phone, address, next_of_kin, next_of_kin_phone, insurance, pay_status, department, assigned_doctor, status, created_at`), `triage`, `consultations` (written, never read back by any page), `prescriptions`, plus the four shadow-service tables above. All list reads are unfiltered by date and unpaginated.

## Current State
Reception → Triage → Doctor is fully implemented and functional as a linear handoff. **The pipeline does not complete for diagnostic-only visits**: neither `Lab.jsx` nor `Imaging.jsx` calls `updatePatient()`, so a patient sent only to Lab/Imaging is never discharged by anything in the codebase — they remain permanently at `status: 'at_lab'`. The Doctor's Disposition selector (Discharge/Admit/Refer/Emergency Transfer) is captured and stored but has no effect on `patients.status`, which is instead derived solely from which destinations (Pharmacy/Lab/Imaging) were checked. The "Doctor Name," "Follow-up Date," and "Follow-up Clinic" form fields are captured in UI state but never sent to the database. Two dead status values (`at_reception`, `admitted`) are defined in `StatusBadge` maps but never assigned by any code path.

## Missing Documentation
No written state-machine specification for `patients.status` exists anywhere — the seven possible values and their legal transitions had to be reverse-engineered from six separate files for this entry, and no source confirms whether the "Lab/Imaging never discharges" behavior is a known, accepted gap or an unnoticed defect. No documentation states the intended relationship (if any) between the `clients` and `patients` tables, despite both being labeled "Patients" in the same UI. No documentation explains why `consultations` and `lab_results` are written but never read back by any screen — whether a patient-history view was planned and not built, or whether this is intentional.
