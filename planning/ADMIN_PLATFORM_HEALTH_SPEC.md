# Admin Platform Health — Owner Console Spec

**Status:** Draft for review — implements brainstorm 2026-09-08 (Platform Health P0, 7/7 selected)
**Owner lens:** Know in 5s if healthy, prove why if not, fix in one click, prove to auditor what you did.
**Existing surface audited:** `apps/carehub/src/pages/admin/AdminDashboard.jsx:1-1676` (SidebarRail:1275, CmdPalette:1194, DailyBrief:70, DashboardStats:126, BusinessesPanel:289 with 36px stripe table:484→card:528, Sheet:580, pulse:1614), `apps/carefind/src/modules/admin/AdminPanel.jsx` (19 tabs 856, callAdminAuth service-role), `apps/carehub/src/services/supabase.js` (sbFetch:25, sbFetchWithCount:451, BUSINESS_PUBLIC_COLUMNS:81), `architecture/Current-Architecture.md`, `planning/CODE_AUDIT.md` (C19/C20/C20a), `planning/roadmap.md` Phase 6-7 gap.

---

## 1. Goals

**Job to Be Done:** As SaaS owner, I hire the admin to tell me “are we making money safely” without asking engineers.
- Money: no silent leakage (Paystack vs ledger mismatch), payouts gated, plans editable.
- Trust: queue verifications/claims/reports with SLA, not tab-hunting.
- Health (this spec): uptime/error/jobs/abuse/flags/audit visible to non-engineer, with control.

**Non-goals:** Not Datadog/Sentry replacement; not tenant feature work; not second auth model.

## 2. Architecture Invariants (must hold)

1. **One Owner Console** in `apps/carehub/src/pages/admin/` extending `AdminDashboard.jsx:1606` shell. CareFind signals via `api/_handlers/admin-auth.js` service-role (proven for `list_verification_requests`), never anon `sbFetch`.
2. **RLS is the boundary.** New health tables = deny-all for `anon, authenticated`, `service_role` only — pattern `20260815_admin_rls_hardening` (admin_users). Verify behaviorally: anon SELECT 0 rows (42501), authenticated UPDATE 0, service-role reads OK. Match advisors INFO “RLS enabled no policy” like `withdrawal_requests`.
3. **Atomic finance untouched.** Payout stays `markPayoutPaidAtomic:606`; health never writes money.
4. **Clamp-aware.** All lists via `sbFetchWithCount:451` + `pagedQuery` (`supabase.js:208`), never unbounded `select=*`.
5. **Quiet chrome.** `var(--teal)` = state only, 13px body, `prefersReducedMotion:1385` respected, sticky 56px header:1611.

## 3. Data Model (service-role only)

```sql
-- Incident + banner
create table admin_incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  severity text not null check (severity in ('amber','red')),
  is_maintenance boolean not null default false,
  pause_signups boolean not null default false,
  created_by uuid references admin_team_members(id),
  created_at timestamptz not null default now()
);
-- Lightweight health probes (last 100)
create table admin_health_checks (
  id bigserial primary key,
  target text not null check (target in ('api','db','storage','paystack')),
  status text not null check (status in ('up','degraded','down')),
  latency_ms int,
  checked_at timestamptz not null default now()
);
-- Append-only audit (no UPDATE/DELETE policy)
create table admin_audit_log (
  id bigserial primary key,
  actor_admin_id uuid references admin_team_members(id),
  action text not null,
  target_table text not null,
  target_id text,
  before jsonb,
  after jsonb,
  ip text,
  ua text,
  created_at timestamptz not null default now()
);
-- Feature flags
create table feature_flags (
  key text primary key check (key in ('ecommerce_enabled','booking_enabled','visible_on_carefind','maintenance_mode')),
  enabled boolean not null default true,
  rollout_pct int not null default 100 check (rollout_pct between 0 and 100),
  allowlist text[] not null default '{}',
  updated_at timestamptz not null default now()
);
-- Export governance
create table export_logs (
  id bigserial primary key,
  actor_admin_id uuid references admin_team_members(id),
  export_type text not null,
  row_count int not null,
  reason text not null,
  watermark text not null,
  created_at timestamptz not null default now()
);
-- Dead letters
create table dead_letters (
  id bigserial primary key,
  queue text not null check (queue in ('notifications','webhooks','payout_mismatch')),
  payload jsonb not null,
  error text not null,
  retries int not null default 0,
  status text not null default 'open' check (status in ('open','retried','dismissed')),
  created_at timestamptz not null default now()
);
```
RLS: `alter table X enable row level security;` then zero policies for anon/authenticated (deny-all). Service-role bypasses RLS. Verify via `pg_policies` empty + probes.

Seed: `insert into feature_flags(key,enabled) values ('ecommerce_enabled',true),('booking_enabled',true),('visible_on_carefind',true),('maintenance_mode',false) on conflict do nothing;`

## 4. Screens (7) — spec per Quality Standard

Each screen must ship: loading skeleton (DashboardStats:134 pattern), error (ErrorState:149 with Retry), empty (Empty+CTA), responsive (table 36px sticky → card 768), a11y (aria-label, sr-only, keyboard, reduced-motion), logging to audit.

### H1 — Health Lights + Incident Banner
**File:** `apps/carehub/src/pages/admin/health/HealthLights.jsx`
**Route:** `tab=health` sub `lights` in AdminDashboard (SidebarRail add `ShieldAlert` item, perm `Health`).
**Header strip:** Directly under `AdminDashboard.jsx:1611` header, 40px, shows `🟢 API 23ms | 🟢 DB | 🟢 Storage | 🟢 Paystack | live • last synced 14:32` reusing `pulseOnline` dot:1614 + `lastSynced` ticker:1475.
**Polling:** 30s interval + realtime `postgres_changes` on `admin_health_checks` + `admin_incidents`. Offline → amber dot + `offline • last synced Xm ago`.
**Banner editor:** Sheet (like BusinessesPanel Sheet:580) fields: Title*, Message*, Severity (amber/red), `pause_signups` checkbox, `is_maintenance`. Writes `admin_incidents` via service-role RPC `create_incident` (SECURITY DEFINER, `search_path=public`, checks `platformPerms.Health`). Read path: `App.jsx` guard — if latest incident `pause_signups=true`, `registerBusiness` shows banner + blocks submit.
**States:** loading skeleton 4 dots pulse; error “Could not check health” + Retry; empty “All systems operational” + 30d sparkline mini (trend:235).
**Audit:** create/dismiss writes `admin_audit_log` (action `create_incident`/`dismiss_incident`).

### H2 — Error Inbox
**File:** `health/ErrorInbox.jsx`
**Data:** `dead_letters` queue=webhooks/notifications + Sentry ingest proxy via `api/_handlers/admin-auth.js` `list_error_logs` (service-role reads `postgres_logs` view if available, else file). Fallback to local `localStorage` error buffer if Sentry not configured.
**Table:** `Time | Where (POS/Paystack/Storage) | Business (link to 360) | Message | Count | Status` — 36px sticky, hover actions, `StatusDot` per severity. Filters pills (24h, payment-only, storage 42501).
**Detail drawer:** stack trace, `business_id`, `request_id`, “Mute 24h” (writes flag), “Create incident from this error” (prefills H1).
**States:** loading 6 skeletons; error “Could not load errors” + Retry; empty “No errors — last checked 14:32” + Go to Health.

### H3 — Migration Tracker
**File:** `health/MigrationTracker.jsx`
**Data:** Reads `supabase_migrations.schema_migrations` (via `sbFetch('supabase_migrations?select=*')` service-role) vs manifest `apps/carehub/sql/*.sql` list (bundled json at build). Columns: `File | Claimed (CODE_AUDIT.md) | Actually applied? | Applied at | Drift?` — red row if file header says APPLIED but `schema_migrations` missing (C20a trap). Also shows `admin_health_checks` latency.
**Action:** “Run advisors” button calls `supabase_get_advisors` proxy, renders `type=security|performance` with remediation link (per `get_advisors` tool shape). No write from UI.
**States:** loading scan skeleton; error; empty “No migrations found — check manifest”.

### H4 — Jobs & Dead Letters
**File:** `health/JobQueue.jsx`
**Tabs:** Notifications (failed `notify:628` swallows), Webhooks (Paystack HMAC retry), Payout mismatches (ledger vs plan_payments delta).
**Row:** `Payload (truncated) | Error | Retries | Retry Now | Dismiss` — Retry is idempotent RPC (`mark_payout_paid` reference-uniqueness). Each action audited.
**States:** loading; error; empty “All queues clear” with `CheckCircle` like `DailyBrief:100`.

### H5 — Abuse & Storage
**File:** `health/AbuseStorage.jsx`
**Rate:** Top 10 by RPM last hour from `postgres_logs` (path filter, `sbFetchWithCount`), columns `Business/IP | RPM | Last error | Throttle | Block`. Throttle writes `feature_flags` rate limit key (or `admin_audit_log` if no flag). Block = insert `blocked_ips` (service-role).
**Storage:** Per bucket bar (`credentials` 0.8GB/5MB limit 20260822 private, `live-media`, `promo-images`), usage vs `file_size_limit`+`allowed_mime_types` (`supabase_list_extensions` verify). Orphans: `storage.objects` where `business_id` orphaned or `deleted_at` set, bulk delete with `ConfirmDialog:632` consequence text.
**States:** loading; error; empty “No abuse detected”.

### H6 — Switches + Maintenance
**File:** `health/FeatureFlags.jsx`
**Toggles:** `ecommerce_enabled`, `booking_enabled`, `visible_on_carefind`, `maintenance_mode` + rollout slider 10/50/100 + allowlist emails (chips). Each toggle PATCH via `sbFetch('feature_flags?key=eq.xxx')` service-role, writes audit before→after.
**Env banner:** Footer card showing `VITE_SUPABASE_URL` host + `PAYSTACK_SECRET` check (`sk_live_REPLACE...` placeholder warns red) — reads `import.meta.env` at build, no secret exposure. Used by guards `businesses.visible_on_carefind`/`booking_enabled`.
**States:** loading switches skeleton; error; empty “No flags”.

### H7 — Audit & Export Log
**File:** `health/AuditLog.jsx`
**Feed:** Chronological `admin_audit_log` + `export_logs` merged, 36px row: `14:32 You suspended OpePharmacy pending→suspended — Undo (5s) | IP | UA`. Uses `BusinessesPanel:359` undo toast shape (5s, actionLabel Undo, onAction rolls back via audit `before`). Export rows: `14:30 Sarah exported 42 businesses — reason: monthly report — watermark #abc123`.
**Filters:** actor, action, target_table, date range (like H2). Sticky filter bar. Pagination `sbFetchWithCount`.
**Governance:** `toBusinessCsv:405` now requires reason modal → writes `export_logs` (row_count, watermark `genId()`-style), download includes watermark footer. Hard delete requires reason + second approver (reuse `ConfirmDialog` danger variant).
**States:** loading; error; empty “No actions yet”.

## 5. Security Verification (per slice)

Before merge, run in production (rolled back where writes):
- anon SELECT `admin_incidents` → 42501/0 rows; authenticated UPDATE → 0 (probe like C19:27)
- `pg_policies` empty for all 6 tables, `relrowsecurity=true`
- service-role via `callAdminAuth` reads OK
- `has_function_privilege` on RPCs: anon false, authenticated true where intended (like ADR `adr_fix_returning_rls:83`)
- Advisors rerun — no new ERROR, only expected SECURITY DEFINER WARN for service-role RPCs

## 6. Testing & Observability

- **Unit:** `modules/health/repositories` with in-memory adapter (like ADR `78 tests` pattern), covers flag toggle audit, incident create, export reason required, dead letter retry idempotency.
- **UI:** Vitest Testing Library for loading/error/empty/undo, responsive at 375/768/1280, keyboard nav, reduced-motion.
- **E2E (later):** Playwright: create incident → banner appears on /login; export with reason → log visible; toggle flag → tenant sees change.
- **Observability:** Sentry init in `main.jsx` (both apps), health lights feed fallback to `postgres_logs` if Sentry not configured.

## 7. Rollout Slices (vertical, tracer-bullet, per roadmap §7)

1. **H7 Audit + H1 Banner** (1 migration, 2 tables, 1 RPC `create_incident`, 2 panels) — proves owner control.
2. H2 Error Inbox (Sentry + proxy, dead_letters table)
3. H3 Migration Tracker (read-only, high trust)
4. H6 Switches (flags gate real features)
5. H4 Jobs + H5 Abuse/Storage
6. H1 Health Lights polling (cron + realtime health_checks)

Each slice: repo seam (`modules/health/repositories`), RLS probe, 5+ vitest, `vite build` clean, update `CODE_AUDIT.md` + `REMEDIATION-STATUS.md`.

## 8. Open Questions

- H2 source: Sentry free vs only `postgres_logs` proxy for MVP? Recommend Sentry free for stack traces.
- H5 rate limit enforcement: `feature_flags` vs edge function? Start audit-only, enforce in `sbFetch` wrapper later.
- Paystack health check: sample verify vs just URL reachability?

## 9. Acceptance (Definition of Done per roadmap §9)

- [ ] Data via repository with injected transport
- [ ] Every write scoped or service-role with RLS deny-all verified behaviorally
- [ ] RLS probe not catalog-only
- [ ] Loading/error/empty + responsive 375/768/1280
- [ ] No alert()/confirm() (use ConfirmDialog + Toast)
- [ ] Tests via in-memory adapter
- [ ] Audit entry for every write
- [ ] Commit discipline: schema + repo + UI separate commits

---
*Next: implement slice 1 (H7+H1) → slice 2 → … ; update `planning/CODE_AUDIT.md` per slice.*
