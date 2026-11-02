# Code Audit: Open Items

The open problems in the CareHub ecosystem, each with evidence, a severity and what would close it. Read it before a
change (`CLAUDE.md` / `AGENTS.md`); when you close or find an item, update it here in the same change.

- **Verified** means checked against the code at the stated commit or the live database on the stated date. Nothing
  here is inferred from comments or docs alone.
- Severity: **High** (security or data exposure, act soon), **Medium** (integrity, governance or a defect waiting to
  happen), **Low** (hygiene, tooling, debt).
- Detailed audits live in `docs/audits/`; this file indexes their open items rather than repeating them (section 3).

Last full review: 2026-11-02, against `main` at `c52f666` and the live Supabase project `szdybxmgmhndoytqanfb`.

## 1. Summary

| ID | Severity | Area | Item | Status |
|---|---|---|---|---|
| A1 | High | Security / ADR | PV routing P0-1 fix is live but was never probed live; the trigger is the only barrier | Open: live probe owed |
| A2 | Medium | Governance | `export_logs` is not append-only: platform admins can edit or delete export records | Open |
| A3 | Medium | Process | 27 migrations say "not applied", "draft" or "review only" but are all live; a live migration also sits in `pending-migrations/` | Open |
| A4 | Medium | Security | Supabase security advisor: 2 errors and several actionable warnings | Open, partly accepted |
| A5 | Medium | Quality | React hook rules are not linted | Open |
| A6 | Medium | Data model | `plan_catalog` and `business_subscriptions` are unused mirrors; the Plan Catalog screen edits prices checkout ignores | Open: owner decision |
| A7 | Low | Admin | Hard delete of a business is selectable again | Open: owner decision |
| A8 | Low | Tooling | CodeRabbit reviews never run on PRs to `main` | Open |
| A9 | Low | Debt | About 600 `no-unused-vars` warnings | Open, tracked in Linting.md |

## 2. Items

### A1. PV routing: the P0-1 fix has never been probed live (High)

**What:** [docs/audits/carefind-carehub-pv-routing-audit.md](../docs/audits/carefind-carehub-pv-routing-audit.md)
P0-1 found that a public reporter could set their own route to `status='routed'` at any business, exposing the case
(including patient data) to that business. `carehub_20261113_adr_route_write_guard` (ledger `20261020185832`) adds the
trigger `trg_adr_guard_route_writes`, which refuses API-role changes to routing columns. Its header says the catalogue
was verified but **"Live behavioural probe NOT run."**

**Evidence (live, 2026-11-02):** the trigger is present and enabled. `authenticated` still holds column UPDATE on every
route column (`status`, `responsible_business_id`, `selection_kind`, `verified_*` and others), so the trigger is the
only barrier. 12 routes are `routed` and 2 `pending`, so real cases now depend on it.

**Close by:** a rolled-back live probe as an `authenticated` public-draft owner (insert a non-pending route, flip
`status` and `responsible_business_id` on an existing route); expect refusals. Record the result in the migration
header. Optionally revoke the column grants too, as defence in depth.

### A2. `export_logs` can be edited or deleted (Medium)

**What:** every platform-admin export (business, application, payout, subscription, ADR and payment exports since
PR #39) is declared in `export_logs` with a reason and watermark before the file is produced. That record is meant to
be the accountability trail, but it is not protected.

**Evidence (live, 2026-11-02):** policy `export_logs_platform_admin` is `ALL` for `is_platform_admin()`, so any
platform admin can `UPDATE` or `DELETE` rows through the REST API. `authenticated` holds `INSERT, SELECT, UPDATE,
DELETE, TRUNCATE`. There is no trigger on the table. Compare `audit_log`, which `carehub_20261209_record_export_audit`
made append-only (client grants reduced to `SELECT`, update/delete/truncate refused by trigger).

**Close by:** the same treatment as `audit_log`: revoke client `UPDATE, DELETE, TRUNCATE`, add an append-only trigger,
keep `INSERT` for platform admins (or move writes behind a SECURITY DEFINER function that stamps the actor).
The admin console only inserts and reads, so nothing in the app changes.

### A3. Migration status headers drift from the live ledger (Medium)

**What:** headers are how a reader knows whether a protection is live. 27 files in `supabase/migrations/` still say
`NOT YET APPLIED`, `STATUS: NOT APPLIED`, `DRAFT — not yet applied` or `REVIEW ONLY — do NOT apply`.

**Evidence (live, 2026-11-02):** all 27 have a same-named entry in `supabase_migrations.schema_migrations`. They
include the ADR delete guards and routing migrations, `carehub_20261209_record_export_audit`, the businesses insert
guard, and the August referral, roles and master-catalogue migrations. Separately,
`docs/architecture/pending-migrations/carehub_20261211_sales_write_hardening.sql` is a draft in the folder for
migrations that must not be applied, yet `carehub_20261211_sales_write_hardening` is in the live ledger, and that
folder's README does not mention it.

**Risk:** someone re-applies a migration believing it is missing, or assumes a protection is absent (or present) when
it is not.

**Close by:** update the 27 headers to `APPLIED (version ...)`, move or annotate the stale draft, and add a check (a
test that reads a committed ledger snapshot, or a header convention a script can verify) so the two cannot drift
silently again. The file list is reproducible with
`grep -l -i "NOT YET APPLIED\|STATUS: NOT APPLIED\|not applied yet\|REVIEW ONLY" supabase/migrations/*.sql`
(27 files on 2026-11-02).

### A4. Supabase security advisor findings (Medium)

**Evidence (advisor run 2026-11-02, 208 findings in 8 groups):**

| Level | Finding | Count | Notes |
|---|---|---|---|
| ERROR | SECURITY DEFINER views | 2 | `adr_pv_case_view` is intentional and documented (column masking needs it; ADR-Privacy-Security-Audit.md). `carefind_products` has no recorded rationale: **review**. |
| ERROR | RLS disabled in public | 1 | `spatial_ref_sys`, the PostGIS reference table. Usually accepted; record the decision. |
| WARN | Mutable `search_path` | 3 | `create_shop_order`, `shop_order_receipts_guard`, `plan_enforcement_started_at`. One-line fixes (`SET search_path = public, pg_temp`). **Fix.** |
| WARN | Leaked-password protection off | 1 | Supabase Auth setting (HaveIBeenPwned check). **Enable** in the dashboard. |
| WARN | Extensions in `public` | 2 | `pg_trgm`, `postgis`. Moving them is disruptive; record as accepted unless there is a reason. |
| WARN | anon may execute SECURITY DEFINER functions | 24 | **Review** each one is meant to be public. |
| WARN | authenticated may execute SECURITY DEFINER functions | 141 | Mostly by design (RPCs that check the caller first, e.g. the three admin subscription functions). Spot-check the ones without an explicit caller check. |
| INFO | RLS enabled, no policy | 34 | Deny-all for clients; fine where only server code uses the table. |

**Close by:** fix the three `search_path` functions, enable leaked-password protection, review `carefind_products` and
the 24 anon-executable functions, and write down the accepted items so the next run only shows new findings.

### A5. React hook rules are not linted (Medium)

**Evidence (`main` at `c52f666`):** the shared `.eslintrc.json` loads only `eslint-plugin-react`; there is no
`eslint-plugin-react-hooks`, so `react-hooks/rules-of-hooks` and `exhaustive-deps` never run (a disable comment for
them fails lint with "Definition for rule ... was not found"). A real defect of this kind shipped: `DashboardStats` in
the admin console called hooks after early returns, which React rejects when the business list goes from empty to
non-empty. It was fixed in PR #39.

**Close by:** add `eslint-plugin-react-hooks` to both apps' devDependencies with `rules-of-hooks: error` and
`exhaustive-deps: warn`, then fix what it reports (expect a burst of `exhaustive-deps` warnings first).

### A6. Unused plan mirrors; Plan Catalog edits prices nothing uses (Medium, owner decision)

**Evidence (live and code, 2026-11-02):** `business_subscriptions` has 0 rows and, since PR #39, nothing in the admin
console reads it. `plan_catalog` holds `basic, pro, enterprise`, but the app sells `basic, growth, premium,
enterprise, custom`. Checkout (`api/_handlers/initiate-plan-payment.js`) takes prices from `src/lib/planLimits.js`, and
Money › Plan Catalog still creates and edits `plan_catalog` rows. An admin changing a price there changes nothing a
customer pays.

**Close by (decide one):**
1. make the database the price source (seed `plan_catalog` with the real plans; checkout and limits read it), or
2. retire `plan_catalog` and `business_subscriptions` and remove the Plan Catalog screen (or make it read-only from
   `planLimits.js`).

### A7. Hard delete of a business is selectable again (Low, owner decision)

**What:** PR #39 fixed `ConfirmDialog` props across the admin console. That made the Delete business dialog's
Soft/Hard choice visible; before, the choice never rendered and every delete was soft. `hardDeleteBusiness` issues a
plain `DELETE` on `businesses`, which the dialog itself warns "may break ledger references".

**Close by:** decide whether hard delete should exist in the console. If yes, require a typed confirmation and a
reason (and audit it); if no, remove the option and keep soft delete.

### A8. CodeRabbit never reviews pull requests to `main` (Low)

**Evidence:** on PR #39 (base `main`, the default branch) CodeRabbit skipped with "Auto reviews are disabled on
base/target branches other than the default branch", reporting `Repository: Unavailable` and no configuration
applied. Its check run is `skipped` on every push.

**Close by:** check the CodeRabbit installation's repository access and add a `.coderabbit.yaml`, or remove the app if
it is not wanted.

### A9. Lint debt (Low)

About 600 `no-unused-vars` and 140 `no-empty` warnings remain across both apps (warnings, not CI failures). The
burn-down plan and ratchet are in [docs/architecture/Linting.md](../docs/architecture/Linting.md) §3. The admin
dashboard alone reports 28.

## 3. Open items recorded in other audits

Not re-verified in this review; see each document for evidence and status.

| Source | Open items |
|---|---|
| [PV routing audit](../docs/audits/carefind-carehub-pv-routing-audit.md) | P1-1 no notifications on routing events; P1-2 unknown/typed-company routes are dead ends; P1-3 tracker picks an arbitrary route per report; P1-4 companies cannot open private attachments (no signed URLs); P1-5 follow-ups on public cases reach nobody; P1-6 tracker has no refresh; P1-7 routed-company visibility of patient fields needs privacy-lead sign-off. (P0-1: see A1.) |
| [Financial figures consistency audit](../docs/audits/2026-10-31-financial-figures-consistency-audit.md) | F7 store money in kobo; a server-side `sales_summary` as the figure of record; per-business time zone; device clock skew. |
| [Live field activity audit](../docs/audits/live-field-activity-audit.md) §18.4 | Retention period for report positions; NDPA lawful basis review for location capture; whether owners can correct or remove reports; one timing-sensitive test; F2 and F10 owner decisions. |
| [Pending migrations](../docs/architecture/pending-migrations/README.md) | `purge_old_report_coordinates` held for the retention decision; `orders_read_scope` held for the warehouse-access decision. |
| [ADR privacy and security audit](../docs/architecture/ADR-Privacy-Security-Audit.md) | Reporter masking interim until the privacy lead rules; routing/follow-up notification templates need comms and privacy sign-off. |

## 4. Recently closed

| Item | Closed in |
|---|---|
| Stored XSS in ADR print documents (concomitant medication fields from the public form) | PR #39 (`e171e47`) |
| CSV formula injection in admin and ADR exports | PR #39 (`e171e47`) |
| Admin confirmation dialogs rendered no explanation (`message`/`variant` vs `consequence`/`danger`) | PR #39 (`e171e47`) |
| Dialogs opened from a detail sheet appeared behind it | PR #39 (`e171e47`) |
| Admin dashboard hooks after early returns | PR #39 (`88627c7`) |
| Platform staff had no audited way to change a plan (raw PATCH, no reason or actor) | PR #39, migration `carehub_20261230_admin_subscription_management` |
| Money › Revenue showed ₦0 from an empty mirror table | PR #39 (`7255952`) |
