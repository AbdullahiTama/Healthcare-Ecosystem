# Identity Domain

Version: 1.0

---

# Purpose

The Identity Domain manages the authentication, authorization, identity lifecycle, and access control for every user within the Care Ecosystem.

It is responsible for answering one question:

"Who is performing this action, and are they allowed to perform it?"

Every authenticated interaction within CareHub and administrative functions within CareFind depend on this domain.

---

# Responsibilities

The Identity Domain owns:

- User Accounts
- Authentication
- Sessions
- Roles
- Permissions
- Access Control
- Password Management
- User Invitations
- Organization Membership
- Branch Membership
- Account Status

No other domain may implement authentication or authorization independently.

---

# Scope

The Identity Domain includes:

- Login
- Logout
- Password Reset
- Change Password
- User Invitation
- Role Assignment
- Permission Assignment
- Session Validation
- Account Activation
- Account Suspension

---

# Out of Scope

The Identity Domain does not own:

- Patient records
- Inventory
- Billing
- Clinical data
- Search
- Reports

It only controls access to those domains.

---

# Actors

System Administrator

Organization Owner

Branch Administrator

Healthcare Staff

Support Staff

Platform Administrator

---

# Business Concepts

## Identity

Represents a unique authenticated individual.

Every user has one identity.

---

## User

A user belongs to one organization.

A user may belong to one or more branches.

A user performs actions through assigned roles.

---

## Session

Represents an authenticated interaction.

Sessions expire according to security policy.

---

## Role

Defines a collection of permissions.

Examples:

Administrator

Doctor

Pharmacist

Cashier

Receptionist

Laboratory Scientist

Inventory Officer

---

## Permission

A permission grants access to perform a specific action.

Examples:

Create Patient

Delete Patient

View Reports

Adjust Inventory

Approve Purchases

Manage Users

---

# Business Rules

Every authenticated action requires a valid session.

Permissions are always evaluated before business logic executes.

Users cannot access another organization's data.

Branch-level restrictions apply where configured.

Inactive users cannot authenticate.

Suspended users cannot authenticate.

Passwords are never stored in plain text.

---

# Authentication Model

Current State

(Custom Authentication — update after code audit)

Future State

Centralized authentication service supporting:

- Secure sessions
- Multi-factor authentication
- Device management
- Session revocation
- OAuth (future)

---

# Authorization Model

Authorization follows Role-Based Access Control (RBAC).

Users receive Roles.

Roles contain Permissions.

Permissions authorize Actions.

Business domains consume permissions but do not define them.

---

# Commands

Login

Logout

Invite User

Create User

Assign Role

Assign Permission

Deactivate User

Reset Password

Change Password

Refresh Session

---

# Events

User Logged In

User Logged Out

Password Changed

Role Assigned

Permission Updated

User Invited

Session Expired

---

# Integrations

Organization Domain

Notification Domain

Audit Domain

Reporting Domain

Shared Platform

---

# Data Ownership

The Identity Domain owns:

User Accounts

Credentials

Roles

Permissions

Sessions

Access Policies

No other domain should duplicate these concepts.

---

# Technical Notes

The implementation must remain independent from any frontend framework.

Authentication should be exposed through well-defined services.

Business domains should consume authorization rather than implement it.

---

# Future Evolution

Single Sign-On

OAuth

Multi-Factor Authentication

Biometric Authentication

Device Management

API Tokens

Third-party Identity Providers