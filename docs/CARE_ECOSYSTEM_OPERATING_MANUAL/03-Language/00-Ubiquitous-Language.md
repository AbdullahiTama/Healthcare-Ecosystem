# Ubiquitous Language

Version: 1.0

---

# Purpose

The Care Ecosystem uses a shared business language across engineering, product, design, operations and AI systems.

Every important term has exactly one meaning.

Business terminology always takes precedence over technical terminology.

If code and documentation disagree with this document, this document is considered the authoritative business definition.

---

# Core Principles

One concept.

One definition.

One meaning.

No ambiguity.

---

# Organisation

A healthcare business registered on CareHub.

Examples:

- Pharmacy
- Hospital
- Clinic
- Laboratory
- Imaging Centre

An organisation is the highest business boundary in the platform.

Every operational record belongs to one organisation.

---

# Branch

A physical operating location belonging to an organisation.

Branches share organisational identity but maintain operational independence.

---

# User

An authenticated individual who interacts with the platform.

Examples include:

- Pharmacist
- Doctor
- Nurse
- Laboratory Scientist
- Cashier
- Administrator

Users belong to organisations.

---

# Patient

A person receiving healthcare services.

Patients may receive services from multiple organisations.

Patients are not employees.

---

# Customer

A person purchasing products or services.

A customer is not necessarily a patient.

Example:

Someone purchasing over-the-counter medication.

---

# Healthcare Provider

A registered healthcare organisation delivering healthcare services.

Healthcare providers are discoverable through CareFind after publication.

---

# Appointment

A scheduled interaction between a patient and a healthcare provider.

Appointments may produce consultations, investigations or procedures.

---

# Encounter

A single interaction between a patient and a healthcare provider.

An encounter begins when care starts and ends when that episode of care is completed.

One appointment usually creates one encounter.

Walk-in patients create encounters without appointments.

---

# Consultation

A clinical assessment performed by a qualified healthcare professional.

Consultations may produce:

Diagnosis

Prescription

Laboratory Requests

Imaging Requests

Clinical Notes

---

# Diagnosis

The clinical conclusion reached during a consultation.

Diagnoses may generate treatment plans.

---

# Prescription

A list of medicines or treatments recommended by a clinician.

Prescriptions are fulfilled through dispensing.

---

# Dispensing

The controlled process of supplying prescribed medicines.

Dispensing updates inventory.

---

# Medicine

A pharmaceutical product managed within inventory.

A medicine may exist in multiple batches.

---

# Batch

A manufactured quantity of a medicine.

Every batch contains:

Batch Number

Expiry Date

Quantity

Purchase Cost

Supplier

---

# Stock Movement

Any operation that changes inventory.

Examples:

Purchase

Sale

Adjustment

Transfer

Return

Expiry

Damage

---

# Invoice

A financial record representing charges for healthcare services or products.

---

# Payment

Settlement of an invoice.

---

# Subscription

A commercial agreement granting an organisation access to CareHub.

---

# Public Listing

Information intentionally exposed through CareFind.

Only approved public information may appear within a listing.

---

# Search Result

A healthcare provider, medicine or healthcare service returned by CareFind.

---

# Business Rule

A rule governing how healthcare operations are performed.

Business rules belong to domains rather than user interfaces.

---

# Domain

A logical business capability responsible for specific business rules.

Domains own behaviour.

Modules implement domains.

---

# Workflow

A sequence of business activities performed to complete a healthcare task.

The software exists to support workflows.

---

# Event

A significant business occurrence.

Examples:

Patient Registered

Medicine Dispensed

Invoice Paid

Appointment Booked

---

# Command

An intentional request that changes business state.

Examples:

Create Patient

Dispense Medicine

Create Invoice

Register Organisation

---

# Decision

A documented architectural or business choice that guides future development.

Decisions are recorded in Architecture Decision Records (ADRs).

---

# AI Rule

Claude Code and all AI agents must use these definitions consistently.

If uncertainty exists, this document takes precedence over assumptions.