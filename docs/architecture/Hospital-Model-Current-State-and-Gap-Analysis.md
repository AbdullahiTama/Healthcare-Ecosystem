# Hospital Model: Current-State Audit and Gap Analysis

**Status:** first issue, 2026-11-16. Written against `main` at `7eadd23` and the live Supabase project
`szdybxmgmhndoytqanfb` (read-only queries on 2026-11-16; nothing was changed). **Update 2026-11-17:** the owner
chose `clients` as the patient identity; the Phase 0 fixes for D1–D7 were applied to production the same day:
[Hospital-Phase-0.md](Hospital-Phase-0.md). This document describes production as it was before Phase 0; the gap matrix
from Phase 1 onward still stands.

**Purpose:** the first two deliverables required by the *CareFind Hub Hospital Model: Upgrade & Implementation
Specification* (§13.1 and §14): an inventory of what the Hospital Model is today and a gap matrix against the
specification. No implementation decision is taken here. Each section says where a decision from the product owner, or from a clinical or legal reviewer, is still needed.

**Specification reference:** "CareFind Hub Hospital Model Specification (Final)", 9 pages, supplied by the product owner
on 2026-11-16. It is not stored in the repository; the section numbers below (§) refer to it.

Contents:

1. Summary
2. How the specification reads (and where it is incomplete)
3. Current state: product boundary, screens, workflow, data, security, tests
4. Defects and risks found
5. Gap matrix
6. Recommended sequence
7. Decisions needed
8. Verification method and limits

---

## 1. Summary

- The Hospital Model today is a **patient-routing prototype**: six screens (Reception, Triage, Doctor, Rx Inbox, Lab,
  Imaging) that move a patient along by changing a single `patients.status` value. It is the foundation the
  specification describes in §1 and §4.2, and it should be preserved as the starting point. It is not yet the
  connected clinical record the specification asks for.
- **Live use is negligible:** 11 patients across 4 hospital businesses, no clinical write since 2026-07-18, and no lab
  result has ever been saved. A redesign of the data model can be done now at almost no migration cost. That
  will not stay true once a hospital adopts the system.
- **One production defect:** the Doctor screen cannot send a patient to the laboratory or imaging (the request
  writes a column the tables do not have), and the consultation save is not atomic, so a failure leaves partial
  records (§4, D1).
- **Two High security findings:**
  - any member of a business, whatever their role, can read and delete every clinical record through the API (D2);
  - the Hospital Model boundary is not enforced by the server: non-hospital businesses can and do hold patient
    records (D3).

  Both conflict directly with the specification's §3, §10 and §12.
- **The schema is not under version control:** the eight hospital tables were never created by a file in
  `supabase/migrations/` (D4).
- **Two patient identities:** at a hospital the "Patients" menu shows the `clients` table, while Reception writes to
  the separate `patients` table (D5). The specification (§13.3) requires one identity, reused.
- Against the specification as a whole: **6 capabilities partial, 1 broken, the rest missing**. The largest missing
  piece is structural rather than a screen: there is no **encounter** (visit). Every module the specification
  describes hangs off an encounter (§7.2), so it has to come first.

## 2. How the specification reads

The specification asks for a configurable Hospital Management and Clinical Information System covering arrival to
follow-up (§5). Four requirements run through every section and shape the architecture more than any single module:

| Cross-cutting requirement | Where | Consequence for design |
|---|---|---|
| One longitudinal patient record built from encounters | §7.2, §12 | An `encounters` entity is the parent of every clinical document, order and result. |
| Per-hospital configuration, versioned with approval history | §6, §8.1, §8.4 | Departments, forms, workflows, templates and roles are data, with versions and approvers, not code. |
| Signed records are preserved; changes are addenda | §7.2, §7.4, §8.4, §10 | Clinical documents become immutable once signed; issued reports store their rendered version. |
| The Hospital Model boundary is enforced server-side | §3, §12, §13.2 | Business-type and role checks in the database, not only in navigation. |

**Gaps in the specification itself** (to resolve with the product owner):

- **§4 "Existing Foundation to Preserve" is empty.** Its three subsections (4.1 Patient registration, 4.2 Current
  patient movement, 4.3 Explicit exclusion) have headings and no content in the PDF. The rest of the document implies
  their intent: 4.1 = reuse existing registration, biodata, next of kin and insurance (§13.3, §16); 4.2 = the
  Reception → Triage → Doctor → departments flow (§1); 4.3 = patient wallet (§13.3, §16). Those readings are
  assumptions until confirmed.
- **"Patient wallet" is not defined.** The platform has a CareCoin wallet for CareFind users
  ([CareCoin-Wallet.md](CareCoin-Wallet.md)) and a business wallet in CareHub. The exclusion is read here as "no
  patient-facing wallet or payment balance is introduced by this upgrade"; the business wallet is unaffected.
- The opening is duplicated (two sections numbered 1 and 2), and the section numbers in the second half are the
  references used here.
- Billing and insurance claims are mentioned only as integrations (§12). Whether hospital billing is in scope
  is not stated.
- The specification states (closing note) that clinical protocols, terminology licensing (SNOMED CT), privacy
  obligations and jurisdictional requirements must be validated by qualified people. This audit does not invent any;
  §7 lists where such sign-off is needed.

## 3. Current state

### 3.1 Product boundary (how the Hospital Model is identified)

- A business's model is `businesses.business_type`. The value `hospital` turns on the clinical modules.
- The module registry in `apps/carehub/src/lib/permissions.js` (see
  [Business-Types-and-Module-Registry.md](Business-Types-and-Module-Registry.md)) gates `reception`, `triage`,
  `doctor`, `rx_inbox` and `imaging` to `HOSPITAL_TYPES = ['hospital']`. The `lab` module is also given to stand-alone `laboratory`
  businesses.
- `clinic` businesses do **not** get the hospital modules. They get `appointments` and `consultations` (the
  forms-based consultation module shared with pharmacy and beauty types, table `consultation_forms`).
- Hospitals do **not** get `appointments` (gate `RETAIL_TYPES` excludes `hospital`), although §5 and §7.1 put
  appointments at the start of the journey.
- **Enforcement is UI-only.** The registry decides navigation and route guards (`BusinessDashboard.jsx` `guard()`).
  The database does not know about business types for these tables (see 3.5).
- **An owner can change their own business type through the API** (verified live 2026-11-16). The Settings screen does
  not offer it, but the `own business row` policy allows the owner to update their row, `authenticated` holds UPDATE on
  `businesses.business_type`, and neither `guard_business_privileged_columns` nor `businesses_operating_model_guard`
  checks that column (the latter only guards `operating_model` and `account_kind`). Specification §3 and §13.2 require
  that ordinary administrators cannot change the business model. Today, an owner of any business could make it a hospital,
  or move a hospital out of the Hospital Model.

### 3.2 Screens

All in `apps/carehub/src/pages/dashboard/hospital/`, lazy-loaded and routed in
`apps/carehub/src/pages/dashboard/BusinessDashboard.jsx` (lines 63–68, 320–325). Data access goes straight from the
component to `services/supabase.js` helpers. There is no module folder, no service layer and no repository,
unlike the module convention (PROJECT_OVERVIEW §3).

| Screen | Lines | What it does | Notable limits |
|---|---|---|---|
| `Reception.jsx` | 174 | Lists and searches patients (server-side `ilike` across the business); registers a patient with biodata, next of kin, insurance, payment status, department and a typed doctor name; sets status `at_triage`. | Departments and insurers are hard-coded lists; doctor is free text; registration number generated in the browser (`genId('REG')`), not unique in the database; no duplicate check; a returning patient cannot start a new visit; the "Total Today" card counts all patients loaded, not today's. |
| `Triage.jsx` | 136 | Queue of `at_triage`; records weight, height, BP, pulse, temperature, RR, SpO₂, blood sugar, chief complaint, allergies; sets `at_doctor`. | All vitals are free-text strings with no units or ranges; nurse name typed by hand; no triage scale or acuity; no reassessment; allergies stored per triage, not on the patient. |
| `Doctor.jsx` | 432 | Queue of `at_doctor`; shows triage data and the message thread; records HPI, examination, two diagnoses (free text), notes, disposition (Discharge / Admit / Refer / Emergency Transfer); prescribes from the business's inventory (`category = 'Medicines'`); requests lab tests and imaging; sets the next status. | **Lab/Imaging send is broken (D1).** Five to seven sequential writes with no transaction. No review of systems, no structured diagnosis coding, no signing. Staff name taken from the logged-in account (correct). |
| `RxInbox.jsx` | 138 | Lists prescriptions; "Mark dispensed" sets the prescription `dispensed` and the patient `discharged`. | Dispensing does not deduct stock or record a sale; discharges the patient even if lab or imaging work is still pending; no partial dispensing; no preset hospital role includes Rx Inbox (only Owner, and the retail Pharmacist role, which hospitals are not offered). |
| `Lab.jsx` | 302 | Lists lab requests; enters a result per test with summary; marks the request `completed`; posts a message. | Parses the `tests` column with `JSON.parse`, which fails on rows stored as JSON arrays (all current rows, see D6); no specimen, units or reference ranges from a test catalogue; no validation or release step; no critical-result handling; no report output. |
| `Imaging.jsx` | 224 | Lists imaging requests; records a free-text report and an optional pasted URL; marks `completed`. | No modality, technique, findings/impression split, verification, or file upload (a typed URL only); shows `priority` and `patient_name`, which the table does not have. |

States: every screen has a loading and empty state, and all but Imaging an error state (corrected 2026-11-17: a
failed Imaging load showed "No pending scan requests"; fixed in Phase 0). Layout uses two-column grids that are not
collapsed on phones in the registration and triage forms (Reception fixed in Phase 0). Accessibility was not audited in this pass.

### 3.3 Workflow as built

```
Reception ──register──▶ at_triage ──Triage──▶ at_doctor ──Doctor──┬─ disposition Admit ─────▶ admitted
                                                                  ├─ Refer ─────────────────▶ referred
                                                                  ├─ Emergency Transfer ────▶ transferred
                                                                  └─ Discharge ─┬─ lab/imaging sent ─▶ at_lab
                                                                                ├─ pharmacy sent ────▶ at_pharmacy
                                                                                └─ none ─────────────▶ discharged
Rx Inbox "dispensed" ─▶ discharged         Lab / Imaging "completed" ─▶ (patient status unchanged)
```

- The patient's single `status` is both the queue and the record of the visit. Nothing returns a patient from
  `at_lab` to the doctor; `admitted`, `referred` and `transferred` have no screen that acts on them.
- Live data also holds `at_reception` (4 patients), a status no current screen produces or queues.
- There is no visit: a returning patient's status is overwritten and their earlier triage cannot be told apart from
  the new one (`getTriage` returns the first row for the patient).

### 3.4 Data (live, 2026-11-16)

None of these tables is created by a file in `supabase/migrations/` (searched by name). Timestamps are
`timestamp without time zone`. No CHECK or UNIQUE constraints exist on any of them.

| Table | Rows | Key columns | Foreign keys |
|---|---|---|---|
| `patients` | 11 | `reg_no`, `full_name`, `date_of_birth` (text), `gender`, `phone`, `address`, `next_of_kin`, `next_of_kin_phone`, `insurance`, `pay_status`, `department`, `assigned_doctor` (text), `status` | business → CASCADE |
| `triage` | 1 | vitals as text, `chief_complaint`, `allergies`, `nurse_name`, `performed_by` | patient, business → CASCADE |
| `consultations` | 6 | `hpi`, `examination`, `primary_diagnosis`, `secondary_diagnosis`, `clinical_notes`, `disposition`, `referral_*`, `ward`, `counselling`, `doctor_name` | patient, business → CASCADE |
| `prescriptions` | 2 | `medicines` jsonb, `lab_tests`, `imaging` (text), `status`, `dispensed_by`, `dispensed_at` | patient, business, consultation → CASCADE |
| `lab_requests` | 2 | `tests` jsonb, `priority`, `requested_by`, `requested_by_id` (never set) | patient, business → CASCADE; consultation (no action) |
| `lab_results` | 0 | `results` jsonb, `summary`, `report_url`, `performed_by_id` (never set) | request, patient, business → CASCADE |
| `imaging_requests` | 1 | `scan_type`, `body_part`, `clinical_info`, `report`, `report_url` | patient, business → CASCADE; consultation (no action) |
| `patient_messages` | 1 | `sender_name`, `sender_role`, `department`, `message`, `message_type` | patient, business → CASCADE |

- Hospital businesses: 4. Patients belonging to **non-hospital** businesses: 3 (D3).
- All rows with a 2026-07-18 timestamp share the same instant, so they are seed or test data rather than real use.
- The hospital tables use `patients`; the rest of CareHub (POS, debts, appointments, consultation forms, the
  "Patients" menu at a hospital) uses `clients` (D5).

### 3.5 Security model (live, 2026-11-16)

- **Row-level security is on** for all eight tables.
- **Policies:** one `FOR ALL` policy per table: `business_id IN current_business_ids() OR is_platform_admin()`
  (`lab_results` and `patient_messages` check through their parent). Any member of the business, in any role, can
  select, insert, update and delete every row.
- **Grants:** `anon` and `authenticated` both hold SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER on
  every table. RLS protects rows for the REST operations. TRUNCATE is not exposed through PostgREST, but the grant is
  the same over-breadth closed for `export_logs` in A2.
- **No triggers, no audit trail.** Nothing records who viewed, created, changed or deleted a clinical record. Clinical
  rows can be edited in place after the fact; deleting a patient cascades away their entire clinical history.
- **No business-type check.** Nothing in the database restricts these tables to hospital businesses.
- The platform's existing patterns (SECURITY DEFINER functions for sensitive writes, append-only audit tables,
  guard triggers, PGlite tests before applying) are the right tools and should be reused rather than reinvented
  (§6).

### 3.6 Tests

- No test file covers any of the six hospital screens or their data helpers.
- `permissions.test.js` covers the registry gates (that clinical modules do not leak to other business types in the
  navigation).
- No PGlite test exists for the hospital tables, because their schema is not in the migrations.

## 4. Defects and risks found

| ID | Severity | Finding | Evidence | Audit item |
|---|---|---|---|---|
| D1 | High (production defect) | **Doctor → Lab / Imaging cannot be sent**, and a failed send leaves partial records. `Doctor.jsx` posts `patient_name` to `lab_requests` and `imaging_requests`; neither table has that column, and PostgREST rejects a write naming an unknown column. The consultation (and any prescription) has already been saved by then. The patient's status is not updated. Retrying saves the consultation again. | Code `Doctor.jsx:117–146`; live columns (§3.4). Not reproduced through the API in this pass (read-only audit). Consistent with no lab request since the 2026-07-18 seed and no lab result ever. | A36 |
| D2 | High | **Clinical data is open to every role**, through the API. A Cashier at a hospital can read every diagnosis, prescription and result, and can delete a patient (cascading their history). Role permissions only hide navigation. | Live policies and grants (§3.5). | A34 |
| D3 | High | **Hospital Model boundary not enforced server-side.** Any business can create and read patients and clinical records through the API, and an owner can change their own `business_type` through the API. | No business-type condition in any policy; 3 live patients belong to non-hospital businesses; `business_type` has a client UPDATE grant and no guard (§3.1). | A35 |
| D4 | Medium | **Hospital schema is not in version control.** The eight tables, their policies and grants exist only in the live database. A rebuild, a branch or a PGlite test cannot reproduce them. | No `CREATE TABLE` for them in `supabase/migrations/`. | A37 |
| D5 | Medium (owner decision) | **Two patient identities.** Reception writes `patients`; the hospital "Patients" menu, the POS, debts and appointments use `clients`. A hospital patient who pays at the POS is a second, unrelated person. | `permissions.js` `labelByType`, `modules/clients/repositories/index.js`, `Reception.jsx`. | A38 |
| D6 | Medium | **JSON columns read inconsistently.** `lab_requests.tests` and `prescriptions.medicines` are jsonb. The screens write `JSON.stringify(...)`, which stores a JSON string, and read with `JSON.parse`, which fails on the JSON arrays the live rows contain. Lab shows no tests and cannot save results for those rows; Rx Inbox shows zero medicines. | Live `jsonb_typeof` = `array` for all rows; `Lab.jsx:71,134,271`, `RxInbox.jsx:41,113`. | A36 |
| D7 | Medium | **Dispensing discharges the patient** whatever else is pending, and does not deduct stock. | `RxInbox.jsx:25–33`. | A36 |
| D8 | Low | Records are editable in place with no signature or amendment history; registration number not unique; vitals stored as free text; dates of birth stored as text. | §3.2, §3.4. | Addressed by Phase 1 (not separately tracked) |

## 5. Gap matrix

Status key: **Existing**: meets the requirement. **Partial**: a usable start that needs extending.
**Broken**: present but does not work. **Duplicated**: two competing implementations. **Missing**: not present.
**N/A**: excluded or out of scope for this upgrade.

Dependencies refer to other rows by section number. "Phase" is the specification's §15 phase.

### 5.1 Platform and boundary

| § | Requirement | Status | What exists | Gap | Depends on | Phase |
|---|---|---|---|---|---|---|
| 3 | Hospital features scoped to the Hospital Model | Partial | Registry gates navigation and routes. | Server-side business-type enforcement (D3). | — | 0 |
| 3 | Modular activation of services (OPD, emergency, inpatient, theatre, lab, radiology, specialist clinics) | Missing | All six screens on for every hospital. | Per-facility service activation, enforced server-side. | 6 config | 1 |
| 3, 13.2 | Ordinary administrators cannot change the business model | Missing (server) | Settings has no control for it. | `business_type` is writable by the owner through the API (§3.1, D3): guard it; controlled, audited change by platform staff only. | — | 0 |
| 6 | Services, branches, departments, rooms, wards, beds, service points | Missing | Hard-coded department list; `locations` module exists for branches. | Facility structure as data, reusing `locations` for branches. | — | 1 |
| 6 | Configurable forms and fields | Missing | Fixed forms. ADR has a form engine (`modules/adr/formEngine.js`) worth evaluating for reuse. | Form definitions with field types, validation, visibility. | Governance | 1–2 |
| 6 | Configurable workflow (stages, statuses, assignment, escalation) | Missing | Statuses hard-coded in screens. | Workflow definitions per facility. | Encounters | 1–3 |
| 6 | Terminology (recognised plus local terms) | Missing | Free text everywhere. | Terminology tables; licensing decision for SNOMED CT. | Owner and licensing | 5 (ICD-10 earlier) |
| 6, 7.15 | Roles by profession, department, branch, care relationship | Partial | Preset roles (Receptionist, Nurse, Doctor, Lab Technician) for navigation. | Database-enforced role and department access (D2); no Pharmacist or Radiographer role for hospitals. | — | 0–1 |
| 6, 8.4 | Configuration governance (versions, approver, activation) | Missing | — | Versioned configuration with approval records. | — | 1 |

### 5.2 Patient journey and modules

| § | Requirement | Status | What exists | Gap | Depends on | Phase |
|---|---|---|---|---|---|---|
| 7.1 | Appointments, rescheduling, cancellation | Missing for hospitals | `appointments` module exists for retail and clinic types, on `clients`. | Enable for the Hospital Model on the single patient identity. | D5 | 3 |
| 7.1 | Walk-in, check-in, queues, encounter creation | Partial | Registration puts a patient in the triage queue. | Check-in creates an encounter; queues per service point; arrival and waiting status. | Encounters | 1 |
| 7.1 | Patient matching and duplicate resolution | Missing | Search by name, phone, reg no. | Matching on registration; merge process with audit (Inventory duplicate merge is a pattern to study). | D5 | 1 |
| 7.1, 13.3 | Reuse existing biodata, next of kin, insurance | **Duplicated** | Held on `patients` and separately on `clients`. | One identity (D5). | Owner decision | 0–1 |
| 7.2 | Longitudinal record with encounters | Missing | Single status per patient; one triage per patient in practice. | `encounters` as parent of every clinical record; patient summary view. | D5 | 1 |
| 7.2 | Allergies / adverse reactions as patient-level data | Partial | Free text on each triage. | Structured allergy list on the patient; ADR module link for reactions. | Encounters | 1 |
| 7.2, 7.4, 10 | Authorship, timestamps, signed originals, addenda | Missing | Text author name on some rows. | Author from the session, signing, immutability after signing, addendum records, audit. | — | 1 |
| 7.3 | Triage: vitals, pain, triage scale, acuity, reassessment, escalation | Partial | Eight vitals, complaint, allergies. | Typed vitals with units; configurable triage scale (clinical sign-off); reassessment; escalation. | Encounters | 1 |
| 7.3 | Nursing assessments and care plans | Missing | — | Needs, goals, interventions, frequency, review; completion with reasons. | Encounters, forms | 1 / 4 |
| 7.4 | Doctor consultation (HPI, ROS, exam, assessment, diagnosis, plan, follow-up) | Partial | HPI, exam, two diagnoses, notes, disposition. | Review of systems, structured diagnoses (ICD), plan, follow-up; specialty templates; atomic save (D1). | Encounters | 1 |
| 7.5 | Prescriptions routed to hospital pharmacy | Partial | Prescription row to Rx Inbox. | Full medication fields (strength, form, quantity); review step. | Encounters | 2 |
| 7.5 | Dispensing, partial dispensing, non-availability; stock | Partial | One "dispensed" action. | Partial and unavailable outcomes; stock deduction through the stock ledger; no automatic discharge (D7). | Stock ledger | 2 |
| 7.5 | Medication administration record | Missing | — | MAR for inpatient and supervised care, distinct from prescribing and dispensing. | 7.11 | 4 |
| 7.6 | Lab orders, configurable statuses, specimens | Partial / **Broken** | Request and completed status; sending is broken (D1, D6). | Test catalogue; statuses requested → reviewed; specimen collection and rejection. | Encounters, orders | 2 |
| 7.6 | Results with units, reference ranges, flags; validation | Partial | Free-text result per test. | Catalogue-driven units and ranges, abnormal flags, validation and release by an authorised user. | Test catalogue | 2 |
| 7.6, 10 | Critical-result notification, acknowledgement, escalation | Missing | — | Critical thresholds (clinical sign-off), acknowledgement, escalation with retries. | Notifications | 2 |
| 7.7 | Imaging requests, scheduling, preparation | Partial | Request with scan type and body part. | Modality catalogue, scheduling, preparation instructions. | Orders | 2 |
| 7.7 | Findings, impression, verification; images; prior studies | Partial | Free-text report; pasted URL. | Structured report, verification step, secure upload to storage, prior-study view. | Storage | 2 |
| 7.7 | DICOM / PACS / RIS | Missing | — | Integration plan only at this stage. | — | 5 |
| 7.8, 8 | Report templates: upload or design, map, version, preview, approve | Missing | Consultation printing exists for the forms module (`consultationPrint.js`). | Template designer and mapping; versions with approver; activation scope. | Governance | 2 |
| 7.8, 8.4 | Issued reports immutable; controlled reprint; PDF | Missing | — | Store each issued report's rendered PDF and template version; reprint returns the stored copy. | Storage | 2 |
| 7.9 | Patient reminders and follow-up (SMS, email) | Missing | Shared email outbox (`shared-email`) and notifications exist. | Reminders with consent, delivery tracking, no sensitive content by SMS. | 7.1, consent | 3 |
| 7.10 | Staff messaging, tasks, queues of unsigned/unreviewed work, handover | Partial | Patient message thread (system messages, 1 live row). | Tasks with owner, due date and escalation; work queues; shift handover. | Encounters | 3 |
| 7.11 | Admission, wards, beds, transfers, discharge summary | Missing | "Admit" disposition sets a status; free-text ward. | Admission workflow, bed management, inpatient encounter, discharge summary with medication reconciliation. | 6 structure | 4 |
| 7.12 | Procedures, consent, referrals with outcome | Partial | Referral destination and reason on the consultation. | Referral lifecycle (acknowledgement, outcome); procedure workflow and consent. | Encounters | 4 |
| 7.13 | Chronic disease registers, screening, immunisation, recalls | Missing | — | Registers and care-gap lists. | Encounters, coding | 4 |
| 7.14 | Hospital analytics with documented metrics; export controls | Missing | Platform reports and `record_export_audit` exist. | Hospital dashboards; exports through the existing audited export path. | Encounters | 5 |
| 7.15 | Staff profiles, rosters, licences with expiry | Partial | Staff module and roles. | Professional registration and licence expiry; rosters; restricted HR access. | — | 5 |

### 5.3 Standards, security and non-functional

| § | Requirement | Status | What exists | Gap | Phase |
|---|---|---|---|---|---|
| 9 | FHIR, SNOMED CT, ICD-10/11, LOINC, DICOM | Missing | — | Design the data model so FHIR mapping (Patient, Encounter, Observation, Condition, MedicationRequest, ServiceRequest, DiagnosticReport) is direct; ICD-10 early; others by licence and need. | 1 (shape), 5 (exchange) |
| 10 | Role and context-based permissions | Missing at data level | UI-only role navigation. | D2. | 0 |
| 10 | Audit of view, create, edit, sign, export, release | Missing | `audit_log` (append-only) exists for tenant exports. | Clinical audit events, including reads of sensitive records. | 0–1 |
| 10 | Encryption in transit and at rest | Existing (platform) | Supabase TLS and storage encryption. | Confirm the storage bucket policy for clinical files when uploads arrive. | 2 |
| 10 | Consent, communication preferences, lawful processing | Missing | Privacy notes in `docs/privacy/`. | NDPA review for clinical data (legal sign-off). | 3 |
| 10 | Retention, backup, restore tested | Partial | Supabase backups (platform). | Retention rules for clinical records; replace `ON DELETE CASCADE` with retention-safe deletion; a restore test. | 0–5 |
| 11 | Responsive, low bandwidth, role workspaces | Partial | Screens work on desktop; some two-column forms do not collapse on phones. | Role workspaces; offline scope decision (the specification warns against assuming offline). | 1–3 |
| 12 | Background jobs with retries and idempotency | Partial | Email outbox with daily cron (Vercel Hobby: two daily crons per app). | Reminders and critical-result escalation need sub-daily scheduling; the current hosting limit is a constraint to decide on. | 2–3 |
| 13.3 | Patient wallet excluded | N/A | — | Confirm meaning (§2). | — |

## 6. Recommended sequence

The specification's phases (§15) stand. This audit adds a **Phase 0** in front of them, because the current
foundation cannot carry Phase 1 safely.

**Phase 0: make the foundation safe (small, mostly server-side):**

1. Bring the eight hospital tables under version control: a baseline migration that reproduces the live schema,
   policies and grants exactly, verified on PGlite against the live shape (D4).
2. Fix D1 and D6 now so the existing flow works: remove `patient_name` from the lab and imaging writes (or add the
   column deliberately), read jsonb as returned, and move the consultation save into one SECURITY DEFINER function so
   it either fully succeeds or does nothing. Stop Rx Inbox from discharging a patient with pending work (D7).
3. Enforce the boundary and roles in the database (D2, D3): guard `businesses.business_type` against client changes,
   hospital-only writes, role-scoped reads of clinical
   content, no client DELETE or TRUNCATE on clinical tables, and an append-only clinical audit table.
4. Settle the single patient identity (D5) with the product owner. Nothing in Phase 1 should be built until this is
   decided.

**Phase 1: Foundation (specification Phase 1):** encounters as the parent record, facility structure and service activation,
structured triage and consultation with signing and addenda, patient-level allergies, configuration governance.

**Phases 2–5** as the specification describes. Each phase starts with its own functional brief in the §13.4 format
(purpose, workflow, data, behaviour, configuration, UI, integration, acceptance) and an owner review before
implementation.

## 7. Decisions needed

| # | Decision | Who | Blocks |
|---|---|---|---|
| 1 | Content of specification §4.1–4.3 (empty in the document) | Product owner | Confirms what must be preserved |
| 2 | Single patient identity: `clients`, `patients`, or a new shared identity both reference (D5) | Product owner | Phase 0 step 4, all of Phase 1 |
| 3 | Meaning of "patient wallet" | Product owner | Scope boundary |
| 4 | Whether `clinic` businesses join the Hospital Model; whether `laboratory` keeps the Lab bench under the new lab module | Product owner | Boundary design |
| 5 | Whether hospitals get Appointments now (registry change) or at Phase 3 | Product owner | 7.1 |
| 6 | Hospital billing and insurance claims: in scope or not | Product owner | Phase 2–5 |
| 7 | Triage scale, critical-result thresholds, care-plan content, discharge summary content | Clinical lead | 7.3, 7.6, 7.11 |
| 8 | SNOMED CT licensing; ICD-10 vs ICD-11 for Nigerian reporting | Owner with clinical lead | §9 |
| 9 | NDPA lawful basis, consent and retention period for clinical records | Privacy / legal | §10 |
| 10 | Scheduling for reminders and escalation beyond the Vercel Hobby daily-cron limit | Product owner (cost) | 7.6, 7.9 |

## 8. Verification method and limits

- **Code:** read in full: the six hospital screens, the hospital data helpers in `services/supabase.js`, the module
  registry and role presets in `lib/permissions.js`, and the route definitions in `BusinessDashboard.jsx`.
- **Live database (read-only):** catalogue queries for columns, constraints, policies, triggers and grants on the eight
  tables; the `businesses` policies, triggers and the `business_type` column grant; row counts and latest timestamps; `jsonb_typeof` of the JSON columns; patient status distribution; patients
  per business type.
- **Not done in this pass:**
  - The application was not run, and D1 was not reproduced through the API. The finding rests on the code and the
    live column list.
  - Accessibility was not audited.
  - No hospital user was consulted.

  The specification (§11) asks for usability testing with clinical users before the design is settled.
