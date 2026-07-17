# Chapter 4 — Business Domain Model

Version: 1.0 (Draft)

---

# Purpose

This document defines the business language used throughout the Care Ecosystem.

Every engineer, product manager, designer, QA engineer, technical writer and AI assistant should use these definitions consistently.

The purpose of this document is to establish a shared language across the company.

The Business Domain Model is the foundation upon which the software architecture is built.

Software should model the business.

The business should never be forced to fit the software.

---

# Ecosystem Overview

The Care Ecosystem consists of three major domains.

## CareHub

The internal operating system used by healthcare providers.

## CareFind

The public healthcare discovery platform used by patients.

## Shared Platform

Common services shared by both applications including:

- Authentication
- Users
- Organisations
- Notifications
- Payments
- Search
- Analytics
- Integrations

---

# Core Business Entities

Everything inside the Care Ecosystem revolves around the following business entities.

These entities represent business concepts rather than database tables.

---

# Organisation

An organisation is any healthcare business using CareHub.

Examples include:

- Pharmacy
- Hospital
- Clinic
- Laboratory
- Imaging Centre
- Wellness Centre

Every organisation owns its own data.

Organisations are isolated from one another.

---

# Branch

A branch represents a physical location belonging to an organisation.

One organisation may own multiple branches.

Each branch manages:

- Inventory
- Staff
- Patients
- Sales
- Reports

independently while remaining connected to the parent organisation.

---

# User

A user is any authenticated person using the platform.

Examples include:

- Administrator
- Pharmacist
- Doctor
- Nurse
- Laboratory Scientist
- Cashier
- Receptionist
- Inventory Officer

Users belong to organisations.

Users perform actions according to assigned roles and permissions.

---

# Patient

A patient is a person receiving healthcare services.

Patients may interact with multiple healthcare providers over time.

Patient records should remain accurate, secure and confidential.

---

# Customer

A customer purchases products or services.

A customer is not always a patient.

Example:

Someone buying over-the-counter medicine.

---

# Healthcare Provider

A healthcare provider is a registered organisation offering healthcare services.

Healthcare providers become discoverable through CareFind after publishing approved public information.

---

# Appointment

An appointment represents a scheduled interaction between a patient and a healthcare provider.

Appointments may result in:

- Consultation
- Laboratory Request
- Imaging Request
- Prescription
- Follow-up

---

# Consultation

A consultation is the clinical interaction between a patient and a healthcare professional.

It may produce:

Diagnosis

Prescription

Laboratory Orders

Imaging Orders

Clinical Notes

---

# Prescription

A prescription contains medicines recommended for a patient.

Prescriptions may later be dispensed by a pharmacy.

---

# Medicine

A medicine represents a pharmaceutical product managed within inventory.

A medicine may exist in multiple batches.

---

# Batch

A batch represents a specific manufactured quantity of a medicine.

Each batch maintains:

- Batch Number
- Manufacture Date
- Expiry Date
- Quantity
- Purchase Cost

Inventory should follow FEFO (First Expiry First Out).

---

# Inventory

Inventory represents every stock item managed by an organisation.

Inventory includes:

Medicines

Consumables

Medical Supplies

Laboratory Reagents

Imaging Consumables

---

# Stock Movement

A stock movement represents any transaction affecting inventory.

Examples include:

Purchase

Sale

Adjustment

Transfer

Return

Damage

Expiry

Every stock movement should be auditable.

---

# Supplier

Suppliers provide products purchased by organisations.

Suppliers support purchasing workflows and inventory replenishment.

---

# Invoice

An invoice records financial charges for healthcare services or products.

Invoices may include:

Consultation

Medicines

Laboratory Services

Imaging Services

Hospital Charges

---

# Payment

Payments settle invoices.

Multiple payment methods may be supported.

---

# Subscription

A subscription grants an organisation access to CareHub.

Subscription plans determine available features and usage limits.

---

# Public Listing

A public listing represents information exposed through CareFind.

Public listings may include:

Organisation Profile

Services

Medicines

Opening Hours

Contact Information

Location

Ratings

Public listings never expose confidential operational data.

---

# Relationships

Organisation

↓

Branches

↓

Users

↓

Patients

↓

Appointments

↓

Consultations

↓

Prescriptions

↓

Dispensing

↓

Billing

↓

Payments

Selected information

↓

CareFind

↓

Public Discovery

---

# Design Principles

Business entities describe business concepts.

Database tables implement business entities.

The two should not be confused.

Business language always takes priority over technical implementation.

---

# Ownership

CareHub owns operational business data.

CareFind consumes approved public data.

Shared Platform manages common infrastructure.

Every business entity has one authoritative owner.

There must never be multiple sources of truth.