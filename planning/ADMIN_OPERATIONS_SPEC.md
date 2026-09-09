# Admin Operations & Support — Inbox, Broadcast, Command Spec

**Status:** Draft for review — implements brainstorm 2026-09-08 (Ops P0, owner lens)
**Owner lens:** Operations is “DM the CTO” → ticket. Every alert, export, and incident becomes a trackable job with owner and SLA.

## 1. Goal
As owner, I hire the admin to **see what needs me, tell everyone, and act in one keystroke**:
- **See:** Support inbox (`business_id`/`user_id` + status + assignee + SLA) — replaces “DM” with queue.
- **Tell:** Broadcast banner + Maintenance mode (kill signups, show page) — one toggle, all tenants see it (Health banner is incident-specific; Ops banner is comms).
- **Act:** Global `⌘K` natural language (`suspend OpePharmacy till Friday reason:dormant`) — existing `CmdPalette:1194` + `commandScore` + `buildCommandList`.

## 2. Data Model (additive)

```sql
create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id),
  user_id uuid references profiles(id), -- CareFind user
  subject text not null,
  body text not null,
  status text not null check (status in ('open','triaged','waiting','resolved','closed')) default 'open',
  priority text not null check (priority in ('low','medium','high','urgent')) default 'medium',
  assignee_admin_id uuid references admin_team_members(id),
  sla_due_at timestamptz, -- computed: priority urgent 4h, high 24h, etc.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  author_admin_id uuid references admin_team_members(id),
  body text not null,
  created_at timestamptz not null default now()
);
```

RLS: `is_platform_admin()` for both (health pattern). `support_tickets` SELECT allows tenant read own where `business_id IN (SELECT current_business_ids())` for future tenant-facing inbox, but admin reads all via platform_admin.

Indexes: `idx_tickets_status`, `idx_tickets_assignee`, `idx_tickets_sla`.

## 3. Screens

### O1 — Support Inbox
**File:** `pages/admin/ops/SupportInbox.jsx`
Table 36px: `Ticket | Business/User | Subject | Priority (dot) | SLA (red overdue) | Assignee | Status | Actions`. Filters: status/priority/assignee/search ilike, page `sbFetchWithCount`.
Click → sheet: timeline `support_messages` + `admin_audit_log` for ticket + `Business 360` link + `Assign to me` + `Resolve/Close` with `ConfirmDialog` consequence.

### O2 — Broadcast & Maintenance
**File:** `ops/Broadcast.jsx`
Reuses `feature_flags.maintenance_mode` + `admin_incidents` banner but adds **Ops comms**: Title/Message/Audience (all vs state vs tier) + `is_maintenance` (kills `registerBusiness` + shows page) + schedule. Writes `admin_incidents` + `feature_flags` + `admin_audit_log`.

### O3 — Command Palette Pro
**File:** `ops/CommandPro.jsx` (enhance existing `CmdPalette:1194`)
Adds natural language parsers: `suspend <business> till <date>`, `export businesses where state=Lagos`, `quarantine <post_id>` — each resolves to existing `commandRegistry` action + confirmation. Recent/frequent ranking already exists `recentCmdIds:1379`.

## 4. Slices

1. **O2 Broadcast reuse** (already Health banner) + **O1 read-only inbox** (no new table yet, mock)
2. O1 with `support_tickets` table + assign + SLA
3. O3 Command natural language

Each: repo seam, RLS probe, 5 tests, build.
