---
id: SPEC-carehub-admin-dashboard
companions:
  - architecture-diagrams.md
  - glossary.md
  - ../../planning-artifacts/architecture/architecture-HealthCare-Ecosystem-2026-09-06/ARCHITECTURE-SPINE.md
sources:
  - _bmad-output/brainstorming/brainstorm-carehub-admin-dashboard-2026-09-06/brainstorm-intent.md
  - _bmad-output/brainstorming/brainstorm-carehub-admin-dashboard-2026-09-06/brainstorm.html
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# CareHub Super Admin Dashboard — Owner Command Center

## Why

Vision to realize + pain to solve. You as owner live hours/day in `carefindhub.com/admin` (`apps/carehub/src/pages/admin/AdminDashboard.jsx:65` — 1,023 lines, 7 equal tabs) managing 28 → 1000+ businesses, 20-agent tiers, payouts and ledger on Supabase `szdybxmgmhndoytqanfb`. The current panel is functional (`c3ded50`) but front-loads chrome, uses card stacks and modals, polls 30s, and shows 4 KPIs without sparkline — it fails the 10-second test: *I open it, I know if today is okay, I approve the right 3 things without scrolling, and I trust the money is right.* Opportunity is to claim the Linear (quiet power tool) + Stripe (job nav + tables as product) spine that the 2026 best dashboards (Linear, Stripe, Vercel, Attio, Supabase, Mercury, Plausible) have proven survives the 200th daily session.

## Capabilities

- **CAP-1 — Command Center via job nav + Cmd+K**
  - **intent:** Owner can reach any business, agent, application or payout and execute Approve/Revoke/Pay as a command without navigating tabs.
  - **success:** `Cmd+K` (Ctrl+K) opens within 100ms, fuzzy matches 20+ commands, arrow+Enter executes; recent commands surface first; pending business `Acme` is approvable by typing `app ac` → `Enter` in <5 keystrokes, verified by e2e with crumb trail.

- **CAP-2 — Businesses as dense table with lifecycle sheet**
  - **intent:** Owner can scan, search (`ilike` on name), sort, and act on businesses as a dense table, drilling into a lifecycle timeline via side sheet.
  - **success:** Table shows 36px rows, sticky header, status dot (not pill), right-aligned mono ₦, inline hover actions; sheet (40% width, bottom sheet on mobile) shows `pending→active→suspended→revoked→reapply` timeline with tooltip distinction suspend=temporary/revoke=withdrawal; Approve/Suspend/Revoke/Soft-delete all work sheet-contained, table updates optimistically with undo 5s.

- **CAP-3 — Capped KPIs + single trend**
  - **intent:** Owner can see health in one glance without 5 decorative charts.
  - **success:** Dashboard shows ≤6 KPIs (hero Pending Approvals + 5 secondary) each with delta + sparkline, one 30d onboarding trend chart only; numbers use Mercury editorial whitespace, Plausible restraint verified by screenshot.

- **CAP-4 — Matrix permissions with vault dual-control**
  - **intent:** Owner can define platform roles and enforce that payout requires two different humans.
  - **success:** `admin_roles` matrix (8 perms × roles) with templates; hiring picks existing role from dropdown (no inline perms). `Approve → processing` and `Mark Paid` require different `admin_team_members` identities; attempt by same user is blocked, audited in `agent_transfers`/`payout_requests.reviewed_by`. Nav filtering via `navCatalogueFor` reuse, locked cards show *Requires Payouts* not empty.

- **CAP-5 — Statement as product + Daily Brief**
  - **intent:** Owner can trust money via Mercury-grade statements and an Attio-grade AI brief on inspectable data.
  - **success:** Ledger is aggregate view (not source of truth) over `business_wallet_transactions` + `plan_payments` + `shop_orders` + `agent_earnings`; entity search → statement with running balance; single export = styled PDF via `window.open+print` (`buildStatementHtml`); bulk = consolidated CSV + ZIP option flagged `confirm with Abdullahi`; top card Daily Brief summarizes 3 pending + 2 payouts ready with suggested next action and source links.

- **CAP-6 — Dark-first tokens, 12-col grid, realtime**
  - **intent:** Owner can work all day without fatigue and see live state without manual refresh.
  - **success:** CSS vars tokens (`--bg,--panel,--border,--teal`) with `data-theme` + `prefers-color-scheme`, color = state only (amber/green/red/gray), WCAG AA contrast; 12-col `auto-rows:minmax(200px,auto)` grid; pending counts via `supabase.realtime` subscription with pulse dot and `last-synced` badge, not 30s poll.

- **CAP-7 — Coverage map + referral graph**
  - **intent:** Owner can see agent capacity and money flow spatially.
  - **success:** Coverage map is interactive territory assignment (drag agent to state/LGA, heatmap density), respects 20-cap via `enforce_agent_tier_limit` (42501) surfaced inline; referral graph `agent→business→earnings` rendered as network, not just list.

## Constraints

- **DB becomes view, not source:** Ledger never writes a new financial truth; all money writes are `SECURITY DEFINER` `calculate_agent_earnings` (idempotent on `(payment_reference,agent_id)` WHERE NOT NULL) and `mark_payout_paid` (atomic payout+earnings/wallet), never client-side (`apps/carehub/src/services/supabase.js`).
- **Permission reuse, no duplicate system:** Must reuse `permissions.js` `getPerms/buildCustomPerms` pattern as `platformPermissions.js:normalizePlatformPermissions/navCatalogueFor` (`_bmad-output/brainstorming/.../brainstorm-intent.md:Matrix`). No second impl.
- **Density + restraint:** 36px rows, 13px body, tabular numbers; color never decorates, only signals state (Vercel monochrome system). Dark-first from day one — retrofitting light → dark is blocked.
- **Sheet not modal:** Business drill is side sheet (Linear slide-over), not modal; mobile is bottom sheet 50% with drag handle.
- **Soft-delete default, hard needs proof:** Businesses delete defaults to `deleted_at` + `revoked` (ledger preserved); hard requires typing business name + reason + second confirm (`ConfirmDialog` danger variant).
- **View security:** `platform_team_members` view must be `security_invoker=true` or inherits RLS; `admin_team_members.password_hash` never `Allow all` for anon (column-level or deny-all + service-role RPC).

## Non-goals

- No chat-widget AI; AI only as first-class summary card on inspectable data — never a floating bot over old UI.
- No 5 decorative charts; one trend only — more charts is explicitly out of scope.
- No hard-delete as default or one-click payout; no global search without Cmd+K.
- No new UI library (MUI/Chakra); hand-rolled `components/ui` + tokens stays.

## Success signal

Owner opens `/admin` on desktop and phone, sees pending count pulse without refresh, hits `Cmd+K` → `app ac` → `Enter` to approve Acme, sees table update + undo toast, opens Ledger → statement PDF prints with correct running balance matching `business_wallet_transactions` sum, and a second owner cannot Mark Paid the same payout. Time to approve <10s/2 clicks, Lighthouse a11y ≥95, and the dashboard passes the sentence: *I know in 10s if today is okay, I approve the right 3 things without scrolling, and I trust the money is right.*

## Assumptions

- Assumed `cmdk` + `command-score` stack for Cmd+K (Vercel pattern) since spec names `healthcare 2026` trends and input names dark-first + Cmd+K as stack-agnostic — if team prefers `kbar`, swap is isolated to registry.
- Assumed `businesses` remains 28 → 1000+; pagination is `limit/offset` with `count` header + `pagedQuery` fallback for clamp (proven 1000-row clamp on this Supabase project).
- Assumed owner has `admin_team_members` super-admin fallback to `businesses.is_platform_admin` for bootstrap (current DB has 0 members, 2 platform businesses).

## Open Questions

- Is Daily Brief AI generation server-side (Edge Function) or client-side via existing `REVIEW_AI` stub — and which LLM key?
- Is Ledger bulk ZIP of PDFs vs consolidated sheet the final choice for Abdullahi — spec says confirm, which to ship as default?
- Is Coverage map drag-assignment allowed to auto-create `agent_transfers` audit, or require explicit Transfer Account confirmation per §4.5?
