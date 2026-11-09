# CareHub Ecosystem: Project Overview

How the repository is put together, where things run, and which documents hold the detail. Product vision and mission
are in the [README](../README.md); open problems are in [planning/CODE_AUDIT.md](../planning/CODE_AUDIT.md). A roadmap
(`planning/ROADMAP.md`) is owner-maintained and has not been written yet.

Last reviewed: 2026-11-02, against `main` at `c52f666` and the live Supabase project.

## 1. Products

| Product | Who uses it | App |
|---|---|---|
| **CareHub** | Healthcare businesses (pharmacies, hospitals, clinics, labs, imaging, skincare) run their operations: POS, inventory, purchases, staff, appointments, finance, reports, ADR reporting. Platform staff run the business from its admin console. | `apps/carehub` |
| **CareFind** | The public: find providers, medicines and facilities; social feed, news, live streams, marketplace and shop, wallet. Has its own admin panel for content, shop and payments. | `apps/carefind` |

Both apps share one Supabase project, so a business created in CareHub is the same `businesses` row CareFind shows.

## 2. Repository layout

```
apps/
  carehub/      Vite + React SPA, Vercel serverless API (api/), Vitest
  carefind/     Vite + React SPA, Vercel serverless API (api/ incl. cron, webhooks), Vitest, PGlite DB tests
  docs/         older architecture notes (financial architecture, migration-ledger reconciliation)
packages/
  design-system         design tokens and UI primitives used by both apps
  shared-email          email delivery and templates (outbox, Resend)
  shared-payments       server-side payment provider abstraction (Paystack adapter)
  shared-payout-ui      client logic for payout screens (bank search, account lookup, PIN)
  shared-marketplace    marketplace logic shared by both apps
  shared-notifications  notification helpers shared by both apps
supabase/migrations/    every database migration (carehub_*, carefind_*), 249 files
docs/                   architecture notes (docs/architecture), audits, privacy, plans and specs (docs/superpowers)
planning/               code audit and financial-system master plan
.github/workflows/      CI (see section 7)
```

## 3. CareHub (`apps/carehub`)

- **Business dashboard:** `src/pages/dashboard/BusinessDashboard.jsx` hosts feature modules from `src/modules/`:
  POS, inventory and stock ledger, purchases, transfers, warehouses, locations, staff, clients, debts, appointments,
  consultation, orders, expenses, reports, money and wallet, settings and billing, ADR (pharmacovigilance), business
  directory, field activity and check-ins, e-commerce, notifications and messages, among others.
  Module convention: `components/`, `services/` (pure business logic), `repositories/` (data access with an injected
  `request` transport, so tests bind an in-memory or recording adapter).
- **Platform admin console:** `src/pages/admin/AdminDashboard.jsx` plus panels in `src/pages/admin/*`. Covers
  businesses, applications (including ambassador/agent), team, ledger, payouts, coverage, health, money (revenue,
  plan catalog, subscriptions, reconciliation, invoices), trust, growth, ops, compliance, ADR reports, PV routing and
  directory. Section permissions come from `lib/platformPermissions.js` (UI only); the database decides access with
  `is_platform_admin()`. See [Admin-Records-Subscriptions-and-Mobile.md](architecture/Admin-Records-Subscriptions-and-Mobile.md).
- **API:** `api/router.js` dispatches to `api/_handlers/*` (plan, wallet and appointment payments, withdrawals, payout
  accounts and KYC, staff invitations, registration, email, webhooks, cron). Every `/api/*` path rewrites to the
  router so the app fits the Vercel Hobby function limit.
- **Plans:** limits and prices live in `src/lib/planLimits.js` (checkout reads prices from there); state rules in
  `src/lib/planStatus.js`, mirrored by the database's `plan_state()`. See [Plan-Limits-and-Expiry.md](architecture/Plan-Limits-and-Expiry.md)
  and [Subscription-Billing.md](architecture/Subscription-Billing.md).

## 4. CareFind (`apps/carefind`)

Feature modules in `src/modules/`: healthcare and business discovery, business profiles and reviews, claims, social
feed, news publishing, live streaming, playlists, media upload, marketplace and shop, wallet and payments,
subscriptions and monetisation, safety (ADR) reporting, agents hub, account, and the admin panel
(`src/modules/admin`). The API (`api/`) includes the payment webhooks and the daily crons (email outbox drain,
subscription-expiry reminders). Deployment specifics: [apps/carefind/DEPLOYMENT.md](../apps/carefind/DEPLOYMENT.md).

## 5. Data and security model (Supabase project `szdybxmgmhndoytqanfb`, eu-west-1)

- **Row-level security everywhere.** A business is identified by the signed-in email (`businesses.email`), staff
  through `staff`, and `current_business_ids()` / `is_business_owner()` scope tenant rows. Platform staff are rows
  with `businesses.is_platform_admin`, checked by `is_platform_admin()`.
- **Privileged columns are guarded by triggers**, not just policies (for example `guard_business_privileged_columns`
  keeps plan, expiry, status and the admin flag platform-only).
- **Sensitive writes go through SECURITY DEFINER functions** that validate and audit, with client write grants
  revoked: plan renewals (`renew_business_plan`), stock and sales ledgers, ADR routing, export audit
  (`record_export_audit`), admin subscription changes (`admin_manage_subscription`).
- **Money is server-authoritative.** Payment intents, settlement, commissions, refunds, withdrawals and
  reconciliation run in the database and serverless handlers. See [Financial-Architecture.md](../apps/docs/architecture/Financial-Architecture.md)
  and [Payment-Security-Matrix.md](architecture/Payment-Security-Matrix.md).
- **Audit trails:** `admin_audit_log` (platform changes), `audit_log` (append-only; tenant exports),
  `export_logs` (platform-admin exports, reason and watermark), `subscription_events` (append-only),
  `adr_report_events` (case timeline).

### Migrations

- Files in `supabase/migrations/` are named `carehub_YYYYMMDD_*` or `carefind_YYYYMMDD_*`. They are applied to the
  live project deliberately (Supabase migration ledger: 446 entries on 2026-11-02), not by a pipeline.
- Each migration opens with a header: problem, fix, security implications, rollback, and a **Status** line that is
  updated to `APPLIED ... (version ...)` with verification evidence once it is live. Drafts that must not be applied
  live in `docs/architecture/pending-migrations/`.
- Database behaviour is tested on PGlite (real Postgres in WebAssembly) with the live table shapes, in
  `apps/carefind/src/test/*/*.db.test.js`, before anything is applied.

## 6. Deployment

- **Vercel, through its GitHub integration.** Each app is its own Vercel project (`carehub` → `apps/carehub`,
  `healthcare-ecosystem` → `apps/carefind`). Every push builds a preview; a push to `main` is the production deploy.
  Vercel reports both as commit statuses ("Vercel – carehub", "Vercel – healthcare-ecosystem").
- Both projects are shaped around the Vercel Hobby plan: at most two cron jobs each, daily schedules, a single
  serverless router per app. A repo-wide test enforces the cron contract (see DEPLOYMENT.md §4).
- Server secrets (`SUPABASE_SERVICE_ROLE_KEY`, Paystack, Resend, `CAREHUB_APP_URL`, `CRON_SECRET`) are set in each
  Vercel project; `.env.example` in each app lists them.

## 7. CI (`.github/workflows`)

| Workflow | Runs | On |
|---|---|---|
| CareHub CI | lint, `lint:undef`, `npm audit` (high), tests, build | `apps/carehub/**`, `packages/**` |
| CareFind CI | the same, plus the financial suite on real Postgres (which also runs the PGlite migration tests) | `apps/carefind/**`, `packages/**`, `supabase/**`, `apps/carehub/vercel.json` |
| Financial mutation gate | mutation tests for money code in CareFind and the shared payment/email packages | `supabase/**`, `apps/carefind/api/**`, the payment tests, `packages/shared-payments`, `packages/shared-email` |
| Shared packages CI | tests and `npm audit` per package | `packages/**` |

## 8. Testing

Each workspace has its own Vitest setup (see the README's Testing table). Tests exercise public interfaces:
repositories with recording transports, services as pure functions, components mounted with `react-dom` and `act`,
and database migrations on PGlite. On 2026-11-02 CareHub had 304 test files and 3,207 tests.

## 9. Engineering conventions

- Read the README, this overview, the roadmap and the code audit before a change (`CLAUDE.md` / `AGENTS.md`).
- Business logic in services, data access in repositories, presentation in components.
- Every screen has loading, error and empty states, works on phones, and is keyboard and screen-reader usable.
- Security changes state their implications; nothing widens access without saying so.
- Every change updates its architecture note in `docs/architecture/` (the folder has one per feature area) and adds a
  test plan.

## 10. Where to read more

| Topic | Document |
|---|---|
| Admin console, subscriptions, exports, revenue | [architecture/Admin-Records-Subscriptions-and-Mobile.md](architecture/Admin-Records-Subscriptions-and-Mobile.md) |
| Plans, limits, expiry, reminders | [architecture/Plan-Limits-and-Expiry.md](architecture/Plan-Limits-and-Expiry.md), [architecture/Subscription-Billing.md](architecture/Subscription-Billing.md) |
| Payments, settlement, wallets, withdrawals | [architecture/CareHub-Payment-Flows.md](architecture/CareHub-Payment-Flows.md), [architecture/Settlement-Engine.md](architecture/Settlement-Engine.md), [architecture/Withdrawal-Engine.md](architecture/Withdrawal-Engine.md) |
| Stock and inventory | [architecture/Stock-Ledger.md](architecture/Stock-Ledger.md), [architecture/Inventory-Large-Catalogs.md](architecture/Inventory-Large-Catalogs.md) |
| ADR / pharmacovigilance | [architecture/ADR-Routing-Foundation.md](architecture/ADR-Routing-Foundation.md), [architecture/ADR-Privacy-Security-Audit.md](architecture/ADR-Privacy-Security-Audit.md), [audits/carefind-carehub-pv-routing-audit.md](audits/carefind-carehub-pv-routing-audit.md) |
| Importer / manufacturer operating models, representative ledgers, transaction register | [architecture/Importer-Operating-Models.md](architecture/Importer-Operating-Models.md) |
| Debts, Clients and Expenses filters; adding customers at the POS; held sales shown at once | [architecture/Record-Filters-POS-Customers-and-Held-Sales.md](architecture/Record-Filters-POS-Customers-and-Held-Sales.md) |
| Business directory and discovery | [architecture/CareHub-Business-Directory-and-Discovery.md](architecture/CareHub-Business-Directory-and-Discovery.md) |
| Production readiness, performance | [architecture/Production-Readiness.md](architecture/Production-Readiness.md), [architecture/Performance-and-Resilience.md](architecture/Performance-and-Resilience.md) |
| Linting | [architecture/Linting.md](architecture/Linting.md) |
| Held draft migrations | [architecture/pending-migrations/README.md](architecture/pending-migrations/README.md) |
