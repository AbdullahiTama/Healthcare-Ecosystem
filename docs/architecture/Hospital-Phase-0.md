# Hospital Model Phase 0: a Safe Foundation

**Status:** implemented in the repository 2026-11-17; **migrations not yet applied to production** (each needs the
owner's approval, as every migration here does). Closes, once applied: CODE_AUDIT A34, A35, A36, A37, A38.

**Background:** [Hospital-Model-Current-State-and-Gap-Analysis.md](Hospital-Model-Current-State-and-Gap-Analysis.md)
§6 defines Phase 0 as the work that must come before the specification's Phase 1 (encounters, structured
documentation). Owner decisions taken 2026-11-17: start Phase 0; **`clients` is the patient identity** (A38).

## 1. What Phase 0 changes

| Step | Migration / code | Closes |
|---|---|---|
| 1. Put the hospital schema under version control | `carehub_20270123_hospital_schema_baseline.sql`: the eight tables, indexes, policies and grants exactly as live; applying it changes nothing | A37 (part) |
| 2. Enforce the Hospital Model boundary and roles in the database | `carehub_20270124_hospital_access.sql` | A34, A35, A37 |
| 3. One patient identity; atomic clinical writes | `carehub_20270125_hospital_identity_and_workflow.sql` | A36, A38 |
| 4. Screens use the new functions; defects fixed | `apps/carehub/src/modules/hospital/` (repository, services), the six screens | A36 |

## 2. Who may do what (step 2)

The database decides which clinical work a signed-in person may do with
`hospital_clinical_modules(business)`: the clinical modules of the caller **for that business**, the same answer the
app's module registry and role presets give (`lib/permissions.js`):

- **Business type:** the clinical modules exist only for `hospital` businesses. The `lab` module is also available to
  `laboratory` businesses, as in the registry. Any other business gets none, so it can no longer create or read
  patients or clinical records (A35).
- **Owner** (the business email, an owner of a business above it, or staff with role `Owner`): every module.
- **A custom role** (a `roles` row whose name is the staff member's role): the clinical modules ticked in its `nav`.
  This takes precedence over a preset of the same name, as `getPerms` does.
- **A preset role** (no `roles` row): Receptionist → reception; Nurse → triage; Doctor → doctor;
  Lab Technician → lab; Pharmacist → rx_inbox. Every other preset (Manager, Cashier, Therapist) → none.
- Platform admins keep **read-only** access (they had full access).

What each module may do, per table (no client may DELETE or TRUNCATE any of them):

| Table | Read | Create | Change |
|---|---|---|---|
| `patients` | any clinical module | reception (through `register_hospital_visit`) | any clinical module (the queue status) |
| `triage` | triage, doctor | triage | none |
| `consultations` | doctor | doctor (through `complete_hospital_consultation`) | none (signed notes are not edited in place; addenda are Phase 1) |
| `prescriptions` | doctor, rx_inbox | doctor | rx_inbox (through `dispense_prescription`) |
| `lab_requests` | doctor, lab | doctor | lab |
| `lab_results` | doctor, lab | lab | none |
| `imaging_requests` | doctor, imaging | doctor | imaging |
| `patient_messages` | any clinical module | any clinical module | none |

Also in step 2:

- **`businesses.business_type` is platform-only** after registration. An owner can no longer change it through the
  API (specification §3, §13.2). Platform admins still can, and the change is recorded in `admin_audit_log`.
- **Clinical history is kept.** A patient's clinical rows no longer cascade from the patient: the foreign keys are
  `NO ACTION` (was `CASCADE`), so a patient with records cannot be deleted. `NO ACTION` rather than `RESTRICT`: it is
  checked at the end of the statement, so the platform's hard delete of a whole business (patients and records together)
  still works. Every clinical row must belong to the same business as its patient, and cannot be moved to another
  patient, business, consultation or request afterwards.
- **Clinical audit trail:** `clinical_audit_log` records every insert and update on the eight tables (who, when,
  which row and patient, and the previous values of changed columns). It is append-only: no client can write, change
  or delete it. The Owner and platform admins can read it. Reads are not audited yet: Postgres has no read
  trigger. Read auditing comes with Phase 1, when clinical reads go through functions.

**Changes for existing users (live 2026-11-17: 5 staff across 4 hospitals):** the hospital Receptionist, Nurse,
Doctor, Lab Technician and Pharmacist keep exactly the screens they have now. What they lose is API access to the
clinical data of other departments. A hospital Manager or Cashier never had these screens and now has no API access
either. **Imaging** has no preset role, so only the Owner, or a custom role with Imaging ticked, can work it: a
Radiographer preset is a Phase 2 decision.

## 3. One patient identity (step 3)

- **`clients` is the patient.** It gains `next_of_kin_name`, `next_of_kin_phone` and `insurance` (name, phone, date of
  birth, gender and address are already there).
- **A `patients` row is now one hospital visit of a client:** it gains `client_id` (required, same business). Its
  name, phone, date of birth, gender, address, next of kin and insurance become a **copy kept by the database** from
  the client. They are set from the client on every write and refreshed when the client is edited, so the screens
  keep reading them unchanged. The copy goes when Phase 1 replaces `patients` with encounters.
- **Existing patients** (11 live): each is linked to the client of the same business with the same phone digits
  (the rule of `clients_phone_unique_per_business`), or a client is created from the patient's details. Next of kin
  and insurance move to the client where the client has none. Every visit is then refreshed from its client; where
  the visit's own details differed, the previous values are kept in `clinical_audit_log`.
- **Live effect (read 2026-11-17):** all 11 patients have a phone and none matches an existing client, so 11 clients
  are created. 8 are at hospitals. **3 are at pharmacies** (test patients from 2026-07-18, at businesses that can no
  longer see patient records): they appear in those pharmacies' client lists and cannot be deleted there while the
  visit rows exist. Removing that test data is an owner decision.
- **The old Reception screen keeps working** between the migration and the app deploy: a patient inserted without a
  client is linked the same way.
- **Deleting a client who has hospital visits is refused** with the reason "hospital records", like sales or debts
  (`delete_clients`, A19).

## 4. Atomic clinical writes (step 3)

Three SECURITY DEFINER functions validate the caller's module, write everything in one transaction, take the staff
name from the session (not from the browser), and return what they did:

- `register_hospital_visit(business, client, client details, visit)`: creates or updates the client and opens the visit at
  triage. Requires reception.
- `complete_hospital_consultation(patient, consultation, medicines, lab tests, imaging)`: saves the consultation and
  every request, works out the patient's next status, and posts the thread message. Either all of it is saved or
  none of it is. Requires doctor; the patient must be waiting for the doctor. This fixes A36: the Lab and
  Imaging sends wrote a column the tables do not have, and a failure left a saved consultation behind.
- `dispense_prescription(prescription)`: marks it dispensed with who and when. The patient is discharged only when
  nothing else is pending for them (lab, imaging or another prescription) and they are not admitted, referred or
  transferred. Requires rx_inbox. **Stock is not deducted** (it never was); that is Phase 2 with the stock ledger.

## 4a. The screens (step 4)

Data access for the hospital screens is in `apps/carehub/src/modules/hospital/` (repository with an injected
transport; pure services). The screens stay in `pages/dashboard/hospital/`.

| Screen | Change |
|---|---|
| Reception | "Returning patient? Find them first" searches the business's clients by name or phone. Picking one fills the form from their record, and only the details Reception changes are saved back to it. Otherwise a new client is created. One request (`register_hospital_visit`). A second open visit, or a phone another client has, is refused with an explanation. The form's two-column rows stack on phones. |
| Doctor | One request (`complete_hospital_consultation`). The screen checks first: a diagnosis, a destination, and something to send for each ticked destination. Prescription lines keep only id, name, generic name, dose, frequency, duration, route and instructions: catalogue products also carry cost price and stock, which no longer go into the clinical record. The confirmation shows the patient's real outcome (admitted, referred, at the lab …), not "discharged" whenever nothing was sent. |
| Rx Inbox | One request (`dispense_prescription`); says whether the patient was discharged. Medicine lists read with `asList`. |
| Lab | Requests read with the patient embedded (the table has no patient name); test lists read with `asList`; results saved as a JSON array. |
| Imaging | As Lab, and it gains the error state it lacked: a failed load showed "No pending scan requests". |
| Clients | `delete_clients`' new reason is shown as "has hospital visits". |

Error messages: the database functions' own messages are written for staff and are shown as they are. Any other
failure shows the screen's own message (`hospitalErrorMessage`), so a raw database error never reaches the screen.
`getTriage` now returns the visit's latest triage. The nine direct-write and read helpers the screens no longer use
were removed from `services/supabase.js`.

## 4b. Applying (owner approval for each)

1. `carehub_20270123_hospital_schema_baseline`: a no-op on production. Applying it records it in the migration
   ledger.
2. `carehub_20270124_hospital_access`. The deployed app keeps working: every write it makes is still allowed for the
   role that makes it (pinned by a test).
3. `carehub_20270125_hospital_identity_and_workflow`, then deploy the app (push to `main`). The new screens call its
   functions, so it must be live first.

After each, run a rolled-back live probe as in the PGlite tests, as for every earlier migration, and record it in
the migration header.

## 5. Not in Phase 0

The following are not part of Phase 0:

- encounters and the patient summary
- signing and addenda
- typed vitals and a triage scale
- the test catalogue, result validation and critical results
- report templates
- appointments for hospitals
- stock deduction on dispensing
- read auditing
- making Triage's save atomic: it still writes the vitals, then moves the patient to the doctor, as two requests

All of these belong to the specification's Phases 1–2, in the order of the gap analysis §6.

## 6. Rollback

Each migration's header gives its rollback. Step 3's identity link can be undone without data loss (the patient
copies are kept); step 2 restores the previous `FOR ALL` policies and grants.

## 7. Tests

| What | Where |
|---|---|
| Baseline reproduces live, including the findings (5) | `apps/carefind/src/test/hospital/hospitalBaseline.db.test.js` |
| Roles per module, boundary, `business_type` guard, no delete or truncate, history kept, row consistency, audit trail, today's app writes still allowed (17) | `apps/carefind/src/test/hospital/hospitalAccess.db.test.js` |
| Backfill, client as the one source, old Reception insert, `delete_clients`, the three functions, atomicity under a forced failure (15) | `apps/carefind/src/test/hospital/hospitalIdentityWorkflow.db.test.js` |
| Repository requests and search escaping; jsonb reading, payloads, checks, error messages, Reception client details (21) | `apps/carehub/src/modules/hospital/**/*.test.js` |
| Delete reason labels (2) | `apps/carehub/src/modules/clients/components/clientKeptReasons.test.js` |

All PGlite tests load the live helper definitions and grants (read 2026-11-16/17). The tests found two defects in the
first drafts of the migrations before anything was applied: an array append that would have refused every
consultation sent to a department, and existing visits keeping their own details after being linked.

**Manual test plan (after deploy, on a test hospital):**

1. Register a new patient, then the same patient again: they must be refused while the first visit is open.
2. Discharge them, then register them again by searching their phone: the visit opens on the same record.
3. Triage, then send to the doctor; complete a consultation with medicines, a lab test and a scan. Check that the Lab
   and Imaging queues show the patient's name.
4. Dispense: the patient is not discharged while the lab or scan is pending. Complete both, then dispense another
   prescription: they are discharged.
5. Repeat each step signed in as the wrong role (for example, a Cashier opening the Doctor URL): no data loads.
6. On a phone-width screen, use Reception's finder and form.
