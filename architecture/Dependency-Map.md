CareHub Dependency Map

Code Archaeologist Report — apps/carehub

Built from a full import-graph sweep of apps/carehub/src (every lib/supabase, lib/permissions, lib/utils, lib/realtime, lib/email, and App/useAuth import), cross-referenced against the five module reviews already on file (Inventory, Patients, Hospital, Pharmacy, Laboratory). No code was modified.

---
1. System-Level Dependency Graph

App.jsx (AuthContext, localStorage 'carehub_auth')
  │
  ├─ Login.jsx / Register.jsx ──────────────► lib/supabase.js, lib/email.js, lib/utils.js
  │
  ├─ AdminDashboard.jsx ─────────────────────► lib/supabase.js, lib/email.js, lib/utils.js
  │
  └─ BusinessDashboard.jsx (owns `products` state, `perms`, `role`; fans out via pageProps)
        │
        ├─ Sidebar.jsx ───────────► lib/permissions.js (getNavItems), lib/utils.js, App.jsx (useAuth: logout)
        ├─ TopBar.jsx ────────────► App.jsx (useAuth: display name), lib/utils.js, components/ui
        ├─ NotificationBell.jsx ──► lib/supabase.js, lib/realtime.js (watchTable) — reads auth via
        │                           raw localStorage, NOT App.jsx's useAuth (see §6)
        │
        ├─ DashboardHome.jsx ─────► lib/supabase.js (sales), lib/utils.js
        ├─ Inventory.jsx ─────────► lib/supabase.js (products), lib/utils.js, components/ui
        ├─ POS.jsx ───────────────► lib/supabase.js (sales, settings, debts, offline queue), lib/utils.js
        ├─ Clients.jsx ───────────► lib/supabase.js (clients — NOT patients), lib/utils.js
        ├─ Appointments.jsx ──────► lib/supabase.js (appointments), lib/utils.js
        ├─ Expenses.jsx ──────────► lib/supabase.js (expenses), lib/utils.js
        ├─ Debts.jsx ─────────────► lib/supabase.js (debts), lib/utils.js
        ├─ Purchases.jsx ─────────► lib/supabase.js (purchases + debts), lib/utils.js
        ├─ Staff.jsx ─────────────► lib/supabase.js (staff, claims), lib/email.js, lib/permissions.js (ROLE_LIST)
        ├─ Reports.jsx ───────────► lib/supabase.js (sales + expenses + purchases), lib/utils.js
        ├─ Settings.jsx ──────────► lib/supabase.js (settings, business), lib/utils.js
        ├─ CareFind.jsx ──────────► lib/supabase.js (updateProduct — duplicates Inventory's toggle), lib/utils.js
        ├─ Locations.jsx ─────────► lib/supabase.js (locations, sales, products), App.jsx (useAuth), lib/utils.js
        ├─ Messages.jsx ──────────► lib/supabase.js (messages + files + staff)
        ├─ Orders.jsx ────────────► lib/supabase.js (orders + staff + products + territories + locations)
        ├─ Warehouses.jsx ────────► lib/supabase.js (enterprise locations + staff)
        ├─ Territories.jsx ───────► lib/supabase.js (territories + staff + rep assignments)
        ├─ Stock.jsx ─────────────► lib/supabase.js (stock batches/movements + enterprise locations + products)
        ├─ LiveActivity.jsx ──────► lib/supabase.js (activity fields/log) + lib/realtime.js (watchTable)
        ├─ ConsultationRouter.jsx ► (stub — no data dependency)
        │
        └─ hospital/
              ├─ Reception.jsx ──► lib/supabase.js (patients)
              ├─ Triage.jsx ─────► lib/supabase.js (patients, triage)
              ├─ Doctor.jsx ─────► lib/supabase.js (patients, triage, consultations, prescriptions)
              │                    + PRIVATE shadow service (own SB_URL/SB_KEY/sbFetch) for
              │                      lab_requests, imaging_requests, patient_messages
              │                    + App.jsx (useAuth), reads shared `products` prop
              ├─ RxInbox.jsx ────► lib/supabase.js (prescriptions, patients), reads shared `products` prop
              ├─ Lab.jsx ────────► PRIVATE shadow service (own SB_URL/SB_KEY/sbFetch) for
              │                      lab_requests, lab_results, patient_messages
              │                    + lib/supabase.js (patients — read only, unused in practice)
              │                    + App.jsx (useAuth)
              └─ Imaging.jsx ────► PRIVATE shadow service (own SB_URL/SB_KEY/sbFetch) for
                                     imaging_requests, patient_messages
                                   + App.jsx (useAuth)

Every leaf page also imports from components/ui/index.jsx (near-universal — not repeated per line above) and most import formatting/constant helpers from lib/utils.js.

---
2. Components → Services

Consumer: Inventory.jsx
Service functions called: getProducts, addProduct, updateProduct, deleteProduct, deleteProductsBulk
Notes: Clean, single source
────────────────────────────────────────
Consumer: POS.jsx
Service functions called: addSale, updateSale, getSales, getTodaySales, getSettings, queueOfflineSale, getOfflineQueue,
addDebt, updateDebt
Notes: Also mutates products only in local state — never calls updateProduct (documented defect, Inventory review §11)
────────────────────────────────────────
Consumer: Purchases.jsx
Service functions called: getPurchases, addPurchase, updatePurchase, addDebt, updateDebt, getDebts
Notes: Writes to debts — a second module reaching into Debts' table alongside Debts.jsx and POS.jsx
────────────────────────────────────────
Consumer: Clients.jsx
Service functions called: getClients, addClient, updateClient
Notes: Operates on clients, not patients — silently unrelated to the hospital pipeline despite sharing the "Patients"
label for hospital tenants
────────────────────────────────────────
Consumer: Reception.jsx, Triage.jsx, Doctor.jsx, RxInbox.jsx
Service functions called: getPatients, addPatient, updatePatient, getTriage, addTriage, addConsultation, getPrescriptions,
 addPrescription, updatePrescription
Notes: Correctly centralized in lib/supabase.js
────────────────────────────────────────
Consumer: Lab.jsx, Imaging.jsx
Service functions called: Not lib/supabase.js for their core data — each defines a private, duplicated sbFetch/credential
pair and its own CRUD functions
Notes: See §6 (tight coupling to copy-pasted infrastructure, not to a shared service)
────────────────────────────────────────
Consumer: Doctor.jsx
Service functions called: Both lib/supabase.js (patients/triage/consultations/prescriptions) and its own private shadow
service (lab_requests/imaging_requests/patient_messages)
Notes: A single file straddling two different service patterns
────────────────────────────────────────
Consumer: NotificationBell.jsx
Service functions called: getMyNotifications, markNotificationRead, markAllNotificationsRead (lib/supabase.js) +
watchTable (lib/realtime.js)
Notes: Only component pairing a poll-based fetch with a live subscription
────────────────────────────────────────
Consumer: LiveActivity.jsx
Service functions called: 13 functions from lib/supabase.js + watchTable
Notes: Largest single import list in the codebase — a sign this page's responsibilities (fields config, live feed,
reactions, comments, voice upload, geocoding) could be split
────────────────────────────────────────
Consumer: Staff.jsx
Service functions called: lib/supabase.js (staff CRUD, claims) + lib/email.js (emailStaffWelcome)
Notes: Only page that bridges data-service and email-service
────────────────────────────────────────
Consumer: CareFind.jsx
Service functions called: updateProduct only
Notes: Single-function dependency, entirely overlapping with Inventory.jsx's own CareFind toggle (§6)

---
3. Hooks → Providers

CareHub has exactly one context provider (AuthContext, defined and exported from App.jsx) and one local convenience hook (useToast, defined in components/ui/index.jsx, not a context — just a useState wrapper instantiated fresh per component).

Hook: useAuth()
Provider: App.jsx's AuthContext.Provider (wraps the whole app; value = { auth, login, logout, isAdmin })
Consumers: BusinessDashboard.jsx, Sidebar.jsx, TopBar.jsx, Locations.jsx, Login.jsx, Doctor.jsx, Lab.jsx, Imaging.jsx
Notes: The only real provider→consumer relationship in the app
────────────────────────────────────────
Hook: useToast()
Provider: (no provider — instantiated locally per component)
Consumers: Nearly every dashboard page (Inventory, POS, Purchases, Clients, Staff, Reception, Triage, Doctor, RxInbox,
Lab, Imaging, …)
Notes: Each call creates an independent toast state; a toast shown by a child component never reaches a parent's <Toast/>
renderer unless that exact component also renders its own <Toast msg={msg}/> — confirmed pattern: every page
independently renders its own Toast
────────────────────────────────────────
Hook: Bypass case
Provider: NotificationBell.jsx reads auth via a private readAuth() → JSON.parse(localStorage.getItem('carehub_auth'))
instead of useAuth()
Consumers: —
Notes: The one component in the whole tree that reaches around the context provider to read the same state a different way
(§6)

lib/realtime.js's watchTable() is not a React hook (no use prefix, not built on useEffect internally) — it's a plain function each caller wraps in its own useEffect. It has exactly two callers: NotificationBell.jsx (staff_notifications) and LiveActivity.jsx (field_activities). No other live-data surface in the app uses it, despite five separate hospital-station pages (Reception/Triage/Doctor/Lab/Imaging) each independently polling or requiring manual refresh for what is, functionally, the same kind of "new work arrived" signal watchTable already solves.

---
4. Services → Database Tables

lib/supabase.js (the canonical service file) touches, by function group:

┌──────────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────┐
│      Domain      │                                            Table(s)                                             │
├──────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Auth/business    │ businesses                                                                                      │
├──────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Staff            │ staff, staff_claims                                                                             │
├──────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Products         │ products                                                                                        │
├──────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Sales            │ sales                                                                                           │
├──────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Clients          │ clients                                                                                         │
├──────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Expenses         │ expenses                                                                                        │
├──────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Appointments     │ appointments                                                                                    │
├──────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Debts            │ debts                                                                                           │
├──────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Purchases        │ purchases                                                                                       │
├──────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Hospital         │ patients, triage, consultations, prescriptions                                                  │
│ patients         │                                                                                                 │
├──────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Settings         │ business_settings                                                                               │
├──────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Admin            │ admin_team                                                                                      │
├──────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Notifications    │ staff_notifications                                                                             │
├──────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Enterprise       │ enterprise_locations                                                                            │
│ locations        │                                                                                                 │
├──────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Territories      │ territories, rep_territories                                                                    │
├──────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Messages         │ internal_messages, internal_message_recipients, internal_message_files, Storage bucket          │
│                  │ message-files                                                                                   │
├──────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Stock            │ stock_batches, stock_movements                                                                  │
│ (enterprise)     │                                                                                                 │
├──────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Orders           │ orders, order_items, order_watchers, order_files, order_events, Storage bucket order-files      │
├──────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Field activity   │ activity_fields, activity_default_viewers, field_activities, activity_viewers,                  │
│                  │ activity_reactions, activity_comments, Storage bucket activity-voice                            │
└──────────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────┘

Three private shadow services (Doctor.jsx, Lab.jsx, Imaging.jsx) each independently reach lab_requests, lab_results, imaging_requests, and patient_messages — four tables with zero representation in the canonical service file. Every write to these four tables happens through hand-duplicated sbFetch calls, not through lib/supabase.js.

lib/realtime.js doesn't own any table — watchTable(tableName, ...) is generic and is pointed at staff_notifications and field_activities by its two callers; it could equally be pointed at any of the four shadow-service tables but currently isn't.

Two tables never read back by anything (dead-write tables, confirmed in the Patients/Laboratory reviews): consultations and lab_results are inserted into and never queried again by any page in the codebase.

---
5. Module → Module Dependencies

From: POS.jsx
To: Inventory (products prop)
Nature: Reads product catalog for the sale screen; does not write back to it (stock decrement is local-state-only —
Inventory review, critical defect)
────────────────────────────────────────
From: Doctor.jsx
To: Inventory (products prop)
Nature: Reads "Medicines" category for prescribing; read-only, no stock reservation
────────────────────────────────────────
From: RxInbox.jsx
To: Inventory (products prop)
Nature: Reads stock to flag "out of stock" on a prescription line; advisory only, doesn't block dispensing
────────────────────────────────────────
From: POS.jsx → Debts
To: writes debts rows directly on any underpaid/credit sale
Nature: Debts module has no awareness this is happening except by reading the resulting rows — no shared "debt creation"
service, this logic is duplicated between POS.jsx and Purchases.jsx
────────────────────────────────────────
From: Purchases.jsx → Debts
To: writes debts rows on any unpaid purchase, and independently re-implements the "find and update matching debt"
reconciliation logic that POS.jsx doesn't have a mirror of
Nature: Two independent debt-writing code paths with no shared helper
────────────────────────────────────────
From: Doctor.jsx → RxInbox.jsx
To: via prescriptions table
Nature: One-way handoff, no shared type/shape validation
────────────────────────────────────────
From: Doctor.jsx → Lab.jsx / Imaging.jsx
To: via lab_requests / imaging_requests
Nature: One-way handoff; Doctor.jsx also separately duplicates "lab tests ordered" as free text into
prescriptions.lab_tests, read only by RxInbox.jsx — two disconnected representations of the same doctor decision
reaching two different downstream modules (Laboratory review §10–11)
────────────────────────────────────────
From: Clients.jsx ("Patients" label) ↔ Reception/Triage/Doctor (patients table)
To: No dependency at all despite both being called "Patients" in the hospital UI
Nature: Confirmed disconnected systems (Hospital review §10.2)
────────────────────────────────────────
From: Staff.jsx → lib/email.js
To: fires emailStaffWelcome on every staff creation, including Pharmacist/Doctor/Nurse/Lab Technician roles
Nature: Cross-cutting side effect from a data-management page into the email subsystem
────────────────────────────────────────
From: Sidebar.jsx/DashboardHome.jsx/ConsultationRouter.jsx/BusinessDashboard.jsx
To: each independently re-derive business_type (brand?.business_type || brand?.type || 'skincare')
Nature: Four parallel copies of the same one-line derivation (Hospital review §11)
────────────────────────────────────────
From: CareFind.jsx ↔ Inventory.jsx
To: both independently implement the identical list_on_carefind toggle against products
Nature: Parallel, duplicated UI/logic for the same field (Inventory review §11)

---
6. Tight Coupling

- Lab.jsx / Imaging.jsx / Doctor.jsx are tightly coupled to a copy-pasted infrastructure block (identical SB_URL, SB_KEY, sbFetch() implementation, plus near-identical getPatientMessages/addPatientMessage) rather than to a shared abstraction. This is coupling of the worst kind — three files depend on the same code without depending on the same reference to it, so a fix, a credential rotation, or a bug patch made in one silently does not propagate to the other two.
- POS.jsx is behaviorally coupled to Inventory.jsx's stock number without any enforced contract. It reads and displays products.stock and computes a discount/checkout flow around it, but the write-back that would keep that number honest doesn't exist — the two modules look connected through the shared products prop but are not connected through any actual persistence contract.
- Doctor.jsx is coupled to three different downstream modules through three different mechanisms simultaneously: lib/supabase.js for patients/prescriptions, its own private shadow service for lab/imaging requests, and a redundant free-text field for a fourth (Pharmacy's view of "lab tests"). A single consultation submission fans out through three structurally different data paths.
- The five hospital station pages are tightly coupled to one shared, unversioned string enum (patients.status: at_reception/at_triage/at_doctor/at_lab/at_pharmacy/discharged/admitted) with no shared constant — each page's StatusBadge (duplicated in Reception.jsx and Triage.jsx) hardcodes its own subset of this vocabulary.
- NotificationBell.jsx is tightly coupled to the literal localStorage key 'carehub_auth' rather than to the AuthContext every other component uses — an implementation detail (the storage key name and shape) leaking into a component that should only need to know "who is logged in," which the context already exposes.

---
7. Unnecessary Dependencies

- NotificationBell.jsx's direct localStorage read is an unnecessary, redundant path to information useAuth() already provides one component away. There is no technical reason for this component not to consume the context like TopBar.jsx and Sidebar.jsx (its own siblings inside Sidebar.jsx) already do.
- CareFind.jsx as a whole page is largely an unnecessary dependency surface — its only meaningful function (updateProduct toggling list_on_carefind) is already fully implemented inside Inventory.jsx. The page adds a second render tree, a second fetch of the same products data pattern, and a second place a future bug fix must be applied, for functionality that already exists elsewhere.
- Lab.jsx's import of getPatients/updatePatient from lib/supabase.js is dead weight — per the Laboratory review, this module never reads or writes patients (patient identity comes from denormalized fields already on the lab_requests row); the import exists but the functions are unused in the file's actual logic paths reviewed.
- Three independent copies of SB_URL/SB_KEY/sbFetch() are, from a dependency-management standpoint, three unnecessary re-declarations of infrastructure that already exists as an importable module (lib/supabase.js's internal, unexported sbFetch) — nothing about Lab/Imaging/Doctor's needs required reinventing this rather than exporting and importing it.
- consultations and lab_results tables are written to by services that have no consumer anywhere in the codebase — from a system perspective, the write dependency exists (Doctor/Lab depend on being able to persist this data) but the corresponding read dependency that would justify the data model's shape (structured results JSON with unit/normal_range fields) is entirely unrealized, making that part of the service's contract speculative/unused.

---
8. Suggested Improvements

1. Fold the three shadow services into lib/supabase.js. Export getLabRequests, getLabResults, addLabResult, updateLabRequest, getImagingRequests, updateImagingRequest, addLabRequest, addImagingRequest, getPatientMessages, addPatientMessage once, alongside the existing patient/prescription functions they already sit next to conceptually. This removes three duplicated credential blocks and gives the four orphan tables a single, discoverable home.
2. Make NotificationBell.jsx consume useAuth() instead of re-reading localStorage directly, eliminating the one place auth state can drift from the context's view of it.
3. Introduce one shared PATIENT_STATUSES (or equivalent) constant consumed by Reception.jsx, Triage.jsx, Doctor.jsx, and RxInbox.jsx, removing the duplicated StatusBadge maps and giving the pipeline's state machine a single source of truth that's easier to audit for dead states (at_reception, admitted) and missing transitions (the at_lab dead end).
4. Give POS.jsx a real write-back to products.stock (via the existing updateProduct) so the dependency it already visually implies (POS depends on and affects Inventory) becomes a dependency that actually holds at the data layer.
5. Retire CareFind.jsx as a standalone page, or make it the single owner of the list_on_carefind toggle and have Inventory.jsx link out to it rather than re-implementing the same control — one owner per piece of state, not two.
6. Extend watchTable() usage to the hospital pipeline, particularly Reception.jsx's incoming-patient list and Doctor.jsx's "waiting for doctor" queue — both are exactly the "new row landed, staff needs to know now" pattern watchTable already solves for notifications and field activity, and both currently have no live-update mechanism at all (manual refresh or none).
7. Split LiveActivity.jsx's 13-function import surface into smaller, purpose-scoped hooks/services (e.g., "activity feed," "activity field config," "activity reactions/comments") so the page's dependency footprint reflects its actual sub-responsibilities rather than one flat list.
8. Centralize the business_type derivation (brand?.business_type || brand?.type || 'skincare') into one exported helper in lib/utils.js, replacing the four independent copies in Sidebar.jsx, DashboardHome.jsx, ConsultationRouter.jsx, and BusinessDashboard.jsx.
9. Either wire consultations/lab_results into a real read path (a patient-history or result-detail view) or treat their current write-only status as a flagged, intentional gap rather than an accidental one — right now the dependency exists in the schema without a corresponding purpose anywhere in the UI.
10. Reconcile Doctor.jsx's two "lab tests ordered" representations (the structured labTests array feeding lab_requests, and the free-text consult.labTests feeding prescriptions.lab_tests) into one, so Laboratory and Pharmacy staff are guaranteed to be looking at the same doctor decision rather than two independently-typed lists that can silently disagree.