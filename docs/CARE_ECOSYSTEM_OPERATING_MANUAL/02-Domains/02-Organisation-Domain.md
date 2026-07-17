# Organisation Domain

Version: 1.0

---

# Purpose

The Organisation Domain manages healthcare businesses operating within the Care Ecosystem.

An organisation represents the highest business boundary inside CareHub.

Every operational record belongs to exactly one organisation.

The Organisation Domain provides tenant isolation, business configuration and organisational hierarchy.

It is the foundation of the multi-tenant architecture.

---

# Responsibilities

The Organisation Domain owns:

- Healthcare Organisations
- Branches
- Departments
- Staff Membership
- Business Configuration
- Subscription Ownership
- Business Profile
- Operational Settings

No other domain should create or manage organisations.

---

# Scope

The Organisation Domain manages:

- Organisation Registration
- Branch Management
- Business Information
- Departments
- Organisation Preferences
- Staff Assignment
- Subscription Association

---

# Out of Scope

The Organisation Domain does not manage:

- Authentication
- Patients
- Clinical Records
- Inventory
- Billing
- Reports

Those belong to their respective domains.

---

# Actors

Platform Administrator

Organisation Owner

Branch Administrator

Healthcare Staff

---

# Business Concepts

## Organisation

A registered healthcare business using CareHub.

Examples include:

- Pharmacy
- Hospital
- Clinic
- Laboratory
- Imaging Centre
- Medical Store
- Wellness Centre

Every organisation is isolated from every other organisation.

---

## Branch

A physical operating location belonging to an organisation.

A single organisation may operate:

- One Branch
- Multiple Branches
- Regional Networks

Each branch maintains its own operational data while remaining connected to its parent organisation.

---

## Department

A functional unit within an organisation.

Examples:

- Pharmacy
- Laboratory
- Radiology
- Finance
- Reception
- Administration

Departments organize staff and workflows.

---

## Staff Member

A staff member is an authenticated user assigned to an organisation.

Staff may belong to:

- One Branch
- Multiple Branches

depending on permissions.

---

# Business Rules

Every organisation owns its own data.

Organisation data must never be visible to another organisation.

Every branch belongs to exactly one organisation.

Deleting an organisation is a controlled administrative operation.

Branch names do not need to be globally unique.

Organisation settings apply across all branches unless explicitly overridden.

---

# Multi-Tenancy

CareHub is a multi-tenant platform.

Each tenant represents one organisation.

Tenant isolation is mandatory.

Every database query must execute within the current tenant context.

Cross-tenant data access is prohibited unless performed by platform administrators.

---

# Branch Hierarchy

Organisation

↓

Branches

↓

Departments

↓

Staff

↓

Operational Activities

---

# Commands

Create Organisation

Update Organisation

Create Branch

Update Branch

Deactivate Branch

Assign Staff

Transfer Staff

Update Settings

---

# Events

Organisation Created

Organisation Updated

Branch Created

Branch Updated

Branch Closed

Staff Assigned

Settings Updated

---

# Integrations

Identity Domain

Subscription Domain

Patient Care Domain

Inventory Domain

Finance Domain

Marketplace Domain

Notification Domain

Reporting Domain

---

# Data Ownership

The Organisation Domain owns:

Organisation Profile

Branch Information

Department Structure

Business Configuration

Operational Preferences

No other domain should duplicate these records.

---

# Technical Notes

Every service should receive the current organisation context.

Tenant resolution should occur before business logic executes.

Branch context should be available throughout request processing.

---

# Future Evolution

Organisation Groups

Franchise Support

Regional Management

Corporate Dashboards

Business Templates

Cross-Organisation Reporting

API-based Organisation Provisioning