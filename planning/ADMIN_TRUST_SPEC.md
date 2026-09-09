# Admin Trust & Safety — Verification, Claims, Moderation Spec

**Status:** Draft for review — implements brainstorm 2026-09-08 (Trust P0, owner lens)
**Owner lens:** Trust is not a tab. It’s the license to operate — a fake doctor, a fake pharmacy, or a bad drug review can kill the brand.
**Existing surface audited:** `apps/carefind/src/modules/admin/AdminPanel.jsx:158` 19 tabs (verifications, claims, reports, drug intel, users, posts), `apps/carehub/src/pages/admin/AdminDashboard.jsx:289` Businesses approve/suspend/revoke + `649` TeamAgents, `carefind` credentials bucket private `20260822`, `modules/adr` signal.

---

## 1. Goal

As owner, I hire the admin to **decide who is real, who owns what, and what stays visible** — with SLA, evidence, and appeal, not delete-and-hope.

- **Who is real:** professional verifications `verification_requests` (credentials private bucket → signed URL)
- **Who owns what:** `business_claims` (CareFind user → CareHub business) + `staff_claims` (CareFind user → CareHub staff) — today split across two admins
- **What stays visible:** `reports` (post/product/review flagged) → quarantine, not just delete `AdminPanel.jsx:756`

## 2. Invariants

1. **Evidence stays private.** `credentials` bucket `public=false` `20260822`, MIME whitelist, folder-scoped `auth.uid()` — admin opens via `credential_url` signed 5m (`AdminPanel.jsx:690` `openCredential`).
2. **Quarantine ≠ Delete.** Hide from feed/search/index, keep row, log `moderation_actions`, allow appeal. Delete is permanent `reports` + `likes` fragment fix `20260822_reposts_reference`.
3. **RLS is tenant-scoped.** `verification_requests` `business_claims` have `business_id` or `user_id` scoping; admin reads via `is_platform_admin()` or service-role `callAdminAuth`.
4. **Audit every decision.** approve/reject/quarantine/appeal → `admin_audit_log` (reuse health audit), plus `moderation_actions` append-only.

## 3. Data Model (additive)

```sql
-- Moderation actions (append-only)
create table moderation_actions (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('post','product','review','verification','claim','report')),
  target_id uuid not null,
  action text not null check (action in ('quarantine','restore','approve','reject','delete')),
  reason text not null,
  actor_admin_id uuid references admin_team_members(id),
  created_at timestamptz not null default now()
);
-- Quarantine flag on existing tables (add column, don't new table for MVP)
alter table posts add column if not exists is_quarantined boolean not null default false;
alter table products add column if not exists is_quarantined boolean not null default false;
-- Appeals
create table moderation_appeals (
  id uuid primary key default gen_random_uuid(),
  moderation_action_id uuid not null references moderation_actions(id),
  appellant_id uuid not null, -- profiles.id or businesses.id
  reason text not null,
  status text not null check (status in ('open','upheld','denied')) default 'open',
  created_at timestamptz not null default now()
);
-- Indexes
create index if not exists idx_moderation_target on moderation_actions(target_type, target_id);
create index if not exists idx_appeals_status on moderation_appeals(status);
```

RLS: enable + platform_admin policy (health pattern). `is_quarantined` read filter added to public feed/search `where is_quarantined=false` (tenant sees only clean).

## 4. Screens (Trust) — what you click

### T1 — Trust Queue (Unified, SLA)
**File:** `pages/admin/trust/TrustQueue.jsx`
**Source:** merges `verification_requests?status=pending` + `business_claims?status=pending` + `staff_claims` + `reports?status=pending` + `moderation_appeals?status=open` into one feed, sorted `created_at desc`, like `AdminPanel.jsx:196` `allNotifs` but with SLA.
**Row:** `🩺 Verify · Ada · RN · 2h ago · 22h left` with `severity` (red <4h, amber <24h) + evidence preview (signed URL button, disabled while `credentialLoadingId`).
**Filters:** All / Verify / Claims / Reports / Appeals + SLA overdue toggle.
**Actions:** Approve/Reject per type (calls `callAdminAuth` existing handlers `approve_verification:716` etc.), each writes `moderation_actions` + `admin_audit_log` + notifies appellant.
**States:** loading skeleton, error Retry, empty “All caught up — no trust queue” with `CheckCircle`.

### T2 — Verifications Workbench
**File:** `trust/Verifications.jsx`
**Enhances `AdminPanel.jsx:976` verifications tab:** adds OCR hint (expiry extraction), `MDCN/PCN` registry link, `View Credential` signed URL (`openCredential:690` sync tab open), phone `verification_requests.phone` via `phoneMap:184`, inline reject reason required.
**Bulk:** select → Approve 5 with same reason.

### T3 — Claims Center (Unified CareHub+CareFind)
**File:** `trust/Claims.jsx`
**Merges:** `business_claims` (CareFind → CareHub `visible_on_carefind`) + `staff_claims` (already `Staff.jsx` approve). Single pane `business | claimant | evidence | BusinessPanel 360 link`.
**Verify:** shows `businesses` row + `profiles` + credential, “Approve → writes `businesses.owner_email` + notifies”.

### T4 — Moderation HQ (Quarantine)
**File:** `trust/Moderation.jsx`
**Queue:** `reports` joined `posts`/`products`/`reviews` + `is_quarantined` flag.
**Actions:** Quarantine (hides from `Feed.jsx`, `Search.jsx` `DrugProfile.jsx`), Restore, Delete (permanent, `ConfirmDialog` consequence), all write `moderation_actions` + audit + toast undo 5s (like `BusinessesPanel:359`).
**Detail drawer:** post content, author `profiles` card (`AdminPanel.jsx:646` `viewPostDetails`), report reason, prior actions timeline.

### T5 — Drug Intel → ADR Signal
**File:** `trust/DrugIntel.jsx`
**Source:** `products` + `product_reviews` sentiment (reuse `reviewAI.js` stub vs CareFind full Anthropic) → flag `is_quarantined` + auto-create `adr_reports` draft via `adrReportRepository.createReport` if adverse keywords + low rating.
**Signal:** `adr_report_analytics` view already `is_serious` → spike by `business_id` auto-notify `DailyBrief:70`.

## 5. Security & Correctness

- anon `verification_requests` SELECT 0, `credential_url` only via signed `credential_url` RPC 5m (AdminPanel:700).
- `moderation_actions` deny-all anon/auth non-admin, platform_admin via `is_platform_admin()`, service-role.
- Quarantine is UPDATE `is_quarantined` with `WITH CHECK (is_platform_admin())` mirror businesses guard `C18`.
- Advisors rerun: no new ERROR, only expected `SECURITY DEFINER` WARN.

## 6. States, Responsive, A11y

- Loading skeleton, error + Retry, empty “No pending…”, 36px table → card 768, `aria-label` search/filter, keyboard, reduced-motion.
- Every approve/reject/quarantine → audit + toast.

## 7. Slices

1. **T1 Queue read-only** (aggregate existing 4 sources, no new tables) — proves unified queue.
2. T2 Verifications polish + bulk (no OCR yet)
3. T4 Moderation quarantine (`is_quarantined` column + `moderation_actions` table)
4. T3 Claims unify (join CareHub+CareFind)
5. T5 Drug Intel → ADR auto-draft

Each: repo seam `modules/trust/repositories`, RLS probe, 5 tests, build clean.

## 8. DoD

- [ ] Repository injected transport
- [ ] RLS behaviorally verified
- [ ] Loading/error/empty + responsive
- [ ] No alert()/confirm()
- [ ] Tests
- [ ] Audit every write

---
*Next: implement slice 1 (T1) → slice 2 → …*
