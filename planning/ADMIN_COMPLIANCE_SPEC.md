# Admin Compliance & Audit — Retention, Export Governance, NDPR Spec

**Status:** Draft for review — implements brainstorm 2026-09-08 (Compliance P0)
**Owner lens:** Compliance is “prove it at 3am” — every export, delete, and quarantine has a reason, watermark, and 1yr trail.

## 1. Goal
As owner, I hire the admin to **prove who did what, why, and that you can undo or forget on request**:
- **Prove:** `admin_audit_log` 90d → 1yr, `export_logs` watermark+reason (already Health H7), `moderation_actions` append-only.
- **Forget:** NDPR right-to-be-forgotten `business_id`/`profile` export ZIP + hard delete with 2-approver.

## 2. Data Model (additive, policy)

```sql
-- Extend existing audit retention (no new table, just policy)
-- Add retention view + purge job (cron deletes >1yr, audited)
create table compliance_requests (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('business','profile')),
  subject_id uuid not null,
  request_type text not null check (request_type in ('export','delete')),
  reason text not null,
  status text not null check (status in ('open','approved','rejected','completed')) default 'open',
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table compliance_requests enable row level security;
-- platform_admin only
```

RLS: `is_platform_admin()`.

## 3. Screens

### C1 — Audit Vault (extend Health AuditLog)
**File:** `pages/admin/compliance/AuditVault.jsx`
Extends `AuditLog.jsx:1` with **1yr filter + retention badge** (`90d` → `1yr`), `Watermark` column, `Export reason` required modal (already `BusinessesPanel:484` should enforce reason + watermark). Purge preview: “3,241 rows >1yr — purge will keep hash”.

### C2 — Compliance Requests (NDPR)
**File:** `compliance/Compliance.jsx`
Table `Subject | Type (export/delete) | Reason | Status | Requested | Actions`. Export → ZIP (business row + `staff` + `sales` sample + `invoices`) + `export_logs` watermark. Delete → 2-approver `ConfirmDialog` danger + `hardDeleteBusiness` soft vs hard (already `BusinessesPanel:632`).

## 4. Slices

1. **C1 Audit 1yr** (no new table, just filter + retention doc)
2. C2 Compliance requests table + export ZIP / delete 2-approver

Each: repo seam, RLS, tests, build.
